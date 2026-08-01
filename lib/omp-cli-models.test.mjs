import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncOmpCliModelsYaml } from "./omp-cli-models.ts";

test("replaces CLI providers so deleted web providers disappear", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-cli-models-"));
  await writeFile(join(agentDir, "models.yml"), "providers:\n  siliconflow:\n    api: openai-completions\n  keep:\n    api: openai-completions\n", "utf8");

  syncOmpCliModelsYaml(agentDir, {
    keep: { api: "openai-completions", models: [{ id: "keep-model" }] },
  });

  const output = await readFile(join(agentDir, "models.yml"), "utf8");
  assert.match(output, /keep-model/);
  assert.doesNotMatch(output, /siliconflow/);
});

test("writes configured providers even when no cached catalog row exists", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-cli-models-configured-"));
  await writeFile(join(agentDir, "models.yml"), "providers:\n  keep:\n    api: openai-completions\n", "utf8");

  syncOmpCliModelsYaml(agentDir, {
    siliconflow: {
      api: "openai-completions",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "test-key",
      models: [{ id: "deepseek-ai/DeepSeek-V3.2", name: "DeepSeek V3.2" }],
    },
  });

  const output = await readFile(join(agentDir, "models.yml"), "utf8");
  assert.match(output, /siliconflow/);
  assert.match(output, /deepseek-ai\/DeepSeek-V3\.2/);
});

test("reads and writes provider models through models.yml", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-model-config-"));
  await writeFile(join(agentDir, "models.yml"), "providers:\n  siliconflow:\n    api: openai-completions\n    models:\n      - id: old-model\n", "utf8");

  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { readOmpModelsConfig, writeOmpModelsConfig } = await jiti.import("./omp-model-config.ts");
  const config = readOmpModelsConfig(agentDir);
  config.providers.siliconflow.models[0].id = "new-model";
  writeOmpModelsConfig(config, agentDir);

  const output = await readFile(join(agentDir, "models.yml"), "utf8");
  assert.match(output, /new-model/);
  assert.doesNotMatch(output, /old-model/);
});
