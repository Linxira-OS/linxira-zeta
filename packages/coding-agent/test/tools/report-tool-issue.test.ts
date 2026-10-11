import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as piUtils from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { DEFAULT_ISSUE_REPO, GITHUB_API_BASE } from "@linxiraos/zeta/grievances/client";
import type { ToolSession } from "@linxiraos/zeta/tools";
import * as reportIssue from "@linxiraos/zeta/tools/report-tool-issue";
import {
	__awaitAutoQaRecordPipelineForTests,
	__resetAutoQaConsentForTests,
	__resetAutoQaFlushStateForTests,
	dispatchReportIssueDevice,
	flushGrievances,
	isAutoQaEnabled,
	reportIssueDeviceUsage,
} from "@linxiraos/zeta/tools/report-tool-issue";
import { mockFetch } from "../helpers/fetch-mock";

const ISSUE_URL = `${GITHUB_API_BASE}/repos/${DEFAULT_ISSUE_REPO}/issues`;

function openTempDb(): Database {
	const db = new Database(":memory:");
	db.run(`
		CREATE TABLE IF NOT EXISTS grievances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			model TEXT NOT NULL,
			version TEXT NOT NULL,
			tool TEXT NOT NULL,
			report TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			pushed INTEGER NOT NULL DEFAULT 0,
			push_error TEXT
		);
	`);
	return db;
}

/** Rows GitHub permanently refused — parked, never retried. */
function selectRejected(db: Database): Array<{ id: number; push_error: string }> {
	return db.prepare("SELECT id, push_error FROM grievances WHERE pushed = -1 ORDER BY id ASC").all() as Array<{
		id: number;
		push_error: string;
	}>;
}

function insertGrievance(db: Database, tool: string, report: string): number {
	const info = db
		.prepare("INSERT INTO grievances (model, version, tool, report) VALUES (?, ?, ?, ?)")
		.run("test-model", "test-version", tool, report);
	return Number(info.lastInsertRowid);
}

/** All rows, regardless of pushed state. */
function selectIds(db: Database): number[] {
	return (db.prepare("SELECT id FROM grievances ORDER BY id ASC").all() as Array<{ id: number }>).map(r => r.id);
}

/** Just unpushed rows — what the next flush would pick up. */
function selectUnpushedIds(db: Database): number[] {
	return (db.prepare("SELECT id FROM grievances WHERE pushed = 0 ORDER BY id ASC").all() as Array<{ id: number }>).map(
		r => r.id,
	);
}

/** Just pushed rows — what's already been filed. */
function selectPushedIds(db: Database): number[] {
	return (db.prepare("SELECT id FROM grievances WHERE pushed = 1 ORDER BY id ASC").all() as Array<{ id: number }>).map(
		r => r.id,
	);
}

/** A GitHub success response carrying a created issue. */
function createdIssue(number: number): Response {
	return new Response(
		JSON.stringify({ html_url: `https://github.com/${DEFAULT_ISSUE_REPO}/issues/${number}`, number }),
		{ status: 201 },
	);
}

/**
 * Auto QA on, consent granted, a GitHub token supplied — so the flush path is
 * fully configured. Env token vars are cleared per test; the settings token
 * keeps the `gh auth token` probe out of the picture.
 */
function pushSettings(overrides: Record<string, unknown> = {}): Settings {
	return Settings.isolated({
		"dev.autoqa": true,
		"dev.autoqaConsent": "granted",
		"dev.autoqaPush.token": "settings-token",
		...overrides,
	});
}

const ENV_KEYS = ["PI_AUTO_QA", "GITHUB_TOKEN", "GH_TOKEN", "ZETA_ISSUE_REPO"] as const;
let savedEnv: Record<string, string | undefined> = {};

function saveAndClearEnv(): void {
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = Bun.env[key];
		delete Bun.env[key];
	}
	// Pin the destination so assertions are independent of the developer's env.
	Bun.env.ZETA_ISSUE_REPO = DEFAULT_ISSUE_REPO;
}

function restoreEnv(): void {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete Bun.env[key];
		else Bun.env[key] = savedEnv[key];
	}
}

