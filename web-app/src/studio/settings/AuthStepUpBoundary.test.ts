/**
 * Real-HTTP regression for the global step-up fetch boundary.
 *
 * A real Bun server owns the 403 challenge and the verify route; the test only
 * supplies the user's code/cancel decision. It pins the observable protocol:
 * each independent request may challenge → verify → replay once, a still-refused
 * retry is returned (no loop), cancel sends no verify/replay, and a Request
 * body survives the one replay.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createStepUpFetch, type FetchLike } from "./AuthStepUpBoundary";

interface Counter {
	protectedHits: number;
	verifyHits: number;
	grant: number;
}

const counters: Counter = { protectedHits: 0, verifyHits: 0, grant: 0 };

const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/api/auth/2fa/verify") {
			counters.verifyHits += 1;
			const body = (await request.json()) as { code?: string };
			if (body.code !== "123456") return Response.json({ error: "invalid code" }, { status: 400 });
			counters.grant = 1;
			return Response.json({ verifiedUntil: "2026-11-12T12:10:00.000Z", method: "totp" });
		}
		if (url.pathname === "/protected") {
			counters.protectedHits += 1;
			if (counters.grant > 0) {
				counters.grant -= 1;
				return new Response("ok");
			}
			return Response.json({ error: "totp_required" }, { status: 403 });
		}
		if (url.pathname === "/echo") {
			counters.protectedHits += 1;
			if (counters.grant > 0) {
				counters.grant -= 1;
				return new Response(await request.text());
			}
			return Response.json({ error: "totp_required" }, { status: 403 });
		}
		if (url.pathname === "/always") {
			counters.protectedHits += 1;
			return Response.json({ error: "totp_required" }, { status: 403 });
		}
		return new Response("missing", { status: 404 });
	},
});

const base = `http://127.0.0.1:${server.port}`;
const inner: FetchLike = (input, init) => fetch(input instanceof Request ? input : new URL(String(input), base), init);

const prompt = (): Promise<string | null> => Promise.resolve("123456");
const cancel = (): Promise<string | null> => Promise.resolve(null);

afterAll(() => {
	server.stop(true);
});

describe("global step-up fetch boundary", () => {
	test("two independent calls on the same URL each challenge, verify, then replay once", async () => {
		counters.protectedHits = 0;
		counters.verifyHits = 0;
		counters.grant = 0;
		const wrapped = createStepUpFetch(inner, { prompt });
		const first = await wrapped(`${base}/protected`);
		const second = await wrapped(`${base}/protected`);
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(counters.protectedHits).toBe(4);
		expect(counters.verifyHits).toBe(2);
	});

	test("a retry that is still refused is returned, not looped", async () => {
		counters.protectedHits = 0;
		counters.verifyHits = 0;
		counters.grant = 0;
		const wrapped = createStepUpFetch(inner, { prompt });
		const response = await wrapped(`${base}/always`);
		expect(response.status).toBe(403);
		expect(counters.protectedHits).toBe(2);
		expect(counters.verifyHits).toBe(1);
	});

	test("cancel performs no verify and no replay", async () => {
		counters.protectedHits = 0;
		counters.verifyHits = 0;
		counters.grant = 0;
		const wrapped = createStepUpFetch(inner, { prompt: cancel });
		const response = await wrapped(`${base}/protected`);
		expect(response.status).toBe(403);
		expect(counters.protectedHits).toBe(1);
		expect(counters.verifyHits).toBe(0);
	});

	test("a Request body is preserved across the one replay", async () => {
		counters.protectedHits = 0;
		counters.verifyHits = 0;
		counters.grant = 0;
		const wrapped = createStepUpFetch(inner, { prompt });
		const request = new Request(`${base}/echo`, { method: "POST", body: "payload" });
		const response = await wrapped(request);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("payload");
		expect(counters.protectedHits).toBe(2);
		expect(counters.verifyHits).toBe(1);
	});

	test("concurrent writes share one recovery-code verification and each execute once", async () => {
		const challenged = Promise.withResolvers<void>();
		let waiting = 0;
		let verified = false;
		let verifyHits = 0;
		const executed: string[] = [];
		const recoveryServer = Bun.serve({
			port: 0,
			async fetch(request) {
				if (new URL(request.url).pathname === "/api/auth/2fa/verify") {
					verifyHits += 1;
					const body = (await request.json()) as { recoveryCode?: string };
					if (verified || body.recoveryCode !== "ABCDE-23456")
						return Response.json({ error: "invalid_code" }, { status: 401 });
					verified = true;
					return Response.json({ verifiedUntil: "2026-11-16T12:00:00Z", method: "recovery" });
				}
				if (!verified) {
					waiting += 1;
					if (waiting === 2) challenged.resolve();
					await challenged.promise;
					return Response.json({ error: "totp_required" }, { status: 403 });
				}
				executed.push(await request.text());
				return new Response("saved");
			},
		});
		try {
			let prompts = 0;
			const wrapped = createStepUpFetch((input, init) => fetch(new URL(String(input), recoveryServer.url), init), {
				prompt: async () => {
					prompts += 1;
					return "ABCDE-23456";
				},
			});
			const responses = await Promise.all([
				wrapped("/save", { method: "POST", body: "first" }),
				wrapped("/save", { method: "POST", body: "second" }),
			]);
			expect(responses.map(response => response.status)).toEqual([200, 200]);
			expect(executed.sort()).toEqual(["first", "second"]);
			expect(verifyHits).toBe(1);
			expect(prompts).toBe(1);
		} finally {
			recoveryServer.stop(true);
		}
	});

	test("a cancelled shared challenge settles every request and a later action may retry", async () => {
		const prompted = Promise.withResolvers<void>();
		const decision = Promise.withResolvers<string | null>();
		const releaseLateChallenge = Promise.withResolvers<void>();
		let prompts = 0;
		let verificationCalls = 0;
		const wrapped = createStepUpFetch(
			async input => {
				if (String(input).endsWith("/verify")) verificationCalls += 1;
				if (String(input) === "/two") await releaseLateChallenge.promise;
				return Response.json({ error: "totp_required" }, { status: 403 });
			},
			{
				prompt: async () => {
					prompts += 1;
					prompted.resolve();
					return decision.promise;
				},
			},
		);
		const first = wrapped("/one");
		const second = wrapped("/two");
		await prompted.promise;
		decision.resolve(null);
		expect((await first).status).toBe(403);
		releaseLateChallenge.resolve();
		expect((await second).status).toBe(403);
		expect(prompts).toBe(1);
		expect(verificationCalls).toBe(0);
		expect((await wrapped("/later")).status).toBe(403);
		expect(prompts).toBe(2);
	});
});
