/**
 * `/cd` picker overlay: folder navigation, pins that act immediately, the
 * resume secondary action, and mouse selection.
 */
import { beforeAll, describe, expect, it, vi } from "bun:test";
import { DirectoryPickerOverlay, type DirectoryPickerListing } from "../src/overlays/directory-picker";
import type { SgrMouseEvent } from "../src/mouse";
import { initTheme } from "../src/theme";

const HOME = "/home/me";

beforeAll(async () => {
	await initTheme(false);
});

/** Down-arrow keystrokes, one input event each (the TUI feeds one key at a time). */
function pressDown(times: number): string[] {
	return Array.from({ length: times }, () => "\x1b[B");
}

function listing(overrides: Partial<DirectoryPickerListing> = {}): DirectoryPickerListing {
	return {
		current: "/home/me/project",
		parent: "/home/me",
		pins: [{ name: "work", path: "/home/me/work", detail: "/home/me/work" }],
		roots: [],
		directories: [
			{ name: "src", path: "/home/me/project/src" },
			{ name: "docs", path: "/home/me/project/docs" },
		],
		selectable: true,
		...overrides,
	};
}

function source(listings: Record<string, DirectoryPickerListing> = {}) {
	const togglePin = vi.fn(async () => true);
	return {
		togglePin,
		list: vi.fn((directory: string | null) => {
			if (directory === null) {
				return listing({
					current: null,
					parent: null,
					rootsKind: "drives",
					roots: [
						{ name: "C:", path: "C:\\", detail: "internal" },
						{ name: "F: Phone", path: "F:\\", detail: "removable / external" },
					],
					directories: [],
					selectable: false,
				});
			}
			return listings[directory] ?? listing({ current: directory });
		}),
	};
}

function build(listings?: Record<string, DirectoryPickerListing>) {
	const pickerSource = source(listings);
	const options = {
		source: pickerSource,
		initialPath: "/home/me/project",
		home: HOME,
		onSelect: vi.fn(),
		onResume: vi.fn(),
		onCancel: vi.fn(),
	};
	return { overlay: new DirectoryPickerOverlay(options), options, source: pickerSource };
}

function click(row: number, modifiers = 0): SgrMouseEvent {
	return {
		button: modifiers,
		col: 0,
		row: row + 1,
		release: false,
		wheel: null,
		motion: false,
		leftClick: true,
	};
}

