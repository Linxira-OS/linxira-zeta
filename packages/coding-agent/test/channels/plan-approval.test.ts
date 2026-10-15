/**
 * Remote plan-approval contracts (`approveRemotePlan`, the `plan_approve`
 * execution path used by IM `@plan` replies and the web-ui PlanApproval card):
 * reads the plan file, transitions plan-mode state, and injects the approved-
 * plan prompt so the session executes the plan.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir, setAgentDir } from "@linxiraos/pi-utils";
import { approveRemotePlan } from "../../src/channels/plan-approval";
import { Settings } from "../../src/config/settings";
import type { AgentSession } from "../../src/session/agent-session";

interface StubSession {
	settings: Settings;
	getActiveToolNames: ReturnType<typeof vi.fn>;
	sessionManager: { getCwd: () => string };
	setPlanModeState: ReturnType<typeof vi.fn>;
	getPlanModeState: ReturnType<typeof vi.fn>;
	setPlanReferencePath: ReturnType<typeof vi.fn>;
	markPlanReferenceSent: ReturnType<typeof vi.fn>;
	newSession: ReturnType<typeof vi.fn>;
	compact: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
	enterGoalMode: ReturnType<typeof vi.fn>;
}

function makeStubSession(
	settings = Settings.isolated({}),
	activeToolNames: string[] = ["read", "bash"],
	cwd = process.cwd(),
): StubSession {
	return {
		settings,
		getActiveToolNames: vi.fn(() => activeToolNames),
		sessionManager: { getCwd: () => cwd },
		setPlanModeState: vi.fn(),
		getPlanModeState: vi.fn(() => undefined),
		setPlanReferencePath: vi.fn(),
		markPlanReferenceSent: vi.fn(),
		newSession: vi.fn(),
		compact: vi.fn(),
		prompt: vi.fn().mockResolvedValue(undefined),
		enterGoalMode: vi.fn().mockResolvedValue(undefined),
	};
}

describe("approveRemotePlan", () => {
	let tempDir: string;
	let previousAgentDir: string | undefined;
	const cleanups: Array<() => Promise<void>> = [];

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "zeta-plan-approve-"));
		// The tracking mirror also updates the machine-global project index
		// (`<agentDir>/tracking-index.json`); point it at the temp dir so a test
		// run never registers a throwaway path in the developer's index.
		previousAgentDir = getAgentDir();
		const agentDir = join(tempDir, "agent");
		await mkdir(agentDir, { recursive: true });
		setAgentDir(agentDir);
		cleanups.push(() => rm(tempDir, { recursive: true, force: true }));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (previousAgentDir !== undefined) setAgentDir(previousAgentDir);
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	const opts = () => ({ getArtifactsDir: () => tempDir, getSessionId: () => "s1" });

	async function seedPlan(content = "# Plan\n\nDo the thing."): Promise<string> {
		const planFilePath = "local://PLAN.md";
		// local:// resolves under <artifactsDir>/local; Bun.write creates the dir.
		await Bun.write(join(tempDir, "local", "PLAN.md"), content);
		return planFilePath;
	}

	test("preserve mode reads the plan, exits plan mode and injects the approved-plan prompt", async () => {
		const session = makeStubSession();
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "preserve" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.setPlanModeState).toHaveBeenCalledWith(undefined);
		expect(session.setPlanReferencePath).toHaveBeenCalledWith(planFilePath);
		expect(session.markPlanReferenceSent).toHaveBeenCalledTimes(1);
		expect(session.newSession).not.toHaveBeenCalled();
		expect(session.compact).not.toHaveBeenCalled();
		expect(session.prompt).toHaveBeenCalledTimes(1);
		const injected = String(session.prompt.mock.calls[0]?.[0]);
		expect(injected).toContain("Plan approved.");
		// Upstream template inlines the plan; the durable path is for handoff/recovery.
		expect(injected).toContain("durable copy at `local://PLAN.md`");
		expect(injected).toContain('<plan path="local://PLAN.md">');
		// The plan body must actually render — an unwired variable would inline an empty plan.
		expect(injected).toContain("Do the thing.");
		expect(injected).toContain("History usable;");
	});

	test("injects the tool-gated instructions its template declares", async () => {
		const session = makeStubSession(Settings.isolated({ "tracking.enabled": true }), [
			"read",
			"bash",
			"todo",
			"tracking_update",
		]);
		const planFilePath = await seedPlan();

		await approveRemotePlan(session as unknown as AgentSession, { planFilePath, mode: "preserve" }, opts());

		// `{{#has tools "…"}}` blocks render only when the live active tool set is
		// passed to the template; without it the todo/tracking instructions vanish.
		const injected = String(session.prompt.mock.calls[0]?.[0]);
		expect(injected).toContain('op: "sync_todo"');
		expect(injected).toContain("initialize todo tracking with `todo`");

		const withoutTools = makeStubSession(Settings.isolated({}));
		await approveRemotePlan(withoutTools as unknown as AgentSession, { planFilePath, mode: "preserve" }, opts());
		const bare = String(withoutTools.prompt.mock.calls[0]?.[0]);
		expect(bare).not.toContain('op: "sync_todo"');
	});

	test("preserve mode mirrors the approved plan into project tracking", async () => {
		const session = makeStubSession(Settings.isolated({ "tracking.enabled": true }), ["read", "bash"], tempDir);
		const planFilePath = await seedPlan("# Words Counter\n\nFile contents.");

		await approveRemotePlan(session as unknown as AgentSession, { planFilePath, mode: "preserve" }, opts());

		// Slug comes from the shared plan-title resolver (`# Words Counter` →
		// `words-counter`), the same source every other approval path uses.
		const mirrored = join(tempDir, ".zeta", "tracking", "plans", "words-counter-plan.md");
		expect(await Bun.file(mirrored).text()).toBe("# Words Counter\n\nFile contents.\n");
	});

	test("mirrors nothing when tracking is disabled", async () => {
		const session = makeStubSession(Settings.isolated({}), ["read", "bash"], tempDir);
		const planFilePath = await seedPlan();

		await approveRemotePlan(session as unknown as AgentSession, { planFilePath, mode: "preserve" }, opts());

		expect(await Bun.file(join(tempDir, ".zeta", "tracking", "plans")).exists()).toBe(false);
	});

	test("fresh mode clears the session, rewrites the plan and injects the prompt without history", async () => {
		const session = makeStubSession();
		session.newSession.mockResolvedValue(undefined);
		const planFilePath = await seedPlan("# Plan\n\nFresh.");
		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "fresh" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.newSession).toHaveBeenCalledTimes(1);
		// Plan file is re-persisted after the clear so the synthetic prompt's read lands.
		const rewritten = await Bun.file(join(tempDir, "local", "PLAN.md")).text();
		expect(rewritten).toContain("Fresh.");
		const injected = String(session.prompt.mock.calls[0]?.[0]);
		expect(injected).not.toContain("History usable;");
	});

	test("compact mode distills with the plan-mode compaction instructions before injecting", async () => {
		const session = makeStubSession();
		session.compact.mockResolvedValue(undefined);
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "compact" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.compact).toHaveBeenCalledTimes(1);
		const compactPrompt = String(session.compact.mock.calls[0]?.[0]);
		expect(compactPrompt).toContain(planFilePath);
	});

	test("cancel returns approved:false and never injects the prompt", async () => {
		const session = makeStubSession();
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "cancel" },
			opts(),
		);

		expect(result).toEqual({ approved: false });
		expect(session.prompt).not.toHaveBeenCalled();
		expect(session.setPlanModeState).not.toHaveBeenCalled();
	});

	test("a missing plan file fails with an error and never prompts", async () => {
		const session = makeStubSession();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath: "local://missing.md", mode: "preserve" },
			opts(),
		);

		expect(result.approved).toBe(false);
		expect(result.error).toContain("Plan file not found");
		expect(session.prompt).not.toHaveBeenCalled();
	});

	test("preserve mode arms goal mode with the task stated at plan entry, before the execution prompt", async () => {
		const session = makeStubSession();
		session.getPlanModeState.mockReturnValue({
			enabled: true,
			planFilePath: "local://PLAN.md",
			objective: "Ship the release",
		});
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "preserve" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.enterGoalMode).toHaveBeenCalledWith({ objective: "Ship the release" });
		// Goal mode must be armed BEFORE the synthetic prompt, or the first
		// execution turn runs without the goal context and the goal tool.
		expect(session.enterGoalMode.mock.invocationCallOrder[0]!).toBeLessThan(
			session.prompt.mock.invocationCallOrder[0]!,
		);
	});

	test("preserve mode derives the goal objective from the plan when no task was stated", async () => {
		const session = makeStubSession();
		const planFilePath = await seedPlan("# Refactor the auth store\n\nDo it.");

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "preserve" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.enterGoalMode).toHaveBeenCalledWith({ objective: "Refactor the auth store" });
	});

	test("fresh mode arms goal mode after the transcript is replaced", async () => {
		const session = makeStubSession();
		session.newSession.mockResolvedValue(undefined);
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "fresh" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.newSession.mock.invocationCallOrder[0]!).toBeLessThan(
			session.enterGoalMode.mock.invocationCallOrder[0]!,
		);
		expect(session.enterGoalMode.mock.invocationCallOrder[0]!).toBeLessThan(
			session.prompt.mock.invocationCallOrder[0]!,
		);
	});

	test("goal mode is not armed when it is disabled in settings", async () => {
		const session = makeStubSession(Settings.isolated({ "goal.enabled": false }));
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "preserve" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.enterGoalMode).not.toHaveBeenCalled();
		expect(session.prompt).toHaveBeenCalledTimes(1);
	});

	test("a goal that cannot start does not fail the approval", async () => {
		const session = makeStubSession();
		session.enterGoalMode.mockRejectedValue(new Error("A goal is already active. Drop it before creating another."));
		const planFilePath = await seedPlan();

		const result = await approveRemotePlan(
			session as unknown as AgentSession,
			{ planFilePath, mode: "preserve" },
			opts(),
		);

		expect(result).toEqual({ approved: true });
		expect(session.prompt).toHaveBeenCalledTimes(1);
	});
});
