import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as ai from "@linxiraos/pi-ai";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { getAgentDbPath, TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { enqueueLocalMemory, getMemoryRoot, learnMemoryWindow, startMemoryStartupTask } from "@linxiraos/zeta/memories";
import { closeMemoryDb, openMemoryDb } from "@linxiraos/zeta/memories/storage";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";

const dirs: TempDir[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) await dir.remove();
});
function response(value: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: JSON.stringify(value) }],
		stopReason: "stop",
	} as AssistantMessage;
}
async function setup(mode: "manual" | "window") {
	const dir = TempDir.createSync("@local-window-");
	dirs.push(dir);
	const agentDir = dir.join("agent");
	const cwd = dir.join("project");
	await fs.mkdir(agentDir, { recursive: true });
	const settings = Settings.isolated({ "memory.backend": "local", "memory.extractionMode": mode });
	const model = getBundledModel("anthropic", "claude-haiku-4-5")!;
	const session = {
		settings,
		model,
		sessionId: "session-window",
		isDisposed: false,
		modelRegistry: { getAll: () => [model], getApiKey: async () => "test", resolver: () => async () => "test" },
		sessionManager: {
			getCwd: () => cwd,
			getSessionFile: () => {
				throw new Error("must not scan rollout");
			},
		},
	} as unknown as AgentSession;
	startMemoryStartupTask({ session, settings, agentDir, taskDepth: 0, modelRegistry: session.modelRegistry });
	return { agentDir, cwd, session };
}
const input = {
	id: "discarded:1/2",
	messages: [
		{ role: "user" as const, content: "Use bounded project queues for durable memory." },
		{ role: "assistant" as const, content: "ASSISTANT_UNTRUSTED" },
	],
};

describe("local window consumer", () => {
	it("suppresses startup scans in manual/window and keeps explicit enqueue usable", async () => {
		const completion = vi.spyOn(ai, "completeSimple");
		for (const mode of ["manual", "window"] as const) {
			const context = await setup(mode);
			await enqueueLocalMemory(context.agentDir, context.cwd, context.session);
		}
		expect(completion).not.toHaveBeenCalled();
	});

	it("delivers only window user evidence and skips successful stage1 on consolidation retry", async () => {
		const context = await setup("window");
		const completion = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValueOnce(
				response({ raw_memory: "Bound project queues", rollout_summary: "Queue decision", rollout_slug: null }),
			)
			.mockResolvedValueOnce(response({ invalid: "consolidation failure" }))
			.mockResolvedValueOnce(response({ memory_md: "# Queues", memory_summary: "Use bounded queues", skills: [] }));
		await expect(learnMemoryWindow(context, input)).rejects.toThrow();
		const firstRequest = JSON.stringify(completion.mock.calls[0]?.[1]);
		expect(firstRequest).toContain(input.messages[0]!.content);
		expect(firstRequest).not.toContain("ASSISTANT_UNTRUSTED");
		await learnMemoryWindow(context, input);
		expect(completion).toHaveBeenCalledTimes(3);
		expect(await Bun.file(`${getMemoryRoot(context.agentDir, context.cwd)}/memory_summary.md`).text()).toContain(
			"bounded queues",
		);
		const db = openMemoryDb(getAgentDbPath(context.agentDir));
		try {
			expect(db.query("SELECT COUNT(*) AS n FROM stage1_outputs").get()).toEqual({ n: 1 });
		} finally {
			closeMemoryDb(db);
		}
	});

	it("propagates stage1 errors and retries the same deterministic job", async () => {
		const context = await setup("window");
		const completion = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValueOnce(response({ malformed: true }))
			.mockResolvedValueOnce(response({ raw_memory: "", rollout_summary: "", rollout_slug: null }));
		await expect(learnMemoryWindow(context, input)).rejects.toThrow("schema");
		await learnMemoryWindow(context, input);
		expect(completion).toHaveBeenCalledTimes(2);
		const db = openMemoryDb(getAgentDbPath(context.agentDir));
		try {
			expect(db.query("SELECT status FROM jobs WHERE kind = 'memory_stage1'").all()).toEqual([{ status: "done" }]);
		} finally {
			closeMemoryDb(db);
		}
	});
});
