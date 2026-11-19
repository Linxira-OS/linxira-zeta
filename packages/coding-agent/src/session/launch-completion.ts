import { prompt } from "@linxiraos/pi-utils";
import type { DaemonCompletionEvent } from "../daemon/protocol";
import type { DaemonCompletionNotification } from "../launch/protocol";
import launchCompletionTemplate from "../prompts/session/launch-completion.md" with { type: "text" };
import type { CustomMessage } from "./messages";

import { LAUNCH_COMPLETION_MESSAGE_TYPE } from "@linxiraos/pi-tui/chat/messages";
export { LAUNCH_COMPLETION_MESSAGE_TYPE } from "@linxiraos/pi-tui/chat/messages";

/** One daemon service completion awaiting injection into its owning session. */
export type LaunchCompletionEntry = DaemonCompletionEvent | DaemonCompletionNotification;

/** Whether a daemon service completion belongs to the primary session or its advisor. */
export function isLaunchCompletionOwner(owner: string, sessionId: string): boolean {
	return owner === sessionId || owner === `${sessionId}-advisor`;
}

/** Build one model-visible notification per terminal supervised process exit. */
export function buildLaunchCompletionBatchMessage(entries: LaunchCompletionEntry[]): CustomMessage {
	return {
		role: "custom",
		customType: LAUNCH_COMPLETION_MESSAGE_TYPE,
		content: entries
			.map(entry => {
				const unit = "unit" in entry ? entry.unit : entry.daemon;
				return prompt.render(launchCompletionTemplate, {
					name: "unit" in entry ? unit.key : ((unit as { name?: string }).name ?? unit.key),
					state: unit.state,
					exitCode: unit.exitCode,
					hasExitCode: unit.exitCode !== undefined,
				});
			})
			.join("\n"),
		display: true,
		attribution: "agent",
		details: { daemons: entries.map(entry => ("unit" in entry ? entry.unit : entry.daemon)) },
		timestamp: Date.now(),
	};
}
