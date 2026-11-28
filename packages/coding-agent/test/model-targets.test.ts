import { describe, expect, it } from "bun:test";
import { Settings } from "@linxiraos/zeta/config/settings";
import {
	modelDataBoundary,
	resolveKindFallback,
	resolveModelTargetIdentity,
	resolveScenarioModel,
	resolveTeamModelTarget,
	resolveVibeModelTarget,
	TEAM_MODEL_TARGET_IDS,
} from "@linxiraos/zeta/session/model-controls";
import { getRetryFallbackChains, normalizeRetryFallbackChain } from "@linxiraos/zeta/session/retry-fallback-chains";
import type { Model } from "@linxiraos/pi-catalog/types";

function boundaryModel(provider: string, id: string, baseUrl: string): Model {
	return { provider, id, baseUrl } as unknown as Model;
}

describe("model target identity", () => {
	it("lets an agent carry its own model, effort and fallback", () => {
		const settings = Settings.isolated({
			modelAgents: {
				reviewer: {
					model: "openai/gpt-5.2",
					thinkingLevel: "low",
					fallback: ["openai/gpt-5-mini", "openai/gpt-5-mini"],
				},
			},
			fallbackScopes: { role: { slow: ["role/should-not-apply"] } },
		});

		const target = resolveModelTargetIdentity(settings, "reviewer");
		expect(target).toMatchObject({
			target: "reviewer",
			kind: "team",
			role: "slow",
			selector: "openai/gpt-5.2",
			source: "agent",
			thinkingLevel: "low",
			fallback: ["openai/gpt-5-mini"],
			fallbackSource: "agent",
		});
		expect(target.duplicates).toEqual([{ removed: "openai/gpt-5-mini", kept: "openai/gpt-5-mini" }]);
	});

	it("drops a fallback spelling that resolves to the selected primary", () => {
		const settings = Settings.isolated({
			modelAgents: {
				reviewer: { model: "openai/gpt-5.2", fallback: ["openai/gpt-5.2", "openai/gpt-5-mini"] },
			},
		});

		expect(resolveModelTargetIdentity(settings, "reviewer").fallback).toEqual(["openai/gpt-5-mini"]);
	});

	it("falls back to the role default when the agent override has no model", () => {
		const settings = Settings.isolated({
			modelRoles: { slow: "anthropic/claude-sonnet-4-5" },
			modelAgents: { reviewer: { thinkingLevel: "low" } },
		});

		const target = resolveModelTargetIdentity(settings, "reviewer");
		expect(target.selector).toBe("anthropic/claude-sonnet-4-5");
		expect(target.source).toBe("role");
		expect(target.thinkingLevel).toBe("low" as typeof target.thinkingLevel);
	});

	it("keeps a plain role configuration working with zero migration", () => {
		const settings = Settings.isolated({
			modelRoles: { task: "openai/gpt-5.2" },
			"retry.fallbackChains": { default: ["openai/gpt-5-mini"] },
		});

		const target = resolveModelTargetIdentity(settings, "scout");
		expect(target.role).toBe("task");
		expect(target.selector).toBe("openai/gpt-5.2");
		expect(target.source).toBe("role");
		expect(target.fallback).toEqual(["openai/gpt-5-mini"]);
		expect(target.fallbackSource).toBe("legacy-retry");
	});

	it("maps the Vibe/Team role targets onto the shared roles", () => {
		expect(TEAM_MODEL_TARGET_IDS).toEqual(["worker", "reviewer", "secretary", "pm"]);
		const settings = Settings.isolated({
			modelRoles: { task: "acme/worker", slow: "acme/reviewer", default: "acme/pm" },
		});

		expect(resolveTeamModelTarget(settings, "worker").selector).toBe("acme/worker");
		expect(resolveTeamModelTarget(settings, "reviewer").selector).toBe("acme/reviewer");
		expect(resolveTeamModelTarget(settings, "secretary").selector).toBe("acme/worker");
		expect(resolveTeamModelTarget(settings, "pm").selector).toBe("acme/pm");
	});

	it("uses the Vibe mode chain without leaking it into a plain Team run", () => {
		const settings = Settings.isolated({
			modelRoles: { task: "acme/worker" },
			fallbackScopes: {
				role: { task: ["acme/role-fallback"] },
				mode: { vibe: ["acme/vibe-fallback"] },
				retry: { task: ["acme/retry-fallback"] },
				resume: { task: ["acme/resume-fallback"] },
			},
		});

		const vibe = resolveVibeModelTarget(settings, "worker");
		expect(vibe.fallback).toEqual(["acme/vibe-fallback"]);
		expect(vibe.fallbackSource).toBe("mode");

		const plain = resolveTeamModelTarget(settings, "worker");
		expect(plain.fallback).toEqual(["acme/role-fallback"]);
		expect(plain.fallbackSource).toBe("role");

		const resume = resolveModelTargetIdentity(settings, "worker", { fallbackScope: "resume" });
		expect(resume.fallback).toEqual(["acme/resume-fallback"]);
		expect(resume.fallbackSource).toBe("resume");

		const retry = resolveModelTargetIdentity(settings, "worker", { fallbackScope: "retry" });
		expect(retry.fallback).toEqual(["acme/retry-fallback"]);
		expect(retry.fallbackSource).toBe("retry");
	});

	it("never borrows the legacy retry chain for another scope", () => {
		const settings = Settings.isolated({
			modelRoles: { task: "acme/worker" },
			"retry.fallbackChains": { default: ["legacy/retry"] },
		});

		const resume = resolveModelTargetIdentity(settings, "worker", { fallbackScope: "resume" });
		expect(resume.fallback).toEqual([]);
		expect(resume.fallbackSource).toBeUndefined();

		const retry = resolveModelTargetIdentity(settings, "worker", { fallbackScope: "retry" });
		expect(retry.fallback).toEqual(["legacy/retry"]);
		expect(retry.fallbackSource).toBe("legacy-retry");
	});

	it("applies an explicit retry scope over the legacy retry chains", () => {
		const settings = Settings.isolated({
			modelRoles: { task: "acme/worker" },
			"retry.fallbackChains": { task: ["legacy/task"] },
			fallbackScopes: { retry: { task: ["scoped/task"] } },
		});

		expect(getRetryFallbackChains(settings).task).toEqual(["scoped/task"]);
	});

	it("merges catalog aliases before counting a retry chain duplicate", () => {
		const model = (id: string) => ({ provider: "provider", id }) as unknown as Model;
		const lookup = {
			find: (provider: string, id: string) => {
				if (provider !== "provider") return undefined;
				if (id === "short" || id === "full-model") return model("full-model");
				return undefined;
			},
		};

		const result = normalizeRetryFallbackChain(["provider/short", "provider/full-model"], lookup);
		expect(result.chain).toEqual(["provider/short"]);
		expect(result.duplicates).toHaveLength(1);
	});

	it("rejects malformed scoped chains and agent identities", () => {
		expect(() => Settings.isolated({ fallbackScopes: { retry: { default: "not-an-array" } } })).toThrow(
			/fallbackScopes\.retry\.default/,
		);
		expect(() => Settings.isolated({ fallbackScopes: { chat: { default: "not-an-array" } } })).toThrow(
			/fallbackScopes\.chat\.default/,
		);
		expect(() => Settings.isolated({ modelAgents: { reviewer: { thinkingLevel: "turbo" } } })).toThrow(
			/modelAgents\.reviewer\.thinkingLevel/,
		);
	});
});

