/**
 * Filesystem primitives for the `/cd` directory picker.
 *
 * Folders only: a picker row is always a directory, never a file. Windows shows
 * the volumes the system actually has (Win32 drive type + volume label, so a
 * phone or a CD is distinguishable from an internal disk); POSIX shows mount
 * points read from `/proc/mounts`, with the removable/media mounts marked.
 *
 * Both enumerations are cached with a short TTL, not for the process lifetime:
 * media can be inserted after the first picker open, and the picker offers an
 * explicit refresh. Roots are enumerated asynchronously so opening the picker
 * never waits on a PowerShell round trip. Every function takes its platform
 * inputs as optional arguments so tests can drive `win32` shapes on any host.
 */
import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** A directory the picker can show or enter. */
export interface PickerDirectory {
	/** Base name, or the volume/mount label for a root row. */
	name: string;
	/** Absolute path. */
	path: string;
}

/** How a Windows volume or POSIX mount behaves, for grouping in the picker. */
export type VolumeKind = "fixed" | "removable" | "network" | "cdrom" | "ram" | "unknown";

/** A Windows drive as reported by Win32_LogicalDisk. */
export interface DriveInfo extends PickerDirectory {
	kind: VolumeKind;
	/** Volume label, when the system reports one. */
	label?: string;
}

/** A POSIX mount point from `/proc/mounts`. */
export interface MountInfo extends PickerDirectory {
	/** Device or remote source (`/dev/sdb1`, `server:/export`). */
	source: string;
	/** Filesystem type (`ext4`, `vfat`, `nfs4`, …). */
	fstype: string;
	/** Mounts under the media/mnt trees, or media filesystems: shown as external. */
	external: boolean;
}

const DIR_CACHE_TTL_MS = 500;
const ROOTS_CACHE_TTL_MS = 30_000;
const dirCache = new Map<string, { time: number; entries: PickerDirectory[] }>();

/**
 * `Dirent.isDirectory()` reports the entry type, not the link target, so a
 * `statSync` fallback is needed for symlinks that point at a directory. Some
 * filesystems (NFS, FUSE, older SMB) report `UV_DIRENT_UNKNOWN` — every `isX()`
 * returns false — so those entries also stat rather than disappear.
 */
export function entryIsDirectory(dir: string, entry: fs.Dirent): boolean {
	if (entry.isDirectory()) return true;
	if (entry.isFile() || entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) {
		return false;
	}
	try {
		return fs.statSync(path.join(dir, entry.name)).isDirectory();
	} catch {
		return false;
	}
}

/** Subdirectories of `directory`, sorted by name; files are never returned. */
export function listChildDirectories(
	directory: string,
	options: {
		includeHidden?: boolean;
		max?: number;
		/** Called once when this call had to read the directory and it failed. */
		onError?: (error: unknown) => void;
	} = {},
): PickerDirectory[] {
	const max = options.max ?? Number.POSITIVE_INFINITY;
	const now = Date.now();
	const cached = dirCache.get(directory);
	if (!cached || now - cached.time >= DIR_CACHE_TTL_MS) {
		let dirents: fs.Dirent[] = [];
		try {
			dirents = fs.readdirSync(directory, { withFileTypes: true });
		} catch (error) {
			options.onError?.(error);
			dirents = [];
		}
		const entries = dirents
			.filter(entry => entryIsDirectory(directory, entry))
			.map(entry => ({ name: entry.name, path: path.join(directory, entry.name) }))
			// readdir order is filesystem-dependent (creation order on ext4); the
			// picker's rows must not reorder between machines.
			.sort((left, right) => left.name.localeCompare(right.name));
		dirCache.set(directory, { time: now, entries });
	}
	// Hidden filtering happens per call so one cache serves both views.
	const items = (dirCache.get(directory)?.entries ?? []).filter(
		entry => options.includeHidden !== false || !entry.name.startsWith("."),
	);
	return items.length > max ? items.slice(0, max) : items;
}

/** Forget a directory's cached listing (a picker refresh after the tree changed). */
export function invalidateDirectoryListing(directory: string): void {
	dirCache.delete(directory);
}

/** Drop every cached listing. */
export function clearDirectoryListingCache(): void {
	dirCache.clear();
}

