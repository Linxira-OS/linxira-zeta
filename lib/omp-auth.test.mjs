import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// omp-auth.ts imports sibling modules without extensions, which node's
// native TS support cannot resolve; load it through jiti.
const { getUsableOmpRuntimeCredentials } = await createJiti(import.meta.url).import("./omp-auth.ts");

const sourceUrl = new URL("./omp-auth.ts", import.meta.url);

test("OMP credentials are normalized before runtime injection", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /function parseRuntimeCredential/);
  assert.match(source, /parsed\.access_token/);
  assert.match(source, /parsed\.apiKey/);
  assert.match(source, /getUsableOmpRuntimeCredentials/);
  assert.match(source, /latestByProvider/);
});

test("api-key credentials stored as {\"key\": ...} are usable", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-auth-key-"));
  process.env.OMP_CODING_AGENT_DIR = agentDir;
  const db = new Database(join(agentDir, "agent.db"));
  db.exec(
    "CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT, identity_key TEXT, created_at INTEGER, updated_at INTEGER)",
  );
  db.prepare("INSERT INTO auth_credentials (provider, credential_type, data) VALUES (?, ?, ?)").run(
    "deepseek",
    "api_key",
    JSON.stringify({ key: "sk-test-123" }),
  );
  db.close();

  const creds = getUsableOmpRuntimeCredentials();
  const deepseek = creds.find((c) => c.provider === "deepseek");
  assert.equal(deepseek?.apiKey, "sk-test-123");
});