describe("model-kind fallback scopes", () => {
	it("keeps every kind chain isolated from retry and from other kinds", () => {
		const settings = Settings.isolated({
			fallbackScopes: {
				chat: { default: ["acme/chat-fallback"] },
				image: { default: ["acme/image-fallback"] },
				embedding: { default: [] },
			},
			"retry.fallbackChains": { default: ["legacy/retry-fallback"] },
		});

		expect(resolveKindFallback(settings, "chat", ["default"])).toMatchObject({
			kind: "chat",
			chain: ["acme/chat-fallback"],
			source: { scope: "chat", key: "default" },
		});
		expect(resolveKindFallback(settings, "image", ["default"]).chain).toEqual(["acme/image-fallback"]);
		// An unconfigured kind never borrows the retry scope or the legacy default.
		expect(resolveKindFallback(settings, "tts", ["default"])).toEqual({
			kind: "tts",
			chain: [],
			duplicates: [],
		});
		// An explicit empty chain is a configured "no fallbacks" answer.
		expect(resolveKindFallback(settings, "embedding", ["default"])).toMatchObject({
			chain: [],
			source: { scope: "embedding", key: "default" },
		});
	});
});

describe("model scenarios", () => {
	const publicModel = boundaryModel("openai", "gpt-5", "https://api.openai.com/v1");
	const privateModel = boundaryModel("vllm", "qwen", "http://10.4.0.9:8000/v1");
	const localModel = boundaryModel("ollama", "llama", "http://127.0.0.1:11434/v1");

	it("classifies endpoint boundaries local < private < public", () => {
		expect(modelDataBoundary(localModel)).toBe("local");
		expect(modelDataBoundary(privateModel)).toBe("private");
		expect(modelDataBoundary(publicModel)).toBe("public");
		expect(modelDataBoundary({ provider: "ollama" })).toBe("local");
		expect(modelDataBoundary({ provider: "acme" })).toBe("public");
	});

	it("uses an allowed fallback instead of a public primary in a private scenario", () => {
		const settings = Settings.isolated({
			modelScenarios: {
				"private-review": { allowedAgents: ["reviewer"], boundary: "private" },
			},
		});
		const resolution = resolveScenarioModel(settings, "reviewer", [
			{ selector: "openai/gpt-5", model: publicModel },
			{ selector: "vllm/qwen", model: privateModel },
		]);
		expect(resolution).toMatchObject({
			scenario: "private-review",
			outcome: "fallback",
			chosen: { selector: "vllm/qwen" },
			modelBoundary: "private",
		});
		expect(resolution?.skipped).toEqual([{ selector: "openai/gpt-5", boundary: "public", reason: "boundary" }]);
	});

	it("refuses an out-of-boundary primary when fail-closed finds no allowed candidate", () => {
		const settings = Settings.isolated({
			modelScenarios: {
				"private-review": { allowedAgents: ["reviewer"], boundary: "private" },
			},
		});
		const resolution = resolveScenarioModel(settings, "reviewer", [
			{ selector: "openai/gpt-5", model: publicModel },
			{ selector: "openai/gpt-5-mini", model: publicModel },
		]);
		expect(resolution).toMatchObject({ outcome: "refused", failClosed: true });
		expect(resolution?.chosen).toBeUndefined();
		expect(resolution?.reason).toContain("outside private");
	});

	it("reports the boundary violation when failClosed is false", () => {
		const settings = Settings.isolated({
			modelScenarios: {
				"private-review": { allowedAgents: ["reviewer"], boundary: "local", failClosed: false },
			},
		});
		const resolution = resolveScenarioModel(settings, "reviewer", [{ selector: "vllm/qwen", model: privateModel }]);
		expect(resolution).toMatchObject({
			outcome: "advisory",
			chosen: { selector: "vllm/qwen" },
			modelBoundary: "private",
		});
		expect(resolution?.reason).toContain("outside local");
	});

	it("leaves an agent without a scenario unconstrained", () => {
		const settings = Settings.isolated({ modelRoles: { default: "openai/gpt-5" } });
		expect(
			resolveScenarioModel(settings, "reviewer", [{ selector: "openai/gpt-5", model: publicModel }]),
		).toBeUndefined();
	});

	it("rejects malformed scenario constraints", () => {
		expect(() => Settings.isolated({ modelScenarios: { review: { boundary: "orbital" } } })).toThrow(
			/modelScenarios\.review\.boundary/,
		);
		expect(() => Settings.isolated({ modelScenarios: { review: { boundary: "local", failClosed: "yes" } } })).toThrow(
			/modelScenarios\.review\.failClosed/,
		);
		expect(() =>
			Settings.isolated({
				modelScenarios: {
					first: { allowedAgents: ["reviewer"], boundary: "local" },
					second: { allowedAgents: ["Reviewer"], boundary: "public" },
				},
			}),
		).toThrow(/already constrained by first/);
		expect(() =>
			Settings.isolated({
				modelScenarios: {
					ambient: { boundary: "local" },
					review: { allowedAgents: ["reviewer"], boundary: "public" },
				},
			}),
		).toThrow(/applies to every agent/);
	});
});