describe("flushGrievances", () => {
	let db: Database;

	beforeEach(() => {
		__resetAutoQaFlushStateForTests();
		saveAndClearEnv();
		db = openTempDb();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		__resetAutoQaFlushStateForTests();
		restoreEnv();
		db.close();
	});

	it("lets PI_AUTO_QA=false disable auto QA when the setting is enabled", () => {
		Bun.env.PI_AUTO_QA = "0";

		expect(isAutoQaEnabled(Settings.isolated({ "dev.autoqa": true }))).toBe(false);
	});

	it("lets PI_AUTO_QA=true enable auto QA when the setting is disabled", () => {
		Bun.env.PI_AUTO_QA = "1";

		expect(isAutoQaEnabled(Settings.isolated({ "dev.autoqa": false }))).toBe(true);
	});

	it("enables auto QA by default with consent still unset", () => {
		expect(isAutoQaEnabled(Settings.isolated())).toBe(true);
	});

	it("vetoes default-on auto QA once the user denied consent", () => {
		expect(isAutoQaEnabled(Settings.isolated({ "dev.autoqaConsent": "denied" }))).toBe(false);
	});

	it("keeps explicitly enabled auto QA on despite denied consent", () => {
		expect(isAutoQaEnabled(Settings.isolated({ "dev.autoqa": true, "dev.autoqaConsent": "denied" }))).toBe(true);
	});

	it("stays off when explicitly disabled", () => {
		expect(isAutoQaEnabled(Settings.isolated({ "dev.autoqa": false }))).toBe(false);
	});

	it("skips network when consent is missing and leaves rows intact", async () => {
		insertGrievance(db, "glob", "weird ordering");
		const fetchSpy = vi.fn(async () => new Response("unexpected", { status: 200 }));

		// `denied` is the user-facing kill switch for push.
		const result = await flushGrievances(db, pushSettings({ "dev.autoqaConsent": "denied" }), {
			fetch: mockFetch(fetchSpy),
		});

		expect(result).toEqual({ pushed: 0, ok: false, skipped: true });
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(selectIds(db)).toEqual([1]);
	});

	it("skips network when Auto-QA is disabled", async () => {
		insertGrievance(db, "glob", "weird ordering");
		const fetchSpy = vi.fn(async () => new Response("unexpected", { status: 200 }));

		const result = await flushGrievances(db, pushSettings({ "dev.autoqa": false }), {
			fetch: mockFetch(fetchSpy),
		});

		expect(result).toEqual({ pushed: 0, ok: false, skipped: true });
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(selectIds(db)).toEqual([1]);
	});

	it("returns ok without fetching when there is nothing to push", async () => {
		const fetchSpy = vi.fn(async () => new Response("unexpected", { status: 200 }));

		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(result).toEqual({ pushed: 0, ok: true });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("files one GitHub issue per pending row and marks them pushed=1", async () => {
		vi.spyOn(piUtils, "getInstallId").mockReturnValue("11111111-2222-3333-4444-555555555555");
		insertGrievance(db, "glob", "weird ordering");
		insertGrievance(db, "read", "selector ignored");

		const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
		const fetchSpy = vi.fn(async (input: string | URL | Request, init: RequestInit | undefined) => {
			captured.push({ url: String(input), init });
			return createdIssue(captured.length);
		});

		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			pushed: 2,
			ok: true,
			urls: [
				`https://github.com/${DEFAULT_ISSUE_REPO}/issues/1`,
				`https://github.com/${DEFAULT_ISSUE_REPO}/issues/2`,
			],
		});

		for (const { url, init } of captured) {
			expect(url).toBe(ISSUE_URL);
			expect(init?.method).toBe("POST");
			const headers = init?.headers as Record<string, string>;
			expect(headers.authorization).toBe("Bearer settings-token");
			expect(headers["content-type"]).toBe("application/json");
		}
		const firstBody = JSON.parse(String(captured[0]?.init?.body)) as {
			title: string;
			body: string;
			labels: string[];
		};
		expect(firstBody.title).toBe("[auto-qa] glob: weird ordering");
		expect(firstBody.labels).toEqual(["bug"]);
		expect(firstBody.body).toContain("- install: 11111111-2222-3333-4444-555555555555");

		// Rows are retained for inspection — `pushed=1` flips, but the data
		// stays so users can browse what they've filed via `zetacode grievances`.
		expect(selectIds(db)).toEqual([1, 2]);
		expect(selectPushedIds(db)).toEqual([1, 2]);
		expect(selectUnpushedIds(db)).toEqual([]);
	});

	it("labels the manual grievances path feedback", async () => {
		insertGrievance(db, "glob", "weird ordering");
		let body: { labels: string[] } | undefined;
		const fetchSpy = vi.fn(async (_input: string | URL | Request, init: RequestInit | undefined) => {
			body = JSON.parse(String(init?.body)) as { labels: string[] };
			return createdIssue(1);
		});

		await flushGrievances(db, pushSettings(), { kind: "feedback", fetch: mockFetch(fetchSpy) });

		expect(body?.labels).toEqual(["feedback"]);
	});

	it("returns the composed issue with a prefilled URL and sends nothing without a token", async () => {
		insertGrievance(db, "glob", "no token here");
		const fetchSpy = vi.fn(async () => createdIssue(1));

		const settings = pushSettings({ "dev.autoqaPush.token": undefined });
		const result = await flushGrievances(db, settings, { fetch: mockFetch(fetchSpy), ghPath: null });

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.unauthenticated).toBe(true);
		expect(result.pushed).toBe(0);
		expect(result.manualUrl).toContain("https://github.com/");
		expect(result.manualUrl).toContain("/issues/new?");
		expect(result.composed?.title).toBe("[auto-qa] glob: no token here");
		// Nothing was shipped — the row stays queued for a later attempt.
		expect(selectUnpushedIds(db)).toEqual([1]);
		expect(selectPushedIds(db)).toEqual([]);
	});

	it("leaves rows unpushed on 5xx and surfaces the error", async () => {
		insertGrievance(db, "glob", "boom");
		const fetchSpy = vi.fn(async () => new Response("nope", { status: 500 }));

		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(result).toMatchObject({ pushed: 0, ok: false });
		expect(result.error).toContain("500");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(selectUnpushedIds(db)).toEqual([1]);
		expect(selectPushedIds(db)).toEqual([]);
	});

	it("keeps rows queued on 401 instead of parking them as rejected", async () => {
		// An auth failure says nothing about the payload — parking rows here
		// would silently discard grievances over a misconfigured token.
		insertGrievance(db, "glob", "unauthorized");
		const fetchSpy = vi.fn(async () => new Response("bad token", { status: 401 }));

		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(result).toMatchObject({ pushed: 0, ok: false });
		expect(result.error).toContain("401");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(selectUnpushedIds(db)).toEqual([1]);
		expect(selectRejected(db)).toEqual([]);
	});

	it("clamps an over-long legacy tool name at send time and keeps the full line in the report", async () => {
		// Recorded by an older build that stored a whole sentence as the tool
		// name (the retired collector rejected entries above 128 UTF-8 bytes).
		const prose =
			"eval içindeki tool.glob exact ve var olmayan yolu çağırınca beklenmedik şekilde RuntimeError fırlatıyor, sessizce boş dönmüyor";
		insertGrievance(db, prose, "glob threw instead of returning empty");

		let body: { title: string; body: string } | undefined;
		const fetchSpy = vi.fn(async (_input: string | URL | Request, init: RequestInit | undefined) => {
			body = JSON.parse(String(init?.body)) as { title: string; body: string };
			return createdIssue(1);
		});

		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(result).toMatchObject({ pushed: 1, ok: true });
		const clampedTool = body?.title.replace("[auto-qa] ", "").split(": ")[0] ?? "";
		expect(Buffer.byteLength(clampedTool, "utf8")).toBeLessThanOrEqual(128);
		expect(prose.startsWith(clampedTool)).toBe(true);
		// Truncation happens on a code-point boundary, never mid-character.
		expect(clampedTool).not.toContain("\ufffd");
		// The full original line survives in the body, not the clamped prefix.
		expect(body?.body).toContain(`${prose}\nglob threw instead of returning empty`);
		expect(selectPushedIds(db)).toEqual([1]);
	});

	it("parks a permanently rejected row and drains the rest of the backlog", async () => {
		// Reproduces #13091: the oldest row is refused, so before the fix every
		// later flush re-sent the same first batch and nothing ever shipped.
		for (let i = 0; i < 6; i++) insertGrievance(db, i === 0 ? "poison" : "read", `report-${i}`);

		const fetchSpy = vi.fn(async (_input: string | URL | Request, init: RequestInit | undefined) => {
			const payload = JSON.parse(String(init?.body)) as { title: string };
			const poisoned = payload.title.includes("poison");
			return poisoned ? new Response('{"message":"tool rejected"}', { status: 422 }) : createdIssue(1);
		});

		const settings = pushSettings();
		const result = await flushGrievances(db, settings, { fetch: mockFetch(fetchSpy) });

		expect(result).toMatchObject({ pushed: 5, ok: true, rejected: 1 });
		expect(result.error).toContain("422");
		expect(selectPushedIds(db)).toEqual([2, 3, 4, 5, 6]);
		expect(selectRejected(db)).toHaveLength(1);
		expect(selectRejected(db)[0]?.id).toBe(1);
		expect(selectRejected(db)[0]?.push_error).toContain("422");
		expect(selectUnpushedIds(db)).toEqual([]);

		// A later session finds nothing to send — the parked row is not retried.
		__resetAutoQaFlushStateForTests();
		fetchSpy.mockClear();
		const second = await flushGrievances(db, settings, { fetch: mockFetch(fetchSpy) });
		expect(second).toEqual({ pushed: 0, ok: true });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("drains mid-flight inserts in a follow-up iteration within the same loop", async () => {
		insertGrievance(db, "glob", "first");

		const fetchEntered = Promise.withResolvers<void>();
		const releaseFirstFetch = Promise.withResolvers<Response>();
		let fetchCount = 0;
		const fetchSpy = vi.fn(() => {
			fetchCount += 1;
			if (fetchCount === 1) {
				fetchEntered.resolve();
				return releaseFirstFetch.promise;
			}
			return Promise.resolve(createdIssue(fetchCount));
		});

		const flushPromise = flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });
		await fetchEntered.promise;

		// New grievance written by a concurrent tool call while the first issue
		// is still in flight.
		insertGrievance(db, "read", "second");

		releaseFirstFetch.resolve(createdIssue(1));
		const result = await flushPromise;

		// Both rows filed — the worker looped, the next query picked up the row
		// that landed mid-flight.
		expect(result).toMatchObject({ pushed: 2, ok: true });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(selectUnpushedIds(db)).toEqual([]);
		expect(selectPushedIds(db)).toEqual([1, 2]);
	});

	it("collapses concurrent callers onto a single in-flight push", async () => {
		insertGrievance(db, "glob", "single-flight");

		const releaseFetch = Promise.withResolvers<Response>();
		const fetchSpy = vi.fn(() => releaseFetch.promise);

		const settings = pushSettings();
		const first = flushGrievances(db, settings, { fetch: mockFetch(fetchSpy) });
		const second = flushGrievances(db, settings, { fetch: mockFetch(fetchSpy) });

		releaseFetch.resolve(createdIssue(1));
		const [a, b] = await Promise.all([first, second]);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(a).toMatchObject({ pushed: 1, ok: true });
		expect(b).toBe(a);
		expect(selectUnpushedIds(db)).toEqual([]);
		expect(selectPushedIds(db)).toEqual([1]);
	});

	it("skips the next push within the failure cooldown window", async () => {
		insertGrievance(db, "glob", "first");
		const fetchSpy = vi.fn(async () => new Response("nope", { status: 500 }));

		const settings = pushSettings();
		const firstResult = await flushGrievances(db, settings, { fetch: mockFetch(fetchSpy) });
		const secondResult = await flushGrievances(db, settings, { fetch: mockFetch(fetchSpy) });

		expect(firstResult).toMatchObject({ pushed: 0, ok: false });
		expect(firstResult.error).toContain("500");
		expect(secondResult).toEqual({ pushed: 0, ok: false, skipped: true });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(selectUnpushedIds(db)).toEqual([1]);
	});

	it("files a backlog as one issue per row across the whole loop", async () => {
		const total = 7;
		for (let i = 0; i < total; i++) insertGrievance(db, "glob", `report-${i}`);

		const fetchSpy = vi.fn(async () => createdIssue(1));
		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(result).toMatchObject({ pushed: total, ok: true });
		expect(fetchSpy).toHaveBeenCalledTimes(total);
		expect(selectUnpushedIds(db)).toEqual([]);
		expect(selectPushedIds(db).length).toBe(total);
	});

	it("stops the loop on a mid-backlog failure and preserves unpushed rows", async () => {
		for (let i = 0; i < 3; i++) insertGrievance(db, "glob", `r-${i}`);

		let call = 0;
		const fetchSpy = vi.fn(() => {
			call += 1;
			return Promise.resolve(call === 1 ? createdIssue(1) : new Response("nope", { status: 500 }));
		});

		const result = await flushGrievances(db, pushSettings(), { fetch: mockFetch(fetchSpy) });

		expect(result).toMatchObject({ pushed: 1, ok: false });
		expect(result.error).toContain("500");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(selectPushedIds(db)).toEqual([1]);
		expect(selectUnpushedIds(db)).toEqual([2, 3]);
	});
});

