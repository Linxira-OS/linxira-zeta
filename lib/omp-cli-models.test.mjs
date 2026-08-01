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
