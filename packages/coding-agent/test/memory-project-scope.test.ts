/**
 * D7 — `memory.backend` is a layered key. Writing it into a repository's
 * project layer (`<repo>/.zeta/settings.json`) enables memory for that repo
 * only; a sibling repo and the user layer stay `off`.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { cfgMemoryBackend } from "../src/memory-backend/settings";

setDefaultTimeout(30_000);

describe("memory project scope (D7)", () => {
	let repoA: string;
	let repoB: string;
	let agentDir: string;

	beforeEach(() => {
		repoA = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-scope-a-"));
		repoB = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-scope-b-"));
		agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-scope-agent-"));
	});

	afterEach(() => {
		fs.rmSync(repoA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		fs.rmSync(repoB, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		fs.rmSync(agentDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	});

	test("project layer enables one repo; the sibling and user layer stay off", async () => {
		fs.mkdirSync(path.join(repoA, ".zeta"), { recursive: true });
		fs.writeFileSync(
			path.join(repoA, ".zeta", "settings.json"),
			JSON.stringify({ memory: { backend: "mnemopi" } }),
			"utf8",
		);

		const enabled = await Settings.loadReadOnly({ cwd: repoA, agentDir });
		expect(cfgMemoryBackend.get(enabled)).toBe("mnemopi");
		expect(enabled.getProvenance(cfgMemoryBackend)).toBe("project");

		const sibling = await Settings.loadReadOnly({ cwd: repoB, agentDir });
		expect(cfgMemoryBackend.get(sibling)).toBe("off");
		expect(sibling.getProvenance(cfgMemoryBackend)).toBe("default");

		// The user layer is untouched: no user settings file was written and no
		// repo's setting leaked upward.
		const userConfig = path.join(agentDir, "settings.json");
		expect(fs.existsSync(userConfig)).toBe(false);
		const reloadedSibling = await Settings.loadReadOnly({ cwd: repoB, agentDir });
		expect(cfgMemoryBackend.get(reloadedSibling)).toBe("off");
	});

	test("opting repo B in later does not change repo A's provenance or the sibling default", async () => {
		fs.mkdirSync(path.join(repoA, ".zeta"), { recursive: true });
		fs.writeFileSync(
			path.join(repoA, ".zeta", "settings.json"),
			JSON.stringify({ memory: { backend: "mnemopi" } }),
			"utf8",
		);
		fs.mkdirSync(path.join(repoB, ".zeta"), { recursive: true });
		fs.writeFileSync(
			path.join(repoB, ".zeta", "settings.json"),
			JSON.stringify({ memory: { backend: "local" } }),
			"utf8",
		);

		const a = await Settings.loadReadOnly({ cwd: repoA, agentDir });
		const b = await Settings.loadReadOnly({ cwd: repoB, agentDir });
		expect(cfgMemoryBackend.get(a)).toBe("mnemopi");
		expect(cfgMemoryBackend.get(b)).toBe("local");
		expect(a.getProvenance(cfgMemoryBackend)).toBe("project");
		expect(b.getProvenance(cfgMemoryBackend)).toBe("project");
	});
});
