import { describe, expect, it } from "bun:test";
import { Settings } from "@linxiraos/zeta/config/settings";
import {
	resolveModelTargetIdentity,
	resolveTeamModelTarget,
	resolveVibeModelTarget,
	TEAM_MODEL_TARGET_IDS,
} from "@linxiraos/zeta/session/model-controls";
import { getRetryFallbackChains, normalizeRetryFallbackChain } from "@linxiraos/zeta/session/retry-fallback-chains";
import type { Model } from "@linxiraos/pi-catalog/types";

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
		expect(() => Settings.isolated({ modelAgents: { reviewer: { thinkingLevel: "turbo" } } })).toThrow(
			/modelAgents\.reviewer\.thinkingLevel/,
		);
	});
});
