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
			await switchToEditor(ctx);
		},
	});
}

/**
 * Perform the switch: write the handoff and spawn the editor. Shared by the
 * /editor command and the header button so both honour the same settings and
 * report the same way.
 */
export async function switchToEditor(ctx: ExtensionCommandContext): Promise<void> {
	const cwd = ctx.cwd;
	const sessionFile =
		(ctx.settings?.get("editor.handoffSession") ?? true) === true
			? (ctx.sessionManager?.getSessionFile?.() ?? undefined)
			: undefined;
	const handoff = await writeHandoff({
		cwd,
		gitRoot: detectGitRoot(cwd),
		sessionFile,
		from: "zeta",
	});

	const autoInstall = ctx.settings?.get("editor.autoInstall") ?? true;
	const resolved = ensureEditorBinary(autoInstall === true);
	if (!resolved.binary) {
		ctx.ui?.notify?.(resolved.error ?? "The editor is unavailable.", "error");
		return;
	}
	// The editor reads the handoff on startup; cwd is passed positionally so a
	// binary older than handoff support still opens the right directory.
	const child = cp.spawn(resolved.binary, [cwd], { detached: true, stdio: "ignore", cwd });
	child.unref();

	const parts = [`Opened the editor on ${cwd}`];
	if (sessionFile) parts.push(`session ${path.basename(sessionFile)}`);
	if (resolved.note) parts.push(resolved.note);
	ctx.ui?.notify?.(`${parts.join(" — ")}.`, "info");
}

/** Entry point for the header button (no slash-command arguments). */
export async function switchToEditorFromUi(ctx: ExtensionCommandContext): Promise<void> {
	await switchToEditor(ctx);
}
