/**
 * /editor — hand the current session to the TTT editor.
 *
 * The agent CLI and the editor are two processes over the same work. Without
 * an explicit handoff the user loses three things on every switch: the
 * directory, the repository root, and the session the conversation lives in.
 * This command writes the handoff file and spawns `zeta-editor`, which reads
 * it on startup and re-opens exactly that context.
 *
 * The editor is spawned detached: the CLI stays alive so returning is just
 * another switch, and a crashed editor never takes the session with it.
 */

import * as cp from "node:child_process";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@linxiraos/zeta";
import { ensureEditorBinary } from "./editor-binary.ts";
import { writeHandoff } from "./handoff.ts";

/** Best-effort repository root for a directory; empty when not inside one. */
function detectGitRoot(dir: string): string {
	try {
		const result = cp.spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			timeout: 3000,
		});
		if (result.status === 0) return result.stdout.trim();
	} catch {
		// git missing or not a repo — the editor discovers the root itself.
	}
	return "";
}

/**
 * Register /editor. Safe to call on every extension load: the runtime
 * replaces a same-named registration.
 */
export function registerEditorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("editor", {
		description: "Open the TTT editor on the current workspace (hands off cwd, repo and session)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const cwd = ctx.cwd;
			const sessionFile = ctx.sessionManager?.getSessionFile?.() ?? undefined;
			const handoff = await writeHandoff({
				cwd,
				gitRoot: detectGitRoot(cwd),
				sessionFile,
				from: "zeta",
			});

			const autoInstall = ctx.settings?.get("editor.autoInstall") ?? true;
			const resolved = ensureEditorBinary(autoInstall === true);
			if (!resolved.binary) {
				pi.sendMessage(
					{ customType: "editor_handoff", content: resolved.error ?? "The editor is unavailable.", display: true },
					{ deliverAs: "aside" },
				);
				return;
			}
			const binary = resolved.binary;;
			// The editor reads the handoff on startup; cwd is passed as the
			// positional argument so a binary older than the handoff support
			// still opens the right directory.
			const child = cp.spawn(binary, [cwd], {
				detached: true,
				stdio: "ignore",
				cwd,
			});
			child.unref();

			const parts = [`Opened the editor on ${cwd}`];
			if (sessionFile) parts.push(`session ${path.basename(sessionFile)}`);
			if (resolved.note) parts.push(resolved.note);
			pi.sendMessage(
				{ customType: "editor_handoff", content: `${parts.join(" — ")}.`, display: true },
				{ deliverAs: "aside" },
			);
		},
	});
}
