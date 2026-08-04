import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// omp-models.ts imports sibling modules without extensions, which node's
// native TS support cannot resolve; load it through jiti.
const { syncOmpRuntimeModelsJson } = await createJiti(import.meta.url).import("./omp-models.ts");

test("generated omp-web-models.json validates when cached cost omits cacheWrite", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-models-schema-"));
  const db = new Database(join(agentDir, "models.db"));
  db.exec("CREATE TABLE model_cache (provider_id TEXT PRIMARY KEY, models TEXT)");
  db.prepare("INSERT INTO model_cache VALUES (?, ?)").run(
    "DeepSeek",
    JSON.stringify([
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: null },
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.003625 },
      },
    ]),
  );
  db.close();

  const modelsPath = syncOmpRuntimeModelsJson(agentDir);
  const runtime = await ModelRuntime.create({ modelsPath, allowModelNetwork: false });

  // The SDK's ModelCostSchema requires all four rates; a missing/null one
  // previously made the whole models file fail validation.
  assert.equal(runtime.getError(), undefined);

  const content = JSON.parse(await readFile(modelsPath, "utf8"));
  const costs = content.providers.DeepSeek.models.map((m) => m.cost);
  assert.deepEqual(costs, [
    { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
  ]);});
