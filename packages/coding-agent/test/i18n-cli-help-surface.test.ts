import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { M } from "../src/i18n";

/**
 * CLI help surface: an explicit, pinned exclusion.
 *
 * `zetacode --help` / `zetacode <command> --help` is the one command-description
 * surface in the coding-agent that is still English-only. `CommandMetadata`,
 * `Flags.*` and `Args.*` all take a plain `description: string`, every one of
 * the ~431 sites in `src/cli/**` and `src/commands/**` is an English literal,
 * and — unlike slash commands — the copy never passes through the catalogue:
 *
 *   - `src/cli/command-help.ts` — one `CommandMetadata` per CLI subcommand.
 *   - `src/commands/launch-help.ts` — the top-level `launchHelp` table and every
 *     `Flags`/`Args` description of the default `zetacode` invocation.
 *   - `src/commands/*.ts`, `src/cli/*-cli.ts`, `src/cli/gallery-fixtures/*.ts` —
 *     each subcommand's own flag table.
 *
 * Localising it means ~431 new catalogue keys plus a thunk-shaped
 * `CommandMetadata.description` (the type is shared with `@linxiraos/pi-utils`
 * and used by every CLI in the repo), so this pass pins the hole instead of
 * closing it: the table below is the reviewed inventory, and the guard fails
 * when the inventory no longer matches the tree.
 *
 * ## What makes this an assertion rather than a comment
 *
 * The table is exact — file list AND per-file site count. A new help literal in
 * a NEW file (a new subcommand) is red; a help literal added to a listed file
 * is red; a listed file whose sites were localised is red too (remove the row).
 * Bumping a number is a deliberate, reviewable one-line change, which is the
 * point: the reviewer sees "this PR added 3 unlocalized help strings".
 *
 * ## Closing this exclusion
 *
 * `CommandMetadata.description` accepting `string | (() => string)` (as
 * `SlashCommandSpec` and `CustomCommand` already do), 431 `M.cli*` keys, and
 * `cliHelp*` entries in the catalogues. Tracked by the i18n coverage table in
 * the PR that introduced this guard.
 */
const EXCLUDED_FILES: Record<string, number> = {
	"cli/command-help.ts": 54,
	"cli/gallery-fixtures/agentic.ts": 3,
	"cli/gallery-fixtures/misc.ts": 4,
	"cli/tiny-models-cli.ts": 1,
	"commands/agents.ts": 6,
	"commands/anonymize.ts": 2,
	"commands/attach.ts": 2,
	"commands/auth-broker.ts": 13,
	"commands/auth-gateway.ts": 7,
	"commands/auth.ts": 2,
	"commands/bench.ts": 15,
	"commands/browser-relay.ts": 6,
	"commands/cleanse.ts": 5,
	"commands/clip.ts": 4,
	"commands/collab.ts": 4,
	"commands/commit.ts": 6,
	"commands/completions.ts": 1,
	"commands/compress.ts": 6,
	"commands/config.ts": 4,
	"commands/dry-balance.ts": 7,
	"commands/find.ts": 6,
	"commands/gallery.ts": 12,
	"commands/gc.ts": 14,
	"commands/git.ts": 2,
	"commands/grep.ts": 8,
	"commands/grievances.ts": 6,
	"commands/if-bench.ts": 7,
	"commands/images.ts": 6,
	"commands/install.ts": 5,
	"commands/join.ts": 1,
	"commands/launch-help.ts": 55,
	"commands/login.ts": 1,
	"commands/models.ts": 7,
	"commands/play.ts": 3,
	"commands/plugin.ts": 11,
	"commands/ps.ts": 12,
	"commands/read.ts": 1,
	"commands/render.ts": 7,
	"commands/say.ts": 6,
	"commands/serve.ts": 8,
	"commands/session.ts": 5,
	"commands/settings.ts": 5,
	"commands/setup.ts": 3,
	"commands/share.ts": 2,
	"commands/shell.ts": 3,
	"commands/skill.ts": 15,
	"commands/ssh.ts": 10,
	"commands/stats.ts": 4,
	"commands/stream.ts": 3,
	"commands/tiny-models.ts": 3,
	"commands/token.ts": 5,
	"commands/toks.ts": 2,
	"commands/ttsr.ts": 12,
	"commands/update.ts": 5,
	"commands/usage.ts": 9,
	"commands/web-search.ts": 5,
	"commands/web.ts": 2,
	"commands/worktree.ts": 11,
};

/** `description: "<literal>"` — the shape a `CommandMetadata`/flag help entry has. */
const LITERAL_DESCRIPTION = /(?<![\w$])description\s*:\s*["'`]/g;

function helpLiteralSites(): Record<string, number> {
	const sourceRoot = path.resolve(import.meta.dir, "..", "src");
	const counts: Record<string, number> = {};
	for (const directory of ["cli", "commands"]) {
		const walk = (root: string): void => {
			for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
				const full = path.join(root, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
				const matches = fs.readFileSync(full, "utf8").match(LITERAL_DESCRIPTION);
				if (!matches) continue;
				counts[path.relative(sourceRoot, full).split(path.sep).join("/")] = matches.length;
			}
		};
		walk(path.join(sourceRoot, directory));
	}
	return counts;
}

describe("CLI help localization", () => {
	test("localized copy stays localized: the catalogue never carries a CLI help key yet", () => {
		// Non-vacuity probe: if a future pass localises the CLI help it will add
		// `cli*`/`cliHelp*` keys and this guard must be updated by hand (the
		// exclusion table below shrinks). Reading `M` here keeps the failure
		// message honest about which direction the surface moved.
		const localizedHelpKeys = Object.keys(M).filter(key => key.startsWith("cliHelp") || key.startsWith("cliFlag"));
		expect(localizedHelpKeys).toEqual([]);
	});

	test("the English CLI help surface equals the pinned exclusion inventory", () => {
		const actual = helpLiteralSites();
		expect(
			actual,
			"the unlocalized CLI help surface changed. Either localise the new help text\n" +
				"(see the header of this file for the required plumbing) or bump the number in\n" +
				"EXCLUDED_FILES so the reviewer sees the added English:",
		).toEqual(EXCLUDED_FILES);
	});
});
