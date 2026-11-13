import { describe, expect, test } from "bun:test";

import {
  mergeModelsConfigLayers,
  modelsConfigWriteText,
  parseModelsConfigDocument,
  serializeModelsConfigDocument,
} from "./modelsConfigDocument";

const JSON_CONFIG = `{
  "providers": {
    "acme": {
      "baseUrl": "https://api.acme.test/v1",
      "apiKey": "ACME_API_KEY",
      "models": [
        { "id": "acme-chat", "name": "Acme Chat", "contextWindow": 128000 }
      ]
    }
  }
}`;

const YAML_CONFIG = `# Hand-written provider catalog
providers:
   acme:
      baseUrl: https://api.acme.test/v1
      apiKey: ACME_API_KEY
      models:
         - id: acme-chat
           name: Acme Chat
           contextWindow: 128000
`;

describe("models config document parser", () => {
	test("accepts a standard JSON object and knows it was JSON", () => {
		const parsed = parseModelsConfigDocument(JSON_CONFIG);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.format).toBe("json");
		expect(parsed.document.providers.acme?.baseUrl).toBe("https://api.acme.test/v1");
		expect(parsed.document.providers.acme?.models).toEqual([
			{ id: "acme-chat", name: "Acme Chat", contextWindow: 128000 },
		]);
	});

	test("accepts block-style YAML and keeps the original text", () => {
		const parsed = parseModelsConfigDocument(YAML_CONFIG);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.format).toBe("yaml");
		expect(parsed.document.providers.acme?.apiKey).toBe("ACME_API_KEY");
		expect(modelsConfigWriteText(parsed)).toBe(YAML_CONFIG);
	});

	test("serializes a JSON import as block YAML that round-trips", () => {
		const parsed = parseModelsConfigDocument(JSON_CONFIG);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const text = serializeModelsConfigDocument(parsed.document);
		expect(text).toContain("providers:");
		expect(text).toContain("acme:");
		expect(text.trimStart().startsWith("{")).toBe(false);
		const reparsed = parseModelsConfigDocument(text);
		expect(reparsed.ok).toBe(true);
		if (!reparsed.ok) return;
		expect(reparsed.document).toEqual(parsed.document);
	});

	test("empty text is an empty provider document, not an error", () => {
		const parsed = parseModelsConfigDocument("  \n# only comments\n");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.document.providers).toEqual({});
	});

	test("a JSON root array is rejected rather than guessed at", () => {
		const parsed = parseModelsConfigDocument(`[{"id":"acme-chat"}]`);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("root-array");
	});

	test("JSON-looking text never falls back to YAML flow syntax", () => {
		const parsed = parseModelsConfigDocument(`{providers: {acme: {models: [{id: acme-chat}]}}}`);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("json-syntax");
	});

	test("duplicate JSON keys are ambiguous and therefore rejected", () => {
		const parsed = parseModelsConfigDocument(
			`{"providers":{"acme":{"api":"openai-completions"},"acme":{"api":"anthropic-messages"}}}`,
		);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("duplicate-key");
	});

	test("duplicate YAML mapping keys are rejected with a position", () => {
		const parsed = parseModelsConfigDocument("providers:\n   acme:\n      api: openai-completions\n   acme:\n      api: anthropic-messages\n");
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("duplicate-key");
		expect(parsed.error.line).toBeGreaterThan(0);
	});

	test("unknown root keys name the key", () => {
		const parsed = parseModelsConfigDocument(`{"providers":{},"modelRoles":{}}`);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error).toMatchObject({ code: "unknown-root-key", path: "modelRoles" });
	});

	test.each([
		[`{"providers": []}`, "providers-not-object", "providers"],
		[`{"providers": {"acme": []}}`, "provider-not-object", "providers.acme"],
		[`{"providers": {"acme": {"models": {"acme-chat": {}}}}}`, "models-not-array", "providers.acme.models"],
		[`{"providers": {"acme": {"models": [[]]}}}`, "model-not-object", "providers.acme.models[0]"],
		[`{"providers": {"acme": {"models": [{"name":"No id"}]}}}`, "model-id-missing", "providers.acme.models[0].id"],
	] as const)("validates the models.yml shape: %s", (text, code, path) => {
		const parsed = parseModelsConfigDocument(text);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe(code);
		expect(parsed.error.path).toBe(path);
	});

	test("a scalar YAML document is an object-shape error", () => {
		const parsed = parseModelsConfigDocument("just-a-string\n");
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("root-not-object");
	});

	test("an explicit null root is not silently treated as an empty document", () => {
		const parsed = parseModelsConfigDocument("null\n");
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("root-not-object");
	});

	test("malformed JSON with a trailing comma fails instead of becoming YAML", () => {
		const parsed = parseModelsConfigDocument(`{"providers": {"acme": {"api": "openai-completions"}},}`);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.code).toBe("json-syntax");
	});

	test("merge keeps the hand-written user layer over the panel layer per provider", () => {
		const user = parseModelsConfigDocument("providers:\n   acme:\n      api: anthropic-messages\n");
		const panel = parseModelsConfigDocument(
			`{"providers":{"acme":{"api":"openai-completions"},"panel-only":{"api":"openai-completions"}}}`,
		);
		expect(user.ok && panel.ok).toBe(true);
		if (!user.ok || !panel.ok) return;
		const merged = mergeModelsConfigLayers(user.document, panel.document);
		expect(merged.providers.acme?.api).toBe("anthropic-messages");
		expect(merged.providers["panel-only"]?.api).toBe("openai-completions");
	});
});
