import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
	CaptionButtons,
	WindowControls,
	desktopWindowBridge,
	subscribeWindowMaximized,
	type DesktopWindowControlBridge,
} from "./windowControls";

type DesktopGlobal = typeof globalThis & { piDesktop?: Partial<DesktopWindowControlBridge> };

function installBridge(bridge: Partial<DesktopWindowControlBridge> | undefined): void {
	const scope = globalThis as DesktopGlobal;
	if (bridge === undefined) delete scope.piDesktop;
	else scope.piDesktop = bridge;
}

function fakeBridge(overrides: Partial<DesktopWindowControlBridge> = {}): DesktopWindowControlBridge {
	return {
		minimize: async () => {},
		maximize: async () => {},
		close: async () => {},
		...overrides,
	};
}

afterEach(() => {
	installBridge(undefined);
});

describe("desktop window-control bridge detection", () => {
	test("a plain browser tab has no bridge and renders no custom controls", () => {
		installBridge(undefined);
		expect(desktopWindowBridge()).toBeUndefined();
		expect(renderToStaticMarkup(<WindowControls />)).toBe("");
	});

	test("a partial bridge is not treated as the frameless shell", () => {
		installBridge({ minimize: async () => {}, maximize: async () => {} });
		expect(desktopWindowBridge()).toBeUndefined();
		expect(renderToStaticMarkup(<WindowControls />)).toBe("");
	});

	test("the preload bridge renders exactly the three caption buttons", () => {
		installBridge(fakeBridge());
		expect(desktopWindowBridge()).toBeDefined();

		const html = renderToStaticMarkup(<CaptionButtons bridge={fakeBridge()} />);
		expect(html).toContain('class="window-controls"');
		expect(html).toContain('class="window-control close"');
		expect(html.match(/<button/g)?.length).toBe(3);
		// Every caption button is labelled (locale-agnostic) and stays out of the drag region.
		const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1] ?? "");
		const knownLabels: Record<string, true> = {
			Minimize: true,
			Maximize: true,
			Close: true,
			最小化: true,
			最大化: true,
			关闭: true,
		};
		expect(labels.length).toBe(3);
		expect(new Set(labels).size).toBe(3);
		for (const label of labels) expect(knownLabels[label]).toBe(true);
	});
});

describe("maximize state tracking", () => {
	test("reports the initial state and follows bridge events", async () => {
		let emit: ((state: { maximized: boolean }) => void) | undefined;
		let unsubscribed = 0;
		const bridge = fakeBridge({
			isMaximized: async () => true,
			onWindowState: callback => {
				emit = callback;
				return () => {
					unsubscribed += 1;
					emit = undefined;
				};
			},
		});

		const seen: boolean[] = [];
		const dispose = subscribeWindowMaximized(bridge, maximized => seen.push(maximized));
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
		expect(seen).toEqual([true]);

		emit?.({ maximized: false });
		expect(seen).toEqual([true, false]);

		dispose();
		expect(unsubscribed).toBe(1);
	});

	test("a bridge without state helpers still subscribes and disposes", () => {
		const bridge = fakeBridge();
		const dispose = subscribeWindowMaximized(bridge, () => {});
		expect(typeof dispose).toBe("function");
		dispose();
	});
});

describe("window chrome stacking", () => {
	// Regression: `.app` is an `isolation: isolate` stacking context, so the
	// in-flow titlebar painted below `.modal-backdrop` (--z-modal): an open
	// dialog swallowed every click on minimize / maximize / close. The caption
	// group is now portaled to <body>, fixed, and above modal backdrops.
	test("the caption strip is fixed above modal backdrops", () => {
		const tokens = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");
		const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
		const token = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)`).exec(tokens)?.[1]);

		expect(token("z-window-controls")).toBeGreaterThan(token("z-modal"));
		expect(token("z-window-controls")).toBeLessThan(token("z-toast"));
		expect(appCss).toMatch(
			/\.window-controls\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*var\(--z-window-controls\)/s,
		);
	});

	test("the titlebar reserves the fixed strip so app controls stay clickable", () => {
		const tokens = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");
		const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
		expect(tokens).toMatch(/--window-controls-width:\s*132px/);
		expect(appCss).toMatch(
			/:root:has\(\.window-controls\)\s*\.app-titlebar\s*\{[^}]*padding-right:\s*calc\(var\(--window-controls-width\)/s,
		);
	});

	test("WindowControls portals the buttons out of the app stacking context", () => {
		const source = readFileSync(new URL("./windowControls.tsx", import.meta.url), "utf8");
		expect(source).toContain("createPortal(<CaptionButtons bridge={bridge} />, document.body)");
	});
});
