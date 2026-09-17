/**
 * Remote plan-approval contracts (`approveRemotePlan`, the `plan_approve`
 * execution path used by IM `@plan` replies and the web-ui PlanApproval card):
 * reads the plan file, transitions plan-mode state, and injects the approved-
 * plan prompt so the session executes the plan.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveRemotePlan } from "../../src/channels/plan-approval";
import type { AgentSession } from "../../src/session/agent-session";

interface StubSession {
	setPlanModeState: ReturnType<typeof vi.fn>;
	setPlanReferencePath: ReturnType<typeof vi.fn>;
	markPlanReferenceSent: ReturnType<typeof vi.fn>;
	newSession: ReturnType<typeof vi.fn>;
	compact: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
}

function makeStubSession(): StubSession {
	return {
		setPlanModeState: vi.fn(),
		setPlanReferencePath: vi.fn(),
		markPlanReferenceSent: vi.fn(),
		newSession: vi.fn(),
		compact: vi.fn(),
		prompt: vi.fn().mockResolvedValue(undefined),
	};
}

describe("approveRemotePlan", () => {
	let tempDir: string;
	const cleanups: Array<() => Promise<void>> = [];

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "zeta-plan-approve-"));
		cleanups.push(() => rm(tempDir, { recursive: true, force: true }));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
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
});
