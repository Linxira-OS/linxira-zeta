import { describe, expect, it, vi } from "bun:test";
import { AMBIENT_USAGE, handleAmbientCommand } from "@linxiraos/zeta/ambient/command";
import { AmbientSession } from "@linxiraos/zeta/ambient/session";

function harness(options: { tsp: boolean; reduceMotion?: boolean }) {
	const session = new AmbientSession();
	const renderFrame = vi.fn();
	const supportsTsp = vi.fn(() => options.tsp);
	const run = (args: string) =>
		handleAmbientCommand(args, session, {
			supportsTsp,
			renderFrame,
			reduceMotion: () => options.reduceMotion ?? false,
		});
	return { session, renderFrame, supportsTsp, run };
}

describe("/ambient routing", () => {
	it("is off by default and never draws on bare or status invocation", () => {
		const h = harness({ tsp: true });
		const bare = h.run("");
		expect(bare.enabled).toBe(false);
		expect(bare.frame).toBeUndefined();
		expect(bare.rendered).toBe(false);
		expect(h.renderFrame).not.toHaveBeenCalled();
		expect(bare.status).toContain("off");

		const status = h.run("status");
		expect(status.enabled).toBe(false);
		expect(status.frame).toBeUndefined();
		expect(status.status).toContain("off");
		expect(h.renderFrame).not.toHaveBeenCalled();
	});

	it("refuses on for a host without TSP and never calls the frame sink", () => {
		const h = harness({ tsp: false });
		const outcome = h.run("on");
		expect(outcome.enabled).toBe(false);
		expect(outcome.rendered).toBe(false);
		expect(outcome.frame).toBeUndefined();
		expect(outcome.status).toContain("TSP frames");
		expect(h.session.enabled).toBe(false);
		expect(h.session.tank).toBeUndefined();
		expect(h.renderFrame).not.toHaveBeenCalled();
	});

	it("enables with a frame only on a TSP host", () => {
		const h = harness({ tsp: true });
		const outcome = h.run("on");
		expect(outcome.enabled).toBe(true);
		expect(outcome.rendered).toBe(true);
		expect(outcome.frame?.length).toBeGreaterThan(0);
		expect(h.renderFrame).toHaveBeenCalledTimes(1);
		expect(h.session.enabled).toBe(true);
	});

	it("feeds the requested cell and redraws while enabled", () => {
		const h = harness({ tsp: true });
		h.run("on");
		const outcome = h.run("feed 7 3");
		expect(outcome.ok).toBe(true);
		expect(outcome.frame).toBeDefined();
		expect(h.renderFrame).toHaveBeenCalledTimes(2);
		expect(h.session.tank?.food).toContainEqual({ x: 7, y: 3, age: 0 });
		// Border plus interior row 3, border plus interior column 7.
		expect(outcome.frame?.[4]?.[8]).toBe("*");
	});

	it("does not feed while off or on a non-TSP host", () => {
		const off = harness({ tsp: true });
		const offOutcome = off.run("feed 2 2");
		expect(offOutcome.ok).toBe(false);
		expect(offOutcome.frame).toBeUndefined();
		expect(off.renderFrame).not.toHaveBeenCalled();

		const unsupported = harness({ tsp: false });
		unsupported.run("on");
		const outcome = unsupported.run("feed 2 2");
		expect(outcome.ok).toBe(false);
		expect(outcome.frame).toBeUndefined();
		expect(unsupported.renderFrame).not.toHaveBeenCalled();
	});

	it("reports usage for malformed feed coordinates without drawing", () => {
		const h = harness({ tsp: true });
		h.run("on");
		h.renderFrame.mockClear();
		const outcome = h.run("feed nope");
		expect(outcome.ok).toBe(false);
		expect(outcome.status).toBe(AMBIENT_USAGE);
		expect(h.renderFrame).not.toHaveBeenCalled();
	});

	it("turns off without drawing and keeps the tank state", () => {
		const h = harness({ tsp: true });
		h.run("on");
		const tank = h.session.tank;
		h.renderFrame.mockClear();
		const outcome = h.run("off");
		expect(outcome.enabled).toBe(false);
		expect(outcome.rendered).toBe(false);
		expect(h.renderFrame).not.toHaveBeenCalled();
		expect(h.session.enabled).toBe(false);
		expect(h.session.tank).toBe(tank);
	});

	it("drops the toggle when a host stops advertising TSP", () => {
		const session = new AmbientSession();
		const renderFrame = vi.fn();
		let tsp = true;
		const deps = { supportsTsp: () => tsp, renderFrame };
		expect(handleAmbientCommand("on", session, deps).enabled).toBe(true);
		expect(renderFrame).toHaveBeenCalledTimes(1);
		tsp = false;
		const status = handleAmbientCommand("status", session, deps);
		expect(status.enabled).toBe(false);
		expect(status.frame).toBeUndefined();
		expect(session.enabled).toBe(false);
		expect(renderFrame).toHaveBeenCalledTimes(1);
	});

	it("uses the injected reduce-motion preference", () => {
		const h = harness({ tsp: true, reduceMotion: true });
		const outcome = h.run("on");
		expect(outcome.status).toContain("reduced motion");
		expect(h.session.reduceMotion).toBe(true);
		expect(h.session.tickIntervalMs).toBe(2_000);
	});
});
