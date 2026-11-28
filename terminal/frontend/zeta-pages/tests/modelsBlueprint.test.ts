/**
 * Blueprint projection tests.
 *
 * The Blueprint is not a second model-control state: `buildModelsControlView`
 * carries the exact snapshot the form renders and derives nodes/edges from it.
 * These cases pin the simple and complex shapes so the page cannot quietly
 * grow a parallel state object.
 */
import { describe, expect, test } from "vitest";
import type {
	ControlModelKind,
	ModelControlKindSection,
	ModelControlRole,
	ModelControlTarget,
	ModelsControlSnapshot,
} from "../modelsControl";
import {
	buildModelsControlView,
	layoutModelsBlueprint,
	projectModelsBlueprint,
	selectorIdentity,
} from "../modelsBlueprint";

function kindSection(kind: ControlModelKind, count = 1): ModelControlKindSection {
	return {
		kind,
		paused: kind === "tts" || kind === "stt" || kind === "video",
		models: Array.from({ length: count }, (_, index) => ({
			provider: "acme",
			id: `${kind}-${index}`,
			name: `${kind} ${index}`,
			kind,
			catalogKind: kind === "decision" ? "judge" : kind,
			available: true,
		})),
	};
}

function role(name: string, selector: string, fallback: string[] = []): ModelControlRole {
	return {
		role: name,
		selector,
		source: "role",
		resolved: {
			provider: selector.slice(0, selector.indexOf("/")),
			id: selector.slice(selector.indexOf("/") + 1).split(":")[0]!,
			name: selector,
			kind: "chat",
			catalogKind: "chat",
		},
		fallback,
		fallbackSource: fallback.length === 0 ? undefined : "role",
		duplicates: [],
	};
}

function target(name: string, selector: string, fallback: string[] = []): ModelControlTarget {
	return {
		target: name,
		kind: "team",
		role: "task",
		selector,
		source: "role",
		resolved: {
			provider: "acme",
			id: selector.split("/")[1]?.split(":")[0] ?? selector,
			name: selector,
			kind: "chat",
			catalogKind: "chat",
		},
		fallback,
		fallbackSource: fallback.length === 0 ? undefined : "role",
		duplicates: [],
	};
}

const SIMPLE: ModelsControlSnapshot = {
	schema: "models-control/1",
	readOnly: true,
	providers: [
		{
			id: "acme",
			name: "Acme",
			state: "visible",
			enabled: true,
			configured: true,
			modelCount: 1,
			capabilities: ["chat"],
			paused: [],
		},
	],
	roles: [role("default", "acme/chat")],
	fallbackScopes: [{ scope: "retry", chains: [] }],
	legacyRetry: [],
	agents: [],
	teamTargets: [],
	vibeTargets: [],
	kinds: [kindSection("chat")],
	catalogKinds: ["chat"],
	totals: { providers: 1, models: 1, roles: 1, agents: 0, targets: 0, fallbackChains: 0 },
};

const COMPLEX: ModelsControlSnapshot = {
	...SIMPLE,
	providers: [
		...SIMPLE.providers,
		{
			id: "openai",
			name: "OpenAI",
			state: "disabled",
			enabled: false,
			configured: false,
			modelCount: 3,
			capabilities: ["chat", "image", "decision"],
			paused: ["tts"],
		},
	],
	roles: [
		role("default", "acme/chat", ["openai/gpt-mini:high", "openai/gpt-mini:high"]),
		role("slow", "openai/gpt-5:high"),
	],
	fallbackScopes: [
		{
			scope: "retry",
			chains: [
				{
					key: "default",
					chain: ["openai/gpt-mini"],
					duplicates: [{ removed: "openai/gpt-mini", kept: "openai/gpt-mini" }],
					sameModelDifferentEffort: [],
				},
			],
		},
		{
			scope: "role",
			chains: [
				{
					key: "slow",
					chain: ["acme/chat:low"],
					duplicates: [],
					sameModelDifferentEffort: [{ modelKey: "acme/chat", thinkingLevels: ["", "low"] }],
				},
			],
		},
	],
	legacyRetry: [
		{
			key: "default",
			chain: ["acme/chat"],
			duplicates: [],
			sameModelDifferentEffort: [],
		},
	],
	agents: [{ ...target("reviewer", "openai/gpt-5", ["acme/chat"]), kind: "agent" }],
	teamTargets: [target("worker", "acme/chat")],
	vibeTargets: [target("worker", "acme/chat", ["openai/gpt-mini"])],
	kinds: [kindSection("chat", 2), kindSection("decision"), kindSection("tts")],
	catalogKinds: ["chat", "image", "judge", "tts"],
	totals: { providers: 2, models: 4, roles: 2, agents: 1, targets: 2, fallbackChains: 3 },
};

