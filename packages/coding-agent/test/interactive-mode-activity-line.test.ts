import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { resetSettingsForTest, Settings, settings } from "@linxiraos/zeta/config/settings";
import { InteractiveMode } from "@linxiraos/zeta/modes/interactive-mode";
import { cfgComposerTokenRate } from "@linxiraos/zeta/modes/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import type { TodoPhase } from "@linxiraos/zeta/tools/details/todo";
import type { UiNode } from "@linxiraos/pi-tui";
import { staticEnvironment } from "@linxiraos/pi-tui/term/paint";
import { describeTree } from "@linxiraos/pi-tui/testing/corpus";
import { TempDir } from "@linxiraos/pi-utils";
import { currentTheme } from "@linxiraos/pi-tui/theme/runtime";
import { initTheme } from "../src/ui/theme/service";
import { createModeTerminal } from "./helpers/mode-terminal";

/** A node as the native backend describes it. */
interface Described {
	readonly k: string;
	readonly key?: string;
	readonly p?: Readonly<Record<string, unknown>>;
	readonly c?: readonly Described[];
}

const PLAN: TodoPhase[] = [
	{ name: "Notifications", tasks: [{ content: "Add new-mail alerts", status: "in_progress" }] },
];

function describeNode(node: UiNode): Described {
	return describeTree(node, staticEnvironment(currentTheme()), 100) as Described;
}

function nodes(root: Described): Described[] {
	return [root, ...(root.c ?? []).flatMap(nodes)];
}

function role(n: Described): string | undefined {
	return n.p?.role as string | undefined;
}

describe("InteractiveMode native dock activity line", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(async () => {
		initTheme();
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-activity-line-");
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
		mode = new InteractiveMode(
			session,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			createModeTerminal().frame,
		);
	});

	afterEach(() => {
		mode.clearWorking();
		mode.setTodos([]);
		session.tokenRate.reset();
		cfgComposerTokenRate.clearOverride(settings);
	});

	afterAll(async () => {
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetSettingsForTest();
	});

	/** The dock as the native backend describes it. */
	const dock = (): Described[] => mode.shell.surface.dock().map(describeNode).flatMap(nodes);
	/** The activity line (working row + todo), or undefined while it is empty. */
	const activity = (): Described | undefined => dock().find(n => role(n) === "omp.hud.activity");
	const keys = (line: Described | undefined) => (line?.c ?? []).map(n => n.key);

	it("describes no activity line when no status row runs and there is no plan", () => {
		expect(activity()).toBeUndefined();
	});

	it("holds the todo in the activity line, not the HUD pills row, between turns", () => {
		mode.setTodos(PLAN);
		const line = activity();
		expect(keys(line)).toEqual(["todo"]);
		expect(line?.c?.[0]).toMatchObject({ k: "checklist", p: { mode: "hud", role: "omp.hud.todo" } });
		expect(dock().filter(n => role(n) === "omp.hud.pill")).toEqual([]);
	});

	it("puts the working row before the todo while a turn runs, and the status alone without a plan", () => {
		mode.ensureWorkingRow();
		const statusOnly = activity();
		expect(keys(statusOnly)).toEqual(["status"]);
		expect(role(statusOnly!.c![0]!)).toBe("omp.hud.status");

		mode.setTodos(PLAN);
		expect(keys(activity())).toEqual(["status", "todo"]);
	});

	it("shows tok/s in the composer bar only with the setting on and a reading", async () => {
		const rate = () => nodes(describeNode(mode.composer.node)).find(n => role(n) === "omp.composer.rate");
		session.tokenRate.seed(1_000, 10_000);
		expect(rate()).toBeUndefined();

		cfgComposerTokenRate.override(settings, true);
		// The setting change reaches the bar on the next tick.
		await Bun.sleep(0);
		expect(rate()?.p).toMatchObject({ value: 100, unit: "tok/s" });

		session.tokenRate.reset();
		// The meter is not reactive: the session event after a reset refreshes the status facts.
		mode.statusLine.refresh();
		expect(rate()).toBeUndefined();
	});
});
