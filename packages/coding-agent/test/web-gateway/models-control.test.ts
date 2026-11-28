/**
 * `GET /api/models/control` — the read-only projection behind `/pages/models`.
 *
 * The tests pin the contract the page depends on:
 * - providers report visibility/credential presence but no credential value;
 * - role and target fallback chains are already normalized (duplicates gone);
 * - typed sections expose chat/image/decision/embedding plus paused tts/stt;
 * - the Blueprint page can share this exact object without another state source.
 */
import { describe, expect, it } from "bun:test";
import type { Model } from "@linxiraos/pi-ai";
import type { ModelKind } from "@linxiraos/pi-catalog/types";
import { Settings } from "@linxiraos/zeta/config/settings";
import { webGatewayFetch } from "../../src/server/web-gateway";
import {
	buildModelsControlSnapshot,
	handleModelsControl,
	type ModelsControlRegistry,
} from "../../src/server/web-gateway/models-control";

function makeModel(provider: string, id: string, kind?: ModelKind, name?: string): Model {
	return { provider, id, kind, name: name ?? id } as unknown as Model;
}

const MODELS: Model[] = [
	makeModel("openai", "gpt-chat", "chat", "GPT Chat"),
	makeModel("openai", "gpt-mini", "chat", "GPT Mini"),
	makeModel("openai", "gpt-image", "image", "GPT Image"),
	makeModel("openai", "gpt-speech", "tts", "GPT Speech"),
	makeModel("openai", "gpt-whisper", "stt", "GPT Whisper"),
	makeModel("openai", "gpt-judge", "judge", "GPT Judge"),
	makeModel("local", "tiny-embed", "tiny", "Tiny Embed"),
	makeModel("local", "embed", "embedding", "Local Embed"),
	makeModel("audio-only", "speech", "tts", "Audio Only Speech"),
	makeModel("disabled-provider", "chat", "chat", "Disabled Chat"),
];

function makeRegistry(authProviders: readonly string[] = ["openai"]): ModelsControlRegistry {
	const auth = new Set(authProviders);
	return {
		getAll: () => MODELS,
		find: (provider, id) => MODELS.find(model => model.provider === provider && model.id === id),
		hasConcreteAuth: provider => auth.has(provider),
		getError: () => undefined,
	};
}

function makeSettings(): Settings {
	return Settings.isolated({
		disabledProviders: ["disabled-provider"],
		modelRoles: {
			default: "openai/gpt-chat",
			slow: "openai/gpt-chat:high",
		},
		modelAgents: {
			reviewer: {
				model: "openai/gpt-chat",
				fallback: ["openai/gpt-chat", "openai/gpt-mini", "openai/gpt-mini"],
			},
			offline: { model: "local/embed", fallback: ["openai/gpt-chat"] },
		},
		fallbackScopes: {
			retry: { default: ["openai/gpt-chat", "openai/gpt-chat"] },
			role: { slow: ["openai/gpt-mini", "openai/gpt-mini"] },
			mode: { vibe: ["local/embed"] },
			chat: { default: ["openai/gpt-mini"] },
			image: { default: ["openai/gpt-image"] },
		},
		modelScenarios: {
			"local-review": {
				allowedAgents: ["reviewer", "offline"],
				boundary: "local",
				failClosed: true,
			},
		},
		"retry.fallbackChains": { default: ["openai/gpt-mini", "openai/gpt-mini"] },
	});
}

/** The credential object deliberately carries a value the snapshot must never touch. */
const CREDENTIALS = {
	has: (provider: string) => provider === "openai",
	secret: "sk-super-secret-value",
};

