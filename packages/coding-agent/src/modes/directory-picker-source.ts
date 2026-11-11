/**
 * `/cd` picker source: the filesystem view behind {@link DirectoryPickerOverlay}.
 *
 * Windows exposes the volumes the system reports (`Win32_LogicalDisk`): internal,
 * removable, network and optical are labelled apart, and A:/B: appear only when
 * they exist. POSIX exposes mount points from `/proc/mounts` instead of drive
 * letters; removable and media mounts are marked external. Inside a level, rows
 * are folders only — the picker never offers a file.
 *
 * Pins live in `<agent dir>/directory-pins.json` (see `directory-pins.ts`), so a
 * pin made here survives restarts and never writes into the home directory.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type {
	DirectoryPickerEntry,
	DirectoryPickerListing,
	DirectoryPickerSource,
} from "@linxiraos/pi-tui/overlays/directory-picker";
import {
	type DriveInfo,
	type MountInfo,
	invalidateDirectoryListing,
	listChildDirectories,
	parentDirectory,
	refreshLinuxMounts,
	refreshWindowsDrives,
	volumeKindLabel,
} from "../utils/directory-listing";
import {
	canonicalDirectoryPin,
	directoryPinKey,
	loadDirectoryPins,
	toggleDirectoryPin,
} from "./directory-pins";

export interface DirectoryPickerSourceOptions {
	/** Platform to build the roots screen for; defaults to the process platform. */
	platform?: NodeJS.Platform;
	/** Pinned directories, most recent first. */
	pins?: readonly string[];
	/** Pre-fetched volumes (tests); defaults to the live Win32 query. */
	drives?: readonly DriveInfo[];
	/** Pre-fetched mounts (tests); defaults to `/proc/mounts`. */
	mounts?: readonly MountInfo[];
	/** Pre-validated pin directories that should render as unavailable. */
	unavailablePins?: readonly string[];
}

/** `~` for the home directory, and `~/sub` beneath it. */
export function abbreviateHome(directory: string, home: string): string {
	const normalizedHome = path.resolve(home);
	const normalized = path.resolve(directory);
	if (normalized === normalizedHome) return "~";
	if (normalized.startsWith(`${normalizedHome}${path.sep}`)) return `~${normalized.slice(normalizedHome.length)}`;
	return normalized;
}

/** `C:\` → `C:`, `C:\Users\me` → `C:` for the roots-screen-style detail column. */
function volumeRootOf(directory: string): string {
	const parsed = path.parse(directory);
	return parsed.root ? parsed.root.replace(/[\\/]+$/, "") : directory;
}

function driveEntry(drive: DriveInfo): DirectoryPickerEntry {
	const kind = volumeKindLabel(drive.kind);
	return {
		name: drive.label ? `${drive.path.replace(/[\\/]+$/, "")}  ${drive.label}` : volumeRootOf(drive.path),
		path: drive.path,
		detail: drive.label ? `${kind} · ${drive.label}` : kind,
	};
}

function mountEntry(mount: MountInfo): DirectoryPickerEntry {
	const scope = mount.external ? " · external" : "";
	return {
		name: mount.path,
		path: mount.path,
		detail: `${mount.source} · ${mount.fstype}${scope}`,
	};
}

function pinEntry(pin: string, unavailable: boolean): DirectoryPickerEntry {
	return {
		name: path.basename(pin) || pin,
		path: pin,
		detail: unavailable ? `${pin} · unavailable` : pin,
		...(unavailable ? { unavailable: true } : {}),
	};
}

/**
 * Build the picker's synchronous source. Pins and roots are read once here;
 * {@link DirectoryPickerSource.refresh} reloads both (the overlay runs it in
 * the background on open and on the explicit `r` action), so a pin toggle or a
 * newly attached volume is visible without rebuilding the source.
 */