describe("selector identity", () => {
	test("splits provider/id and strips a thinking suffix", () => {
		expect(selectorIdentity("openai/gpt-5:high")).toEqual({ provider: "openai", id: "gpt-5" });
		expect(selectorIdentity("acme/model:med")).toEqual({ provider: "acme", id: "model" });
		expect(selectorIdentity("gpt-5")).toBeUndefined();
		expect(selectorIdentity("@task")).toBeUndefined();
	});
});

describe("models Blueprint projection", () => {
	test("projects the simple control state to provider/role/kind/model nodes", () => {
		const blueprint = projectModelsBlueprint(SIMPLE);
		expect(blueprint.nodes.map(node => node.kind)).toEqual(
			expect.arrayContaining(["provider", "role", "kind", "model"]),
		);
		expect(blueprint.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "provider:acme", to: "kind:chat", label: "supports" }),
				expect.objectContaining({ from: "role:default", to: "model:acme/chat", label: "selects" }),
			]),
		);
		const layout = layoutModelsBlueprint(blueprint);
		expect(layout.nodes).toHaveLength(blueprint.nodes.length);
		expect(layout.edges.length).toBeGreaterThan(0);
		for (const node of layout.nodes) {
			expect(node.x).toBeGreaterThanOrEqual(24);
			expect(node.y).toBeGreaterThanOrEqual(24);
		}
		expect(layout.edges.every(edge => edge.path.startsWith("M "))).toBe(true);
	});

	test("projects complex fallback, agent, team, vibe and paused-kind state", () => {
		const blueprint = projectModelsBlueprint(COMPLEX);
		const byId = new Map(blueprint.nodes.map(node => [node.id, node]));
		expect(byId.get("agent:reviewer")).toMatchObject({ kind: "agent" });
		expect(byId.get("team:worker")).toMatchObject({ kind: "team" });
		expect(byId.get("vibe:worker")).toMatchObject({ kind: "team", label: "worker (vibe)" });
		expect(byId.get("kind:decision")).toBeDefined();
		expect(byId.get("kind:tts")).toBeDefined();
		expect(blueprint.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "provider:openai", to: "kind:tts", label: "paused" }),
				expect.objectContaining({ from: "role:slow", to: "model:openai/gpt-5", label: "selects" }),
				expect.objectContaining({ from: "role:slow", to: "model:acme/chat", label: "fallback:role" }),
				expect.objectContaining({ from: "vibe:worker", to: "model:openai/gpt-mini", label: "fallback" }),
			]),
		);
		// The duplicate spellings in the source chain are not re-emitted as edges.
		const duplicateEdges = blueprint.edges.filter(
			edge => edge.from === "role:default" && edge.to === "model:openai/gpt-mini" && edge.label === "fallback",
		);
		expect(duplicateEdges).toHaveLength(1);
	});

	test("carries the exact same snapshot object into both views", () => {
		const view = buildModelsControlView(COMPLEX);
		expect(view.snapshot).toBe(COMPLEX);
		expect(view.blueprint).toEqual(projectModelsBlueprint(COMPLEX));

		const next = { ...COMPLEX, roles: [...COMPLEX.roles, role("commit", "acme/chat")] };
		const nextView = buildModelsControlView(next);
		expect(nextView.snapshot).toBe(next);
		expect(nextView.blueprint.nodes.some(node => node.id === "role:commit")).toBe(true);
		expect(projectModelsBlueprint(COMPLEX).nodes.some(node => node.id === "role:commit")).toBe(false);
	});
});
