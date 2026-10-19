/**
 * Gitea `run_watch` tests: poll cadence is injected (zero-delay), while the
 * `tea api` request shape, transition trace, and terminal handling are the
 * production paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { AgentToolUpdateCallback } from "@linxiraos/pi-agent-core";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { resetTeaLoginsCache } from "@linxiraos/zeta/tools/tea-common";
import {
	executeTeaRunWatch,
	formatTeaRunResult,
	getTeaRunOutcome,
	type TeaRunWatchSchedule,
} from "@linxiraos/zeta/tools/tea-run-watch";
import type { TeaRun, TeaToolDetails } from "@linxiraos/zeta/tools/tea-types";
import { gitea } from "@linxiraos/zeta/utils/gitea";

const REPO = "gitea.example.com/owner/repo";
const RUN_ENDPOINT = "/repos/owner/repo/actions/runs/5";

function createSession(): ToolSession {
	return {
		cwd: "/tmp/tea-watch",
		hasUI: false,
		getSessionFile: () => null,
		getArtifactsDir: () => null,
		getSessionSpawns: () => null,
		settings: Settings.isolated({ "gitea.enabled": true }),
	};
}

const instant: TeaRunWatchSchedule = { pollIntervalMs: () => 0 };

interface Capture {
	texts: string[];
}

function capture(): { callback: AgentToolUpdateCallback<TeaToolDetails>; capture: Capture } {
	const state: Capture = { texts: [] };
	const callback: AgentToolUpdateCallback<TeaToolDetails> = update => {
		const text = update.content.find(block => block.type === "text")?.text;
		if (text) state.texts.push(text);
	};
	return { callback, capture: state };
}

function mockRunSequence(runs: TeaRun[]) {
	let index = 0;
	const spy = vi.spyOn(gitea, "json").mockImplementation(async (_cwd, args) => {
		if (args[0] === "logins") {
			return [{ name: "work", url: "https://gitea.example.com" }] as never;
		}
		if (args.includes(RUN_ENDPOINT)) {
			const run = runs[Math.min(index, runs.length - 1)];
			index += 1;
			return run as never;
		}
		throw new Error(`unexpected endpoint ${args[args.length - 1]}`);
	});
	return spy;
}

beforeEach(() => {
	resetTeaLoginsCache();
	vi.spyOn(gitea, "available").mockReturnValue(true);
});

afterEach(() => {
	resetTeaLoginsCache();
	vi.restoreAllMocks();
});

describe("getTeaRunOutcome", () => {
	it("reads the conclusion of a completed run", () => {
		expect(getTeaRunOutcome({ status: "completed", conclusion: "success" })).toBe("success");
		expect(getTeaRunOutcome({ status: "completed", conclusion: "skipped" })).toBe("success");
		expect(getTeaRunOutcome({ status: "completed", conclusion: "failure" })).toBe("failure");
		expect(getTeaRunOutcome({ status: "completed", conclusion: "cancelled" })).toBe("failure");
		expect(getTeaRunOutcome({ status: "completed", conclusion: null })).toBe("pending");
	});

	it("also accepts instances that fold the outcome into status", () => {
		expect(getTeaRunOutcome({ status: "success" })).toBe("success");
		expect(getTeaRunOutcome({ status: "failure" })).toBe("failure");
		expect(getTeaRunOutcome({ status: "queued" })).toBe("pending");
	});
});

describe("executeTeaRunWatch", () => {
	it("polls through status transitions until a successful terminal state", async () => {
		const spy = mockRunSequence([
			{ id: 5, name: "ci", status: "queued", html_url: "https://gitea.example.com/owner/repo/actions/runs/5" },
			{ id: 5, name: "ci", status: "in_progress" },
			{ id: 5, name: "ci", status: "completed", conclusion: "success" },
		]);
		const { callback, capture: updates } = capture();

		const result = await executeTeaRunWatch(
			createSession(),
			{ op: "run_watch", repo: REPO, run: 5 },
			undefined,
			callback,
			instant,
		);

		expect(updates.texts).toHaveLength(3);
		expect(updates.texts[0]).toContain("Watching Gitea Actions Run #5");
		expect(updates.texts[0]).toContain("Status: queued");
		expect(updates.texts[1]).toContain("Status: in_progress");
		const text = result.content.find(block => block.type === "text")?.text ?? "";
		expect(text).toContain("Gitea Actions Run #5");
		expect(text).toContain("Transitions: queued → in_progress → completed (success)");
		expect(text).toContain("Run succeeded.");
		expect(result.details?.runId).toBe(5);
		expect(result.details?.runStatus).toBe("completed");
		expect(result.details?.runConclusion).toBe("success");

		const api = spy.mock.calls.map(call => call[1] as string[]).filter(args => args[0] === "api");
		expect(api).toHaveLength(3);
		expect(api[0]).toContain(RUN_ENDPOINT);
		expect(api[0]?.[api[0].indexOf("--login") + 1]).toBe("work");
	});

	it("stops on a failed run and reports the failure", async () => {
		mockRunSequence([{ id: 5, name: "ci", status: "completed", conclusion: "failure" }]);

		const result = await executeTeaRunWatch(
			createSession(),
			{ op: "run_watch", repo: REPO, run: 5 },
			undefined,
			undefined,
			instant,
		);

		const text = result.content.find(block => block.type === "text")?.text ?? "";
		expect(text).toContain("Run failed.");
	});

	it("treats a folded terminal status as completion", async () => {
		const spy = mockRunSequence([{ id: 5, name: "ci", status: "success" }]);

		const result = await executeTeaRunWatch(
			createSession(),
			{ op: "run_watch", repo: REPO, run: 5 },
			undefined,
			undefined,
			instant,
		);

		expect(result.content.find(block => block.type === "text")?.text).toContain("Run succeeded.");
		const api = spy.mock.calls.map(call => call[1] as string[]).filter(args => args[0] === "api");
		expect(api).toHaveLength(1);
	});

	it("rejects a missing or non-positive run id before touching the API", async () => {
		const spy = vi.spyOn(gitea, "json");

		await expect(
			executeTeaRunWatch(createSession(), { op: "run_watch", repo: REPO }, undefined, undefined, instant),
		).rejects.toThrow(/positive numeric `run` id/);
		await expect(
			executeTeaRunWatch(createSession(), { op: "run_watch", repo: REPO, run: 0 }, undefined, undefined, instant),
		).rejects.toThrow(/positive numeric `run` id/);
		expect(spy).not.toHaveBeenCalled();
	});

	it("honors an already-aborted signal", async () => {
		mockRunSequence([{ id: 5, status: "queued" }]);
		const controller = new AbortController();
		controller.abort();

		await expect(
			executeTeaRunWatch(
				createSession(),
				{ op: "run_watch", repo: REPO, run: 5 },
				controller.signal,
				undefined,
				instant,
			),
		).rejects.toThrow();
	});
});

describe("formatTeaRunResult", () => {
	it("renders run fields, URL, and the transition trace", () => {
		const text = formatTeaRunResult(
			REPO,
			{
				id: 5,
				name: "ci",
				display_title: "Build",
				head_branch: "main",
				head_sha: "1234567890abcdef",
				status: "completed",
				conclusion: "success",
				html_url: "https://gitea.example.com/owner/repo/actions/runs/5",
			},
			["queued", "completed (success)"],
		);

		expect(text).toContain("Workflow: ci");
		expect(text).toContain("Title: Build");
		expect(text).toContain("Branch: main");
		expect(text).toContain("Commit: 1234567890ab");
		expect(text).toContain("Transitions: queued → completed (success)");
		expect(text).toContain("Run succeeded.");
	});
});
