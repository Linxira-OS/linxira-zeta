/**
 * Headless `/tan`: dispatch the background clone through the same controller
 * the TUI uses, with status lines routed to the command output.
 */

import { TanCommandController, type TanCommandHost } from "../modes/controllers/tan-command-controller";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime } from "./types";

/** `/tan` handler for ACP/RPC and attached clients. */
export async function handleTanSlashCommand(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	const host: TanCommandHost = {
		session: runtime.session,
		sessionManager: runtime.sessionManager,
		settings: runtime.settings,
		mcpManager: runtime.mcpManager,
		showStatus: text => void runtime.output(text),
		showError: text => void runtime.output(text),
	};
	try {
		await new TanCommandController(host).start(command.args.trim());
		return commandConsumed();
	} catch (error) {
		await runtime.output(`/tan failed: ${error instanceof Error ? error.message : String(error)}`);
		return commandConsumed({ failed: true });
	}
}
