/**
 * Tracking wiring: `tracking.enabled` must reach a *live* session's tool set —
 * at startup and mid-run — and the phase nudge must key off that live set.
 *
 * These assertions are the regression net for the defect where `/tracking on`
 * wrote the setting and flipped the UI, but never reconciled the session's
 * built-ins: `tracking_update` stayed out of the active tool set, so both
 * gates that read its presence (the todo phase nudge and the approved-plan
 * prompt) stayed closed. `tracking_update` is a `discoverable` built-in, so
 * the assertion is on the *active* (top-level, directly callable) set — being
 * present only as an `xd://` device would not reopen those gates.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CustomMessage } from "@linxiraos/pi-agent-core";
import { AuthStorage } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { removeSyncWithRetries, Snowflake } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TodoTracker, type TodoTrackerHost } from "@linxiraos/zeta/session/todo-tracker";
import { cfgTrackingEnabled } from "@linxiraos/zeta/tools/settings";

const TRACKING_PHASE_NUDGE = "tracking-phase-nudge";

describe("tracking tool wiring", () => {
	let registryDir: string;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeAll(async () => {
		registryDir = path.join(os.tmpdir(), `pi-tracking-wiring-${Snowflake.next()}`);
		fs.mkdirSync(registryDir, { recursive: true });
		authStorage = await AuthStorage.create(path.join(registryDir, "auth.db"));
		modelRegistry = new ModelRegistry(authStorage, path.join(registryDir, "models.yml"));
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose().catch(() => {});
	});

	afterAll(() => {
		authStorage.close();
		if (fs.existsSync(registryDir)) removeSyncWithRetries(registryDir);
	});

	async function startSession(settings: Settings, toolNames?: string[]): Promise<AgentSession> {
		const { session } = await createAgentSession({
			cwd: registryDir,
			agentDir: registryDir,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings,
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			enableMCP: false,
			enableLsp: false,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			rules: [],
			workspaceTree: { rootPath: registryDir, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
			toolNames,
		});
		sessions.push(session);
		return session;
	}

	/** Lets the coalesced watch fire, then waits for the reconcile it queued on the registry lock. */
	async function settle(session: AgentSession): Promise<void> {
		await Promise.resolve();
		await session.runToolRegistryMutation(async () => {});
	}

	/** The todo tracker reads the live session for settings and the active tool set. */
	function trackerOn(session: AgentSession): TodoTracker {
		const host = {
			settings: session.settings,
			getActiveToolNames: () => session.getActiveToolNames(),
			getEnabledToolNames: () => session.getEnabledToolNames(),
			planModeEnabled: () => false,
			toolRegistry: () => new Map(),
		} as unknown as TodoTrackerHost;
		return new TodoTracker(host);
	}

	const COMPLETED_PHASE = [{ name: "Phase A", tasks: [{ content: "ship it", status: "completed" as const }] }];

	it("① resolves tracking_update into the active tool set when tracking.enabled is true", async () => {
		const settings = Settings.isolated({ "tracking.enabled": true });
		const session = await startSession(settings);

		// Directly callable, not merely present as an `xd://` device: both the
		// phase nudge and the approved-plan prompt call `tracking_update` by name.
		expect(session.getActiveToolNames()).toContain("tracking_update");
		expect(session.getToolByName("tracking_update")).toBeDefined();
		expect(session.getMountedXdevToolNames()).not.toContain("tracking_update");
	});

	it("① leaves tracking_update out of the active tool set by default", async () => {
		const session = await startSession(Settings.isolated({}));

		expect(session.getActiveToolNames()).not.toContain("tracking_update");
		expect(session.getEnabledToolNames()).not.toContain("tracking_update");
		expect(session.getToolByName("tracking_update")).toBeUndefined();
	});

	it("② reconciles a live session when tracking.enabled flips off→on→off", async () => {
		const settings = Settings.isolated({});
		const session = await startSession(settings);
		expect(session.getActiveToolNames()).not.toContain("tracking_update");

		cfgTrackingEnabled.set(settings, true);
		await settle(session);
		expect(session.getActiveToolNames()).toContain("tracking_update");
		expect(session.getToolByName("tracking_update")).toBeDefined();

		cfgTrackingEnabled.set(settings, false);
		await settle(session);
		expect(session.getActiveToolNames()).not.toContain("tracking_update");
		expect(session.getToolByName("tracking_update")).toBeUndefined();
		expect(session.getActiveToolNames()).toContain("read");
	});

	it("③ builds the phase nudge when a phase completes with tracking_update active", async () => {
		const settings = Settings.isolated({ "tracking.enabled": true });
		const session = await startSession(settings);
		const tracker = trackerOn(session);

		tracker.setPhases(COMPLETED_PHASE);
		const nudge = tracker.takeMidRunNudge() as CustomMessage | null;

		expect(nudge?.role).toBe("custom");
		expect(nudge?.customType).toBe(TRACKING_PHASE_NUDGE);
		expect(nudge?.display).toBe(false);
		expect(String(nudge?.content)).toContain("Phase A");
		expect(String(nudge?.content)).not.toContain("{phase}");
		// One-shot: the mirror is consumed exactly once.
		expect(tracker.takeMidRunNudge()).toBeNull();
	});

	it("③ returns nothing when tracking is disabled or the tool is not in the active set", async () => {
		const disabled = await startSession(Settings.isolated({}));
		const disabledTracker = trackerOn(disabled);
		disabledTracker.setPhases(COMPLETED_PHASE);
		expect(disabledTracker.takeMidRunNudge()).toBeNull();

		// Enabled, but an explicit tool list that omits tracking_update keeps it
		// out of the active set.
		const restricted = await startSession(Settings.isolated({ "tracking.enabled": true }), ["read", "bash"]);
		expect(restricted.getActiveToolNames()).not.toContain("tracking_update");
		const restrictedTracker = trackerOn(restricted);
		restrictedTracker.setPhases(COMPLETED_PHASE);
		expect(restrictedTracker.takeMidRunNudge()).toBeNull();
	});
});
