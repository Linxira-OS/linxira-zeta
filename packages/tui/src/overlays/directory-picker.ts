/**
 * `/cd` directory picker: a folder-only browser for the current workspace.
 *
 * The picker never shows files. Windows lists its real volumes (internal,
 * removable, network, optical), POSIX lists mount points; both then walk the
 * chosen directory's subdirectories. Pinned paths sit at the top and act
 * immediately: Enter or a click switches the session there, while Ctrl+R
 * (or Ctrl+click) opens the resume picker filtered to that path's
 * conversations.
 *
 * Keys: type to filter (always on), j/k and arrows to move, Enter to open a
 * folder or use the current one, Backspace to go up, Esc to cancel, Ctrl+P to
 * pin/unpin the highlighted folder, Ctrl+R to resume from it. Mouse: wheel
 * scrolls, a click activates the row under the pointer.
 */
import * as path from "node:path";
import {
	SelectList,
	Text,
	extractPrintableText,
	matchesKey,
	routeSgrMouseInput,
	type SelectItem,
	type SgrMouseEvent,
} from "../index";
import { getSelectListTheme, theme } from "../theme/theme";
import { OverlayPanel } from "../chrome/overlay-box";
import { routeSelectListMouseWithTopBorder } from "../chrome/select-list-mouse-routing";
import type { DescribeContext, NativeNode, NativeUiEvent } from "../native/node";
import { SelectListSheet } from "../native/picker";
import { tuiText, tuiTextFmt } from "../i18n";

/** One directory row the picker can show. */
export interface DirectoryPickerEntry {
	/** Row label (a folder name, or a volume label for a root row). */
	name: string;
	/** Absolute path the row stands for. */
	path: string;
	/** Detail line under/next to the label: a volume kind, mount source, or path. */
	detail?: string;
	/** Named icon for the row. */
	icon?: string;
	/** A pin whose directory is missing or no longer accessible. */
	unavailable?: boolean;
}

/** What the picker shows at one level. */
export interface DirectoryPickerListing {
	/** Directory being browsed; `null` on the roots screen (drives / mounts). */
	current: string | null;
	/** Parent directory, or `null` at a filesystem root or the roots screen. */
	parent: string | null;
	/** What the roots screen lists; the title is localized by this component. */
	rootsKind?: "drives" | "mounts";
	/** Volumes or mounts for the roots screen; empty while browsing a directory. */
	roots: DirectoryPickerEntry[];
	/** Pinned directories, always shown first. */
	pins: DirectoryPickerEntry[];
	/** Subdirectories of `current`, folders only. */
	directories: DirectoryPickerEntry[];
	/** Whether `current` itself can become the session directory. */
	selectable: boolean;
	/** Roots are being enumerated in the background. */
	rootsLoading?: boolean;
	/** Roots enumeration failed (user-visible message). */
	rootsError?: string;
	/** The current directory could not be read (user-visible message). */
	error?: string;
}

/** Host filesystem access; synchronous so a repaint never waits on I/O. */
export interface DirectoryPickerSource {
	list(directory: string | null): DirectoryPickerListing;
	/** Persist a pin change; resolves to the new pinned state. */
	togglePin(directory: string): Promise<boolean>;
	/** Reload pins and roots for the explicit refresh action (optional test doubles). */
	refresh?(directory?: string | null, options?: { force?: boolean }): Promise<void>;
}

export interface DirectoryPickerOptions {
	source: DirectoryPickerSource;
	/** Directory that is currently the session workspace. */
	initialPath: string;
	/** Called when the user chooses a directory (Enter, click, or a pin). */
	onSelect: (directory: string) => void;
	/** Secondary action: open resume filtered to this directory's conversations. */
	onResume: (directory: string) => void;
	onCancel: () => void;
	/** Home directory, abbreviated to `~` in breadcrumbs. */
	home?: string;
}

interface Row {
	kind: "use" | "parent" | "pin" | "root" | "dir" | "note";
	entry: DirectoryPickerEntry;
}

