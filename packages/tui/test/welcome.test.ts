import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { pickWeightedTip, WelcomeComponent, ZETA_LOGO } from "@linxiraos/pi-tui/prompt/welcome";
import { initTheme, theme } from "@linxiraos/pi-tui/theme";
import { visibleWidth, type NativeNode } from "@linxiraos/pi-tui";

describe("WelcomeComponent", () => {
	beforeAll(async () => {
		await initTheme(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("natively lays out the brand column beside the info column holding the version", () => {
		const tree = new WelcomeComponent("18.4.12").describe({} as never);
		// The props union is keyed by node kind; tests only read these two members.
		const props = (node: NativeNode | undefined) =>
			node?.p as { role?: string; spans?: Array<{ t?: string }> } | undefined;
		const find = (node: NativeNode | undefined, role: string): NativeNode | undefined => {
			if (props(node)?.role === role) return node;
			for (const child of node?.c ?? []) {
				if ("k" in child) {
					const found = find(child, role);
					if (found) return found;
				}
			}
			return undefined;
		};

		const grid = find(tree, "zeta.welcome.grid");
		expect(grid?.p).toMatchObject({ align: "start", wrap: true });

		// Brand column: greeting plus the terminal's builtin zeta logo mark.
		const brand = find(grid, "zeta.welcome.brand");
		expect(props(find(brand, "zeta.welcome.greeting"))?.spans?.[0]).toMatchObject({ t: "Welcome back!" });
		expect(find(brand, "omp.welcome.logo")?.k).toBe("image");

		// Info column: the version sits at its head, ahead of tips/LSP/sessions.
		const info = find(grid, "zeta.welcome.info");
		expect(props(find(info, "omp.welcome.version"))?.spans?.[0]).toMatchObject({ t: "18.4.12" });
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

	it("centers the greeting and every logo line in the brand column", () => {
		const columns = 60;
		const rows = new WelcomeComponent("1.0.0").render(columns).map(row => Bun.stripANSI(row));
		// Content rows read `│ left │ right │`: the brand column is the first segment.
		const brand = rows.map(row => row.split("│")[1] ?? "");

		const greeting = brand.find(segment => segment.includes("Welcome back!")) ?? "";
		const leftCol = visibleWidth(greeting);
		const greetingLead = visibleWidth(greeting) - visibleWidth(greeting.trimStart());
		const greetingTrail = visibleWidth(greeting) - visibleWidth(greeting.trimEnd());
		expect(Math.abs(greetingLead - greetingTrail)).toBeLessThanOrEqual(1);

		// Each logo line keeps its own art spacing and centers on the column.
		for (const art of ZETA_LOGO) {
			const segment = brand.find(seg => seg.includes(art)) ?? "";
			const pad = Math.floor((leftCol - visibleWidth(art)) / 2);
			expect(segment.startsWith(" ".repeat(pad))).toBe(true);
			expect(segment.endsWith(" ".repeat(leftCol - visibleWidth(art) - pad))).toBe(true);
		}

		// The tip renders beneath the box; its lines carry no baked-in indent.
		const tipIndex = rows.findIndex(row => row.includes("Tip: "));
		expect(tipIndex).toBeGreaterThan(rows.findIndex(row => row.includes("Recent sessions")));
		expect(rows[tipIndex]?.startsWith("Tip: ")).toBe(true);
	});

	it("drops the tip below 16 columns", () => {
		const text = (columns: number) => Bun.stripANSI(new WelcomeComponent("1.0.0").render(columns).join("\n"));
		expect(text(16)).toContain("Tip: ");
		expect(text(15)).not.toContain("Tip: ");
		expect(text(15)).toContain("███████╗");
		expect(text(50)).toContain("v1.0.0");
	});

	it("keeps the info column beside the brand column while it fits, else the brand column alone", () => {
		const rows = (columns: number) => new WelcomeComponent("1.0.0").render(columns).map(row => Bun.stripANSI(row));

		// Wide: both columns, version in the border title.
		const wide = rows(60).join("\n");
		expect(wide).toContain("███████╗");
		expect(wide).toContain("Recent sessions");
		expect(wide).toContain("v1.0.0");

		// Narrow: the info column collapses, but the logo and title version stay.
		const narrow = rows(33).join("\n");
		expect(narrow).toContain("███████╗");
		expect(narrow).toContain("v1.0.0");
		expect(narrow).not.toContain("Recent sessions");
	});

	it("truncates a long model name inside the fixed left column and keeps the right column", () => {
		// Dynamic model labels must not influence the responsive breakpoint: a
		// long name is truncated with an ellipsis instead of collapsing the right
		// column or changing the box height when authoritative session data
		// replaces the prepaint labels.
		const modelName = "DeepSeek V4 Flash (2x usage)";
		const output = new WelcomeComponent("17.3.4", modelName, "opencode-go").render(55).join("\n");
		const plain = output.replace(/\x1b\[[0-9;]*m/g, "");

		expect(plain).not.toContain(modelName);
		expect(plain).toMatch(/DeepSeek V4 [^│]*…/);
		expect(plain).toContain("Recent sessions");
	});

	it("hides the LSP section only when LSP is disabled (null), not when no servers were detected", () => {
		const [empty, disabled] = [[], null].map(servers =>
			new WelcomeComponent("1.0.0", "model", "provider", [], servers)
				.render(100)
				.join("\n")
				.replace(/\x1b\[[0-9;]*m/g, ""),
		);

		expect(empty).toContain("No LSP servers");
		expect(disabled).not.toContain("LSP Servers");
		expect(disabled).not.toContain("No LSP servers");
		expect(disabled).toContain("Recent sessions");
	});
});
