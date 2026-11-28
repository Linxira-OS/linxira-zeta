import { describe, expect, it } from "bun:test";
import {
	AMBIENT_DEFAULT_MAX_FISH,
	AMBIENT_REDUCED_MOTION_TICK_MS,
	AMBIENT_TICK_MS,
	createTank,
	feedTank,
	renderTank,
	tickTank,
} from "@linxiraos/zeta/ambient/engine";
import { AmbientSession } from "@linxiraos/zeta/ambient/session";

describe("ambient engine", () => {
	it("starts a session off and refuses to advance or feed until enabled", () => {
		const session = new AmbientSession();
		expect(session.enabled).toBe(false);
		expect(session.tank).toBeUndefined();
		expect(session.tick(AMBIENT_TICK_MS)).toBeUndefined();
		expect(session.feed(3, 2)).toBeUndefined();
		expect(session.rows()).toEqual([]);
	});

	it("is deterministic for the same state and delta", () => {
		const base = feedTank(createTank({ seed: 7 }), 6, 4);
		const once = tickTank(base, 1_000);
		const again = tickTank(base, 1_000);
		expect(again).toEqual(once);
		expect(once).not.toBe(base);
		// Time is carried across calls, so subdividing a delta changes nothing.
		expect(tickTank(tickTank(base, 500), 500)).toEqual(once);
	});

	it("drops food on the exact requested cell", () => {
		const base = createTank({ seed: 3, width: 20, height: 8 });
		const fed = feedTank(base, 4, 3);
		expect(fed.food).toHaveLength(1);
		expect(fed.food[0]).toMatchObject({ x: 4, y: 3, age: 0 });
		expect(base.food).toHaveLength(0);
		// One border row/column: y=3 is row 4, x=4 is column 5.
		expect(renderTank(fed)[4]?.[5]).toBe("*");
		expect(fed.foodsAdded).toBe(1);
	});

	it("clamps food coordinates to the tank's interior", () => {
		const base = createTank({ seed: 3, width: 20, height: 8 });
		const fed = feedTank(feedTank(base, -5, 99), 99, -5);
		expect(fed.food).toEqual([
			{ x: 0, y: 7, age: 0 },
			{ x: 19, y: 0, age: 0 },
		]);
	});

	it("keeps population and food within their configured bounds", () => {
		let state = createTank({ seed: 9, width: 24, height: 8, maxFish: 4, maxFood: 3 });
		for (let step = 0; step < 200; step++) {
			const fish = state.fish[0]!;
			state = feedTank(state, fish.x, fish.y);
			state = tickTank(state, AMBIENT_TICK_MS);
			expect(state.fish.length).toBeLessThanOrEqual(4);
			expect(state.food.length).toBeLessThanOrEqual(3);
		}
		expect(state.fish.length).toBeLessThanOrEqual(4);
		expect(state.fish.length).toBeGreaterThanOrEqual(1);
	});

	it("defaults to a bounded school", () => {
		const tank = createTank();
		expect(tank.fish.length).toBeLessThanOrEqual(AMBIENT_DEFAULT_MAX_FISH);
		expect(tank.fish.length).toBeGreaterThanOrEqual(1);
		expect(AMBIENT_REDUCED_MOTION_TICK_MS).toBeGreaterThan(AMBIENT_TICK_MS);
		expect(AMBIENT_TICK_MS).toBeGreaterThanOrEqual(250);
	});

	it("moves much slower under reduce-motion", () => {
		const base = createTank({ seed: 11, width: 30, height: 8 });
		const full = tickTank(base, AMBIENT_TICK_MS);
		const reduced = tickTank(base, AMBIENT_TICK_MS, { reduceMotion: true });
		expect(full.fish).not.toEqual(base.fish);
		expect(reduced.fish).toEqual(base.fish);
		expect(reduced.tick).toBe(0);
		// A reduced-motion host tick is one full simulation step at 1/4 speed.
		expect(tickTank(base, AMBIENT_REDUCED_MOTION_TICK_MS, { reduceMotion: true }).tick).toBe(1);
	});

	it("renders exact-width ASCII rows with a border", () => {
		const tank = createTank({ width: 20, height: 6 });
		const rows = renderTank(tank);
		expect(rows).toHaveLength(8);
		expect(rows[0]).toBe(`+${"-".repeat(20)}+`);
		expect(rows.at(-1)).toBe(`+${"-".repeat(20)}+`);
		for (const row of rows) {
			expect(row).toHaveLength(22);
			expect(/^[\x20-\x7e]+$/.test(row)).toBe(true);
		}
	});
});
