import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./omp-auth.ts", import.meta.url);

test("OMP credentials are normalized before runtime injection", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /function parseRuntimeCredential/);
  assert.match(source, /parsed\.access_token/);
  assert.match(source, /parsed\.apiKey/);
  assert.match(source, /getUsableOmpRuntimeCredentials/);
  assert.match(source, /latestByProvider/);
});
