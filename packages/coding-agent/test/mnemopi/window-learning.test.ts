import { afterEach, describe, expect, it, vi } from "bun:test";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { mnemopiBackend } from "@linxiraos/zeta/mnemopi/backend";
import { loadMnemopiConfig } from "@linxiraos/zeta/mnemopi/config";
import { loadMnemopi, loadMnemopiCore, MnemopiSessionState, setMnemopiSessionState } from "@linxiraos/zeta/mnemopi/state";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";

await Promise.all([loadMnemopi(), loadMnemopiCore()]);
const states: MnemopiSessionState[] = [];
const dirs: TempDir[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const state of states.splice(0)) await state.dispose({ consolidate: false });
	for (const dir of dirs.splice(0)) await dir.remove();
});
function setup(mode: "auto" | "window" | "manual") {
	const dir = TempDir.createSync("@mnemopi-window-");
	dirs.push(dir);
	const settings = Settings.isolated({ "memory.backend": "mnemopi", "memory.extractionMode": mode,
		"mnemopi.llmMode": "none", "mnemopi.noEmbeddings": true, "mnemopi.scoping": "global",
		"mnemopi.dbPath": dir.join("memory.db") });
	const session = { settings, sessionId: "window-session", sessionManager: {
		getCwd: () => dir.path(), getEntries: () => { throw new Error("must not read live tail"); },
	} } as unknown as AgentSession;
	const state = new MnemopiSessionState({ session, sessionId: session.sessionId, config: loadMnemopiConfig(settings, dir.path()) });
	setMnemopiSessionState(session, state);
	states.push(state);
	return { state, context: { session, cwd: dir.path(), agentDir: dir.path() } };
}
const window = { id: "stable-window", messages: [
	{ role: "user" as const, content: "Keep project queues bounded and durable." },
	{ role: "assistant" as const, content: "Assistant context must never become user facts." },
] };

describe("mnemopi window consumer", () => {
	it("stores exact windows once through the host-only none retention path", async () => {
		const { state, context } = setup("window");
		const remember = vi.spyOn(state, "rememberScoped");
		await mnemopiBackend.learnWindow!(context, window);
		await mnemopiBackend.learnWindow!(context, window);
		expect(remember).toHaveBeenCalledTimes(1);
		expect(remember.mock.calls[0]?.[1]).toMatchObject({ extract: false, extractEntities: false, extractText: null });
		const rows = state.memory.beam.db.query("SELECT content, metadata_json FROM working_memory WHERE source = 'coding-agent-window'").all();
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).toContain("stable-window");
		expect(JSON.stringify(rows)).toContain(window.messages[0]!.content);
	});

	it("gates cadence and disposal retention while preserving explicit consolidation", async () => {
		for (const mode of ["manual", "window"] as const) {
			const { state } = setup(mode);
			await state.maybeRetainOnAgentEnd([]);
			const retain = vi.spyOn(state, "forceRetainCurrentSession").mockResolvedValue(undefined);
			const sleep = vi.spyOn(state.memory, "sleep");
			await state.consolidate({ retain: true });
			expect(retain).toHaveBeenCalledTimes(1);
			expect(sleep).not.toHaveBeenCalled();
			await state.dispose();
			expect(retain).toHaveBeenCalledTimes(1);
			states.splice(states.indexOf(state), 1);
		}
	});

	it("propagates storage failures so a retry can retain the same window", async () => {
		const { state, context } = setup("window");
		const remember = vi.spyOn(state, "rememberScoped").mockImplementationOnce(() => { throw new Error("locked storage"); });
		await expect(mnemopiBackend.learnWindow!(context, window)).rejects.toThrow("locked storage");
		remember.mockRestore();
		await mnemopiBackend.learnWindow!(context, window);
		expect(state.memory.beam.db.query("SELECT COUNT(*) AS n FROM working_memory WHERE source = 'coding-agent-window'").get()).toEqual({ n: 1 });
	});
});
