/**
 * `/ambient` — an optional, session-only ASCII fish tank.
 *
 * Off by default. Frames are drawn only when the terminal advertises the TSP
 * capability (`TerminalCapabilities.tsp`), i.e. Tern answered the handshake
 * and renders the surface itself. A plain ANSI terminal gets a concise status
 * and never receives a frame; the timer is only armed after an accepted
 * `/ambient on`, so nothing animates unless the operator opted in.
 */
import { jsx, onCleanup, signal, type Signal } from "@linxiraos/pi-tui";
import { AmbientSession } from "../ambient/session";
import { AMBIENT_TSP_CAPABILITY, handleAmbientCommand, type AmbientCommandOutcome } from "../ambient/command";
import type { InteractiveModeContext } from "../modes/types";
import { M } from "../i18n";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandRuntime, SlashCommandSpec } from "./types";

interface AmbientTuiState {
	readonly session: AmbientSession;
	readonly frame: Signal<readonly string[]>;
	stop: (() => void) | undefined;
	presented: boolean;
}

/** One tank per interactive session; state dies with the session and never touches settings. */
const TUI_STATES = new WeakMap<object, AmbientTuiState>();

function stateFor(ctx: InteractiveModeContext): AmbientTuiState {
	let state = TUI_STATES.get(ctx.session);
	if (!state) {
		state = {
			session: new AmbientSession(),
			frame: signal<readonly string[]>([]),
			stop: undefined,
			presented: false,
		};
		TUI_STATES.set(ctx.session, state);
	}
	return state;
}

/**
 * The host capability seam: both a negotiated native TSP surface and the
 * terminal's own `tsp` capability must be present. The terminal renderer
 * reports `tsp: false`, and an optimistic Tern start stays false until the
 * hello is confirmed.
 */
function supportsTsp(ctx: InteractiveModeContext): boolean {
	return ctx.shell.native() && ctx.shell.host?.driver.capabilities[AMBIENT_TSP_CAPABILITY] === true;
}

function reduceMotionRequested(): boolean {
	const motion = process.env.PI_MOTION?.trim().toLowerCase();
	return motion === "none" || motion === "reduced";
}

/**
 * Mount the tank's canvas. A live block is used so the low-rate ticker can
 * paint new rows in place; on a TSP surface the canvas becomes a `rows` node.
 */
function presentTank(ctx: InteractiveModeContext, state: AmbientTuiState): void {
	if (state.presented) return;
	state.presented = true;
	ctx.presentCommandOutput(
		() => {
			onCleanup(() => {
				state.stop?.();
				state.stop = undefined;
				state.presented = false;
			});
			return jsx("canvas", {
				// Re-evaluate the gate while painting: an optimistic Tern start that
				// falls back to the terminal renderer must not paint tank rows there.
				paint: (width: number) => (supportsTsp(ctx) ? state.frame().map(row => row.slice(0, width)) : []),
			});
		},
		{ live: true },
	);
}

/**
 * Start the low-rate simulation timer. Called only for an accepted `on` on a
 * TSP host; every other route leaves `state.stop` clear. The host tick period
 * is the session's own (`500ms`, or `2000ms` reduced), so this is not an
 * unconditional animation loop.
 */
function startTicker(ctx: InteractiveModeContext, state: AmbientTuiState): void {
	state.stop?.();
	const reduce = state.session.reduceMotion;
	const interval = state.session.tickIntervalMs;
	const timer = setInterval(() => {
		if (!supportsTsp(ctx)) {
			state.stop?.();
			state.stop = undefined;
			return;
		}
		state.session.tick(interval, { reduceMotion: reduce });
		state.frame.set(state.session.rows());
	}, interval);
	timer.unref?.();
	state.stop = () => clearInterval(timer);
}

function applyOutcome(ctx: InteractiveModeContext, state: AmbientTuiState, outcome: AmbientCommandOutcome): void {
	if (outcome.frame) state.frame.set(outcome.frame);
	ctx.showStatus(outcome.status);
	if (!outcome.rendered) {
		if (!outcome.enabled) {
			state.stop?.();
			state.stop = undefined;
		}
		return;
	}
	presentTank(ctx, state);
	startTicker(ctx, state);
}

export const BUILTIN_AMBIENT_SLASH_COMMAND: SlashCommandSpec = {
	name: "ambient",
	icon: "wave",
	description: () => M.cmdAmbient,
	allowArgs: true,
	subcommandOptional: true,
	inlineHint: "[on|off|feed <x> <y>|status]",
	subcommands: [
		{ name: "on", description: () => M.cmdAmbientOn },
		{ name: "off", description: () => M.cmdAmbientOff },
		{ name: "feed", description: () => M.cmdAmbientFeed, usage: "feed <x> <y>" },
		{ name: "status", description: () => M.cmdAmbientStatus },
	],
	handle: async (command: ParsedSlashCommand, runtime: SlashCommandRuntime) => {
		// Text/ACP hosts have no TSP surface: routing still reports the state,
		// but never produces or draws a frame.
		const session = new AmbientSession();
		const outcome = handleAmbientCommand(command.args, session, { supportsTsp: () => false });
		await runtime.output(outcome.status);
		return outcome.ok ? commandConsumed() : commandConsumed({ failed: true });
	},
	handleTui: (command: ParsedSlashCommand, runtime) => {
		const ctx = runtime.ctx;
		const state = stateFor(ctx);
		const outcome = handleAmbientCommand(command.args, state.session, {
			supportsTsp: () => supportsTsp(ctx),
			reduceMotion: reduceMotionRequested,
			renderFrame: rows => {
				state.frame.set(rows);
				presentTank(ctx, state);
			},
		});
		applyOutcome(ctx, state, outcome);
	},
};
