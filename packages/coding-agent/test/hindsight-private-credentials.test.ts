import { afterEach, expect, spyOn, test } from "bun:test";
import { privateMemoryCredential, releaseMemoryCredentials, replaceMemoryCredentials } from "../src/hindsight/private-credentials";
import { runtimeSettingsFor } from "../src/server/studio-host/services/runtime-settings";
import { Settings } from "../src/config/settings";
import { cfgHindsightApiToken, cfgHindsightApiUrl } from "../src/hindsight/settings";
import { validateRuntimeSettingValue } from "../src/server/studio-host/protocol/validation";

const url = "https://private-memory.example/api";
afterEach(() => { releaseMemoryCredentials("private-test-a"); releaseMemoryCredentials("private-test-b"); });

test("credential replacement validates atomically, expires and protects a live owner", () => {
  replaceMemoryCredentials("private-test-a", Date.now() + 60_000, [{ url, token: "first" }]);
  expect(() => replaceMemoryCredentials("private-test-a", Date.now() + 60_000, [{ url, token: "next" }, { url: url + "/", token: "duplicate" }])).toThrow("Duplicate");
  expect(privateMemoryCredential(url) === "first").toBe(true);
  expect(() => replaceMemoryCredentials("private-test-b", Date.now() + 60_000, [{ url, token: "other" }])).toThrow("another live owner");
  expect(() => replaceMemoryCredentials("private-test-a", Date.now() + 60_000, [{ url, token: "bad\r\nheader" }])).toThrow("entry");
	const now = Date.now();
	const clock = spyOn(Date, "now").mockReturnValue(now);
	try {
		replaceMemoryCredentials("private-test-a", now + 30, [{ url, token: "short-lived" }]);
		clock.mockReturnValue(now + 31);
		expect(privateMemoryCredential(url)).toBeUndefined();
	} finally { clock.mockRestore(); }
  replaceMemoryCredentials("private-test-b", Date.now() + 60_000, [{ url, token: "new-owner" }]);
  expect(privateMemoryCredential(url) === "new-owner").toBe(true);
});

test("public runtime settings expose configuration provenance without native or supplementary secrets", () => {
	const settings = Settings.isolated({}, { storage: null });
  cfgHindsightApiUrl.override(settings, url);
  replaceMemoryCredentials("private-test-a", Date.now() + 60_000, [{ url, token: "supplement-private" }]);
  const first = runtimeSettingsFor(settings);
  expect(first.activation?.hindsightCredential).toEqual({ configured: true, source: "runtime" });
  for (const key of ["edit.autoRepair.enabled", "features.unexpectedStopDetection", "extendedContext", "compaction.asyncEnabled", "compaction.methodOrder", "providers.openai-codex.codeMode"] as const) {
    expect(first.values[key]).toBeDefined();
    validateRuntimeSettingValue(key, first.values[key], key);
  }
  expect(JSON.stringify(first).includes("supplement-private")).toBe(false);
  cfgHindsightApiToken.override(settings, "native-private");
  const second = runtimeSettingsFor(settings, ["hindsight.apiUrl"]);
  expect(second.activation?.hindsightCredential).toEqual({ configured: true, source: "runtime" });
  expect(JSON.stringify(second).includes("native-private")).toBe(false);
  expect(Object.keys(second.values)).toEqual(["hindsight.apiUrl"]);
  expect(() => runtimeSettingsFor(settings, ["hindsight.apiToken"])).toThrow("Unsupported");
});
