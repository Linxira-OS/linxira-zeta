import assert from "node:assert/strict";
import test from "node:test";

import { extractMatchingModelMetadata, extractModelMetadata } from "./model-metadata.ts";

test("extracts model limits from common catalog field names", () => {
  assert.deepEqual(
    extractModelMetadata({ context_window: "131072", max_output_tokens: 8192 }),
    { contextWindow: 131072, maxTokens: 8192 },
  );
});

test("extracts nested provider metadata", () => {
  assert.deepEqual(
    extractModelMetadata({ limits: { max_context_length: 200000, max_completion_tokens: 16384 } }),
    { contextWindow: 200000, maxTokens: 16384 },
  );
});

test("matches an OpenAI-compatible /models response by model id", () => {
  assert.deepEqual(
    extractMatchingModelMetadata({ data: [{ id: "other" }, { id: "DeepSeek-V4", contextWindow: 1000000, maxTokens: 20000 }] }, "deepseek-v4"),
    { contextWindow: 1000000, maxTokens: 20000 },
  );
});

test("returns no metadata for catalogs without limits", () => {
  assert.deepEqual(extractMatchingModelMetadata({ data: [{ id: "model" }] }, "model"), {});
});
