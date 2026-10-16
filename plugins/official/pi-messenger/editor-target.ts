/**
 * The `/editor` switch's command line — what the editor payload is told.
 *
 * The built-in editor takes its context on the command line
 * (`termide-editor FILE[:line[:col]]... [DIRECTORY]`), so the switch needs no
 * side-channel file: the requested targets come first, in argument order, and
 * the workspace directory comes last as the editor's project root (LSP, git
 * and the layered config resolve against it).
 *
 * Kept apart from `editor-command.ts` on purpose: this is the pair's protocol,
 * pure string/path work with no host imports, so it is unit-testable in the
 * plugin's standalone vitest tree.
 */

import * as path from "node:path";

/**
 * Build the editor's argv for a switch.
 *
 * - `args` is the raw `/editor` argument string; each whitespace-separated
 *   token is one target (`FILE`, `FILE:line` or `FILE:line:col`).
 * - Relative targets resolve against `cwd`, because the editor would otherwise
 *   resolve them against its own process working directory. The position
 *   suffix survives resolution — the editor parses `path:line:col` itself —
 *   and a Windows drive letter is never mistaken for a position.
 * - The trailing entry is always the workspace directory (the project root).
 */
export function editorArgs(args: string, cwd: string): string[] {
	const targets = args
		.trim()
		.split(/\s+/)
		.filter(token => token.length > 0)
		.map(token => {
			const match = /^(.*?)((?::\d+)+(?::)?)$/.exec(token);
			if (!match) return path.resolve(cwd, token);
			const [, filePath, position] = match;
			return path.resolve(cwd, filePath) + position;
		});
	return [...targets, cwd];
}
