/** Opt-in ASCII fish tank: pure engine, session switch, and `/ambient` routing. */
export {
	AMBIENT_DEFAULT_HEIGHT,
	AMBIENT_DEFAULT_MAX_FISH,
	AMBIENT_DEFAULT_MAX_FOOD,
	AMBIENT_DEFAULT_WIDTH,
	AMBIENT_FEEDS_PER_SPAWN,
	AMBIENT_FOOD_LIFETIME_STEPS,
	AMBIENT_MAX_DT_MS,
	AMBIENT_MAX_STEPS_PER_TICK,
	AMBIENT_MIN_HEIGHT,
	AMBIENT_MIN_WIDTH,
	AMBIENT_REDUCED_MOTION_SCALE,
	AMBIENT_REDUCED_MOTION_TICK_MS,
	AMBIENT_TICK_MS,
	createTank,
	feedTank,
	renderTank,
	tickTank,
	type AmbientFish,
	type AmbientFood,
	type AmbientTankOptions,
	type AmbientTankState,
	type AmbientTickOptions,
} from "./engine";
export { AmbientSession, type AmbientSessionOptions } from "./session";
export {
	AMBIENT_TSP_CAPABILITY,
	AMBIENT_USAGE,
	handleAmbientCommand,
	type AmbientCommandDeps,
	type AmbientCommandOutcome,
} from "./command";
