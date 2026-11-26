import { prompt } from "@linxiraos/pi-utils";
import type { DaemonCompletionEvent, UnitSnapshot } from "../daemon/protocol";
import type { DaemonCompletionNotification } from "../launch/protocol";
import launchCompletionTemplate from "../prompts/session/launch-completion.md" with { type: "text" };
import type { CustomMessage } from "./messages";

import { LAUNCH_COMPLETION_MESSAGE_TYPE } from "./transcript/messages";
export { LAUNCH_COMPLETION_MESSAGE_TYPE } from "./transcript/messages";

/** One daemon service completion awaiting injection into its owning session. */
export type LaunchCompletionEntry = DaemonCompletionEvent;

/**
 * The unit snapshot of a legacy launch-broker completion, which predates the
 * daemon's `unit` field and carries the same service data as `daemon`.
 */
function legacyUnit(notification: DaemonCompletionNotification): UnitSnapshot {
	const { daemon } = notification;
	return {
		id: daemon.id,
		kind: "proc",
		scope: { kind: "session", id: notification.owner },
		key: daemon.name,
		label: daemon.name,
		generation: daemon.id,
		state: daemon.state,
		pids: daemon.pid === undefined ? [] : [daemon.pid],
		createdAt: daemon.createdAt,
		startedAt: daemon.startedAt,
		readyAt: daemon.readyAt,
		exitedAt: daemon.exitedAt,
		exitCode: daemon.exitCode,
		exitReason: daemon.exitReason,
		restartCount: daemon.restartCount,
		outputBytes: daemon.outputBytes,
		owner: daemon.owner,
		readyMatch: daemon.readyMatch,
		readyPending: daemon.readyPending,
		previewUrl: daemon.previewUrl,
		leases: 0,
		policy: {
			hold: daemon.detached ? "detached" : daemon.persist ? "persist" : "leases",
			idleMs: 0,
			onIdle: "stop",
			restart: "no",
			survive: "none",
		},
		supervised: true,
	};
}

/**
 * Normalize a completion onto the daemon event shape every queue entry stores,
 * mapping a legacy launch broker's `daemon` snapshot to `unit`.
 */
export function toLaunchCompletionEvent(notification: LaunchCompletionNotification): LaunchCompletionEntry {
	return "unit" in notification
		? notification
		: {
				ev: "completed",
				completionId: notification.completionId,
				owner: notification.owner,
				unit: legacyUnit(notification),
			};
}

/** What a caller may queue: the daemon event or the launch broker's older notification. */
export type LaunchCompletionNotification = LaunchCompletionEntry | DaemonCompletionNotification;

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
			.map(({ unit }) =>
				prompt.render(launchCompletionTemplate, {
					name: unit.key,
					state: unit.state,
					exitCode: unit.exitCode,
					hasExitCode: unit.exitCode !== undefined,
				}),
			)
			.join("\n"),
		display: true,
		attribution: "agent",
		details: { daemons: entries.map(entry => entry.unit) },
		timestamp: Date.now(),
	};
}
