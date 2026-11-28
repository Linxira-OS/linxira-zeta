/**
 * Deterministic ASCII fish tank.
 *
 * The engine owns state, not terminals: every operation takes a state and
 * returns a new one, never mutates its input, and never reads a clock, the
 * environment, or a renderer. Hosts decide when to tick and where to draw the
 * rows {@link renderTank} produces.
 *
 * Determinism matters because the same tank is advanced by terminal animation
 * loops and by tests. Randomness comes from a small xorshift32 state carried
 * in the tank, never from `Math.random`.
 */

/** Smallest interior width, in cells. */
export const AMBIENT_MIN_WIDTH = 12;
/** Smallest interior height, in cells. */
export const AMBIENT_MIN_HEIGHT = 4;
/** Default interior width, in cells. */
export const AMBIENT_DEFAULT_WIDTH = 40;
/** Default interior height, in cells. */
export const AMBIENT_DEFAULT_HEIGHT = 10;
/** A tank never grows past this many fish unless a larger bound is configured. */
export const AMBIENT_DEFAULT_MAX_FISH = 6;
/** A tank never holds more food than this unless a larger bound is configured. */
export const AMBIENT_DEFAULT_MAX_FOOD = 12;
/** A fish eats twice before a new fish can join (while the population allows it). */
export const AMBIENT_FEEDS_PER_SPAWN = 2;
/** Food disappears after this many simulation steps. */
export const AMBIENT_FOOD_LIFETIME_STEPS = 12;
/** Full-motion simulation step. Deliberately slow: two ticks per second. */
export const AMBIENT_TICK_MS = 500;
/** Reduced motion advances one quarter as fast (one simulation step every two seconds). */
export const AMBIENT_REDUCED_MOTION_SCALE = 0.25;
/** Reduced-motion host tick period; still one simulation step per tick. */
export const AMBIENT_REDUCED_MOTION_TICK_MS = AMBIENT_TICK_MS / AMBIENT_REDUCED_MOTION_SCALE;
/** Largest host delta folded into one call, so a suspended terminal cannot spin the tank. */
export const AMBIENT_MAX_DT_MS = 60_000;
/** Upper bound on simulation steps in one call (a defensive bound; reached only with a huge dt). */
export const AMBIENT_MAX_STEPS_PER_TICK = 120;

/** A fish's position is an interior cell (`0 <= x < width`, `0 <= y < height`). */
export interface AmbientFish {
	readonly id: number;
	readonly x: number;
	readonly y: number;
	/** 1 faces right (`>`), -1 faces left (`<`). */
	readonly direction: 1 | -1;
	/** Foods eaten since the fish last spawned; resets when it spawns. */
	readonly fed: number;
}

/** Food is an interior cell and ages one step at a time. */
export interface AmbientFood {
	readonly x: number;
	readonly y: number;
	readonly age: number;
}

/** Complete immutable tank state. */
export interface AmbientTankState {
	readonly width: number;
	readonly height: number;
	readonly fish: readonly AmbientFish[];
	readonly food: readonly AmbientFood[];
	readonly maxFish: number;
	readonly maxFood: number;
	/** xorshift32 state; always non-zero. */
	readonly rng: number;
	/** Simulation steps completed. */
	readonly tick: number;
	/** Unconsumed time carried into the next tick. */
	readonly pendingMs: number;
	readonly nextFishId: number;
	readonly foodsEaten: number;
	readonly foodsAdded: number;
}

/** Construction options. Every value is clamped to a usable range. */
export interface AmbientTankOptions {
	readonly width?: number;
	readonly height?: number;
	readonly seed?: number;
	readonly initialFish?: number;
	readonly maxFish?: number;
	readonly maxFood?: number;
}

/** Motion policy for one tick. */
export interface AmbientTickOptions {
	/**
	 * `true` runs the tank at {@link AMBIENT_REDUCED_MOTION_SCALE} speed.
	 * Hosts should also tick less often (`AMBIENT_REDUCED_MOTION_TICK_MS`).
	 */
	readonly reduceMotion?: boolean;
}