/** Parent directory of `directory`, or `null` at a filesystem root. */
export function parentDirectory(directory: string): string | null {
	const normalized = path.normalize(directory);
	const parent = path.dirname(normalized);
	return parent === normalized ? null : parent;
}

/** Win32 `DriveType` → {@link VolumeKind}. */
export function driveKindOf(driveType: number): VolumeKind {
	switch (driveType) {
		case 2:
			return "removable";
		case 3:
			return "fixed";
		case 4:
			return "network";
		case 5:
			return "cdrom";
		case 6:
			return "ram";
		default:
			return "unknown";
	}
}

/**
 * Parse `Get-CimInstance Win32_LogicalDisk | Select DeviceID,DriveType,VolumeName`
 * piped through `ConvertTo-Json -Compress`. A single volume serializes as one
 * object, several as an array; A:/B: appear only when the system reports them.
 */
export function parseWindowsLogicalDisks(json: string): DriveInfo[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json.trim() || "null");
	} catch {
		return [];
	}
	const records = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
	const drives: DriveInfo[] = [];
	for (const record of records) {
		if (!record || typeof record !== "object") continue;
		const fields = record as Record<string, unknown>;
		const deviceId = typeof fields.DeviceID === "string" ? fields.DeviceID.toUpperCase() : "";
		if (!/^[A-Z]:$/.test(deviceId)) continue;
		const label = typeof fields.VolumeName === "string" ? fields.VolumeName.trim() : "";
		const root = `${deviceId}\\`;
		drives.push({
			name: label ? `${deviceId} ${label}` : deviceId,
			path: root,
			kind: driveKindOf(typeof fields.DriveType === "number" ? fields.DriveType : 0),
			label: label || undefined,
		});
	}
	// A: before C:, and every letter in between in order.
	return drives.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Win32_LogicalDisk query used by {@link listWindowsDrives}. The console is put
 * on UTF-8 first: a volume label on a non-English Windows is written in the
 * OEM code page otherwise, and reading that as UTF-8 mangles it.
 */
export const WINDOWS_DRIVE_QUERY =
	"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
	"Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName | ConvertTo-Json -Compress";

let windowsDrivesCache: { time: number; drives: DriveInfo[] } | undefined;

function freshWindowsDrives(): DriveInfo[] | undefined {
	if (!windowsDrivesCache || Date.now() - windowsDrivesCache.time >= ROOTS_CACHE_TTL_MS) return undefined;
	return windowsDrivesCache.drives;
}

function windowsDriveProbeSync(): DriveInfo[] {
	const drives: DriveInfo[] = [];
	for (let code = 65; code <= 90; code++) {
		const letter = String.fromCharCode(code);
		const root = `${letter}:\\`;
		try {
			if (fs.existsSync(root)) drives.push({ name: root, path: root, kind: "unknown" });
		} catch {
			// unreadable drive: not a picker row
		}
	}
	return drives;
}

async function windowsDriveProbe(): Promise<DriveInfo[]> {
	const probes = await Promise.all(
		Array.from({ length: 26 }, async (_entry, index): Promise<DriveInfo | undefined> => {
			const letter = String.fromCharCode(65 + index);
			const root = `${letter}:\\`;
			try {
				return (await fs.promises.stat(root)).isDirectory()
					? { name: root, path: root, kind: "unknown" }
					: undefined;
			} catch {
				return undefined;
			}
		}),
	);
	return probes.filter((drive): drive is DriveInfo => drive !== undefined);
}

function parseDriveQuery(output: string | null | undefined): DriveInfo[] {
	const drives = output ? parseWindowsLogicalDisks(output) : [];
	return drives.length > 0 ? drives : windowsDriveProbeSync();
}

/**
 * The real Windows volumes. Prefers Win32_LogicalDisk (drive type + label);
 * when that query is unavailable (PowerShell missing, locked-down host, test
 * runner) it degrades to probing A:..Z: for a readable root, which still never
 * reports a drive that does not exist. Synchronous compatibility entry point;
 * the picker uses {@link refreshWindowsDrives}.
 */
