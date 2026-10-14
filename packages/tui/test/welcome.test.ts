import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { pickWeightedTip, WelcomeComponent } from "@linxiraos/pi-tui/prompt/welcome";
import { initTheme, theme } from "@linxiraos/pi-tui/theme";
import { visibleWidth } from "@linxiraos/pi-tui";

/** The `Zeta` wordmark's top row (its `Z`+`e` top bars), for row probes. */
const WORDMARK_ROW = "███████╗███████╗";

describe("WelcomeComponent", () => {
	beforeAll(async () => {
		await initTheme(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("natively sets the version under the wordmark beside the logo", () => {
		const tree = new WelcomeComponent("18.4.12").describe({} as never);
		expect(tree.c?.[0]).toMatchObject({
			key: "lockup",
			p: { role: "zeta.welcome.lockup" },
			c: [
				{ k: "image", key: "logo" },
				{
					k: "col",
					p: { role: "zeta.welcome.mark" },
					c: [
						{ p: { role: "zeta.welcome.wordmark", spans: [{ t: "Zeta" }] } },
						{ p: { role: "zeta.welcome.version", spans: [{ t: "v18.4.12" }] } },
						{ p: { role: "zeta.welcome.subline", spans: [{ t: "Linxira-Zeta" }] } },
					],
				},
			],
		});
	});

	it("selects standard tip when preset is not unicode", () => {
		vi.spyOn(theme, "getSymbolPreset").mockReturnValue("nerd");

		const welcome = new WelcomeComponent("1.0.0");
		expect(welcome.tip).not.toBe("Please use nerdfont 😭.");
		expect(welcome.tip).toBeDefined();
	});

	it("selects nerdfont tip with 10% probability under unicode preset", () => {
		vi.spyOn(theme, "getSymbolPreset").mockReturnValue("unicode");

		// 9% chance => selects special tip
		vi.spyOn(Math, "random").mockReturnValue(0.09);
		const welcomeSpecial = new WelcomeComponent("1.0.0");
		expect(welcomeSpecial.tip).toBe("Please use nerdfont 😭.");

		// 10% chance => selects regular tip
		vi.spyOn(Math, "random").mockReturnValue(0.1);
		const welcomeRegular = new WelcomeComponent("1.0.0");
		expect(welcomeRegular.tip).not.toBe("Please use nerdfont 😭.");
		expect(welcomeRegular.tip).toBeDefined();
	});

	it("weights [NEW] tips above ordinary tips in selection", () => {
		// Data-independent: tips.txt may legitimately carry zero "[NEW]" tips, so
		// exercise the weighting contract on a synthetic list.
		const tips = ["plain one", "shiny thing [NEW]", "plain two"] as const;

		const counts = new Map<string, number>();
		const samples = 10_000;
		for (let i = 0; i < samples; i++) {
			const tip = pickWeightedTip(tips, (i + 0.5) / samples); // sweep the selection domain uniformly
			counts.set(tip, (counts.get(tip) ?? 0) + 1);
		}

		let newMax = 0;
		let ordinaryMax = 0;
		for (const [tip, count] of counts) {
			if (/\[NEW\]\s*$/.test(tip)) newMax = Math.max(newMax, count);
			else ordinaryMax = Math.max(ordinaryMax, count);
		}

		// A "[NEW]" tip carries a >1 weight, so it covers strictly more of the
		// uniform selection domain than any single ordinary tip.
		expect(newMax).toBeGreaterThan(0);
		expect(newMax).toBeGreaterThan(ordinaryMax);
		expect(pickWeightedTip([], 0.5)).toBe("");
	});

	it("centers the lockup block and every tip line in the terminal width", () => {
		const columns = 140;
		const rows = new WelcomeComponent("1.0.0").render(columns).map(Bun.stripANSI);
		// The lockup is the block before the blank spacer; everything after it is
		// the tip, which may wrap onto continuation lines that carry no "Tip: ".
		const spacer = rows.findIndex(row => row.trim().length === 0);
		const lockup = rows.slice(0, spacer);
		const tips = rows.slice(spacer + 1).filter(row => row.trim().length > 0);
		const lead = (row: string) => visibleWidth(row) - visibleWidth(row.trimStart());

		const widest = lockup.reduce((a, b) => (visibleWidth(a) >= visibleWidth(b) ? a : b));
		// The block indent is the smallest leading run: the art's own leading spaces
		// add to it per row, so only the minimum is the centering offset.
		const blockLead = Math.min(...lockup.map(lead));
		expect(widest).toContain(WORDMARK_ROW);
		expect(Math.abs(blockLead - (columns - visibleWidth(widest)))).toBeLessThanOrEqual(1);

		// Each tip line centers on its own.
		expect(tips.length).toBeGreaterThanOrEqual(1);
		for (const row of tips) {
			expect(Math.abs(lead(row) - (columns - visibleWidth(row)))).toBeLessThanOrEqual(1);
		}
	});

	it("drops the tip below 50 columns", () => {
		const text = (columns: number) => Bun.stripANSI(new WelcomeComponent("1.0.0").render(columns).join("\n"));
		expect(text(50)).toContain("Tip: ");
		expect(text(49)).not.toContain("Tip: ");
		expect(text(49)).toContain("v1.0.0");
	});

	it("sets the version under the wordmark while the lockup fits, else keeps the logo alone", () => {
		const rows = (columns: number) => new WelcomeComponent("1.0.0").render(columns).map(row => Bun.stripANSI(row));

		// The lockup needs 8 mark + 4 gap + 33 wordmark = 45 columns inside the
		// 2-column margin, so it fits from 47 columns up.
		const fits = rows(47);
		const word = fits.find(row => row.includes(WORDMARK_ROW));
		const version = fits.find(row => row.includes("v1.0.0"));
		expect(fits.some(row => row.includes("███████╗    ███████╗███████╗"))).toBe(true);
		expect(version?.indexOf("v1.0.0")).toBe(word?.indexOf(WORDMARK_ROW));

		const narrow = rows(46).join("\n");
		expect(narrow).toContain("╚══███╔╝");
		expect(narrow).not.toContain(WORDMARK_ROW);
		expect(narrow).not.toContain("v1.0.0");
	});
});
