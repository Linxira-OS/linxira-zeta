import { describe, expect, test } from "bun:test";
import type { Model } from "@linxiraos/pi-ai";
import { Settings } from "../src/config/settings";
import type { AgentSession } from "../src/session/agent-session";
import {
	FEATURE_SETTING_KEYS,
	type FeatureSettingRow,
} from "../src/server/studio-host/protocol/contracts/feature-settings";
import { featureSettingsOps } from "../src/server/studio-host/ops/feature-settings";
import type { StudioHostContext } from "../src/server/studio-host/registry";
import { runWithStudioSelection, type StudioSelection } from "../src/server/studio-host/selection";
import { StudioFeatureSettingsService } from "../src/server/studio-host/services/feature-settings-service";

const model = {
	provider: "test",
	id: "model",
	contextWindow: 200_000,
	cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
} as unknown as Model;

function fakeSession(settings = Settings.isolated()) {
	const state = { refreshes: 0, reapplies: 0 };
	const session = {
		sessionId: "session-a",
		settings,
		isDisposed: false,
		modelRegistry: {
			find: (provider: string, id: string) => (provider === "test" && id === "model" ? model : undefined),
			contextWindowTiers: () => ({ standard: 200_000, extended: 1_000_000 }),
			reapplyModelPolicies: async () => {
				state.reapplies++;
			},
		},
		refreshIdleMaintenance: () => {
			state.refreshes++;
		},
		getEvalToolSession: () => undefined,
		getEvalPreludes: () => [],
		getEvalKernelOwnerId: () => "",
	} as unknown as AgentSession;
	return { session, state };
}

const selection: StudioSelection = { workspaceId: "workspace", sessionId: "session-a", closed: false };
function context(overrides: Partial<StudioHostContext> = {}): StudioHostContext {
	return {
		selection,
		privateOwner: { id: "owner", expiresAt: Date.now() + 60_000, isLive: () => true },
		...overrides,
	} as unknown as StudioHostContext;
}

describe("native feature settings", () => {
	test("session overrides inherit from global and clear back to it", async () => {
		const { session, state } = fakeSession();
		const service = new StudioFeatureSettingsService(session);

		const global = await service.execute({
			kind: "preferences.features.set",
			sessionId: "session-a",
			key: "stt.language",
			value: "en",
			scope: "global",
		});
		expect(global).toMatchObject({ key: "stt.language", value: "en", source: "global" });

		const sessionRow = await service.execute({
			kind: "preferences.features.set",
			sessionId: "session-a",
			key: "stt.language",
			value: "fr",
			scope: "session",
		});
		expect(sessionRow).toMatchObject({ key: "stt.language", value: "fr", source: "runtime" });

		const cleared = await service.execute({
			kind: "preferences.features.clearOverride",
			sessionId: "session-a",
			key: "stt.language",
		});
		expect(cleared).toMatchObject({ key: "stt.language", value: "en", source: "global" });
		expect(state.refreshes).toBe(3);

		const listed = await service.execute({ kind: "preferences.features.get", sessionId: "session-a" });
		expect(listed.settings).toHaveLength(FEATURE_SETTING_KEYS.length);
		expect(listed.settings.find(row => row.key === "stt.language")).toMatchObject({ value: "en", source: "global" });
		expect(listed.settings.find(row => row.key === "computer.enabled")).toMatchObject({ source: "default" });
	});

	test("invalid types and raw compaction writes keep native policy authoritative", async () => {
		const { session } = fakeSession();
		const service = new StudioFeatureSettingsService(session);

		await expect(
			service.execute({
				kind: "preferences.features.set",
				sessionId: "session-a",
				key: "recap.idleSeconds",
				value: "many",
				scope: "global",
			}),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

		await expect(
			service.execute({
				kind: "preferences.features.set",
				sessionId: "session-a",
				key: "compaction.modelThresholds",
				value: { "test/model": "80%" },
				scope: "global",
			}),
		).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });

		await expect(
			service.execute({
				kind: "preferences.features.set",
				sessionId: "session-a",
				key: "computer.enabled",
				value: true,
				scope: "global",
			}),
		).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });

		await expect(
			service.execute({
				kind: "preferences.features.set",
				sessionId: "session-a",
				key: "computer.maxWidth",
				value: 0,
				scope: "session",
			}),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});

	test("compaction preview reports extended windows and requires confirmation before writing", async () => {
		const { session, state } = fakeSession();
		const service = new StudioFeatureSettingsService(session);

		const preview = await service.execute({
			kind: "models.compaction.preview",
			sessionId: "session-a",
			selector: "test/model",
			input: "800k",
		});
		expect(preview).toMatchObject({ valid: true, window: 1_000_000, extended: true });

		const pending = await service.execute({
			kind: "models.compaction.set",
			sessionId: "session-a",
			selector: "test/model",
			input: "800k",
		});
		expect(pending).toMatchObject({ saved: false, confirmationRequired: true });
		expect(pending.summary).toContain("1M");

		const unsaved = await service.execute({
			kind: "preferences.features.get",
			sessionId: "session-a",
		});
		expect(unsaved.settings.find(row => row.key === "compaction.modelThresholds")?.value).toEqual({});

		const saved = await service.execute({
			kind: "models.compaction.set",
			sessionId: "session-a",
			selector: "test/model",
			input: "800k",
			confirmed: true,
		});
		expect(saved).toMatchObject({ saved: true, confirmationRequired: false });
		expect(state.reapplies).toBe(1);
		const thresholds = (
			await service.execute({ kind: "preferences.features.get", sessionId: "session-a" })
		).settings.find((row: FeatureSettingRow) => row.key === "compaction.modelThresholds")?.value;
		expect(thresholds).toEqual({ "test/model": 800_000 });

		await expect(
			service.execute({
				kind: "models.compaction.set",
				sessionId: "session-a",
				selector: "other/missing",
				input: "80%",
				confirmed: true,
			}),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});

	test("operation boundary refuses missing keys, credentials, and stale or foreign views", async () => {
		const commands = featureSettingsOps.commands!;
		expect(Object.keys(commands).sort()).toEqual([
			"models.compaction.preview",
			"models.compaction.set",
			"preferences.features.clearOverride",
			"preferences.features.get",
			"preferences.features.set",
		]);
		const command = (name: keyof typeof commands) =>
			commands[name] as unknown as (input: unknown, context: StudioHostContext) => Promise<unknown>;
		const get = command("preferences.features.get");
		const set = command("preferences.features.set");

		await expect(
			set({ sessionId: "session-a", key: "task.file", value: true, scope: "global" }, context()),
		).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
		await expect(
			set({ sessionId: "session-a", key: "auth.broker.token", value: "secret", scope: "global" }, context()),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
		await expect(
			runWithStudioSelection(selection, () => get({ sessionId: "session-b" }, context())),
		).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
		await expect(
			runWithStudioSelection(selection, () =>
				get(
					{ sessionId: "session-a" },
					context({ privateOwner: { id: "owner", expiresAt: Date.now() - 1, isLive: () => true } }),
				),
			),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			runWithStudioSelection({ ...selection, closed: true }, () => get({ sessionId: "session-a" }, context())),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(
			runWithStudioSelection({ ...selection, sessionId: "missing" }, () => get({ sessionId: "missing" }, context())),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});
});