describe("dispatchReportIssueDevice", () => {
	beforeEach(() => {
		saveAndClearEnv();
		// The device path is fire-and-forget; keep the happy path off the network.
		vi.spyOn(globalThis, "fetch").mockResolvedValue(createdIssue(1));
	});

	afterEach(() => {
		__resetAutoQaConsentForTests();
		vi.restoreAllMocks();
		restoreEnv();
	});

	/** Drain the fire-and-forget consent → insert → flush pipeline. */
	async function settlePipeline(): Promise<void> {
		await __awaitAutoQaRecordPipelineForTests();
	}

	/** Auto QA on, consent already granted, a token available. */
	function consentedSettings(): Settings {
		return Settings.isolated({
			"dev.autoqa": true,
			"dev.autoqaConsent": "granted",
			"dev.autoqaPush.token": "settings-token",
		});
	}

	it("records a grievance from `<tool>: <report>` text", async () => {
		Bun.env.PI_AUTO_QA = "1";
		const db = openTempDb();
		const openSpy = vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		try {
			const session = { settings: consentedSettings() } as ToolSession;
			const { result, xdev } = await dispatchReportIssueDevice(
				session,
				"read: selector parse dropped trailing line",
			);
			const first = result.content[0];
			expect(first?.type).toBe("text");
			if (first?.type === "text") expect(first.text).toBe("Noted, thanks!");
			expect(xdev.tool).toBe("report_issue");
			await settlePipeline();
			expect(selectIds(db)).toHaveLength(1);
			const row = db.prepare("SELECT tool, report FROM grievances").get() as { tool: string; report: string };
			expect(row).toEqual({ tool: "read", report: "selector parse dropped trailing line" });
		} finally {
			openSpy.mockRestore();
			db.close();
		}
	});

	it("accepts the two-line fallback body format", async () => {
		Bun.env.PI_AUTO_QA = "1";
		const db = openTempDb();
		const openSpy = vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		try {
			const session = { settings: consentedSettings() } as ToolSession;
			await dispatchReportIssueDevice(session, "grep\nreported matches include a deleted file");
			await settlePipeline();
			const row = db.prepare("SELECT tool, report FROM grievances").get() as { tool: string; report: string };
			expect(row).toEqual({ tool: "grep", report: "reported matches include a deleted file" });
		} finally {
			openSpy.mockRestore();
			db.close();
		}
	});

	it("clamps a prose first line so the stored tool stays within the historical limit", async () => {
		Bun.env.PI_AUTO_QA = "1";
		const db = openTempDb();
		const openSpy = vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		try {
			const prose =
				"eval içindeki tool.glob exact ve var olmayan yolu çağırınca beklenmedik şekilde RuntimeError fırlatıyor, sessizce boş dönmüyor";
			const session = { settings: consentedSettings() } as ToolSession;
			await dispatchReportIssueDevice(session, `${prose}\nglob threw instead of returning empty`);
			await settlePipeline();
			const row = db.prepare("SELECT tool, report FROM grievances").get() as { tool: string; report: string };
			expect(Buffer.byteLength(row.tool, "utf8")).toBeLessThanOrEqual(128);
			expect(prose.startsWith(row.tool)).toBe(true);
			// The sentence is preserved in the report, not dropped on the floor.
			expect(row.report).toBe(`${prose}\nglob threw instead of returning empty`);
		} finally {
			openSpy.mockRestore();
			db.close();
		}
	});

	it("writes nothing while consent is unresolved", async () => {
		Bun.env.PI_AUTO_QA = "1";
		const originalPush = Bun.env.PI_AUTO_QA_PUSH;
		delete Bun.env.PI_AUTO_QA_PUSH;
		const db = openTempDb();
		const openSpy = vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		try {
			// Consent unset and no UI handler registered → resolves to false.
			const session = { settings: Settings.isolated({ "dev.autoqa": true }) } as ToolSession;
			const { result } = await dispatchReportIssueDevice(session, "read: selector parse dropped trailing line");
			const first = result.content[0];
			if (first?.type === "text") expect(first.text).toBe("Noted, thanks!");
			await settlePipeline();
			expect(selectIds(db)).toHaveLength(0);
		} finally {
			if (originalPush === undefined) delete Bun.env.PI_AUTO_QA_PUSH;
			else Bun.env.PI_AUTO_QA_PUSH = originalPush;
			openSpy.mockRestore();
			db.close();
		}
	});

	it("rejects malformed body text with a usage hint", async () => {
		const session = { settings: Settings.isolated({ "dev.autoqa": true }) } as ToolSession;
		await expect(dispatchReportIssueDevice(session, "just a vague sentence")).rejects.toThrow(
			reportIssueDeviceUsage(),
		);
	});
});