export function listWindowsDrives(options: { query?: () => string | null } = {}): DriveInfo[] {
	const cached = freshWindowsDrives();
	if (cached) return cached;
	const query =
		options.query ??
		(() => {
			try {
				const result = spawnSync(
					"powershell.exe",
					["-NoProfile", "-NonInteractive", "-Command", WINDOWS_DRIVE_QUERY],
					{ encoding: "utf8", timeout: 4000, windowsHide: true },
				);
				return result.status === 0 ? result.stdout : null;
			} catch {
				return null;
			}
		});
	const drives = parseDriveQuery(query());
	windowsDrivesCache = { time: Date.now(), drives };
	return drives;
}

function queryWindowsDrivesAsync(): Promise<string | null> {
	const { promise, resolve } = Promise.withResolvers<string | null>();
	execFile(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", WINDOWS_DRIVE_QUERY],
		{ encoding: "utf8", timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 },
		(error, stdout) => resolve(error ? null : stdout),
	);
	return promise;
}

/** Enumerate Windows volumes without blocking the UI; uses the shared TTL cache. */
export async function refreshWindowsDrives(
	options: { query?: () => string | null | Promise<string | null> } = {},
): Promise<DriveInfo[]> {
	const cached = freshWindowsDrives();
	if (cached) return cached;
	const output = await (options.query ?? queryWindowsDrivesAsync)();
	let drives = output ? parseWindowsLogicalDisks(output) : [];
	if (drives.length === 0) drives = await windowsDriveProbe();
	windowsDrivesCache = { time: Date.now(), drives };
	return drives;
}

/** Reset the process-level drive cache (tests, or a volume mounted at runtime). */
export function clearWindowsDriveCache(): void {
	windowsDrivesCache = undefined;
}

/** Filesystem types that are kernel bookkeeping rather than user-reachable trees. */
const PSEUDO_FILESYSTEMS: Record<string, true> = {
	proc: true,
	sysfs: true,
	devtmpfs: true,
	devpts: true,
	tmpfs: true,
	cgroup: true,
	cgroup2: true,
	pstore: true,
	bpf: true,
	tracefs: true,
	debugfs: true,
	securityfs: true,
	configfs: true,
	fusectl: true,
	mqueue: true,
	hugetlbfs: true,
	ramfs: true,
	autofs: true,
	overlay: true,
	squashfs: true,
	nsfs: true,
	efivarfs: true,
	binfmt_misc: true,
	rpc_pipefs: true,
	nfsd: true,
	selinuxfs: true,
	"fuse.portal": true,
	"fuse.gvfsd-fuse": true,
	"fuse.snapfuse": true,
	portal: true,
};

/** Filesystem types that are, in practice, removable media or a remote share. */
const REMOVABLE_FILESYSTEMS: Record<string, true> = {
	vfat: true,
	exfat: true,
	ntfs: true,
	ntfs3: true,
	iso9660: true,
	udf: true,
	hfsplus: true,
	msdos: true,
};

/** Mount trees that hold user-attached volumes. */
const MEDIA_MOUNT_ROOTS = ["/media/", "/run/media/", "/Volumes/"];

/** Decode `/proc/mounts` octal escapes (`\040` space, `\011` tab, `\012` newline, `\134` backslash). */
export function decodeMountPath(encoded: string): string {
	return encoded.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

/** Whether a mount point belongs in the picker's mount list. */
function isPickerMount(mountPoint: string, fstype: string): boolean {
	// The root is always navigable, even when its fstype is overlay/squashfs
	// in a container; dropping it leaves the roots screen without the tree
	// every other mount hangs off.
	if (mountPoint === "/") return true;
	if (PSEUDO_FILESYSTEMS[fstype]) return false;
	// Nested kernel/container trees are noise: only the roots users navigate from.
	if (mountPoint.startsWith("/snap/")) return false;
	if (mountPoint.startsWith("/var/lib/")) return false;
	if (mountPoint.startsWith("/sys/") || mountPoint.startsWith("/proc/") || mountPoint.startsWith("/dev/")) {
		return false;
	}
	return true;
}

/**
 * Parse `/proc/mounts`: one mount point per line, pseudo filesystems dropped,
 * duplicates collapsed, external media flagged for the picker's grouping.
 */
export function parseLinuxMounts(text: string): MountInfo[] {
	const mounts: MountInfo[] = [];
	const seen = new Set<string>();
	for (const line of text.split("\n")) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 3) continue;
		const [source, encodedMountPoint, fstype] = fields as [string, string, string];
		const mountPoint = decodeMountPath(encodedMountPoint);
		if (!mountPoint.startsWith("/") || !isPickerMount(mountPoint, fstype)) continue;
		if (seen.has(mountPoint)) continue;
		seen.add(mountPoint);
		mounts.push({
			name: path.basename(mountPoint) || mountPoint,
			path: mountPoint,
			source: decodeMountPath(source),
			fstype,
			external:
				Boolean(REMOVABLE_FILESYSTEMS[fstype]) ||
				MEDIA_MOUNT_ROOTS.some(root => `${mountPoint}/`.startsWith(root)) ||
				// `server:/export`, `//server/share`: a network source, never a local disk.
				source.startsWith("//") ||
				(!source.startsWith("/") && source.includes(":")),
		});
	}
	return mounts.sort((left, right) => left.path.localeCompare(right.path));
}

