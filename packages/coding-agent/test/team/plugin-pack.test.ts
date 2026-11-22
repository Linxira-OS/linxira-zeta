import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promotePersonaPluginPack, readPersonaPluginSource } from "../../src/team/plugin-pack";

const roots: string[] = [];
afterEach(async () => {
	for (const dir of roots.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe("persona plugin packs", () => {
	it("hashes and promotes a scoped pack to an explicit empty target", async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-persona-plugin-"));
		roots.push(base);
		const teamRoot = path.join(base, "team");
		const packRoot = path.join(teamRoot, ".zeta", "personas", "review", "plugin");
		await fs.mkdir(packRoot, { recursive: true });
		await fs.writeFile(path.join(packRoot, "plugin.json"), '{"name":"review"}');
		const pack = {
			schemaVersion: 1 as const,
			id: "reviewer",
			revision: 1,
			name: "Reviewer",
			role: "review",
			pluginPack: { root: "review/plugin" },
		};
		const source = await readPersonaPluginSource(teamRoot, pack);
		expect(source.files).toEqual(["plugin.json"]);
		expect(source.hash).toHaveLength(64);
		const target = path.join(base, "installed");
		const promoted = await promotePersonaPluginPack(teamRoot, pack, target);
		expect(promoted.files).toEqual(["plugin.json"]);
		expect(await fs.readFile(path.join(target, "plugin.json"), "utf8")).toContain("review");
	});

	it("refuses an escaping pack and a non-empty target", async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), "zeta-persona-plugin-"));
		roots.push(base);
		const teamRoot = path.join(base, "team");
		const pack = {
			schemaVersion: 1 as const,
			id: "reviewer",
			revision: 1,
			name: "Reviewer",
			role: "review",
			pluginPack: { root: "../../escape" },
		};
		await expect(readPersonaPluginSource(teamRoot, pack)).rejects.toThrow("escapes");
	});
});