export class DirectoryPickerOverlay extends OverlayPanel {
	#source: DirectoryPickerSource;
	#options: DirectoryPickerOptions;
	#selectList: SelectList;
	#sheet: SelectListSheet;
	#statusText: Text;
	#rows: Row[] = [];
	/** True while typed characters filter; j/k move only outside it. */
	#filtering = false;
	#current: string | null;
	#listing: DirectoryPickerListing;
	#closed = false;

	constructor(options: DirectoryPickerOptions) {
		super(tuiText("cdPickerTitle", "Change directory"), "zeta.overlay.cd");
		this.#options = options;
		this.#source = options.source;
		this.#current = options.initialPath;
		this.#listing = this.#source.list(this.#current);

		this.#selectList = new SelectList([], 14, getSelectListTheme(), {
			// Folder browsing is short; typing must filter from the first key.
			search: "always",
		});
		this.#selectList.onSelect = item => this.#activate(Number(item.value));
		this.#selectList.onCancel = () => this.#cancel();
		this.addChild(this.#selectList);
		this.#statusText = new Text("", 1, 0);
		this.addChild(this.#statusText);
		this.#sheet = new SelectListSheet(this.#selectList, {
			title: tuiText("cdPickerTitle", "Change directory"),
			icon: "folderMove",
			noun: "folders",
		});
		this.#rebuild();
		this.#hint();
		// Volumes/mounts are enumerated asynchronously; the overlay is usable
		// immediately and its roots screen fills in when the refresh lands.
		void this.#refresh(true);
	}

	/** Directories listed at the current level (tests and hosts). */
	get listing(): DirectoryPickerListing {
		return this.#listing;
	}

	get current(): string | null {
		return this.#current;
	}

	/** Highlighted row's directory, when the row names one. */
	get highlightedPath(): string | undefined {
		return this.#selectedRow()?.entry.path;
	}

	override describe(cx: DescribeContext): NativeNode | null {
		return cx.supports("picker") ? this.#sheet.describe() : super.describe(cx);
	}

	handleNativeEvent(event: NativeUiEvent): void {
		this.#sheet.handle(event);
	}

	routeMouse(event: SgrMouseEvent, line: number, col: number): void {
		// Ctrl+click is the secondary action on the row under the pointer.
		if (event.leftClick && (event.button & 16) !== 0) {
			const index = this.#selectList.hitTest(line - 1);
			const row = index === undefined ? undefined : this.#rows[index];
			if (row && row.kind !== "note") {
				this.#resume(row.entry.path);
				return;
			}
		}
		routeSelectListMouseWithTopBorder(this.#selectList, event, line, col);
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (routeSgrMouseInput(data, event => this.#handleMouse(event))) return;
		if (matchesKey(data, "ctrl+p")) {
			void this.#togglePin();
			return;
		}
		if (matchesKey(data, "ctrl+r")) {
			const row = this.#selectedRow();
			if (row && row.kind !== "note") this.#resume(row.entry.path);
			return;
		}
		if (this.#filtering) {
			if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
				this.#filtering = false;
				this.#selectList.setFilter("");
				this.#hint();
				return;
			}
			if (matchesKey(data, "backspace") && this.#selectList.getFilter().length === 0) {
				this.#filtering = false;
				this.#goUp();
				return;
			}
			this.#selectList.handleInput(data);
			this.invalidate();
			return;
		}
		// Navigation mode: vim keys move, and typing starts a filter. `/` starts one
		// explicitly, which is how a filter may begin with `j` or `k`. `r` refreshes
		// the level outside a filter, so a failed/empty listing can be retried.
		if (matchesKey(data, "r")) {
			void this.#refresh(false);
			return;
		}
		if (matchesKey(data, "j")) {
			this.#selectList.handleInput("\x1b[B");
			this.invalidate();
			return;
		}
		if (matchesKey(data, "k")) {
			this.#selectList.handleInput("\x1b[A");
			this.invalidate();
			return;
		}
		if (matchesKey(data, "/")) {
			this.#filtering = true;
			this.#selectList.setFilter("");
			this.#hint();
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.#goUp();
			return;
		}
		if (extractPrintableText(data) !== undefined) this.#filtering = true;
		this.#hint();
		this.#selectList.handleInput(data);
		this.invalidate();
	}

	/** Footer line: the mode-specific key hints. */
	#hint(): void {
		this.#statusText.setText(
			theme.fg(
				"dim",
				this.#filtering
					? tuiText("cdPickerFilterHint", "type to filter · Enter open · Esc clear filter")
					: tuiText(
							"cdPickerNavHint",
							"j/k move · type or / to filter · Enter open · ⌫ up · r refresh · Ctrl+P pin · Ctrl+R resume",
						),
			),
		);
	}

	#handleMouse(event: SgrMouseEvent): boolean {
		this.routeMouse(event, event.row, event.col);
		return true;
	}

	#selectedRow(): Row | undefined {
		const selected = this.#selectList.pickerView().selected;
		if (selected === null) return undefined;
		return this.#rows[Number(selected)];
	}

	#title(): string {
		if (this.#current === null) {
			return this.#listing.rootsKind === "mounts"
				? tuiText("cdPickerMounts", "Mounts")
				: tuiText("cdPickerDrives", "This PC");
		}
		return this.#abbreviate(this.#current);
	}

	#abbreviate(directory: string): string {
		const home = this.#options.home;
		if (!home) return directory;
		const normalizedHome = path.resolve(home);
		const normalized = path.resolve(directory);
		if (normalized === normalizedHome) return "~";
		if (normalized.startsWith(`${normalizedHome}${path.sep}`)) return `~${normalized.slice(normalizedHome.length)}`;
		return normalized;
	}

	#rebuild(): void {
		this.#listing = this.#source.list(this.#current);
		const rows: Row[] = [];
		const items: SelectItem[] = [];
		const push = (row: Row, item: Omit<SelectItem, "value">) => {
			items.push({ ...item, value: String(rows.length) });
			rows.push(row);
		};

		if (this.#current !== null && this.#listing.selectable) {
			push(
				{ kind: "use", entry: { name: this.#title(), path: this.#current } },
				{
					label: tuiText("cdPickerUseThisFolder", "Use this folder"),
					description: this.#title(),
				},
			);
		}
		if (this.#listing.parent) {
			push(
				{ kind: "parent", entry: { name: "..", path: this.#listing.parent } },
				{ label: "..", description: this.#abbreviate(this.#listing.parent) },
			);
		}
		for (const pin of this.#listing.pins) {
			push(
				{ kind: "pin", entry: pin },
				{
					label: pin.name,
					description: pin.detail ?? this.#abbreviate(pin.path),
					state: tuiText("cdPickerPinned", "pin"),
				},
			);
		}
		for (const root of this.#listing.roots) {
			push(
				{ kind: "root", entry: root },
				{
					label: root.name,
					description: root.detail,
				},
			);
		}
		for (const directory of this.#listing.directories) {
			push({ kind: "dir", entry: directory }, { label: `${directory.name}/`, description: directory.detail });
		}
		const pushNote = (label: string, description: string) =>
			push(
				{ kind: "note", entry: { name: label, path: "" } },
				{ label, description, disabled: true },
			);
		const retry = tuiText("cdPickerRetryHint", "press r to retry");
		if (this.#current === null) {
			if (this.#listing.rootsLoading) {
				pushNote(tuiText("cdPickerRootsLoading", "Loading volumes…"), retry);
			} else if (this.#listing.rootsError) {
				pushNote(
					tuiTextFmt("cdPickerRootsErrorFmt", "Cannot list volumes: %s", this.#listing.rootsError),
					retry,
				);
			} else if (this.#listing.roots.length === 0 && this.#listing.pins.length === 0) {
				pushNote(tuiText("cdPickerRootsEmpty", "No volumes found"), retry);
			}
		} else if (this.#listing.error) {
			pushNote(
				tuiTextFmt("cdPickerUnreadableFmt", "Cannot read this folder: %s", this.#listing.error),
				retry,
			);
		} else if (this.#listing.directories.length === 0) {
			pushNote(tuiText("cdPickerEmptyFolder", "This folder is empty"), retry);
		}

		this.#rows = rows;
		this.#selectList.setItems(items);
		this.#selectList.setSelectedIndex(0);
		// Keep the overlay's own chrome in sync with the level being shown.
		this.title = `${tuiText("cdPickerTitle", "Change directory")}  ${this.#title()}`;
		this.invalidate();
	}

	#activate(index: number): void {
		const row = this.#rows[index];
		if (!row) return;
		switch (row.kind) {
			case "note":
				return;
			case "use":
				this.#select(row.entry.path);
				return;
			case "pin":
				if (row.entry.unavailable) {
					this.#statusText.setText(
						theme.fg(
							"error",
							tuiTextFmt(
								"cdPickerUnavailableFmt",
								"Unavailable: %s · Ctrl+P to unpin",
								row.entry.path,
							),
						),
					);
					this.invalidate();
					return;
				}
				// A pin acts immediately: choosing it switches the workspace.
				this.#select(row.entry.path);
				return;
			case "parent":
			case "root":
			case "dir":
				this.#navigate(row.entry.path);
				return;
		}
	}

	#navigate(directory: string | null): void {
		this.#current = directory;
		this.#filtering = false;
		this.#selectList.setFilter("");
		this.#rebuild();
		this.#hint();
	}

	#goUp(): void {
		if (this.#listing.parent) {
			this.#navigate(this.#listing.parent);
			return;
		}
		if (this.#current !== null) this.#navigate(null);
	}

	#select(directory: string): void {
		if (this.#closed) return;
		const target = path.resolve(directory);
		const initial = path.resolve(this.#options.initialPath);
		const alreadyHere =
			process.platform === "win32" ? target.toLowerCase() === initial.toLowerCase() : target === initial;
		if (alreadyHere) {
			this.#statusText.setText(
				theme.fg("dim", tuiTextFmt("cdPickerAlreadyHereFmt", "Already in %s", this.#abbreviate(directory))),
			);
			this.invalidate();
			return;
		}
		this.#closed = true;
		this.#options.onSelect(directory);
	}

	async #refresh(background: boolean): Promise<void> {
		const refresh = this.#source.refresh;
		if (!refresh) return;
		const selectedPath = this.#selectedRow()?.entry.path;
		const filter = this.#selectList.getFilter();
		const filtering = this.#filtering;
		if (!background) this.#statusText.setText(theme.fg("dim", tuiText("cdPickerRefreshing", "Refreshing…")));
		try {
			await refresh.call(this.#source, this.#current, { force: !background });
			if (this.#closed) return;
			this.#rebuild();
			this.#restoreAfterRefresh(selectedPath, filter, filtering);
			if (!background) {
				this.#statusText.setText(theme.fg("dim", tuiText("cdPickerRefreshed", "Refreshed")));
				this.invalidate();
			}
		} catch (error) {
			if (this.#closed) return;
			this.#statusText.setText(theme.fg("error", String(error instanceof Error ? error.message : error)));
			this.#rebuild();
			this.#restoreAfterRefresh(selectedPath, filter, filtering);
		}
	}

	#restoreAfterRefresh(selectedPath: string | undefined, filter: string, filtering: boolean): void {
		if (filter) this.#selectList.setFilter(filter);
		this.#filtering = filtering;
		if (selectedPath) {
			const index = this.#rows.findIndex(row => row.entry.path === selectedPath);
			if (index >= 0) this.#selectList.setSelectedIndex(index);
		}
	}

	#resume(directory: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#options.onResume(directory);
	}

	#cancel(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#options.onCancel();
	}

	async #togglePin(): Promise<void> {
		const row = this.#selectedRow();
		const directory = row?.entry.path ?? this.#current;
		if (!directory) return;
		try {
			const pinned = await this.#source.togglePin(directory);
			this.#statusText.setText(
				theme.fg(
					"dim",
					pinned
						? tuiTextFmt("cdPickerPinnedFmt", "Pinned %s", directory)
						: tuiTextFmt("cdPickerUnpinnedFmt", "Unpinned %s", directory),
				),
			);
		} catch (error) {
			this.#statusText.setText(theme.fg("error", String(error instanceof Error ? error.message : error)));
		}
		this.#rebuild();
	}
}
