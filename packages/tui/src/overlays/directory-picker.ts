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
import { SelectList, Text, matchesKey, routeSgrMouseInput, type SelectItem, type SgrMouseEvent } from "../index";
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
}

/** Host filesystem access; synchronous so a repaint never waits on I/O. */
export interface DirectoryPickerSource {
	list(directory: string | null): DirectoryPickerListing;
	/** Persist a pin change; resolves to the new pinned state. */
	togglePin(directory: string): Promise<boolean>;
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
	kind: "use" | "parent" | "pin" | "root" | "dir";
	entry: DirectoryPickerEntry;
}

export class DirectoryPickerOverlay extends OverlayPanel {
	#source: DirectoryPickerSource;
	#options: DirectoryPickerOptions;
	#selectList: SelectList;
	#sheet: SelectListSheet;
	#statusText: Text;
	#rows: Row[] = [];
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
			if (row) {
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
			if (row) this.#resume(row.entry.path);
			return;
		}
		// Backspace moves up only while the filter is empty; otherwise it edits the filter.
		if (matchesKey(data, "backspace") && this.#selectList.getFilter().length === 0) {
			this.#goUp();
			return;
		}
		this.#selectList.handleInput(data);
		this.invalidate();
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
			case "use":
			case "pin":
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
		this.#statusText.setText("");
		this.#rebuild();
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
		this.#closed = true;
		this.#options.onSelect(directory);
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
