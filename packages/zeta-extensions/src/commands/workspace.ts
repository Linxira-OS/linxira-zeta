// /dirs /worktree /append /say /btw: workspace info + message utilities
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export function installWorkspaceCommands(api: ExtensionAPI): void {
	api.registerCommand("dirs", {
		description: "Show working directory and session storage locations",
		handler: async (_args, ctx) => {
			const sm = ctx.sessionManager;
			const lines = [
				`CWD: ${ctx.cwd}`,
				`Session dir: ${sm.getSessionDir()}`,
				`Session file: ${sm.getSessionFile()}`,
			];
			void api.sendMessage({ customType: "zeta-dirs", content: lines.join("\n"), display: true });
		},
	});

	api.registerCommand("worktree", {
		description: "Create a git worktree. Usage: /worktree <path> [branch]",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /worktree <path> [branch]", "warning");
				return;
			}
			const [path, branch] = trimmed.split(/\s+/);
			const addArgs = ["worktree", "add", path!];
			if (branch) addArgs.push("-b", branch);
			const result = await api.exec("git", addArgs, { cwd: ctx.cwd });
			ctx.ui.notify(result.stdout.trim() || result.stderr.trim(), result.code === 0 ? "info" : "error");
		},
	});
}

export function installSayCommands(api: ExtensionAPI): void {
	api.registerCommand("say", {
		description: "Send a visible message without triggering a turn. Usage: /say <text>",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /say <text>", "warning");
				return;
			}
			void api.sendMessage({ customType: "zeta-say", content: text, display: true }, { triggerTurn: false });
		},
	});

	api.registerCommand("append", {
		description: "Append a note to the session context (visible to the agent). Usage: /append <text>",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /append <text>", "warning");
				return;
			}
			void api.sendUserMessage(`[Note appended by user]\n${text}`, { deliverAs: "followUp" });
		},
	});

	api.registerCommand("btw", {
		description: "Provide background information to the agent for the current task. Usage: /btw <text>",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /btw <text>", "warning");
				return;
			}
			void api.sendUserMessage(`[Background context]\n${text}`, { deliverAs: "followUp" });
		},
	});
}
