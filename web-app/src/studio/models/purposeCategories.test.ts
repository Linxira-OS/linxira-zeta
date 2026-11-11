import { describe, expect, it } from "bun:test";

import type { AvailableModelRecord, ModelRoleRecord } from "@linxiraos/studio-contract";
import { composeFallbackSlots } from "./fallbackSlots";
import {
	agentModelOverrideFor,
	agentRoleReferences,
	categoryChain,
	categoryModelFacts,
	classifyAgentModelOverride,
	isChatCategoryModel,
	resolveAgentModel,
	selectorNamesRole,
} from "./purposeCategories";

function role(id: string, primary: string): ModelRoleRecord {
	return { id, alias: `@${id}`, name: id, desc: "", builtin: true, primary, scope: "global" };
}

function model(
	selector: string,
	contextWindow = 128_000,
	cost?: { input: number; output: number },
): AvailableModelRecord {
	return {
		provider: selector.split("/")[0] ?? "test",
		id: selector.split("/")[1] ?? selector,
		selector,
		name: selector,
		reasoning: false,
		contextWindow,
		...(cost === undefined ? {} : { cost }),
	};
}

describe("purpose category chains", () => {
	it("distinguishes explicit, inherited-default and no fallback", () => {
		expect(categoryChain({ research: ["a/1", "b/2"] }, "research")).toEqual({
			chain: ["a/1", "b/2"],
			source: "explicit",
		});
		expect(categoryChain({ default: ["a/1"] }, "research")).toEqual({
			chain: ["a/1"],
			source: "inherited-default",
		});
		expect(categoryChain({}, "research")).toEqual({ chain: [], source: "none" });
		expect(categoryChain({}, "default")).toEqual({ chain: [], source: "none" });
	});

	it("composes the fixed slots without silently dropping extras", () => {
		expect(composeFallbackSlots("a/1", "b/2", ["c/3"])).toEqual({ ok: true, chain: ["a/1", "b/2", "c/3"] });
		expect(composeFallbackSlots("a/1", undefined, ["c/3"], { clearExtras: true })).toEqual({
			ok: true,
			chain: ["a/1"],
		});
	});
});

describe("agent category references", () => {
	it("finds definition and override references to a role alias only", () => {
		const agents = [
			{ name: "scout", model: ["@research"], overrideModel: "@research" },
			{ name: "worker", model: ["openai/gpt-5"] },
			{ name: "sonic", model: ["@smol"], overrideModel: "@smol" },
			{ name: "legacy", model: ["pi/research:high"] },
			{ name: "custom", overrideModel: "provider/model" },
		];
		expect(agentRoleReferences(agents, "research")).toEqual(["legacy", "scout"]);
		expect(agentRoleReferences(agents, "smol")).toEqual(["sonic"]);
		expect(agentRoleReferences(agents, "default")).toEqual([]);
		expect(selectorNamesRole("@research", "research")).toBe(true);
		expect(selectorNamesRole("@research-fast", "research")).toBe(false);
	});
});

describe("per-agent three-state model", () => {
	it("classifies inherit, category and exact overrides", () => {
		expect(classifyAgentModelOverride(undefined, ["@task"])).toEqual({
			mode: "inherit",
			roleId: "",
			exact: "",
			selector: "@task",
		});
		expect(classifyAgentModelOverride("@research", []).mode).toBe("category");
		expect(classifyAgentModelOverride("@research", []).roleId).toBe("research");
		expect(classifyAgentModelOverride("local/llama-3", []).mode).toBe("exact");
		expect(classifyAgentModelOverride("local/llama-3", []).exact).toBe("local/llama-3");
	});

	it("keeps the persisted override empty for inherit and role-keyed for categories", () => {
		expect(agentModelOverrideFor({ mode: "inherit", roleId: "research", exact: "a/b" })).toBe("");
		expect(agentModelOverrideFor({ mode: "category", roleId: "research", exact: "" })).toBe("@research");
		expect(agentModelOverrideFor({ mode: "exact", roleId: "", exact: " a/b " })).toBe("a/b");
	});

	it("resolves the final model and source without guessing", () => {
		const roles = [role("task", "deepseek/deepseek-v4"), role("research", "cheap/large-context")];
		const available = [model("deepseek/deepseek-v4"), model("cheap/large-context", 500_000)];
		const inherited = resolveAgentModel(undefined, ["@task"], roles, available);
		expect(inherited.source).toBe("inherit");
		expect(inherited.selector).toBe("deepseek/deepseek-v4");
		expect(inherited.model?.selector).toBe("deepseek/deepseek-v4");
		const category = resolveAgentModel("@research", [], roles, available);
		expect(category.source).toBe("category");
		expect(category.roleId).toBe("research");
		expect(category.model?.selector).toBe("cheap/large-context");
		expect(resolveAgentModel("local/llama", [], roles, [])).toEqual({
			source: "unresolved",
			selector: "local/llama",
		});
		expect(resolveAgentModel(undefined, [], roles, available)).toEqual({ source: "unresolved", selector: "" });
	});
});

describe("category facts", () => {
	it("keeps unknown context/cost unlabelled and filters non-chat models", () => {
		expect(isChatCategoryModel({ kind: "chat" })).toBe(true);
		expect(isChatCategoryModel({})).toBe(true);
		expect(isChatCategoryModel({ kind: "image" })).toBe(false);
		expect(categoryModelFacts(model("a/b", 32_000))).toEqual({ contextWindow: 32_000, costLabel: undefined });
		expect(categoryModelFacts(model("a/b", 32_000, { input: 1, output: 2 })).costLabel).toBe("1/2");
	});
});
