/**
 * `/cd` directory picker view model: a folder-only browser for the current
 * workspace.
 *
 * The picker never shows files. Windows lists its real volumes (internal,
 * removable, network, optical), POSIX lists mount points; both then walk the
 * chosen directory's subdirectories. Pinned paths sit at the top and act
 * immediately: choosing one switches the session there, while Ctrl+R (or a
 * Ctrl+click) opens the resume picker filtered to that path's conversations.
 *
 * Rendering, key decoding and mouse routing live in the host UI; this module
 * owns the listing, the visible rows, the filter and the refresh state.
 */
import * as path from "node:path";
import { tuiText, tuiTextFmt } from "@linxiraos/pi-tui";

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
	/** Called after the visible rows change; a reactive host re-renders from its own effect instead. */
	onChange?: () => void;
}

export type DirectoryPickerRowKind = "use" | "parent" | "pin" | "root" | "dir" | "note";

/** One rendered row: what activating it does, and its picker item fields. */
export interface DirectoryPickerRow {
	readonly kind: DirectoryPickerRowKind;
	readonly entry: DirectoryPickerEntry;
	readonly label: string;
	readonly description?: string;
	readonly disabled?: boolean;
	readonly state?: string;
}

/** `~`-relative form of `directory` for breadcrumbs and details. */
export function abbreviateDirectory(directory: string, home?: string): string {
	if (!home) return directory;
	const normalizedHome = path.resolve(home);
	const normalized = path.resolve(directory);
	if (normalized === normalizedHome) return "~";
	if (normalized.startsWith(`${normalizedHome}${path.sep}`)) return `~${normalized.slice(normalizedHome.length)}`;
	return normalized;
}

/** Heading of the level being browsed: a drive/mounts title, or the abbreviated path. */
export function directoryPickerTitle(current: string | null, listing: DirectoryPickerListing, home?: string): string {
	if (current === null) {
		return listing.rootsKind === "mounts"
			? tuiText("cdPickerMounts", "Mounts")
			: tuiText("cdPickerDrives", "This PC");
	}
	return abbreviateDirectory(current, home);
}

/**
 * The visible rows of one listing: "use this folder", the parent, pins, roots
 * and subdirectories, then a disabled note when the level has nothing else.
 */
export function buildDirectoryPickerRows(
	listing: DirectoryPickerListing,
	current: string | null,
	home?: string,
): DirectoryPickerRow[] {
	const rows: DirectoryPickerRow[] = [];
	const title = directoryPickerTitle(current, listing, home);
	if (current !== null && listing.selectable) {
		rows.push({
			kind: "use",
			entry: { name: title, path: current },
			label: tuiText("cdPickerUseThisFolder", "Use this folder"),
			description: title,
		});
	}
	if (listing.parent) {
		rows.push({
			kind: "parent",
			entry: { name: "..", path: listing.parent },
			label: "..",
			description: abbreviateDirectory(listing.parent, home),
		});
	}
	for (const pin of listing.pins) {
		rows.push({
			kind: "pin",
			entry: pin,
			label: pin.name,
			description: pin.detail ?? abbreviateDirectory(pin.path, home),
			state: tuiText("cdPickerPinned", "pin"),
		});
	}
	for (const root of listing.roots) {
		rows.push({ kind: "root", entry: root, label: root.name, description: root.detail });
	}
	for (const directory of listing.directories) {
		rows.push({ kind: "dir", entry: directory, label: `${directory.name}/`, description: directory.detail });
	}
	const note = (label: string, description: string): void => {
		rows.push({
			kind: "note",
			entry: { name: label, path: "" },
			label,
			description,
			disabled: true,
		});
	};
	const retry = tuiText("cdPickerRetryHint", "press r to retry");
	if (current === null) {
		if (listing.rootsLoading) note(tuiText("cdPickerRootsLoading", "Loading volumes…"), retry);
		else if (listing.rootsError)
			note(tuiTextFmt("cdPickerRootsErrorFmt", "Cannot list volumes: %s", listing.rootsError), retry);
		else if (listing.roots.length === 0 && listing.pins.length === 0)
			note(tuiText("cdPickerRootsEmpty", "No volumes found"), retry);
	} else if (listing.error) {
		note(tuiTextFmt("cdPickerUnreadableFmt", "Cannot read this folder: %s", listing.error), retry);
	} else if (listing.directories.length === 0) {
		note(tuiText("cdPickerEmptyFolder", "This folder is empty"), retry);
	}
	return rows;
}

/** Listing, visible rows, filter and refresh state of the directory picker. */
export class DirectoryPickerModel {
	readonly #options: DirectoryPickerOptions;
	#current: string | null;
	#listing: DirectoryPickerListing;
	#rows: DirectoryPickerRow[] = [];
	#selectedIndex = 0;
	#filter = "";
	#filtering = false;
	#statusText = "";
	#refreshing = false;
	#closed = false;

	constructor(options: DirectoryPickerOptions) {
		this.#options = options;
		this.#current = options.initialPath;
		this.#listing = options.source.list(this.#current);
		this.#rebuild();
		// Volumes/mounts are enumerated asynchronously; the overlay is usable
		// immediately and its roots screen fills in when the refresh lands.
		void this.refresh(true);
	}

