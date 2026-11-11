import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { hindsightBackend } from "@linxiraos/zeta/hindsight/backend";
import type { HindsightClientApi } from "@linxiraos/zeta/hindsight/client";
import { loadHindsightConfig } from "@linxiraos/zeta/hindsight/config";
import { HindsightSessionState } from "@linxiraos/zeta/hindsight/state";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";

const dirs: TempDir[] = [];
const states: HindsightSessionState[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const state of states.splice(0)) state.dispose();
	for (const dir of dirs.splice(0)) await dir.remove();
});
function setup(mode: "manual" | "window") {
	const dir = TempDir.createSync("@hindsight-window-");
	dirs.push(dir);
	const settings = Settings.isolated({ "memory.backend": "hindsight", "memory.extractionMode": mode,
		"hindsight.apiUrl": "http://localhost:8888", "hindsight.autoRetain": true });
	const retainBatch = vi.fn(async (_bank: string, _items: unknown[]) => ({}));
	const client = { retainBatch } as unknown as HindsightClientApi;
	let state: HindsightSessionState;
	const session = { settings, sessionId: "window-session", getHindsightSessionState: () => state,
		emitNotice: vi.fn(), sessionManager: { getEntries: () => { throw new Error("must not scan history"); } },
	} as unknown as AgentSession;
	state = new HindsightSessionState({ agentDir: dir.path(), session, sessionId: session.sessionId, client,
		bankId: "resolved-project-bank", retainTags: ["project:resolved"], config: loadHindsightConfig(settings),
		banksSet: new Set(["resolved-project-bank"]) });
	states.push(state);
	return { state, retainBatch, context: { session, agentDir: dir.path(), cwd: "/wrong-context" } };
}
const input = { id: "stable-window", messages: [
	{ role: "user" as const, content: "Always retain user evidence in bounded queues." },
	{ role: "assistant" as const, content: "ASSISTANT_CANNOT_ESTABLISH_FACTS" },
] };

describe("hindsight window consumer", () => {
	it("gates cadence outside auto and delivers user evidence through the resolved durable queue", async () => {
		for (const mode of ["manual", "window"] as const) {
			const { state, retainBatch, context } = setup(mode);
			await state.maybeRetainOnAgentEnd();
			await hindsightBackend.learnWindow!(context, input);
			await hindsightBackend.learnWindow!(context, input);
			await state.flushRetainQueue();
			expect(retainBatch).toHaveBeenCalledTimes(1);
			const [bank, items] = retainBatch.mock.calls[0] as unknown as [string, Array<{ content: string; tags: string[] }>];
			expect(bank).toBe("resolved-project-bank");
			expect(items).toHaveLength(1);
			expect(items[0]?.tags).toEqual(["project:resolved"]);
			expect(items[0]?.content).toContain(input.messages[0]!.content);
			expect(items[0]?.content).not.toContain("ASSISTANT_CANNOT_ESTABLISH_FACTS");
		}
	});

	it("retains remote failures on disk and retries with the same document identity", async () => {
		const { state, retainBatch, context } = setup("window");
		retainBatch.mockRejectedValueOnce(new Error("offline"));
		await hindsightBackend.learnWindow!(context, input);
		await state.flushRetainQueue();
		const root = path.join(context.agentDir, "hindsight-outbox");
		const [destination] = (await fs.readdir(root)).filter(name => name !== "quarantine");
		expect(await fs.readdir(path.join(root, destination!))).toContainEqual(expect.stringMatching(/^zeta-retain-.*\.json$/));
		await state.flushRetainQueue();
		expect(retainBatch).toHaveBeenCalledTimes(2);
		expect(retainBatch.mock.calls[0]?.[1]).toEqual(retainBatch.mock.calls[1]?.[1]);
	});

	it("rejects unavailable backend state instead of reporting success", async () => {
		await expect(hindsightBackend.learnWindow!({ agentDir: "unused", cwd: "unused" }, input)).rejects.toThrow("primary");
	});
});
