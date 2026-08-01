import assert from "node:assert/strict";
import test from "node:test";

const { buildVisibleRoleModels } = await import("./model-role-filter.ts");

test("does not resurrect a role for an unconfigured provider", () => {
  const result = buildVisibleRoleModels(
    { smol: "SiliconFlow/Pro/deepseek-ai/DeepSeek-V3.2" },
    [{ provider: "SiliconFlow", id: "Pro/deepseek-ai/DeepSeek-V3.2" }],
    new Set(["Lucoo", "DeepSeek"]),
  );

  assert.deepEqual(result, []);
});

test("keeps configured roles and removes the thinking suffix", () => {
  const result = buildVisibleRoleModels(
    { default: "Lucoo/gpt-5.6-luna:max" },
    [{ provider: "Lucoo", id: "gpt-5.6-luna", contextWindow: 1_000_000 }],
    new Set(["Lucoo"]),
  );

  assert.deepEqual(result, [{
    provider: "Lucoo",
    id: "gpt-5.6-luna",
    name: "gpt-5.6-luna (default)",
    contextWindow: 1_000_000,
  }]);
});

test("does not expose a configured role when its model is missing", () => {
  const result = buildVisibleRoleModels(
    { smol: "DeepSeek/unknown-model" },
    [{ provider: "DeepSeek", id: "deepseek-v4-flash" }],
    new Set(["DeepSeek"]),
  );

  assert.deepEqual(result, []);
});
