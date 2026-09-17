import { describe, expect, it } from "bun:test";
import { extractRetryHint, fetchWithRetry } from "@linxiraos/pi-utils/fetch-retry";

describe("fetchWithRetry", () => {
	it("routes requests through the `fetch` override when provided", async () => {
		const calls: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = [];
		const customFetch = async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ input, init });
			return new Response("ok", { status: 200 });
		};

		const response = await fetchWithRetry("https://example.invalid/x", {
			method: "POST",
			body: "hi",
			fetch: customFetch,
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.input).toBe("https://example.invalid/x");
		expect(calls[0]?.init).toMatchObject({ method: "POST", body: "hi" });
	});

	it("retries through the override on transient failures", async () => {
		let attempt = 0;
		const customFetch = async () => {
			attempt += 1;
			if (attempt === 1) return new Response("", { status: 503 });
			return new Response("done", { status: 200 });
		};

		const response = await fetchWithRetry("https://example.invalid/y", {
			fetch: customFetch,
			defaultDelayMs: 1,
			maxAttempts: 3,
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("done");
		expect(attempt).toBe(2);
	});

	it("lets callers stop retries for deterministic response bodies", async () => {
		let attempt = 0;
		const customFetch = async () => {
			attempt += 1;
			return new Response("deterministic provider failure", { status: 500 });
		};

		const response = await fetchWithRetry("https://example.invalid/z", {
			fetch: customFetch,
			defaultDelayMs: 1,
			maxAttempts: 3,
			shouldRetryResponse: (_response, bodyText) => !bodyText.includes("deterministic"),
		});

		expect(response.status).toBe(500);
		expect(await response.text()).toBe("deterministic provider failure");
		expect(attempt).toBe(1);
	});

	it("returns retryable responses immediately when retry hints exceed the delay cap", async () => {
		let attempt = 0;
		const customFetch = async () => {
			attempt += 1;
			return new Response("slow down", { status: 429, headers: { "Retry-After": "3600" } });
		};

		const response = await fetchWithRetry("https://example.invalid/rate-limit", {
			fetch: customFetch,
			defaultDelayMs: 1,
			maxAttempts: 3,
			maxDelayMs: 10,
		});

		expect(response.status).toBe(429);
		expect(await response.text()).toBe("slow down");
		expect(attempt).toBe(1);
	});

	it("normalizes aborts during response backoff", async () => {
		const request = fetchWithRetry("https://example.invalid/response-backoff", {
			fetch: async () => new Response("retry", { status: 503 }),
			signal: AbortSignal.timeout(10),
			defaultDelayMs: 1_000,
			maxAttempts: 2,
		});

		await expect(request).rejects.toMatchObject({
			name: "Error",
			message: "Request was aborted",
		});
	});

	it("normalizes aborts during network-error backoff", async () => {
		const request = fetchWithRetry("https://example.invalid/network-backoff", {
			fetch: async () => {
				throw new TypeError("connection reset");
			},
			signal: AbortSignal.timeout(10),
			defaultDelayMs: 1_000,
			maxAttempts: 2,
		});

		await expect(request).rejects.toMatchObject({
			name: "Error",
			message: "Request was aborted",
		});
	});
});

