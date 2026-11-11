/**
 * `/cd` source: volumes on Windows, mounts on POSIX, folders only, pins first.
 *
 * The roots screen and the browsing levels are asserted separately so a drive
 * list can never leak into a directory listing (or the reverse).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, setAgentDir } from "@linxiraos/pi-utils";
import { createDirectoryPickerSource } from "@linxiraos/zeta/modes/directory-picker-source";
import type { DriveInfo, MountInfo } from "@linxiraos/zeta/utils/directory-listing";

const drives: DriveInfo[] = [
	{ name: "C: System", path: "C:\\", kind: "fixed", label: "System" },
	{ name: "F: Phone", path: "F:\\", kind: "removable", label: "Phone" },
	{ name: "Z: share", path: "Z:\\", kind: "network", label: "share" },
];

const mounts: MountInfo[] = [
	{ name: "/", path: "/", source: "/dev/nvme0n1p2", fstype: "ext4", external: false },
	{
		name: "USB Stick",
		path: "/media/me/USB Stick",
		source: "/dev/sdb1",
		fstype: "vfat",
		external: true,
	},
];

let tempDir: string;
let originalAgentDir: string;

beforeEach(() => {
	originalAgentDir = getAgentDir();
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-cd-source-"));
	// Never touch the developer's real pin store from a test.
	setAgentDir(path.join(tempDir, "agent"));
	fs.mkdirSync(path.join(tempDir, "alpha"));
	fs.mkdirSync(path.join(tempDir, "beta"));
	fs.writeFileSync(path.join(tempDir, "file.txt"), "not a directory");
});

afterEach(() => {
	setAgentDir(originalAgentDir);
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("directory picker source", () => {
	it("shows real Windows volumes with their kind and label, and no invented A:", () => {
		const source = createDirectoryPickerSource({ platform: "win32", drives });
		const roots = source.list(null);

		expect(roots.current).toBeNull();
		expect(roots.selectable).toBe(false);
		expect(roots.rootsKind).toBe("drives");
		expect(roots.roots.map(entry => entry.path)).toEqual(["C:\\", "F:\\", "Z:\\"]);
		expect(roots.roots.map(entry => entry.detail)).toEqual([
			"internal · System",
			"removable / external · Phone",
			"network · share",
		]);
		expect(roots.roots.some(entry => entry.path.startsWith("A:"))).toBe(false);
	});

	it("shows POSIX mounts instead of drive letters", () => {
		const source = createDirectoryPickerSource({ platform: "linux", mounts });
		const roots = source.list(null);

		expect(roots.rootsKind).toBe("mounts");
		expect(roots.roots.map(entry => entry.path)).toEqual(["/", "/media/me/USB Stick"]);
		expect(roots.roots[1]!.detail).toContain("external");
	});

	it("lists folders only inside a directory", () => {
		const source = createDirectoryPickerSource({ platform: "linux", mounts: [] });
		const listing = source.list(tempDir);

		expect(listing.current).toBe(tempDir);
		expect(listing.selectable).toBe(true);
		expect(listing.roots).toEqual([]);
		expect(listing.directories.map(entry => entry.name)).toEqual(["alpha", "beta"]);
		expect(listing.directories.map(entry => entry.name)).not.toContain("file.txt");
		expect(listing.parent).toBe(path.dirname(tempDir));
	});

	it("pins are listed first on every level and switch the view after a toggle", async () => {
		const source = createDirectoryPickerSource({
			platform: "linux",
			mounts: [],
			pins: ["/srv/work"],
		});
		expect(source.list(null).pins.map(entry => entry.path)).toEqual(["/srv/work"]);
		expect(source.list(tempDir).pins.map(entry => entry.path)).toEqual(["/srv/work"]);

		expect(await source.togglePin("/srv/other")).toBe(true);
		// A whole-list canonicalization resolves every local pin through the host path module.
		expect(source.list(tempDir).pins.map(entry => entry.path)).toEqual([
			path.resolve("/srv/other"),
			path.resolve("/srv/work"),
		]);
	});

	it("keeps a Windows drive pin canonical on win32", () => {
		if (process.platform !== "win32") return;
		const source = createDirectoryPickerSource({
			platform: "win32",
			mounts: [],
			pins: [String.raw`C:\srv\work`],
		});
		expect(source.list(null).pins.map(entry => entry.path)).toEqual([path.resolve(String.raw`C:\srv\work`)]);
	});

	it("keeps the pin store out of the home directory", async () => {
		const workspace = path.join(tempDir, "workspace");
		fs.mkdirSync(workspace);
		const source = createDirectoryPickerSource({ platform: "linux", mounts: [], pins: [] });
		await source.togglePin(workspace);
		expect(fs.readdirSync(workspace)).toEqual([]);
		expect(fs.existsSync(path.join(tempDir, "agent", "directory-pins.json"))).toBe(true);
	});
});
