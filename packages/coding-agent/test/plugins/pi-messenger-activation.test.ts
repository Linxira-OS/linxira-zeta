import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { loadExtensions } from "@linxiraos/zeta/extensibility/extensions/loader";

/**
 * Activation smoke for the official plugin in this repository.
 *
 * `plugins/official/pi-messenger/index.ts` statically imports
 * `./editor-command.ts`, which reads the host's `cfgEditorAutoInstall` /
 * `cfgEditorHandoffSession` settings handles. When those handles went missing
 * from `src/session/settings.ts` (dropped in a merge, AGENTS.md damage class 4)
 * the whole module graph failed to import: `plugin list` showed the plugin
 * enabled, its `skills/` still loaded by directory convention, and every tool
 * and command the plugin registers simply did not exist. Nothing in the tree
 * noticed, because the only consumer of those handles is this plugin.
 *
 * So the assertion is the observable contract, not the source text: import the
 * real plugin through the real extension loader and require that the surface it
 * registers is there.
 */
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const PLUGIN_ENTRY = path.join(REPO_ROOT, "plugins", "official", "pi-messenger", "index.ts");

describe("pi-messenger activation", () => {
	test("the plugin's extension module loads and registers its tool and commands", async () => {
		const { extensions, errors } = await loadExtensions([PLUGIN_ENTRY], REPO_ROOT);

		expect(errors).toEqual([]);
		expect(extensions).toHaveLength(1);

		const [extension] = extensions;
		expect(extension.path).toBe(PLUGIN_ENTRY);
		expect([...extension.tools.keys()]).toEqual(["pi_messenger"]);
		expect([...extension.commands.keys()]).toEqual(expect.arrayContaining(["editor", "teamagent"]));
	});
});
