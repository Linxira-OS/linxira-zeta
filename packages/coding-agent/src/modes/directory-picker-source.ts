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
import * as path from "node:path";
import type {
	DirectoryPickerEntry,
	DirectoryPickerListing,
	DirectoryPickerSource,
} from "@linxiraos/pi-tui/overlays/directory-picker";
import {
	type DriveInfo,
	type MountInfo,
	listChildDirectories,
	listLinuxMounts,
	listWindowsDrives,
	parentDirectory,
	volumeKindLabel,
} from "../utils/directory-listing";
import { loadDirectoryPins, toggleDirectoryPin } from "./directory-pins";

export interface DirectoryPickerSourceOptions {
	/** Platform to build the roots screen for; defaults to the process platform. */
	platform?: NodeJS.Platform;
	/** Pinned directories, most recent first. */
	pins?: readonly string[];
	/** Pre-fetched volumes (tests); defaults to the live Win32 query. */
	drives?: readonly DriveInfo[];
	/** Pre-fetched mounts (tests); defaults to `/proc/mounts`. */
	mounts?: readonly MountInfo[];
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

function pinEntry(pin: string): DirectoryPickerEntry {
	return { name: path.basename(pin) || pin, path: pin, detail: pin };
}

/**
 * Build the picker's synchronous source. `pins` is read once here; a pin toggle
 * updates the internal list and the file, so the picker can rebuild immediately
 * without another async load.
 */
export function createDirectoryPickerSource(options: DirectoryPickerSourceOptions = {}): DirectoryPickerSource {
	const platform = options.platform ?? process.platform;
	const pins = [...(options.pins ?? [])];

	const rootsFor = (): DirectoryPickerEntry[] => {
		if (platform === "win32") {
			return (options.drives ?? listWindowsDrives()).map(driveEntry);
		}
		return (options.mounts ?? listLinuxMounts()).map(mountEntry);
	};

	return {
		list(directory: string | null): DirectoryPickerListing {
			const pinEntries = pins.map(pinEntry);
			if (directory === null) {
				return {
					current: null,
					parent: null,
					rootsKind: platform === "win32" ? "drives" : "mounts",
					roots: rootsFor(),
					pins: pinEntries,
					directories: [],
					selectable: false,
				};
			}
			return {
				current: directory,
				parent: parentDirectory(directory),
				pins: pinEntries,
				roots: [],
				directories: listChildDirectories(directory).map(child => ({ name: child.name, path: child.path })),
				selectable: true,
			};
		},
		async togglePin(directory: string): Promise<boolean> {
			const pinned = await toggleDirectoryPin(directory);
			const index = pins.indexOf(directory);
			if (pinned && index === -1) pins.unshift(directory);
			if (!pinned && index !== -1) pins.splice(index, 1);
			return pinned;
		},
	};
}

/** Load persisted pins and build a live picker source. */
export async function loadDirectoryPickerSource(
	options: Omit<DirectoryPickerSourceOptions, "pins"> = {},
): Promise<DirectoryPickerSource> {
	return createDirectoryPickerSource({ ...options, pins: await loadDirectoryPins() });
}
