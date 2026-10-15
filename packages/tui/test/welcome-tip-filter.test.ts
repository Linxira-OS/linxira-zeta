import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { setTuiTipFilter, TIP_CATALOGUE_KEYS, WelcomeComponent } from "@linxiraos/pi-tui/prompt/welcome";
import { initTheme } from "@linxiraos/pi-tui/theme";

/**
 * Host-installable splash-tip gate.
 *
 * The welcome box advertises product features through tips.txt lines; when a
 * feature the tip points at is switched off by configuration, the host must be
 * able to keep that tip out of the splash pool. The filter is consulted for
 * every candidate on every pick, so no roll of the weighted picker can surface
 * a suppressed tip.
 */
beforeAll(async () => {
	await initTheme(false);
});

afterEach(() => {
	setTuiTipFilter(undefined);
});

/** Every tip the splash can show, sweeping the weighted picker's whole range. */
function tipsAcrossRolls(count = 64): string[] {
	const random = spyOn(Math, "random");
	const seen: string[] = [];
	try {
		for (let i = 0; i < count; i++) {
			random.mockReturnValue((i + 0.5) / count);
			const tip = new WelcomeComponent("1.0.0").tip;
			if (tip !== undefined) seen.push(tip);
		}
	} finally {
		random.mockRestore();
	}
	return seen;
}

describe("splash tip filter", () => {
	it("exposes one catalogue key per tips.txt line", () => {
		expect(TIP_CATALOGUE_KEYS.length).toBeGreaterThan(20);
		expect(TIP_CATALOGUE_KEYS).toContain("tip25");
		expect(new Set(TIP_CATALOGUE_KEYS).size).toBe(TIP_CATALOGUE_KEYS.length);
	});

	it("keeps every tip when no filter is installed", () => {
		const seen = tipsAcrossRolls();
		expect(seen.some(tip => tip.includes("/collab"))).toBe(true);
	});

	it("never surfaces a tip the filter rejects, for any roll", () => {
		setTuiTipFilter(key => key !== "tip25");
		const seen = tipsAcrossRolls();
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.some(tip => tip.includes("/collab"))).toBe(false);
	});

	it("passes the tip's raw line to the filter alongside its key", () => {
		const calls: Array<{ key: string; raw: string }> = [];
		setTuiTipFilter((key, raw) => {
			calls.push({ key, raw });
			return true;
		});
		tipsAcrossRolls();
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every(call => call.raw.startsWith("`") || call.raw.length > 0)).toBe(true);
		expect(calls.every(call => call.key === `tip${TIP_CATALOGUE_KEYS.indexOf(call.key) + 1}`)).toBe(true);
	});
});
