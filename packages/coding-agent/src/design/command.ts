import { M } from "../i18n";
import { commandConsumed } from "../slash-commands/helpers/parse";
import type { ParsedSlashCommand, SlashCommandRuntime } from "../slash-commands/types";
import { writeDesignMarker } from "./config";
import { formatDesignStatus, probeDesignStatus } from "./status";
import { closeDesignConnections } from "./transport";

export async function handleDesignCommand(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<ReturnType<typeof commandConsumed>> {
	const arg = command.args.trim().toLowerCase();
	if (!arg || arg === "status") {
		const status = await probeDesignStatus(runtime.cwd);
		await runtime.output(formatDesignStatus(status));
		return commandConsumed();
	}

	if (arg === "enable") {
		try {
			const marker = await writeDesignMarker(runtime.cwd, { enabled: true });
			await runtime.session.reconcileBuiltinTools({ refreshPrompt: true });
			const status = await probeDesignStatus(runtime.cwd);
			await runtime.output(
				[
					M.designEnabledFmt.replace("%s", marker.path),
					"",
					formatDesignStatus(status),
					"",
					M.designReconcileHint,
				].join("\n"),
			);
		} catch (error) {
			await runtime.output(M.designErrorFmt.replace("%s", error instanceof Error ? error.message : String(error)));
		}
		return commandConsumed();
	}

	if (arg === "disable") {
		try {
			await writeDesignMarker(runtime.cwd, { enabled: false });
			await closeDesignConnections(runtime.cwd);
			await runtime.session.reconcileBuiltinTools({ refreshPrompt: true });
			await runtime.output(M.designDisabledFmt);
		} catch (error) {
			await runtime.output(M.designErrorFmt.replace("%s", error instanceof Error ? error.message : String(error)));
		}
		return commandConsumed();
	}

	await runtime.output(M.designUsage);
	return commandConsumed();
}