export function createDirectoryPickerSource(options: DirectoryPickerSourceOptions = {}): DirectoryPickerSource {
	const platform = options.platform ?? process.platform;
	let pins = options.pins ? [...options.pins] : [];
	const unavailable = new Set((options.unavailablePins ?? []).map(directoryPinKey));
	let drives = options.drives ? [...options.drives] : undefined;
	let mounts = options.mounts ? [...options.mounts] : undefined;
	const fixedRoots = options.drives !== undefined || options.mounts !== undefined;
	let rootsLoading = !fixedRoots;
	let rootsError: string | undefined;
	let refreshing: Promise<void> | undefined;

	const rootsFor = (): DirectoryPickerEntry[] => {
		if (platform === "win32") return (drives ?? []).map(driveEntry);
		return (mounts ?? []).map(mountEntry);
	};

	const replacePins = (next: readonly string[]) => {
		pins = [];
		const seen = new Set<string>();
		for (const pin of next) {
			const canonical = canonicalDirectoryPin(pin);
			const key = directoryPinKey(canonical);
			if (seen.has(key)) continue;
			seen.add(key);
			pins.push(canonical);
		}
	};

	const pinEntries = (): DirectoryPickerEntry[] =>
		pins.map(pin => pinEntry(pin, unavailable.has(directoryPinKey(pin))));

	const loadRoots = async (): Promise<void> => {
		if (fixedRoots) return;
		if (platform === "win32") {
			drives = await refreshWindowsDrives();
			return;
		}
		mounts = await refreshLinuxMounts();
	};

	const refresh = async (directory?: string | null): Promise<void> => {
		if (refreshing) {
			await refreshing;
			return;
		}
		rootsLoading = true;
		rootsError = undefined;
		refreshing = (async () => {
			try {
				replacePins(await loadDirectoryPins());
				const checked = await Promise.all(
					pins.map(async pin => {
						try {
							return (await fs.promises.stat(pin)).isDirectory() ? null : pin;
						} catch {
							return pin;
						}
					}),
				);
				unavailable.clear();
				for (const pin of checked) {
					if (pin !== null) unavailable.add(directoryPinKey(pin));
				}
			} catch {
				// A pins read failure leaves the last known pins in place.
			}
			try {
				await loadRoots();
			} catch (error) {
				rootsError = error instanceof Error ? error.message : String(error);
			} finally {
				rootsLoading = false;
			}
			if (directory) invalidateDirectoryListing(directory);
		})().finally(() => {
			refreshing = undefined;
		});
		await refreshing;
	};

	return {
		list(directory: string | null): DirectoryPickerListing {
			const pinsHere = pinEntries();
			if (directory === null) {
				return {
					current: null,
					parent: null,
					rootsKind: platform === "win32" ? "drives" : "mounts",
					roots: rootsFor(),
					pins: pinsHere,
					directories: [],
					selectable: false,
					rootsLoading,
					...(rootsError ? { rootsError } : {}),
				};
			}
			let error: string | undefined;
			const directories = listChildDirectories(directory, {
				onError: caught => {
					error = caught instanceof Error ? caught.message : String(caught);
				},
			});
			return {
				current: directory,
				parent: parentDirectory(directory),
				pins: pinsHere,
				roots: [],
				directories: directories.map(child => ({ name: child.name, path: child.path })),
				selectable: true,
				...(error ? { error } : {}),
			};
		},
		async togglePin(directory: string): Promise<boolean> {
			const pinned = await toggleDirectoryPin(directory);
			const canonical = canonicalDirectoryPin(directory);
			const key = directoryPinKey(canonical);
			replacePins(pins.filter(pin => directoryPinKey(pin) !== key));
			if (pinned) {
				pins.unshift(canonical);
				unavailable.delete(key);
			} else {
				unavailable.delete(key);
			}
			return pinned;
		},
		refresh,
	};
}

/** Load persisted pins and build a live picker source. */
export async function loadDirectoryPickerSource(
	options: Omit<DirectoryPickerSourceOptions, "pins"> = {},
): Promise<DirectoryPickerSource> {
	return createDirectoryPickerSource({ ...options, pins: await loadDirectoryPins() });
}
