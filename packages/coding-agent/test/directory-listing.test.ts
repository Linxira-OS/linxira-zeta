/**
 * `/cd` picker filesystem primitives: Windows volumes, POSIX mounts, folders.
 *
 * The Windows cases feed the exact shape `ConvertTo-Json -Compress` produces, so
 * a removable phone, an internal disk, a network share and an optical drive are
 * told apart — and a machine without A: never shows A:.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	clearDirectoryListingCache,
	clearLinuxMountCache,
	clearWindowsDriveCache,
	decodeMountPath,
	driveKindOf,
	homeDirectory,
	listChildDirectories,
	listLinuxMounts,
	listWindowsDrives,
	parentDirectory,
	parseLinuxMounts,
	parseWindowsLogicalDisks,
	volumeKindLabel,
} from "@linxiraos/zeta/utils/directory-listing";

let tempDir: string;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-cd-listing-"));
	clearDirectoryListingCache();
	clearWindowsDriveCache();
	clearLinuxMountCache();
});

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
	clearDirectoryListingCache();
	clearWindowsDriveCache();
	clearLinuxMountCache();
});

describe("Windows volumes", () => {
	it("parses one volume serialized as a single JSON object", () => {
		const drives = parseWindowsLogicalDisks(JSON.stringify({ DeviceID: "C:", DriveType: 3, VolumeName: "System" }));
		expect(drives).toEqual([{ name: "C: System", path: "C:\\", kind: "fixed", label: "System" }]);
	});

	it("keeps real letters, their kinds and labels; never invents A:", () => {
		const drives = parseWindowsLogicalDisks(
			JSON.stringify([
				{ DeviceID: "F:", DriveType: 2, VolumeName: "Phone" },
				{ DeviceID: "C:", DriveType: 3, VolumeName: "System" },
				{ DeviceID: "D:", DriveType: 5, VolumeName: "" },
				{ DeviceID: "Z:", DriveType: 4, VolumeName: "share" },
			]),
		);
		expect(drives.map(drive => drive.path)).toEqual(["C:\\", "D:\\", "F:\\", "Z:\\"]);
		expect(drives.map(drive => drive.kind)).toEqual(["fixed", "cdrom", "removable", "network"]);
		expect(drives.map(drive => drive.label)).toEqual(["System", undefined, "Phone", "share"]);
		expect(drives.some(drive => drive.path.startsWith("A:"))).toBe(false);
		expect(volumeKindLabel(drives[2]!.kind)).toContain("removable");
		expect(volumeKindLabel(drives[0]!.kind)).toBe("internal");
	});

	it("drops malformed rows instead of showing a fake drive", () => {
		expect(parseWindowsLogicalDisks("not json")).toEqual([]);
		expect(parseWindowsLogicalDisks(JSON.stringify([{ DeviceID: "nope", DriveType: 3 }, null]))).toEqual([]);
	});

	it("maps every Win32 DriveType value", () => {
		expect(driveKindOf(2)).toBe("removable");
		expect(driveKindOf(3)).toBe("fixed");
		expect(driveKindOf(4)).toBe("network");
		expect(driveKindOf(5)).toBe("cdrom");
		expect(driveKindOf(6)).toBe("ram");
		expect(driveKindOf(99)).toBe("unknown");
	});

	it("uses the Win32 query when it answers", () => {
		const drives = listWindowsDrives({ query: () => JSON.stringify({ DeviceID: "Q:", DriveType: 3 }) });
		expect(drives.map(drive => drive.path)).toEqual(["Q:\\"]);
	});

	it("falls back to probing letters that actually exist", () => {
		const drives = listWindowsDrives({ query: () => null });
		for (const drive of drives) {
			expect(drive.path).toMatch(/^[A-Z]:\\$/);
			expect(fs.existsSync(drive.path)).toBe(true);
		}
	});
});

describe("POSIX mounts", () => {
	const mountsFixture = [
		"/dev/nvme0n1p2 / ext4 rw,relatime 0 0",
		"proc /proc proc rw,nosuid 0 0",
		"tmpfs /run tmpfs rw,nosuid 0 0",
		"sysfs /sys sysfs rw 0 0",
		"/dev/sdb1 /media/me/USB\\040Stick vfat rw,nosuid 0 0",
		"/dev/sdc1 /mnt/data ext4 rw 0 0",
		"server:/export /mnt/share nfs4 rw 0 0",
		"/dev/sdd1 /media/me/USB\\040Stick vfat rw 0 0",
		"",
	].join("\n");

	it("decodes /proc/mounts octal escapes", () => {
		expect(decodeMountPath("/media/me/USB\\040Stick")).toBe("/media/me/USB Stick");
		expect(decodeMountPath("/a\\011b\\012c\\134d")).toBe("/a\tb\nc\\d");
	});

	it("lists user-reachable mounts, drops kernel trees, and marks external media", () => {
		const mounts = parseLinuxMounts(mountsFixture);
		expect(mounts.map(mount => mount.path)).toEqual(["/", "/media/me/USB Stick", "/mnt/data", "/mnt/share"]);
		const usb = mounts.find(mount => mount.path === "/media/me/USB Stick")!;
		expect(usb.external).toBe(true);
		expect(usb.fstype).toBe("vfat");
		// A fixed disk mounted under /mnt stays internal; a network source is external.
		expect(mounts.find(mount => mount.path === "/mnt/data")!.external).toBe(false);
		expect(mounts.find(mount => mount.path === "/mnt/share")!.external).toBe(true);
		// Duplicate lines collapse to one row.
		expect(mounts.filter(mount => mount.path === "/media/me/USB Stick")).toHaveLength(1);
	});

	it("degrades to the root when /proc/mounts cannot be read", () => {
		const mounts = listLinuxMounts({ read: () => null });
		expect(mounts.map(mount => mount.path)).toEqual(["/"]);
	});
});

describe("folder listing", () => {
	it("returns directories only, sorted, and follows a directory symlink", () => {
		fs.mkdirSync(path.join(tempDir, "beta"));
		fs.mkdirSync(path.join(tempDir, "Alpha"));
		fs.mkdirSync(path.join(tempDir, ".hidden"));
		fs.writeFileSync(path.join(tempDir, "notes.txt"), "x");
		let symlinked = true;
		try {
			fs.symlinkSync(path.join(tempDir, "beta"), path.join(tempDir, "link-to-beta"), "dir");
		} catch {
			symlinked = false;
		}

		const names = listChildDirectories(tempDir).map(entry => entry.name);
		expect(names).toContain("beta");
		expect(names).toContain("Alpha");
		expect(names).toContain(".hidden");
		expect(names).not.toContain("notes.txt");
		if (symlinked) expect(names).toContain("link-to-beta");
		expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);

		// Hidden folders can be excluded for a tighter list.
		expect(listChildDirectories(tempDir, { includeHidden: false }).map(entry => entry.name)).not.toContain(".hidden");
	});

	it("returns an empty list for an unreadable directory", () => {
		expect(listChildDirectories(path.join(tempDir, "missing"))).toEqual([]);
	});

	it("resolves parents and the filesystem root", () => {
		const root = path.parse(tempDir).root;
		expect(parentDirectory(root)).toBeNull();
		expect(parentDirectory(tempDir)).toBe(path.dirname(tempDir));
	});

	it("exposes the home directory as a picker row", () => {
		expect(homeDirectory()).toEqual({
			name: path.basename(os.homedir()) || os.homedir(),
			path: os.homedir(),
		});
	});
});
