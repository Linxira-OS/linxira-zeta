/**
 * A session-local ambient tank: the switch, the tank state, and the motion
 * preference. Nothing here persists — a new session starts off with a fresh
 * tank, as `/ambient` is an opt-in toy rather than a setting.
 */
import {
	AMBIENT_REDUCED_MOTION_TICK_MS,
	AMBIENT_TICK_MS,
	createTank,
	feedTank,
	renderTank,
	tickTank,
	type AmbientTankOptions,
	type AmbientTankState,
} from "./engine";

/** Construction options for an off-by-default session. */
export interface AmbientSessionOptions extends AmbientTankOptions {
	/** Start in the reduced-motion policy (still off until {@link AmbientSession.enable}). */
	readonly reduceMotion?: boolean;
}

/** The per-session owner of one tank. */
export class AmbientSession {
	readonly #tankOptions: AmbientTankOptions;
	#enabled = false;
	#reduceMotion: boolean;
	#tank: AmbientTankState | undefined;

	constructor(options: AmbientSessionOptions = {}) {
		const { reduceMotion = false, ...tank } = options;
		this.#tankOptions = tank;
		this.#reduceMotion = reduceMotion;
	}

	/** Whether the session has opted in. Off until {@link enable}. */
	get enabled(): boolean {
		return this.#enabled;
	}

	/** `undefined` until first enabled; the tank (and its fish) survives an off/on cycle. */
	get tank(): AmbientTankState | undefined {
		return this.#tank;
	}

	get reduceMotion(): boolean {
		return this.#reduceMotion;
	}

	/** Host tick period for the current motion policy. */
	get tickIntervalMs(): number {
		return this.#reduceMotion ? AMBIENT_REDUCED_MOTION_TICK_MS : AMBIENT_TICK_MS;
	}

	/** Opt in, creating the tank on first use. Returns the tank state. */
	enable(options: { readonly reduceMotion?: boolean } = {}): AmbientTankState {
		if (options.reduceMotion !== undefined) this.#reduceMotion = options.reduceMotion;
		this.#enabled = true;
		this.#tank ??= createTank(this.#tankOptions);
		return this.#tank;
	}

	/** Opt out without discarding the tank; a later {@link enable} resumes it. */
	disable(): void {
		this.#enabled = false;
	}

	/** Drop food at a cell while enabled; returns the new state, or `undefined` while off. */
	feed(x: number, y: number): AmbientTankState | undefined {
		if (!this.#enabled || !this.#tank) return undefined;
		this.#tank = feedTank(this.#tank, x, y);
		return this.#tank;
	}

	/** Advance the tank by one host delta while enabled; no-op while off or when `dtMs` is zero. */
	tick(dtMs: number, options: { readonly reduceMotion?: boolean } = {}): AmbientTankState | undefined {
		if (!this.#enabled || !this.#tank) return undefined;
		this.#tank = tickTank(this.#tank, dtMs, {
			reduceMotion: options.reduceMotion ?? this.#reduceMotion,
		});
		return this.#tank;
	}

	/** Current frame, or an empty list while the tank has never been enabled. */
	rows(): readonly string[] {
		return this.#tank ? renderTank(this.#tank) : [];
	}

	/** One concise line for a status command. */
	summary(): string {
		if (!this.#enabled || !this.#tank) return "Ambient tank: off.";
		const fish = this.#tank.fish.length;
		const food = this.#tank.food.length;
		return `Ambient tank: on (${fish} fish, ${food} food, ${this.#reduceMotion ? "reduced motion" : "full motion"}, ${this.tickIntervalMs}ms/tick).`;
	}
}