describe("model-control snapshot", () => {
	const snapshot = buildModelsControlSnapshot({
		settings: makeSettings(),
		registry: makeRegistry(),
		credentials: CREDENTIALS,
	});

	it("reports provider visibility, credential presence and typed capabilities", () => {
		const openai = snapshot.providers.find(provider => provider.id === "openai");
		expect(openai).toMatchObject({
			state: "visible",
			enabled: true,
			configured: true,
			modelCount: 6,
		});
		expect(openai?.capabilities).toEqual(["chat", "image", "decision"]);
		expect(openai?.paused).toEqual(["tts", "stt"]);

		const disabled = snapshot.providers.find(provider => provider.id === "disabled-provider");
		expect(disabled).toMatchObject({ state: "disabled", enabled: false });
		expect(snapshot.providers.find(provider => provider.id === "local")).toMatchObject({
			configured: false,
			capabilities: ["chat", "embedding"],
		});
	});

	it("normalizes scoped and legacy chains before exposing them", () => {
		const retry = snapshot.fallbackScopes.find(scope => scope.scope === "retry");
		expect(retry?.chains[0]).toMatchObject({
			key: "default",
			chain: ["openai/gpt-chat"],
		});
		expect(retry?.chains[0]?.duplicates).toEqual([{ removed: "openai/gpt-chat", kept: "openai/gpt-chat" }]);

		expect(snapshot.legacyRetry[0]).toMatchObject({
			key: "default",
			chain: ["openai/gpt-mini"],
		});
		expect(snapshot.legacyRetry[0]?.duplicates).toHaveLength(1);

		const role = snapshot.roles.find(entry => entry.role === "slow");
		expect(role).toMatchObject({
			selector: "openai/gpt-chat:high",
			fallback: ["openai/gpt-mini"],
			fallbackSource: "role",
			resolved: { provider: "openai", id: "gpt-chat", kind: "chat" },
		});
		// The scope chain is already normalized when the target is resolved, so
		// the target row reports the collapsed chain and no duplicate remains.
		expect(role?.duplicates).toEqual([]);
		const roleScope = snapshot.fallbackScopes.find(scope => scope.scope === "role");
		expect(roleScope?.chains[0]?.duplicates).toEqual([{ removed: "openai/gpt-mini", kept: "openai/gpt-mini" }]);

		const reviewer = snapshot.agents.find(target => target.target === "reviewer");
		expect(reviewer).toMatchObject({
			kind: "team",
			role: "slow",
			selector: "openai/gpt-chat",
			fallback: ["openai/gpt-mini"],
			fallbackSource: "agent",
		});
		expect(reviewer?.duplicates).toHaveLength(1);
	});

	it("resolves Team targets and applies the Vibe mode chain only to Vibe", () => {
		const teamWorker = snapshot.teamTargets.find(target => target.target === "worker");
		// The explicit retry scope overrides the legacy default chain; the
		// target still reports the legacy-retry source it inherited through.
		expect(teamWorker).toMatchObject({
			role: "task",
			selector: "@task",
			fallback: ["openai/gpt-chat"],
			fallbackSource: "legacy-retry",
		});
		const vibeWorker = snapshot.vibeTargets.find(target => target.target === "worker");
		expect(vibeWorker).toMatchObject({
			fallback: ["local/embed"],
			fallbackSource: "mode",
		});
		expect(snapshot.teamTargets).toHaveLength(4);
		expect(snapshot.vibeTargets).toHaveLength(4);
	});

	it("groups catalog kinds into typed sections, preserving the catalog spelling", () => {
		expect(snapshot.kinds.map(section => section.kind)).toEqual([
			"chat",
			"image",
			"tts",
			"stt",
			"decision",
			"embedding",
		]);
		const decision = snapshot.kinds.find(section => section.kind === "decision");
		expect(decision?.paused).toBe(false);
		expect(decision?.models[0]).toMatchObject({ provider: "openai", id: "gpt-judge", catalogKind: "judge" });
		expect(snapshot.kinds.find(section => section.kind === "tts")?.paused).toBe(true);
		expect(snapshot.kinds.find(section => section.kind === "stt")?.paused).toBe(true);
		expect(snapshot.kinds.find(section => section.kind === "chat")?.models).toContainEqual(
			expect.objectContaining({ provider: "local", id: "tiny-embed", catalogKind: "tiny" }),
		);
	});

	it("exposes each kind's own fallback chain without borrowing retry/default", () => {
		const chat = snapshot.kinds.find(section => section.kind === "chat");
		const image = snapshot.kinds.find(section => section.kind === "image");
		expect(chat?.fallback[0]).toMatchObject({ key: "default", chain: ["openai/gpt-mini"] });
		expect(image?.fallback[0]).toMatchObject({ key: "default", chain: ["openai/gpt-image"] });
		// No tts chain exists, so the tts section stays empty even though retry
		// and role chains are configured.
		expect(snapshot.kinds.find(section => section.kind === "tts")?.fallback).toEqual([]);
		expect(snapshot.fallbackScopes.find(scope => scope.scope === "chat")?.chains).toHaveLength(1);
		expect(snapshot.fallbackScopes.find(scope => scope.scope === "tts")?.chains).toEqual([]);
		// Typed rows carry the boundary implied by their provider/endpoint.
		expect(chat?.models).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ provider: "openai", id: "gpt-chat", boundary: "public" }),
				expect.objectContaining({ provider: "local", id: "tiny-embed", boundary: "local" }),
			]),
		);
		expect(image?.models).toContainEqual(expect.objectContaining({ id: "gpt-image", boundary: "public" }));
	});

	it("projects scenario boundary decisions and refusals", () => {
		expect(snapshot.totals.scenarios).toBe(1);
		const scenario = snapshot.scenarios[0];
		expect(scenario).toMatchObject({
			name: "local-review",
			boundary: "local",
			failClosed: true,
			appliesToAll: false,
		});
		expect(scenario?.allowedAgents).toEqual(["reviewer", "offline"]);
		const reviewer = scenario?.targets.find(target => target.target === "reviewer");
		// Public primary and public fallbacks: refused rather than silently used.
		expect(reviewer).toMatchObject({ outcome: "refused" });
		expect(reviewer?.selected).toBeUndefined();
		expect(reviewer?.skipped).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ selector: "openai/gpt-chat", boundary: "public", reason: "boundary" }),
			]),
		);
		const offline = scenario?.targets.find(target => target.target === "offline");
		expect(offline).toMatchObject({
			outcome: "allowed",
			selected: { provider: "local", id: "embed" },
			selectedBoundary: "local",
		});
	});

	it("never contains credential values or auth material", () => {
		const serialized = JSON.stringify(snapshot);
		expect(serialized).not.toContain("sk-super-secret-value");
		expect(serialized).not.toContain("apiKey");
		expect(snapshot.readOnly).toBe(true);
		expect(snapshot.schema).toBe("models-control/1");
	});

	it("serves the snapshot as a no-store JSON response", async () => {
		const response = await handleModelsControl(undefined, {
			settings: makeSettings(),
			registry: makeRegistry(),
			credentials: CREDENTIALS,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = (await response.json()) as { readOnly?: boolean };
		expect(body.readOnly).toBe(true);
	});

	it("dispatches the route before the generic /api/models listing", async () => {
		const response = await webGatewayFetch(
			new Request("http://127.0.0.1/api/models/control", { method: "POST" }),
			"127.0.0.1",
		);
		expect(response.status).toBe(405);
		expect(await response.json()).toEqual({ error: "Method not allowed" });
	});
});
