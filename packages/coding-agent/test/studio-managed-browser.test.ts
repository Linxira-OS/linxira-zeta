import { expect, test } from "bun:test";
import { once } from "node:events";
import { existsSync, watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import type { AgentSession } from "../src/session/agent-session";
import { StudioManagedBrowserService, managedBrowserFor } from "../src/server/studio-host/services/managed-browser";
import { ownsPage } from "../src/tools/browser/tab-protocol";

// Exercises the real private relay WebSocket; control completion is the synchronization signal.
test("managed relay fences views, drains agent work and tears down its private descriptor", async () => {
	const scratch = path.resolve(import.meta.dir, "../../../temp");
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(path.join(scratch, "studio-managed-"));
	const session = { sessionId: path.basename(directory), instanceKey: path.basename(directory), isDisposed: false } as AgentSession;
	let live = true;
	const service = new StudioManagedBrowserService(session, { enabled: true, directory, isLive: () => live });
	let socket: WebSocket | undefined;
	let watcher: ReturnType<typeof watch> | undefined;
	try {
		const prepared = await service.prepare(session.sessionId);
		const file = path.join(directory, "managed-browser", prepared.descriptorId);
		const descriptor = JSON.parse(await readFile(file, "utf8")) as { endpoint: string; pid: number; sessionId: string };
		expect(descriptor.pid).toBe(process.pid);
		expect(descriptor.sessionId).toBe(session.sessionId);
		expect(JSON.stringify(prepared)).not.toContain(descriptor.endpoint);
		expect((await fetch(new URL("/json/version", descriptor.endpoint))).status).toBe(404);
		expect((await fetch(descriptor.endpoint + "/cdp", { headers: { origin: "http://untrusted.test" } })).status).toBe(403);
		expect(() => new StudioManagedBrowserService(session, { enabled: true, directory, isLive: () => true })).toThrow("Another Studio view");
		socket = new WebSocket(descriptor.endpoint.replace("http:", "ws:") + "/ext");
		await once(socket, "open");
		const replies = new Map<number, PromiseWithResolvers<void>>();
		socket.addEventListener("message", event => {
			const reply = JSON.parse(String(event.data)) as { t: string; id: number; ok: boolean; error?: string };
			if (reply.t !== "studioControlResult") return;
			const pending = replies.get(reply.id);
			replies.delete(reply.id);
			if (reply.ok) pending?.resolve(); else pending?.reject(new Error(reply.error));
		});
		const control = (mode: string, id: number) => {
			const reply = Promise.withResolvers<void>();
			replies.set(id, reply);
			socket!.send(JSON.stringify({ t: "studioControl", id, control: mode }));
			return reply.promise;
		};
		socket.send(JSON.stringify({ t: "hello", userAgent: "test", browserVersion: "149.0.0", tabs: [], attachedTabIds: [], discardedTabsProtocol: 1, instanceId: session.sessionId, browserSession: "one" }));
		await control("agent", 1);
		expect(managedBrowserFor(session.sessionId)).toBe(service);
		const release = await service.begin();
		const taking = service.setControl("human");
		await expect(service.begin()).rejects.toThrow("user controls");
		release();
		release(); // A duplicate completion cannot underflow the work count.
		await taking;
		await expect(service.begin()).rejects.toThrow("user controls");
		await control("agent", 2);
		(await service.begin())();
		const deleted = Promise.withResolvers<void>();
		watcher = watch(path.dirname(file), () => { if (!existsSync(file)) deleted.resolve(); });
		const closed = once(socket, "close");
		live = false;
		await expect(service.begin()).rejects.toThrow("disconnected");
		await closed;
		await deleted.promise;
		expect(managedBrowserFor(session.sessionId)).toBeUndefined();
		expect(existsSync(file)).toBe(false);
	} finally {
		watcher?.close();
		socket?.close();
		service.dispose();
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);

test("managed Runtime workers borrow desktop pages across cleanup", () => {
	const payload = { mode: "attach" as const, browserWSEndpoint: "ws://local", safeDir: ".", uploadDir: "./uploads", page: { kind: "create" as const } };
	expect(ownsPage({ ...payload, studioManaged: true })).toBe(false);
	expect(ownsPage(payload)).toBe(true);
});