	/** Directories listed at the current level (tests and hosts). */
	get listing(): DirectoryPickerListing {
		return this.#listing;
	}
	get current(): string | null {
		return this.#current;
	}
	get rows(): readonly DirectoryPickerRow[] {
		return this.#rows;
	}
	get selectedIndex(): number {
		return this.#selectedIndex;
	}
	get selectedRow(): DirectoryPickerRow | undefined {
		return this.#rows[this.#selectedIndex];
	}
	/** Highlighted row's directory, when the row names one. */
	get highlightedPath(): string | undefined {
		return this.selectedRow?.entry.path;
	}
	get filter(): string {
		return this.#filter;
	}
	get filtering(): boolean {
		return this.#filtering;
	}
	/** Plain status line under the list (already localized; no styling). */
	get statusText(): string {
		return this.#statusText;
	}
	get refreshing(): boolean {
		return this.#refreshing;
	}
	get closed(): boolean {
		return this.#closed;
	}
	get title(): string {
		return directoryPickerTitle(this.#current, this.#listing, this.#options.home);
	}

	/** Move the highlighted row by `delta`, clamped to the list. */
	move(delta: number): void {
		if (this.#rows.length === 0) return;
		this.#selectedIndex = Math.max(0, Math.min(this.#rows.length - 1, this.#selectedIndex + delta));
		this.#requestRender();
	}

	/** Turn typed filtering on, optionally starting from `query`. */
	startFiltering(query = ""): void {
		this.#filtering = true;
		this.setFilter(query);
	}

	/** Replace the filter text; the host decides how rows are filtered for display. */
	setFilter(query: string): void {
		this.#filter = query;
		this.#selectedIndex = 0;
		this.#requestRender();
	}

	/** Escape while filtering: keep the level, drop the query. */
	cancelFiltering(): void {
		this.#filtering = false;
		this.setFilter("");
	}

	/** Enter on row `index` (default: the highlighted row). Closed after a choice. */
	activate(index = this.#selectedIndex): void {
		const row = this.#rows[index];
		if (!row || row.kind === "note") return;
		switch (row.kind) {
			case "use":
			case "pin":
				this.select(row.entry.path);
				return;
			case "parent":
			case "root":
			case "dir":
				this.navigate(row.entry.path);
				return;
		}
	}

	/** Switch the session to `directory`; does nothing when it is already the workspace. */
	select(directory: string): void {
		if (this.#closed) return;
		const target = path.resolve(directory);
		const initial = path.resolve(this.#options.initialPath);
		const alreadyHere =
			process.platform === "win32" ? target.toLowerCase() === initial.toLowerCase() : target === initial;
		if (alreadyHere) {
			this.#statusText = tuiTextFmt(
				"cdPickerAlreadyHereFmt",
				"Already in %s",
				abbreviateDirectory(directory, this.#options.home),
			);
			this.#requestRender();
			return;
		}
		this.#closed = true;
		this.#options.onSelect(directory);
	}

	/** Ctrl+R: resume from `directory`'s conversations. */
	resume(directory: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#options.onResume(directory);
	}

	/** Escape: close without choosing. */
	cancel(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#options.onCancel();
	}

	/** Enter a directory level (`null`: the roots screen). */
	navigate(directory: string | null): void {
		this.#current = directory;
		this.#filtering = false;
		this.#filter = "";
		this.#selectedIndex = 0;
		this.#rebuild();
	}

	/** Backspace: parent directory, then the roots screen. */
	goUp(): void {
		if (this.#listing.parent) {
			this.navigate(this.#listing.parent);
			return;
		}
		if (this.#current !== null) this.navigate(null);
	}

	/** Pin or unpin the highlighted row's directory (or the current one). */
	async togglePin(): Promise<void> {
		const directory = this.selectedRow?.entry.path || this.#current;
		if (!directory) return;
		try {
			const pinned = await this.#options.source.togglePin(directory);
			this.#statusText = pinned
				? tuiTextFmt("cdPickerPinnedFmt", "Pinned %s", directory)
				: tuiTextFmt("cdPickerUnpinnedFmt", "Unpinned %s", directory);
		} catch (error) {
			this.#statusText = String(error instanceof Error ? error.message : error);
		}
		this.#rebuild();
	}

	/** Reload pins and roots (and the current level unless `background`). */
	async refresh(background: boolean): Promise<void> {
		const refresh = this.#options.source.refresh;
		if (!refresh || this.#refreshing) return;
		const selectedPath = this.selectedRow?.entry.path;
		const filter = this.#filter;
		const filtering = this.#filtering;
		this.#refreshing = true;
		if (!background) this.#statusText = tuiText("cdPickerRefreshing", "Refreshing…");
		this.#requestRender();
		try {
			await refresh.call(this.#options.source, this.#current, { force: !background });
			if (this.#closed) return;
			this.#rebuild();
			this.#restoreAfterRefresh(selectedPath, filter, filtering);
			if (!background) this.#statusText = tuiText("cdPickerRefreshed", "Refreshed");
		} catch (error) {
			if (this.#closed) return;
			this.#statusText = String(error instanceof Error ? error.message : error);
			this.#rebuild();
			this.#restoreAfterRefresh(selectedPath, filter, filtering);
		} finally {
			this.#refreshing = false;
			this.#requestRender();
		}
	}

	#restoreAfterRefresh(selectedPath: string | undefined, filter: string, filtering: boolean): void {
		this.#filter = filter;
		this.#filtering = filtering;
		if (selectedPath) {
			const index = this.#rows.findIndex(row => row.entry.path === selectedPath);
			if (index >= 0) this.#selectedIndex = index;
		}
		this.#requestRender();
	}

	#rebuild(): void {
		this.#listing = this.#options.source.list(this.#current);
		this.#rows = buildDirectoryPickerRows(this.#listing, this.#current, this.#options.home);
		this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, this.#rows.length - 1));
		this.#requestRender();
	}

	#requestRender(): void {
		if (!this.#closed) this.#options.onChange?.();
	}
}