let linuxMountsCache: { time: number; mounts: MountInfo[] } | undefined;

function freshLinuxMounts(): MountInfo[] | undefined {
	if (!linuxMountsCache || Date.now() - linuxMountsCache.time >= ROOTS_CACHE_TTL_MS) return undefined;
	return linuxMountsCache.mounts;
}

function fallbackMounts(): MountInfo[] {
	return [{ name: "/", path: "/", source: "/", fstype: "unknown", external: false }];
}

/** The POSIX mount points worth showing; synchronous compatibility entry point. */
export function listLinuxMounts(options: { read?: () => string | null } = {}): MountInfo[] {
	const cached = freshLinuxMounts();
	if (cached) return cached;
	const read =
		options.read ??
		(() => {
			try {
				return fs.readFileSync("/proc/mounts", "utf8");
			} catch {
				return null;
			}
		});
	const text = read();
	const mounts = text ? parseLinuxMounts(text) : [];
	const result = mounts.length > 0 ? mounts : fallbackMounts();
	linuxMountsCache = { time: Date.now(), mounts: result };
	return result;
}

/**
 * Refresh the POSIX mount list without blocking the UI. Mount points that are
 * files (bind-mounted `/etc/hosts` in containers) or no longer resolve as
 * directories are dropped; `validate: false` keeps the parse-only behavior for
 * fixture-driven tests.
 */
export async function refreshLinuxMounts(
	options: { read?: () => string | null | Promise<string | null>; validate?: boolean } = {},
): Promise<MountInfo[]> {
	const cached = freshLinuxMounts();
	if (cached) return cached;
	const text = await (options.read ??
		(async () => {
			try {
				return await fs.promises.readFile("/proc/mounts", "utf8");
			} catch {
				return null;
			}
		}))();
	let mounts = text ? parseLinuxMounts(text) : [];
	if (options.validate !== false && mounts.length > 0) {
		const checked = await Promise.all(
			mounts.map(async (mount): Promise<MountInfo | undefined> => {
				try {
					return (await fs.promises.stat(mount.path)).isDirectory() ? mount : undefined;
				} catch {
					return undefined;
				}
			}),
		);
		mounts = checked.filter((mount): mount is MountInfo => mount !== undefined);
	}
	const result = mounts.length > 0 ? mounts : fallbackMounts();
	linuxMountsCache = { time: Date.now(), mounts: result };
	return result;
}

/** Reset the process-level mount cache (tests). */
export function clearLinuxMountCache(): void {
	linuxMountsCache = undefined;
}

/** One-line description of a volume kind, for the picker's detail column. */
export function volumeKindLabel(kind: VolumeKind): string {
	switch (kind) {
		case "fixed":
			return "internal";
		case "removable":
			return "removable / external";
		case "network":
			return "network";
		case "cdrom":
			return "optical";
		case "ram":
			return "memory";
		default:
			return "volume";
	}
}

/** Home directory as a picker row. */
export function homeDirectory(): PickerDirectory {
	const home = os.homedir();
	return { name: path.basename(home) || home, path: home };
}
