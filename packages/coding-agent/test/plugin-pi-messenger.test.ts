/**
 * The official messenger plugin, exercised through the real host loader.
 *
 * `plugins/official/pi-messenger/` is a port, not a copy: the CLI it spawns for
 * crew workers is rewritten to `zetacode` (`crew/agents.ts`), and upstream
 * fixes land here by hand. This suite is the one place that proves the port
 * still loads into a session: if a host rename or a botched port breaks the
 * extension module, it fails here instead of silently offering a dead plugin.
 */
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { loadExtensions } from "@linxiraos/zeta/extensibility/extensions/loader";
import { BUILTIN_SLASH_COMMAND_RESERVED_NAMES } from "@linxiraos/zeta/slash-commands/builtin-registry";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const PLUGIN_ENTRY = path.join(REPO_ROOT, "plugins", "official", "pi-messenger", "index.ts");

/** Core command ids/aliases this plugin must never claim, even accidentally. */
const CORE_TEAM_COMMANDS = ["team", "hub", "lead", "pm", "vibe"] as const;

describe("pi-messenger through the host", () => {
	test("the real extension loader registers the mesh tool and its commands", async () => {
		const { extensions, errors } = await loadExtensions([PLUGIN_ENTRY], REPO_ROOT);
		expect(errors).toEqual([]);
		expect(extensions).toHaveLength(1);
		const [extension] = extensions;
		// The tool is the whole orchestration surface: join/leave/status/feed/
		// reserve/send/plan/work, all actions on this one name.
		expect([...extension.tools.keys()]).toEqual(["pi_messenger"]);
		expect([...extension.commands.keys()].sort()).toEqual(["editor", "messenger", "teamagent"]);
	});

	test("plugin commands are disjoint from core builtins and never claim Team/Lead/Vibe", async () => {
		const { extensions, errors } = await loadExtensions([PLUGIN_ENTRY], REPO_ROOT);
		expect(errors).toEqual([]);
		const commands = new Set(extensions[0]?.commands.keys() ?? []);

		// The core surface exists and stays core; this guards the delta above
		// against a future plugin accidentally re-registering one of its names.
		for (const name of CORE_TEAM_COMMANDS) {
			expect(BUILTIN_SLASH_COMMAND_RESERVED_NAMES.has(name)).toBe(true);
			expect(commands.has(name)).toBe(false);
		}
		expect(commands.has("team hub")).toBe(false);

		const collisions = [...commands].filter(name => BUILTIN_SLASH_COMMAND_RESERVED_NAMES.has(name));
		expect(collisions).toEqual([]);
	});
});