describe("DirectoryPickerOverlay", () => {
	it("lists folders only, with 'use this folder', '..', pins and children", () => {
		const { overlay } = build();
		const lines = overlay.renderContent(80).join("\n");
		expect(lines).toContain("Use this folder");
		expect(lines).toContain("..");
		expect(lines).toContain("work");
		expect(lines).toContain("src/");
		expect(lines).toContain("docs/");
		expect(overlay.current).toBe("/home/me/project");
	});

	it("opens a folder with Enter and goes back up with Backspace", () => {
		const { overlay } = build({
			"/home/me/project/src": listing({
				current: "/home/me/project/src",
				parent: "/home/me/project",
				directories: [{ name: "deep", path: "/home/me/project/src/deep" }],
			}),
		});
		// Rows: use(0), ..(1), pin(2), src(3), docs(4).
		for (const key of pressDown(3)) overlay.handleInput(key); // use(0), ..(1), pin(2) → src(3)
		overlay.handleInput("\r");
		expect(overlay.current).toBe("/home/me/project/src");
		expect(overlay.listing.directories.map(entry => entry.name)).toEqual(["deep"]);

		overlay.handleInput("\x7f"); // backspace with an empty filter → parent
		expect(overlay.current).toBe("/home/me/project");
	});

	it("does not switch when the current folder is chosen", () => {
		const { overlay, options } = build();
		const before = overlay.current;
		overlay.handleInput("\r");
		expect(options.onSelect).not.toHaveBeenCalled();
		expect(overlay.current).toBe(before);
		expect(overlay.listing.current).toBe(before);
	});

	it("switches immediately on a pin — it does not descend into it", () => {
		const { overlay, options } = build();
		for (const key of pressDown(2)) overlay.handleInput(key); // use(0), ..(1) → pin(2)
		overlay.handleInput("\r");
		expect(options.onSelect).toHaveBeenCalledWith("/home/me/work");
	});

	it("routes Ctrl+R and Ctrl+click to resume instead of switching", () => {
		const { overlay, options } = build();
		for (const key of pressDown(2)) overlay.handleInput(key); // pin row
		overlay.handleInput("\x12"); // Ctrl+R
		expect(options.onResume).toHaveBeenCalledWith("/home/me/work");
		expect(options.onSelect).not.toHaveBeenCalled();

		const second = build();
		second.overlay.renderContent(80); // the frame lays out the row hit map
		second.overlay.routeMouse(click(2, 16), 3, 0); // Ctrl+click on the pin row (content row 2)
		expect(second.options.onResume).toHaveBeenCalledWith("/home/me/work");
	});

	it("activates a folder on a plain mouse click", () => {
		const { overlay } = build({
			"/home/me/project/docs": listing({
				current: "/home/me/project/docs",
				parent: "/home/me/project",
				directories: [],
			}),
		});
		overlay.renderContent(80); // the frame lays out the row hit map
		overlay.routeMouse(click(4), 5, 0); // docs row is the 5th content line
		expect(overlay.current).toBe("/home/me/project/docs");
	});

	it("moves with j/k outside the filter", () => {
		const { overlay, options } = build();
		overlay.handleInput("j"); // use(0) → ..(1)
		overlay.handleInput("j"); // → pin(2)
		overlay.handleInput("\r");
		expect(options.onSelect).toHaveBeenCalledWith("/home/me/work");
	});

	it("filters a name that starts with j after an explicit /", () => {
		const { overlay } = build({
			"/home/me/project": listing({
				directories: [
					{ name: "java", path: "/home/me/project/java" },
					{ name: "docs", path: "/home/me/project/docs" },
				],
			}),
		});
		overlay.handleInput("/");
		overlay.handleInput("ja");
		const lines = overlay.renderContent(80).join("\n");
		expect(lines).toContain("java/");
		expect(lines).not.toContain("docs/");
		overlay.handleInput("\x1b"); // Esc clears the filter instead of closing
		expect(overlay.current).toBe("/home/me/project");
		expect(overlay.renderContent(80).join("\n")).toContain("docs/");
	});

	it("filters by typed text and keeps Backspace for the filter when it has content", () => {
		const { overlay } = build();
		overlay.handleInput("do");
		expect(overlay.renderContent(80).join("\n")).toContain("docs/");
		const shown = overlay.renderContent(80).join("\n");
		expect(shown).not.toContain("src/");
		overlay.handleInput("\x7f"); // deletes the filter character, stays in the same level
		expect(overlay.current).toBe("/home/me/project");
	});

	it("pins the highlighted folder through the source", async () => {
		const { overlay, source: pickerSource } = build();
		overlay.handleInput("\x10"); // Ctrl+P on "Use this folder" pins the current folder
		await pickerSource.togglePin.mock.results.at(-1)?.value;
		expect(pickerSource.togglePin).toHaveBeenCalledWith("/home/me/project");
	});

	it("cancels on Escape", () => {
		const { overlay, options } = build();
		overlay.handleInput("\x1b");
		expect(options.onCancel).toHaveBeenCalledTimes(1);
	});

	it("shows the roots screen with real volumes when no directory is selected", () => {
		const { overlay } = build({
			"/home/me/project": listing({ current: "/home/me/project", parent: null }),
		});
		overlay.handleInput("\x7f"); // backspace from the root of the tree
		expect(overlay.current).toBeNull();
		const lines = overlay.renderContent(80).join("\n");
		expect(lines).toContain("C:");
		expect(lines).toContain("F: Phone");
	});
});
