import { describe, expect, test } from "bun:test";

import { loadVisibilitySnapshot, saveHiddenModels } from "./modelVisibilityGateway";

function fakeGateway(handler: (url: string, init?: RequestInit) => unknown) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const fetcher = async (url: string, init?: RequestInit) => {
		calls.push(init === undefined ? { url } : { url, init });
		return Response.json(handler(url, init));
	};
	return { fetcher, calls };
}

describe("visibility gateway fallback", () => {
	test("reads the available model list and the shared hidden list", async () => {
		const { fetcher, calls } = fakeGateway(url => {
			if (url.startsWith("/api/models")) {
				return {
					modelList: [
						{
							id: "claude-sonnet-4-5",
							name: "Claude Sonnet",
							provider: "anthropic",
							kind: "chat",
							roles: ["default", "vision"],
						},
						{ id: "claude-sonnet-4-5", name: "duplicate", provider: "anthropic" },
						{ id: "gpt-5", name: "GPT-5", provider: "openai" },
						{ id: "", name: "broken", provider: "openai" },
					],
				};
			}
			return { values: { hiddenModels: ["anthropic/claude-sonnet-4-5", 3] } };
		});

		const snapshot = await loadVisibilitySnapshot(fetcher);

		expect(snapshot.models).toEqual([
			{
				provider: "anthropic",
				id: "claude-sonnet-4-5",
				selector: "anthropic/claude-sonnet-4-5",
				name: "Claude Sonnet",
				kind: "chat",
				roles: ["default", "vision"],
			},
			{ provider: "openai", id: "gpt-5", selector: "openai/gpt-5", name: "GPT-5", roles: [] },
		]);
		expect(snapshot.hiddenModels).toEqual(["anthropic/claude-sonnet-4-5"]);
		expect(calls.map(call => call.url)).toEqual(["/api/models", "/api/settings/values?path=hiddenModels"]);
	});

	test("saves hiddenModels through the settings route with the whole list", async () => {
		const { fetcher, calls } = fakeGateway(() => ({ ok: true }));

		await saveHiddenModels(["openai/*", "anthropic/claude-sonnet-4-5"], fetcher);

		expect(calls.length).toBe(1);
		expect(calls[0]?.url).toBe("/api/settings");
		expect(calls[0]?.init?.method).toBe("PUT");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			path: "hiddenModels",
			value: ["openai/*", "anthropic/claude-sonnet-4-5"],
		});
	});
});
