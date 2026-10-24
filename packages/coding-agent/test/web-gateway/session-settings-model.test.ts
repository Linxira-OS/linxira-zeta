/**
 * `/api/sessions/<id>` reports the session's model for attach clients. Runtime
 * `model_change` entries store `"provider/modelId"` in `model`, so reading the
 * legacy `provider`/`modelId` fields produced `model: {}` and every attach
 * crashed in `modelRegistry.find(undefined, undefined)`.
 */
import { describe, expect, test } from "bun:test";
import { buildWebSessionContext } from "../../src/server/web-gateway/sessions";
import type { SessionEntry } from "../../src/session/session-entries";

const now = new Date().toISOString();

function modelChange(id: string, parentId: string | null, model: string, role?: string): SessionEntry {
	return { type: "model_change", id, parentId, timestamp: now, model, role } as SessionEntry;
}

describe("session settings model", () => {
	test("parses the runtime provider/modelId string and strips a thinking suffix", () => {
		const context = buildWebSessionContext(
			[modelChange("a", null, "ac/glm-5.3-flash"), modelChange("b", "a", "od/deepseek-v4.1-flash:high")],
			"b",
		);
		expect(context.model).toEqual({ provider: "od", modelId: "deepseek-v4.1-flash" });
	});

	test("keeps the explicit default over a later assistant fallback tag", () => {
		const context = buildWebSessionContext(
			[
				modelChange("a", null, "ac/glm-5.3-flash", "default"),
				{
					type: "message",
					id: "b",
					parentId: "a",
					timestamp: now,
					message: {
						role: "assistant",
						content: [{ type: "text", text: "hello" }],
						provider: "backup",
						model: "fallback-model",
					},
				} as SessionEntry,
			],
			"b",
		);
		expect(context.model).toEqual({ provider: "ac", modelId: "glm-5.3-flash" });
	});

	test("keeps the user's default pick over an ephemeral fallback", () => {
		const context = buildWebSessionContext(
			[modelChange("a", null, "ac/glm-5.3-flash", "default"), modelChange("b", "a", "backup/model", "ephemeral")],
			"b",
		);
		expect(context.model).toEqual({ provider: "ac", modelId: "glm-5.3-flash" });
	});
});
