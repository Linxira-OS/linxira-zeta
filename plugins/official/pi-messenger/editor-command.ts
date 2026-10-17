/**
 * `/editor` — hand the current session to the editor.
 *
 * The agent CLI and the editor are two processes over the same workspace, so
 * the switch has to carry the context the user was in: where they were, and
 * what they were looking at. It carries it the way any other editor does —
 * on the command line, as the editor's own positional protocol:
 *
 *   termide-editor FILE[:line[:col]]... [DIRECTORY]
 *
 * The workspace directory goes last as the directory positional, which the
 * editor takes as its project root (LSP, git and config resolve there), and
 * the requested target (if any) goes first, so the cursor lands on the line
 * the user asked for. Nothing is written to `~/.zeta` — the previous
 * `handoff.json` contract existed because the editor of the day could not be
 * told anything else; the built-in editor's positional protocol replaces it.
 *
 * The editor is spawned detached: the CLI stays alive so returning is just
 * another switch, and a crashed editor never takes the session with it.
 */

import { cfgEditorAutoInstall } from "@linxiraos/zeta/session/settings";
import {
	createDefaultTerminalLaunchRequest,
	terminalLaunchCapabilities,
} from "@linxiraos/zeta/subprocess/terminal-launch";
import { classifyTerminalMultiplexer } from "@linxiraos/pi-tui/terminal-multiplexer";
import * as cp from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@linxiraos/zeta";
import { ensureEditorBinary } from "./editor-binary.ts";
import { editorArgs } from "./editor-target.ts";

/**
 * Register /editor. Safe to call on every extension load: the runtime
 * replaces a same-named registration.
 */
export function registerEditorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("editor", {
		description: "Open the built-in editor on this workspace, optionally at FILE[:line[:col]]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await switchToEditor(ctx, args);
		},
	});
}

/**
 * Perform the switch: resolve the editor and spawn it on the workspace.
 * Shared by the /editor command and the header button so both honour the
 * same settings and report the same way.
 */
export async function switchToEditor(ctx: ExtensionCommandContext, args = ""): Promise<void> {
	const cwd = ctx.cwd;
	const autoInstall = ctx.settings ? cfgEditorAutoInstall.get(ctx.settings) : true;
	const resolved = ensureEditorBinary(autoInstall === true);
	if (!resolved.binary) {
		ctx.ui?.notify?.(resolved.error ?? "The editor is unavailable.", "error");
		return;
	}

	const argv = editorArgs(args, cwd);

	// Inside a multiplexer the editor belongs beside the CLI, as a pane: the
	// session stays visible and the editor is not a separate detached process
	// the terminal knows nothing about. The host owns the launch (see
	// `ctx.ui.openTerminal`); when it cannot place the pane we fall through to
	// the detached spawn rather than leaving the user without an editor.
	if (process.platform !== "win32" && ctx.ui?.openTerminal) {
		const multiplexer = classifyTerminalMultiplexer(process.env);
		if (multiplexer !== null) {
			const plan = createDefaultTerminalLaunchRequest(multiplexer, "pane", [resolved.binary, ...argv], cwd);
			if ("request" in plan) {
				try {
					const result = await ctx.ui.openTerminal(plan.request);
					const provider = terminalLaunchCapabilities[result.multiplexer].displayName;
					ctx.ui.notify?.(
						result.warning
							? `Opened the editor in ${provider}, but ${result.warning}`
							: `Opened the editor in ${provider}.`,
						result.warning ? "warning" : "info",
					);
					return;
				} catch {
					// A multiplexer that cannot launch must not cost the user the editor.
				}
			}
		}
	}

	// Detached so the CLI survives the switch and a crashed editor cannot take
	// the session with it. On Windows a detached child gets its own console,
	// which is where the editor then runs; the editor discovers everything else
	// it needs from the argv above (the workspace directory is the last entry).
	const child = cp.spawn(resolved.binary, argv, { detached: true, stdio: "ignore", cwd });
	child.unref();

	// `argv` is the resolved targets followed by the project root; the first
	// entries are what the user asked to open, the last is always cwd.
	const targets = argv.slice(0, -1);
	const opened =
		targets.length > 0 ? `Opened the editor at ${targets.join(", ")}` : `Opened the editor on ${cwd}`;
	ctx.ui?.notify?.(resolved.note ? `${opened} — ${resolved.note}.` : `${opened}.`, "info");
}

/** Entry point for the header button (no slash-command arguments). */
export async function switchToEditorFromUi(ctx: ExtensionCommandContext): Promise<void> {
	await switchToEditor(ctx);
}
