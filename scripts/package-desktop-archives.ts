#!/usr/bin/env bun
/**
 * Package the zetawork desktop app for release.
 *
 * Two shapes, both built on the Linux runner from artifacts that
 * `ci-release-build-binaries.ts` already produced:
 *
 *   windows  `zetawork-windows-x64.zip`
 *            `zetawork-gui.exe` + `WebView2Loader.dll`. The loader is a real
 *            runtime dependency — the PE imports `WebView2Loader.dll` — and it
 *            ships inside the `webview2-com-sys` crate, so it is copied from
 *            the cargo registry of the same build.
 *
 *   linux    `zetawork-<version>-1-x86_64.pkg.tar.zst` (Arch, `pacman -U`)
 *            and `zetawork-<version>-x86_64.AppImage`.
 *            The GUI binary is installed OFF PATH (`/usr/lib/zetawork/`), so
 *            the desktop app does not add a fourth command; the TUI binary is
 *            the `zetawork` command. The AppImage carries the GUI plus the
 *            desktop entry.
 *
 * Usage:
 *   bun scripts/package-desktop-archives.ts windows --exe <path> --out <dir>
 *   bun scripts/package-desktop-archives.ts linux   --version 1.3.1 \
 *       --gui <path> --tui <path> --out <dir>
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as zlib from "node:zlib";

const repoRoot = path.join(import.meta.dir, "..");

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0) return process.argv[index + 1];
	const inline = process.argv.find(value => value.startsWith(`--${name}=`));
	return inline?.split("=", 2)[1];
}

async function run(command: string[], cwd = repoRoot, env: Record<string, string> = {}): Promise<void> {
	console.log(`  $ ${command.join(" ")}`);
	const proc = Bun.spawn(command, { cwd, env: { ...Bun.env, ...env }, stdout: "inherit", stderr: "inherit" });
	const code = await proc.exited;
	if (code !== 0) throw new Error(`command failed (${code}): ${command.join(" ")}`);
}

async function mustExist(file: string): Promise<void> {
	try {
		await fs.access(file);
	} catch {
		throw new Error(`missing input: ${file}`);
	}
}

/**
 * The WebView2 loader lives inside the crate that links it. Resolve it from the
 * build's own registry so the dll always matches the wry/webview2-com version
 * that produced the exe.
 */
