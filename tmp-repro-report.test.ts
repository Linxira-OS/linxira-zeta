import { beforeAll, beforeEach, describe, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { Text } from "@linxiraos/pi-tui";
import { Composer } from "@linxiraos/pi-tui/prompt/composer";
import { initTheme } from "@linxiraos/pi-tui/theme";
import { TempDir } from "@linxiraos/pi-utils";
import { VirtualTerminal } from "./packages/tui/test/virtual-terminal";

const ROWS = 32;

describe("repro", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;
	let term: VirtualTerminal;
	const screen = (t: VirtualTerminal) => t.getViewport().map(row => Bun.stripANSI(row).trimEnd());

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-command-report-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		term = new VirtualTerminal(120, ROWS);
		const composer = new Composer({ terminal: term });
		mode = new InteractiveMode(session, "test", undefined, () => {}, undefined, undefined, undefined, composer);
	});

	it("dump screens", async () => {
		await mode.init({ suppressWelcomeIntro: true });
		void mode.getUserInput();
		await term.waitForRender();
		for (let i = 0; i < 5; i++) mode.chatContainer.addChild(new Text(`TRANSCRIPT ${i}`, 0, 0));
		mode.ui.requestRender();
		const last = "TRANSCRIPT 4";
		await term.waitForRender(() => screen(term).includes(last));
		const before = screen(term);
		console.log("BEFORE", before.indexOf(last));

		const rawWrite = term.write.bind(term);
		const events: string[] = [];
		let prevLen = term.getScrollBuffer().length;
		term.write = (data: string) => {
			rawWrite(data);
			const len = term.getScrollBuffer().length;
			if (len !== prevLen) {
				events.push(`scroll ${prevLen}->${len}\nHEAD: ${JSON.stringify(data.slice(0, 200))}\nTAIL: ${JSON.stringify(data.slice(-400))}`);
				prevLen = len;
			}
		};

		term.sendInput("/changelog full");
		await term.waitForRender(() => screen(term).some(row => row.includes("/changelog full")));
		term.sendInput("\r");
		await term.waitForRender(() => screen(term).some(row => row.includes("Full Changelog")));
		const page = screen(term).join("\n");
		term.sendInput("\x1b[6~");
		await term.waitForRender(() => screen(term).join("\n") !== page);
		term.sendInput("\x1b");
		await term.waitForRender(() => !screen(term).some(row => row.includes("Full Changelog")));
		const after = screen(term);
		console.log("AFTER", after.indexOf(last));
		console.log("SCROLL EVENTS\n" + events.join("\n---\n"));

		mode.stop();
		await session.dispose();
		authStorage.close();
		tempDir.removeSync();
		resetSettingsForTest();
	}, 30000);
});
