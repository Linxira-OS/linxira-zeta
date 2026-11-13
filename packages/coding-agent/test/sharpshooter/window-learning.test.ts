import { afterEach, describe, expect, it, vi } from "bun:test";
import * as ai from "@linxiraos/pi-ai";
import type { AssistantMessage } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { sharpshooterBackend, releaseSharpshooterSession } from "@linxiraos/zeta/sharpshooter/backend";
import { learnSharpshooterWindow, maybeStartSharpshooterExtraction } from "@linxiraos/zeta/sharpshooter/extract";
import { listSharpshooterDeltas } from "@linxiraos/zeta/sharpshooter/queue";

const dirs: TempDir[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) await dir.remove();
});
function setup(mode: "manual" | "window") {
	const dir = TempDir.createSync("@sharpshooter-window-");
	dirs.push(dir);
	const model = getBundledModel("anthropic", "claude-haiku-4-5")!;
	const settings = Settings.isolated({
		"memory.extractionMode": mode,
		"sharpshooter.model": `${model.provider}/${model.id}`,
	});
	const session = {
		settings,
		isDisposed: false,
		sessionId: "window-session",
		modelRegistry: { getAll: () => [model], getAvailable: () => [model], resolver: () => async () => "test" },
		messages: [{ role: "user", content: "LIVE_TAIL_MUST_NOT_APPEAR" }],
		sessionManager: { getCwd: () => dir.join("project") },
		subscribe: () => () => {},
	} as unknown as AgentSession;
	return { session, settings, modelRegistry: session.modelRegistry, agentDir: dir.path(), cwd: dir.join("project") };
}
function response(deltas?: unknown[]): AssistantMessage {
	return {
		role: "assistant",
		stopReason: "stop",
		content: deltas
			? [{ type: "toolCall", id: "record", name: "record_deltas", arguments: { deltas } }]
			: [{ type: "text", text: "Malformed extraction" }],
	} as AssistantMessage;
}
function delta(evidence: string) {
	return {
		kind: "constraint",
		statement: "Use bounded durable queues",
		source: "explicit_user",
		evidence,
		friction: { corrective: true, regression: false, subtle: false },
		confidence: 1,
	};
}
const input = {
	id: "stable-window",
	messages: [
		{ role: "user" as const, content: "Use bounded" },
		{ role: "assistant" as const, content: "ASSISTANT_ONLY_EVIDENCE" },
		{ role: "user" as const, content: "durable queues" },
	],
};

describe("sharpshooter window consumer", () => {
	it("batches once, rejects assistant/cross-message evidence regardless of confidence, and persists deterministic queue files", async () => {
		const options = setup("window");
		const completion = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(
				response([delta("Use bounded"), delta("ASSISTANT_ONLY_EVIDENCE"), delta("Use bounded\ndurable queues")]),
			);
		await sharpshooterBackend.start({ ...options, taskDepth: 0 });
		try {
			await sharpshooterBackend.learnWindow!(
				{ agentDir: options.agentDir, cwd: "/wrong-context", session: options.session },
				input,
			);
			expect(completion).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(completion.mock.calls[0]?.[1])).not.toContain("LIVE_TAIL_MUST_NOT_APPEAR");
			await learnSharpshooterWindow(options, input);
			const groups = await listSharpshooterDeltas(options.agentDir, options.cwd);
			expect(groups.flatMap(group => group.deltas)).toHaveLength(1);
			expect(groups[0]?.deltas[0]?.delta.evidence).toBe("Use bounded");
		} finally {
			releaseSharpshooterSession(options.session);
		}
	});

	it("suppresses per-prompt extraction outside auto without disabling window delivery", async () => {
		const completion = vi.spyOn(ai, "completeSimple").mockResolvedValue(response([]));
		for (const mode of ["manual", "window"] as const) {
			const options = setup(mode);
			maybeStartSharpshooterExtraction(options);
			expect(completion).not.toHaveBeenCalled();
		}
		await learnSharpshooterWindow(setup("window"), input);
		expect(completion).toHaveBeenCalledTimes(1);
	});

	it("propagates malformed batches for retry and leaves accepted deltas queued", async () => {
		const options = setup("window");
		const completion = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValueOnce(response())
			.mockResolvedValueOnce(response([delta("Use bounded")]));
		await expect(learnSharpshooterWindow(options, input)).rejects.toThrow("record_deltas");
		await learnSharpshooterWindow(options, input);
		expect(completion).toHaveBeenCalledTimes(2);
		expect((await listSharpshooterDeltas(options.agentDir, options.cwd))[0]?.deltas).toHaveLength(1);
	});
});