async function findWebView2Loader(): Promise<string> {
	const cargoHome = Bun.env.CARGO_HOME ?? path.join(Bun.env.HOME ?? "", ".cargo");
	const registry = path.join(cargoHome, "registry", "src");
	let entries: string[] = [];
	try {
		entries = await fs.readdir(registry);
	} catch {
		throw new Error(`no cargo registry at ${registry}`);
	}
	for (const index of entries) {
		let crates: string[] = [];
		try {
			crates = await fs.readdir(path.join(registry, index));
		} catch {
			continue;
		}
		for (const crate of crates) {
			if (!crate.startsWith("webview2-com-sys-")) continue;
			const dll = path.join(registry, index, crate, "x64", "WebView2Loader.dll");
			try {
				await fs.access(dll);
				return dll;
			} catch {
				// keep looking
			}
		}
	}
	throw new Error("WebView2Loader.dll not found in the cargo registry (webview2-com-sys)");
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Write a deflate-compressed zip. The release image is an ubuntu runner where
 * `/usr/bin/zip` exists, but a local Windows verification has no zip in PATH,
 * and a packaging step that only works on one host is a trap.
 */
async function writeZip(entries: Array<{ name: string; file: string }>, outPath: string): Promise<void> {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const raw = await fs.readFile(entry.file);
		const packed = zlib.deflateRawSync(raw, { level: 9 });
		const name = Buffer.from(entry.name, "utf8");
		const crc = crc32(raw);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(0x21, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, packed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(0x21, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(packed.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + packed.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	await fs.writeFile(outPath, Buffer.concat([...locals, directory, end]));
}

async function packageWindows(): Promise<void> {
	const exe = arg("exe") ?? "packages/coding-agent/binaries/zetawork-gui-win-x64.exe";
	const outDir = path.resolve(arg("out") ?? "packages/coding-agent/binaries");
	await mustExist(exe);
	const loader = await findWebView2Loader();
	console.log(`Using WebView2 loader: ${loader}`);

	const stage = await fs.mkdtemp(path.join(Bun.env.RUNNER_TEMP ?? "/tmp", "zetawork-win-"));
	await fs.copyFile(exe, path.join(stage, "zetawork-gui.exe"));
	await fs.copyFile(loader, path.join(stage, "WebView2Loader.dll"));

	const archive = path.join(outDir, "zetawork-windows-x64.zip");
	await writeZip(
		[
			{ name: "zetawork-gui.exe", file: path.join(stage, "zetawork-gui.exe") },
			{ name: "WebView2Loader.dll", file: path.join(stage, "WebView2Loader.dll") },
		],
		archive,
	);
	console.log(`wrote ${archive}`);
}

/** Desktop entry + icon the AppImage and the Arch package share. */
function desktopEntry(): string {
	return `[Desktop Entry]
Type=Application
Name=zetawork
Comment=Zeta workbench — projects, terminals and the coding agent
Exec=zetawork-gui %U
Icon=zetawork
Terminal=false
Categories=Development;
StartupWMClass=zetawork-gui
`;
}

/** A small 256x256 PNG (zeta mark placeholder) generated deterministically. */
async function writeIcon(file: string): Promise<void> {
	// 16x16 RGBA is enough to satisfy desktop tooling; the real icon ships
	// with the site assets. Kept buffer-generated so packaging has no extra
	// dependency.
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR42mNkYPhfz0AEYBxVSF+FjAMNGBgYGOgVJgONowrpqxAAakQH0lZ3s9cAAAAASUVORK5CYII=",
		"base64",
	);
	await fs.writeFile(file, png);
}

async function packageLinux(): Promise<void> {
	const version = arg("version");
	const gui = arg("gui") ?? "packages/coding-agent/binaries/zetawork-gui-linux-x64";
	const tui = arg("tui") ?? "packages/coding-agent/binaries/zeta-work-linux-x64";
	const outDir = path.resolve(arg("out") ?? "packages/coding-agent/binaries");
	if (!version) throw new Error("--version is required for the linux archives");
	await mustExist(gui);
	await mustExist(tui);

	const work = await fs.mkdtemp(path.join(Bun.env.RUNNER_TEMP ?? "/tmp", "zetawork-linux-"));
	const appDir = path.join(work, "zetawork.AppDir");
	await fs.mkdir(path.join(appDir, "usr", "lib", "zetawork"), { recursive: true });
	await fs.mkdir(path.join(appDir, "usr", "bin"), { recursive: true });
	await fs.mkdir(path.join(appDir, "usr", "share", "applications"), { recursive: true });
	await fs.mkdir(path.join(appDir, "usr", "share", "icons", "hicolor", "128x128", "apps"), { recursive: true });

	await fs.copyFile(gui, path.join(appDir, "usr", "lib", "zetawork", "zetawork-gui"));
	await fs.chmod(path.join(appDir, "usr", "lib", "zetawork", "zetawork-gui"), 0o755);
	await fs.copyFile(tui, path.join(appDir, "usr", "bin", "zetawork"));
	await fs.chmod(path.join(appDir, "usr", "bin", "zetawork"), 0o755);
	await fs.writeFile(path.join(appDir, "usr", "share", "applications", "zetawork.desktop"), desktopEntry());
	await writeIcon(path.join(appDir, "usr", "share", "icons", "hicolor", "128x128", "apps", "zetawork.png"));
	await fs.writeFile(path.join(appDir, "AppRun"), `#!/bin/sh\nexec "$APPDIR/usr/lib/zetawork/zetawork-gui" "$@"\n`);
	await fs.chmod(path.join(appDir, "AppRun"), 0o755);

	// Top-level entries AppDir tooling expects.
	await fs.rm(path.join(appDir, "zetawork.desktop"), { force: true });
	await fs.copyFile(
		path.join(appDir, "usr", "share", "applications", "zetawork.desktop"),
		path.join(appDir, "zetawork.desktop"),
	);
	await fs.copyFile(
		path.join(appDir, "usr", "share", "icons", "hicolor", "128x128", "apps", "zetawork.png"),
		path.join(appDir, "zetawork.png"),
	);

	// AppImage: appimagetool refuses to run under FUSE in most CI images, so
	// the runner extracts it (APPIMAGE_EXTRACT_AND_RUN) and we pass -n.
	const tool = Bun.env.APPIMAGETOOL ?? path.join(work, "appimagetool");
	if (!Bun.env.APPIMAGETOOL) {
		const url = "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";
		await run(["curl", "-fsSL", "-o", tool, url]);
		await fs.chmod(tool, 0o755);
	}
	const appimage = path.join(outDir, `zetawork-${version}-x86_64.AppImage`);
	await run([tool, "-n", "--appimage-extract-and-run", appDir, appimage].filter(Boolean) as string[], work, {
		ARCH: "x86_64",
	});
	console.log(`wrote ${appimage}`);

	// Arch package: makepkg inside archlinux/base-devel. The runner has Docker;
	// this is the only honest way to produce a .pkg.tar.zst without an Arch
	// host.
	const pkgDir = path.join(work, "arch");
	await fs.mkdir(pkgDir, { recursive: true });
	await fs.copyFile(gui, path.join(pkgDir, "zetawork-gui"));
	await fs.copyFile(tui, path.join(pkgDir, "zetawork"));
	await fs.copyFile(
		path.join(repoRoot, "scripts", "packaging", "arch", "zetawork.desktop"),
		path.join(pkgDir, "zetawork.desktop"),
	);
	await writeIcon(path.join(pkgDir, "zetawork.png"));
	const pkgbuild = (
		await fs.readFile(path.join(repoRoot, "scripts", "packaging", "arch", "PKGBUILD"), "utf8")
	).replaceAll("@VERSION@", version);
	await fs.writeFile(path.join(pkgDir, "PKGBUILD"), pkgbuild);

	await run([
		"docker",
		"run",
		"--rm",
		"-v",
		`${pkgDir}:/pkg`,
		"-w",
		"/pkg",
		"archlinux:base-devel",
		"bash",
		"-lc",
		"pacman -Sy --noconfirm --needed base-devel fakeroot && useradd -m builder && chown -R builder /pkg && su builder -c 'makepkg -f --nodeps --noconfirm'",
	]);
	const produced = (await fs.readdir(pkgDir)).find(name => name.endsWith(".pkg.tar.zst"));
	if (!produced) throw new Error("makepkg produced no .pkg.tar.zst");
	await fs.copyFile(path.join(pkgDir, produced), path.join(outDir, produced));
	console.log(`wrote ${path.join(outDir, produced)}`);
}

const mode = process.argv[2];
try {
	if (mode === "windows") await packageWindows();
	else if (mode === "linux") await packageLinux();
	else {
		console.error("Usage: package-desktop-archives.ts <windows|linux> [options]");
		process.exit(2);
	}
} catch (error) {
	console.error(`packaging failed: ${(error as Error).message}`);
	process.exit(1);
}
