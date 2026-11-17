import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Api, Model } from "@linxiraos/pi-ai";
import * as ai from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { Settings } from "@linxiraos/zeta/config/settings";
import { generateTaskLabel, labelEchoesHandle } from "@linxiraos/zeta/task/label";

function getModelOrThrow(id: string): Model<Api> {
	const model = getBundledModel("anthropic", id);
	if (!model) throw new Error(`Expected model ${id}`);
	return model;
}

function createSettings(model: Model<Api>, extra: Record<string, unknown> = {}) {
	return Settings.isolated({
		modelRoles: { tiny: `${model.provider}/${model.id}` },
		...extra,
	});
}

function createRegistry(model: Model<Api>) {
	return {
		getAvailable: (kind = "chat") => (kind === "all" ? [model] : []),
		getApiKey: async () => "test-key",
		resolver: vi.fn(() => async () => "test-key"),
	} as never;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("task label generation", () => {
	it("settles when its executor cancellation signal aborts an in-flight title request", async () => {
		const model = getModelOrThrow("claude-sonnet-4-5");
		const controller = new AbortController();
		const started = Promise.withResolvers<void>();
		const response = Promise.withResolvers<ai.AssistantMessage>();
		let requestSignal: AbortSignal | undefined;
		vi.spyOn(ai, "completeSimple").mockImplementation((_model, _context, options) => {
			requestSignal = options?.signal;
			requestSignal?.addEventListener(
				"abort",
				() => response.resolve({ stopReason: "stop", content: [{ type: "text", text: "" }] } as never),
				{ once: true },
			);
			started.resolve();
			return response.promise;
		});

		const label = generateTaskLabel(
			"Investigate shutdown",
			createRegistry(model),
			createSettings(model),
			undefined,
			controller.signal,
		);
		await started.promise;
		controller.abort();

		expect(requestSignal).toBe(controller.signal);
		expect(await label).toBeNull();
	});

	it("rejects a generated label that only echoes the spawn handle", async () => {
		const model = getModelOrThrow("claude-sonnet-4-5");
		vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "stop",
			content: [{ type: "text", text: "<title>AuthLoader</title>" }],
		} as never);

		const echoed = await generateTaskLabel(
			"Sleep forty seconds then reply done",
			createRegistry(model),
			createSettings(model),
			"AuthLoader",
		);
		expect(echoed).toBeNull();

		vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "stop",
			content: [{ type: "text", text: "<title>Sleep then reply done</title>" }],
		} as never);
		const labeled = await generateTaskLabel(
			"Sleep forty seconds then reply done",
			createRegistry(model),
			createSettings(model),
			"AuthLoader",
		);
		expect(labeled).toBe("Sleep then reply done");
	});

	it("writes Chinese labels for a Chinese session while preserving identifiers", async () => {
		const model = getModelOrThrow("claude-sonnet-4-5");
		const completeSimpleMock = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "stop",
			content: [{ type: "text", text: "<title>修复 Redis 重试队列</title>" }],
		} as never);

		const label = await generateTaskLabel(
			"Fix the Redis retry queue dropping jobs when a worker restarts",
			createRegistry(model),
			createSettings(model, { language: "zh" }),
			"RetryFixer",
		);

		expect(label).toBe("修复 Redis 重试队列");
		expect(label).toContain("Redis");
		expect(label).not.toBe("RetryFixer");
		expect(completeSimpleMock).toHaveBeenCalledTimes(1);
		const request = completeSimpleMock.mock.calls[0]?.[1] as { systemPrompt?: string[] } | undefined;
		expect(request?.systemPrompt?.join("\n")).toContain("简体中文");
	});

	it("keeps the English task label request for an English session", async () => {
		const model = getModelOrThrow("claude-sonnet-4-5");
		const completeSimpleMock = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "stop",
			content: [{ type: "text", text: "<title>Fix Redis retry queue</title>" }],
		} as never);

		const label = await generateTaskLabel(
			"Fix the Redis retry queue",
			createRegistry(model),
			createSettings(model, { language: "en" }),
			"RetryFixer",
		);

		expect(label).toBe("Fix Redis retry queue");
		const request = completeSimpleMock.mock.calls[0]?.[1] as { systemPrompt?: string[] } | undefined;
		expect(request?.systemPrompt?.join("\n")).not.toContain("简体中文");
	});

	it("uses an explicit invocation language over the session setting", async () => {
		const model = getModelOrThrow("claude-sonnet-4-5");
		const completeSimpleMock = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "stop",
			content: [{ type: "text", text: "<title>修复登录过期</title>" }],
		} as never);

		const label = await generateTaskLabel(
			"Fix expired login",
			createRegistry(model),
			createSettings(model, { language: "en" }),
			"LoginFixer",
			undefined,
			"zh",
		);

		expect(label).toBe("修复登录过期");
		const request = completeSimpleMock.mock.calls[0]?.[1] as { systemPrompt?: string[] } | undefined;
		expect(request?.systemPrompt?.join("\n")).toContain("简体中文");
	});

	it("treats a case-insensitive Name-N collision as an echoed handle", () => {
		expect(labelEchoesHandle("AuthLoader-3", "authloader")).toBe(true);
		expect(labelEchoesHandle("AuthLoader-3", "AuthLoader")).toBe(true);
		expect(labelEchoesHandle("AuthLoader", "authloader")).toBe(true);
		expect(labelEchoesHandle("AuthLoader-3", "Migrate users")).toBe(false);
	});
});