function clampInt(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function normalizeSeed(seed: number | undefined): number {
	const value = seed === undefined || !Number.isFinite(seed) ? 1 : Math.trunc(seed) >>> 0;
	// An all-zero xorshift state is a fixed point.
	return value === 0 ? 1 : value;
}

/** One deterministic xorshift32 draw. */
function nextRandom(rng: number): { readonly rng: number; readonly value: number } {
	let next = rng >>> 0;
	next ^= next << 13;
	next >>>= 0;
	next ^= next >>> 17;
	next ^= next << 5;
	next >>>= 0;
	if (next === 0) next = 1;
	return { rng: next, value: next / 0x1_0000_0000 };
}

/** Create an off-by-default tank representation; the session owns whether it draws. */
export function createTank(options: AmbientTankOptions = {}): AmbientTankState {
	const width = clampInt(options.width, AMBIENT_MIN_WIDTH, 240, AMBIENT_DEFAULT_WIDTH);
	const height = clampInt(options.height, AMBIENT_MIN_HEIGHT, 80, AMBIENT_DEFAULT_HEIGHT);
	const maxFish = clampInt(options.maxFish, 1, 24, AMBIENT_DEFAULT_MAX_FISH);
	const maxFood = clampInt(options.maxFood, 1, 48, AMBIENT_DEFAULT_MAX_FOOD);
	const fishCount = Math.min(maxFish, clampInt(options.initialFish, 1, maxFish, 2));
	const fish: AmbientFish[] = [];
	for (let i = 0; i < fishCount; i++) {
		// Spread the starting school without drawing random numbers: seeded runs
		// with the same options must start with the same layout.
		const x = 2 + Math.floor((i * Math.max(1, width - 5)) / Math.max(1, fishCount));
		fish.push({
			id: i,
			x: Math.min(width - 1, x),
			y: 1 + (i % Math.max(1, height - 2)),
			direction: i % 2 === 0 ? 1 : -1,
			fed: 0,
		});
	}
	return {
		width,
		height,
		fish,
		food: [],
		maxFish,
		maxFood,
		rng: normalizeSeed(options.seed),
		tick: 0,
		pendingMs: 0,
		nextFishId: fishCount,
		foodsEaten: 0,
		foodsAdded: 0,
	};
}

/** Drop food at an interior cell. Coordinates outside the tank are clamped to its edge. */
export function feedTank(state: AmbientTankState, x: number, y: number): AmbientTankState {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return state;
	const cellX = Math.min(state.width - 1, Math.max(0, Math.trunc(x)));
	const cellY = Math.min(state.height - 1, Math.max(0, Math.trunc(y)));
	const overflow = state.food.length + 1 - state.maxFood;
	const food = overflow > 0 ? state.food.slice(overflow) : state.food.slice();
	food.push({ x: cellX, y: cellY, age: 0 });
	return { ...state, food, foodsAdded: state.foodsAdded + 1 };
}

interface StepState {
	fish: AmbientFish[];
	food: AmbientFood[];
	rng: number;
	nextFishId: number;
	foodsEaten: number;
}

/** Advance the simulation one low-rate step. */
function stepTank(state: AmbientTankState): StepState {
	let rng = state.rng;
	let nextFishId = state.nextFishId;
	let foodsEaten = state.foodsEaten;
	let food: AmbientFood[] = state.food
		.map(item => ({ ...item, age: item.age + 1 }))
		.filter(item => item.age < AMBIENT_FOOD_LIFETIME_STEPS);
	const fish: AmbientFish[] = [];

	for (let index = 0; index < state.fish.length; index++) {
		const current = state.fish[index]!;
		let targetIndex = -1;
		let targetDistance = Number.POSITIVE_INFINITY;
		for (let at = 0; at < food.length; at++) {
			const candidate = food[at]!;
			const candidateDistance = Math.abs(current.x - candidate.x) + Math.abs(current.y - candidate.y);
			if (candidateDistance < targetDistance) {
				targetDistance = candidateDistance;
				targetIndex = at;
			}
		}

		let x = current.x;
		let y = current.y;
		let direction = current.direction;
		let fed = current.fed;

		if (targetIndex >= 0 && targetDistance <= 1) {
			const eaten = food[targetIndex]!;
			food = food.filter((_, at) => at !== targetIndex);
			foodsEaten += 1;
			x = eaten.x;
			y = eaten.y;
			fed += 1;
			const remaining = state.fish.length - index - 1;
			if (fed >= AMBIENT_FEEDS_PER_SPAWN && fish.length + remaining + 2 <= state.maxFish) {
				// The meal becomes a new fish at its cell. Draw once so the seed
				// still controls the newcomer's direction (and future wandering).
				const draw = nextRandom(rng);
				rng = draw.rng;
				fish.push({
					id: nextFishId++,
					x,
					y,
					direction: draw.value < 0.5 ? -1 : 1,
					fed: 0,
				});
				fed = 0;
			}
		} else if (targetIndex >= 0) {
			const target = food[targetIndex]!;
			const dx = Math.sign(target.x - x);
			if (dx !== 0) {
				x += dx;
				direction = dx > 0 ? 1 : -1;
			} else {
				y += Math.sign(target.y - y);
			}
		} else {
			const draw = nextRandom(rng);
			rng = draw.rng;
			if (draw.value < 0.2) direction = direction === 1 ? -1 : 1;
			x += direction;
			if (draw.value > 0.85) {
				const vertical = nextRandom(rng);
				rng = vertical.rng;
				y += vertical.value < 0.5 ? -1 : 1;
			}
		}

		if (x < 0) {
			x = 0;
			direction = 1;
		} else if (x >= state.width) {
			x = state.width - 1;
			direction = -1;
		}
		y = Math.min(state.height - 1, Math.max(0, y));
		fish.push({ id: current.id, x, y, direction, fed });
	}

	return { fish, food, rng, nextFishId, foodsEaten };
}

/**
 * Advance the tank by `dtMs` of host time.
 *
 * The call is pure and deterministic: the same state and delta produce the
 * same result. Sub-step remainders are carried in `pendingMs`, so splitting a
 * delta across calls yields the same simulation as one call. With
 * `reduceMotion`, time advances at {@link AMBIENT_REDUCED_MOTION_SCALE}; hosts
 * should additionally tick at {@link AMBIENT_REDUCED_MOTION_TICK_MS}.
 */
export function tickTank(state: AmbientTankState, dtMs: number, options: AmbientTickOptions = {}): AmbientTankState {
	if (!Number.isFinite(dtMs) || dtMs <= 0) return state;
	const scale = options.reduceMotion === true ? AMBIENT_REDUCED_MOTION_SCALE : 1;
	const elapsed = Math.min(dtMs, AMBIENT_MAX_DT_MS) * scale;
	const total = state.pendingMs + elapsed;
	const steps = Math.min(AMBIENT_MAX_STEPS_PER_TICK, Math.floor(total / AMBIENT_TICK_MS));
	const pendingMs = total - steps * AMBIENT_TICK_MS;
	if (steps === 0) return pendingMs === state.pendingMs ? state : { ...state, pendingMs };

	let next = state;
	for (let step = 0; step < steps; step++) {
		const stepped = stepTank(next);
		next = {
			...next,
			fish: stepped.fish,
			food: stepped.food,
			rng: stepped.rng,
			nextFishId: stepped.nextFishId,
			foodsEaten: stepped.foodsEaten,
			tick: next.tick + 1,
		};
	}
	return { ...next, pendingMs };
}

/**
 * Draw the tank as ASCII rows. The frame is `width + 2` columns by
 * `height + 2` rows: a `+`/`-` border around the water. String widths are
 * one cell because the glyphs are ASCII.
 */
export function renderTank(state: AmbientTankState): string[] {
	const border = `+${"-".repeat(state.width)}+`;
	const rows: string[] = [border];
	for (let y = 0; y < state.height; y++) {
		const cells: string[] = Array.from({ length: state.width }, (_, x) => {
			// A few still ripples keep the water readable without animation.
			if (y === 0 && (x + state.tick) % 11 === 0) return "~";
			if (y === state.height - 1 && x >= 2 && x < state.width - 2 && x % 7 === 2) return "|";
			return " ";
		});
		for (const item of state.food) {
			if (item.y === y && item.x >= 0 && item.x < state.width) cells[item.x] = "*";
		}
		// Fish draw last so they stay visible over food and plants.
		for (const fish of state.fish) {
			if (fish.y === y && fish.x >= 0 && fish.x < state.width) {
				cells[fish.x] = fish.direction === 1 ? ">" : "<";
			}
		}
		rows.push(`|${cells.join("")}|`);
	}
	rows.push(border);
	return rows;
}