describe("extractRetryHint", () => {
	// Devin returns HTTP 403 with "Your limit will reset in 13 minutes" for an
	// account-scoped message rate cap. Without recognizing "will reset in", the
	// credential is blocked for the 1-minute default instead of 13 minutes and
	// can be reselected and hammered while the cap remains active.
	it("parses Devin 'Your limit will reset in 13 minutes' as 13 minutes", () => {
		expect(extractRetryHint(undefined, "Your limit will reset in 13 minutes")).toBe(13 * 60_000);
	});

	it("parses bare 'reset in 13 minutes' phrasing", () => {
		expect(extractRetryHint(undefined, "reset in 13 minutes")).toBe(13 * 60_000);
	});

	it("parses 'will reset in 2h' phrasing", () => {
		expect(extractRetryHint(undefined, "will reset in 2h")).toBe(2 * 60 * 60_000);
	});
	// OpenCode Go quota errors use "Resets in …" with day units and compound
	// remainders (upstream `formatRetryTime`: "2hr 15min", "3 days", "45min").
	// Without these the exhausted credential falls back to the 60s heuristic
	// and is reselected while the cap is still active.
	it("parses OpenCode Go 'Resets in 45min' as 45 minutes", () => {
		expect(
			extractRetryHint(
				undefined,
				"429 5-hour usage limit reached. Resets in 45min. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_1/go",
			),
		).toBe(45 * 60_000);
	});

	it("parses OpenCode Go compound 'Resets in 2hr 15min' as 2h15m", () => {
		expect(
			extractRetryHint(
				undefined,
				"429 5-hour usage limit reached. Resets in 2hr 15min. To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_1/go",
			),
		).toBe((2 * 60 + 15) * 60_000);
	});

	it("parses OpenCode Go day-unit resets", () => {
		expect(extractRetryHint(undefined, "429 Weekly usage limit reached. Resets in 3 days.")).toBe(
			3 * 24 * 60 * 60_000,
		);
		expect(extractRetryHint(undefined, "429 Monthly usage limit reached. Resets in 1 day.")).toBe(24 * 60 * 60_000);
	});

	// A quota body can carry both a generic retry hint and the account reset
	// window ("Please retry in 5s. Your limit will reset in 13 minutes"). The
	// account-reset hint must take precedence so the exhausted credential stays
	// blocked for the full stated window instead of the short generic retry.
	it("prefers the account reset window over a shorter retry hint", () => {
		expect(extractRetryHint(undefined, "Please retry in 5s. Your limit will reset in 13 minutes")).toBe(13 * 60_000);
	});

	it("parses retry-after-ms in error body", () => {
		expect(
			extractRetryHint(
				undefined,
				'429 {"type":"error","error":{"type":"rate_limit_error","code":"1310"}} retry-after-ms=98497000',
			),
		).toBe(98497000);
	});

	it.each([
		["space-separated UTC", "2099-09-01 09:44:51", Date.UTC(2099, 8, 1, 9, 44, 51)],
		["ISO-separated UTC", "2099-09-01T09:44:51", Date.UTC(2099, 8, 1, 9, 44, 51)],
		["explicit offset", "2099-09-01 09:44:51+08:00", Date.parse("2099-09-01T09:44:51+08:00")],
	])("parses %s absolute reset timestamp", (_label, timestamp, targetMs) => {
		const expected = targetMs - Date.now();
		const hint = extractRetryHint(undefined, `Your limit will reset at ${timestamp}`);
		expect(hint).toBeDefined();
		expect(Math.abs(hint! - expected)).toBeLessThan(100);
	});

	it("prefers an absolute account reset over retry-after-ms", () => {
		const future = new Date(Date.now() + 3_600_000).toISOString();
		const hint = extractRetryHint(undefined, `Your limit will reset at ${future} retry-after-ms=5000`);
		expect(hint).toBeGreaterThan(3_500_000);
		expect(hint).toBeLessThanOrEqual(3_600_000);
	});

	it("yields to the relative retry hint over a longer naive reset-at stamp", () => {
		// A naive stamp is the provider's wall clock in an unknown zone: it
		// cannot disambiguate against a conflicting relative signal without
		// guessing the zone, so the unambiguous signal wins regardless of
		// which is longer.
		const naiveWall = new Date(Date.now() + 3_600_000).toISOString().slice(0, 19).replace("T", " ");
		expect(extractRetryHint(undefined, `Your limit will reset at ${naiveWall} retry-after-ms=5000`)).toBe(5000);
	});

	it("reads a naive Chinese reset stamp as UTC without a provider offset", () => {
		const targetMs = Date.parse("2099-09-01T09:44:51Z");
		const expected = targetMs - Date.now();
		const hint = extractRetryHint(undefined, "已达到使用上限。您的限额将在 2099-09-01 09:44:51 重置。");
		expect(hint).toBeDefined();
		expect(Math.abs(hint! - expected)).toBeLessThan(100);
	});

	it("applies naiveResetTimezoneOffset to a naive Chinese reset stamp", () => {
		const targetMs = Date.parse("2099-09-01T09:44:51+08:00");
		const expected = targetMs - Date.now();
		const hint = extractRetryHint(undefined, "已达到使用上限。您的限额将在 2099-09-01 09:44:51 重置。", {
			naiveResetTimezoneOffset: "+08:00",
		});
		expect(hint).toBeDefined();
		expect(Math.abs(hint! - expected)).toBeLessThan(100);
	});

	it("keeps a configured reset over a shorter retry-after-ms", () => {
		const future = new Date(Date.now() + 3_600_000 + 8 * 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
		const hint = extractRetryHint(undefined, `Your limit will reset at ${future} retry-after-ms=5000`, {
			naiveResetTimezoneOffset: "+08:00",
		});
		expect(hint).toBeGreaterThan(3_500_000);
		expect(hint).toBeLessThanOrEqual(3_600_000);
	});
});
