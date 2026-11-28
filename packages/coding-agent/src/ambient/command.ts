/**
 * `/ambient` routing.
 *
 * Parsing and rendering decisions live here, away from the slash-command
 * registry and the terminal. The caller injects the host capability check and
 * a frame sink, which keeps the TSP gate testable and makes it impossible for
 * a plain ANSI host to receive a frame: {@link handleAmbientCommand} calls the
 * sink only after `supportsTsp()` returns true.
 */
import type { AmbientSession } from "./session";

/** The TSP terminal capability that permits native frame rendering (`TerminalCapabilities.tsp`). */
export const AMBIENT_TSP_CAPABILITY = "tsp" as const;

/** Usage text shared by TUI and ACP callers. */
export const AMBIENT_USAGE = "Usage: /ambient [on|off|feed <x> <y>|status]";

/** Inputs a host provides; `supportsTsp` is the injectable capability seam. */
export interface AmbientCommandDeps {
	/** Whether the host advertises a TSP surface that can draw frames. */
	readonly supportsTsp: () => boolean;
	/** Receives a frame only after {@link supportsTsp} returns true. */
	readonly renderFrame?: (rows: readonly string[]) => void;
	/** Current motion policy; defaults to the session's. */
	readonly reduceMotion?: () => boolean;
}

/** What the dispatcher should tell the operator and, when supported, draw. */
export interface AmbientCommandOutcome {
	readonly status: string;
	/** Present only when the host advertises TSP. */
	readonly frame?: readonly string[];
	readonly enabled: boolean;
	readonly rendered: boolean;
	readonly ok: boolean;
}

function unsupported(session: AmbientSession): AmbientCommandOutcome {
	session.disable();
	return {
		status: "Ambient tank: off — this terminal does not advertise TSP frames.",
		enabled: false,
		rendered: false,
		ok: false,
	};
}

function statusOutcome(status: string, enabled: boolean, ok: boolean): AmbientCommandOutcome {
	return { status, enabled, rendered: false, ok };
}

function parseFeedCell(tokens: readonly string[]): { readonly x: number; readonly y: number } | undefined {
	if (tokens.length !== 3) return undefined;
	const x = Number(tokens[1]);
	const y = Number(tokens[2]);
	if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
	return { x, y };
}

/**
 * Interpret `/ambient <args>` against `session`.
 *
 * `status` and `off` never draw. `on` and `feed` draw only on a TSP host; on
 * an unsupported host they leave the session off and return a status with no
 * frame. Invalid input also never draws.
 */
export function handleAmbientCommand(
	rawArgs: string,
	session: AmbientSession,
	deps: AmbientCommandDeps,
): AmbientCommandOutcome {
	const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
	const action = (tokens[0] ?? "status").toLowerCase();
	const supported = deps.supportsTsp() === true;

	switch (action) {
		case "status": {
			if (!supported) {
				session.disable();
				return statusOutcome("Ambient tank: off — this terminal does not advertise TSP frames.", false, true);
			}
			return statusOutcome(session.summary(), session.enabled, true);
		}
		case "on": {
			if (!supported) return unsupported(session);
			const reduce = deps.reduceMotion?.() ?? session.reduceMotion;
			session.enable({ reduceMotion: reduce });
			const frame = session.rows();
			deps.renderFrame?.(frame);
			return {
				status: `Ambient tank: on — ${session.tank?.fish.length ?? 0} fish, ${reduce ? "reduced" : "full"} motion.`,
				frame,
				enabled: true,
				rendered: true,
				ok: true,
			};
		}
		case "off": {
			session.disable();
			return statusOutcome("Ambient tank: off.", false, true);
		}
		case "feed": {
			const cell = parseFeedCell(tokens);
			if (!cell) return statusOutcome(AMBIENT_USAGE, session.enabled, false);
			if (!supported) return unsupported(session);
			if (!session.enabled) return statusOutcome("Ambient tank is off. Use /ambient on first.", false, false);
			session.feed(cell.x, cell.y);
			const frame = session.rows();
			deps.renderFrame?.(frame);
			return {
				status: `Fed (${cell.x}, ${cell.y}). ${session.summary()}`,
				frame,
				enabled: true,
				rendered: true,
				ok: true,
			};
		}
		default:
			return statusOutcome(AMBIENT_USAGE, session.enabled, false);
	}
}
