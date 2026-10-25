#!/usr/bin/env bun
/**
 * Package the Linxira Zeta desktop product for release.
 *
 * The four product assets carry the product name (organisation included) and
 * the numeric version (the `v` of a release tag is stripped). Component
 * binaries keep their own `zeta-cli-*` / `zeta-ide-*` / `zeta-work-*` names:
 * they are the small packages, this is the complete one.
 *
 *   windows  `linxira-zeta-<version>-windows-x64.zip`
 *            The full portable payload: `zetawork-gui.exe`, `zetacode.exe`,
 *            `zetaide.exe`, `zetawork.exe` and `WebView2Loader.dll`. A
 *            portable copy must be able to start its own backend, so it
 *            carries the companions; the loader is a real runtime dependency
 *            (the PE imports it) and is copied from the cargo registry of the
 *            same build.
 *
 *   windows-installer
 *            `linxira-zeta-<version>-setup-x64.exe` (NSIS, per-user install).
 *            The same five files beside each other in
 *            `%LOCALAPPDATA%\Programs\Linxira Zeta`, which is what
 *            `main/crates/zetawork-gui/src/zetacode.rs` companion discovery
 *            expects. `makensis` must be on PATH (the release job apt-installs
 *            `nsis`); it cannot run on the Windows dev box.
 *
 *   linux    `linxira-zeta-<version>-1-x86_64.pkg.tar.zst` (Arch, `pacman -U`)
 *            and `linxira-zeta-<version>-x86_64.AppImage`.
 *            The GUI and both companions are installed OFF PATH
 *            (`/usr/lib/zetawork/`), so the desktop app does not add a fourth
 *            command; the TUI binary is the `zetawork` command. The AppImage
 *            carries the same payload plus the desktop entry.
 *
 * Usage:
 *   bun scripts/package-desktop-archives.ts windows --version v1.3.2 \
 *       --exe <gui.exe> --tui <zetawork.exe> --agent <zetacode.exe> \
 *       --ide <zetaide.exe> --dll <WebView2Loader.dll> --out <dir>
 *   bun scripts/package-desktop-archives.ts windows-installer --version v1.3.2 \
 *       --gui <gui.exe> --tui <zetawork.exe> --agent <zetacode.exe> \
 *       --ide <zetaide.exe> --dll <WebView2Loader.dll> --out <dir>
 *   bun scripts/package-desktop-archives.ts linux --version v1.3.2 \
 *       --gui <gui> --tui <zetawork> --agent <zetacode> --ide <zetaide> \
 *       --out <dir>
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeZip } from "./packaging/zip";

const repoRoot = path.join(import.meta.dir, "..");

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0) return process.argv[index + 1];
	const inline = process.argv.find(value => value.startsWith(`--${name}=`));
	return inline?.split("=", 2)[1];
}

/** Asset names are versioned with the numeric version: no leading `v`. */
export function normalizeVersion(raw: string): string {
	return raw.trim().replace(/^v/, "");
}

/** The four release assets, so the packaging script and the guards agree. */
export interface DesktopAssetNames {
	installer: string;
	windowsZip: string;
	appImage: string;
	archPackage: string;
}

export function desktopAssetNames(version: string): DesktopAssetNames {
	const numeric = normalizeVersion(version);
	return {
		installer: `linxira-zeta-${numeric}-setup-x64.exe`,
		windowsZip: `linxira-zeta-${numeric}-windows-x64.zip`,
		appImage: `linxira-zeta-${numeric}-x86_64.AppImage`,
		archPackage: `linxira-zeta-${numeric}-1-x86_64.pkg.tar.zst`,
	};
}

/**
 * `--version` is authoritative, but a packaging dry run has no release tag;
 * fall back to the workspace version so the dry run still produces a coherent
 * (versioned) asset name.
 */
async function resolveVersion(): Promise<string> {
	const fromArg = arg("version")?.trim();
	// The root manifest is private and carries no version; the product version
	// lives in the package that ships the binary.
	const manifest = JSON.parse(
		await fs.readFile(path.join(repoRoot, "packages/coding-agent/package.json"), "utf8"),
	) as { version?: unknown };
	const fallback = typeof manifest.version === "string" ? manifest.version : "";
	const raw = fromArg || fallback;
	if (!raw) throw new Error("no version: --version is empty and package.json has none");
	const version = normalizeVersion(raw);
	if (!version) throw new Error("--version is empty");
	return version;
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

async function resolveLoader(staged: string | undefined): Promise<string> {
	if (!staged) return findWebView2Loader();
	const loader = path.resolve(staged);
	await mustExist(loader);
	return loader;
}

/**
 * Portable zip: the whole suite, the same five files the installer lays down.
 * A portable copy has to be able to start its own backend, so the companions
 * travel with the shell — a GUI-only archive could not.
 */
/**
 * Copy the built Web UI into `<stage>/web-ui` in the layout
 * `spawnEmbeddedWebUi` looks for (`<exe dir>/web-ui/.next/standalone/server.js`).
 *
 * Next's standalone output does not contain its own static assets or `public`,
 * so both are copied **inside** the standalone tree — the server resolves them
 * relative to its own directory. Without this the shell loads and every asset
 * 404s.
 */
async function stageWebUi(stage: string, source: string): Promise<void> {
	const standalone = path.join(source, ".next", "standalone");
	const serverJs = path.join(standalone, "server.js");
	await mustExist(serverJs);
	const target = path.join(stage, "web-ui");
	await fs.cp(path.join(source, ".next", "standalone"), path.join(target, ".next", "standalone"), {
		recursive: true,
		// A traced `node_modules` may be a link (a dev tree sharing one install);
		// the packaged tree must hold real files.
		dereference: true,
	});
	await fs.cp(path.join(source, ".next", "static"), path.join(target, ".next", "standalone", ".next", "static"), {
		recursive: true,
		dereference: true,
	});
	const publicDir = path.join(source, "public");
	// `Bun.file()` on a directory is not `exists()`; stat the path instead.
	const hasPublic = await fs.stat(publicDir).then(
		stat => stat.isDirectory(),
		() => false,
	);
	if (hasPublic) {
		await fs.cp(publicDir, path.join(target, ".next", "standalone", "public"), {
			recursive: true,
			dereference: true,
		});
	}
}

/** Every file under `dir`, named `prefix/<relative path>` with POSIX separators. */
async function directoryEntries(dir: string, prefix: string): Promise<{ name: string; file: string }[]> {
	const out: { name: string; file: string }[] = [];
	const walk = async (current: string, rel: string): Promise<void> => {
		const items = await fs.readdir(current, { withFileTypes: true });
		items.sort((a, b) => a.name.localeCompare(b.name));
		for (const item of items) {
			const abs = path.join(current, item.name);
			const name = rel ? `${rel}/${item.name}` : item.name;
			if (item.isDirectory()) await walk(abs, name);
			else if (item.isFile()) out.push({ name: `${prefix}/${name}`, file: abs });
		}
	};
	await walk(dir, "");
	return out;
}

/** The `--webui` directory, or a refusal: the product ships the browser UI. */
async function resolveWebUi(): Promise<string> {
	const source = path.resolve(arg("webui") ?? "web-ui");
	const serverJs = path.join(source, ".next", "standalone", "server.js");
	if (!(await Bun.file(serverJs).exists())) {
		throw new Error(
			`no Web UI build at ${serverJs}; run \`NEXT_OUTPUT_STANDALONE=1 npm run build\` in web-ui/ or pass --webui <dir>`,
		);
	}
	return source;
}

async function packageWindows(): Promise<void> {
	const version = await resolveVersion();
	const gui = arg("exe") ?? "packages/coding-agent/binaries/zetawork-gui-win-x64.exe";
	const tui = arg("tui") ?? "packages/coding-agent/binaries/zeta-work-win-x64.exe";
	const agent = arg("agent") ?? "packages/coding-agent/binaries/zeta-cli-windows-x64.exe";
	const ide = arg("ide") ?? "packages/coding-agent/binaries/zeta-ide-win-x64.exe";
	const outDir = path.resolve(arg("out") ?? "packages/coding-agent/binaries");
	for (const file of [gui, tui, agent, ide]) await mustExist(file);
	// The archives job builds nothing, so it has no cargo registry; the Windows
	// product leg stages the loader beside its artifact and passes it here.
	const loader = await resolveLoader(arg("dll"));
	console.log(`Using WebView2 loader: ${loader}`);
	const webUi = await resolveWebUi();

	const stage = await fs.mkdtemp(path.join(Bun.env.RUNNER_TEMP ?? "/tmp", "linxira-zeta-win-"));
	await fs.copyFile(gui, path.join(stage, "zetawork-gui.exe"));
	await fs.copyFile(tui, path.join(stage, "zetawork.exe"));
	await fs.copyFile(agent, path.join(stage, "zetacode.exe"));
	await fs.copyFile(ide, path.join(stage, "zetaide.exe"));
	await fs.copyFile(loader, path.join(stage, "WebView2Loader.dll"));
	await stageWebUi(stage, webUi);

	await fs.mkdir(outDir, { recursive: true });
	const archive = path.join(outDir, desktopAssetNames(version).windowsZip);
	const entries = [
		{ name: "zetawork-gui.exe", file: path.join(stage, "zetawork-gui.exe") },
		{ name: "zetawork.exe", file: path.join(stage, "zetawork.exe") },
		{ name: "zetacode.exe", file: path.join(stage, "zetacode.exe") },
		{ name: "zetaide.exe", file: path.join(stage, "zetaide.exe") },
		{ name: "WebView2Loader.dll", file: path.join(stage, "WebView2Loader.dll") },
	];
	for (const entry of await directoryEntries(path.join(stage, "web-ui"), "web-ui")) entries.push(entry);
	await writeZip(entries, archive);
	console.log(`wrote ${archive}`);
}

/**
 * NSIS installer: the whole suite beside each other in a per-user directory.
 * `installer.nsi` does the Windows work; this function only stages the four
 * executables (+ the loader) and invokes `makensis` with the version and paths.
 */
async function packageWindowsInstaller(): Promise<void> {
	const version = await resolveVersion();
	const names = desktopAssetNames(version);
	const gui = arg("gui") ?? "packages/coding-agent/binaries/zetawork-gui-win-x64.exe";
	const tui = arg("tui") ?? "packages/coding-agent/binaries/zeta-work-win-x64.exe";
	const agent = arg("agent") ?? "packages/coding-agent/binaries/zeta-cli-windows-x64.exe";
	const ide = arg("ide") ?? "packages/coding-agent/binaries/zeta-ide-win-x64.exe";
	const outDir = path.resolve(arg("out") ?? "packages/coding-agent/binaries");
	for (const file of [gui, tui, agent, ide]) await mustExist(file);
	const loader = await resolveLoader(arg("dll"));

	const webUi = await resolveWebUi();
	const stage = await fs.mkdtemp(path.join(Bun.env.RUNNER_TEMP ?? "/tmp", "linxira-zeta-nsis-"));
	await stageWebUi(stage, webUi);
	await fs.copyFile(gui, path.join(stage, "zetawork-gui.exe"));
	await fs.copyFile(tui, path.join(stage, "zetawork.exe"));
	await fs.copyFile(agent, path.join(stage, "zetacode.exe"));
	await fs.copyFile(ide, path.join(stage, "zetaide.exe"));
	await fs.copyFile(loader, path.join(stage, "WebView2Loader.dll"));
	// The MUI interface icons are read from the staging dir; the GUI's PE icon
	// is the product icon, so the installer and the app never drift apart.
	const icon = path.join(repoRoot, "main", "crates", "zetawork-gui", "assets", "icon.ico");
	await mustExist(icon);
	await fs.copyFile(icon, path.join(stage, "zetawork.ico"));

	await fs.mkdir(outDir, { recursive: true });
	const outFile = path.join(outDir, names.installer);
	const script = path.join(repoRoot, "scripts", "packaging", "windows", "installer.nsi");
	await mustExist(script);
	await run(
		[
			Bun.env.MAKENSIS ?? "makensis",
			`-DAPP_VERSION=${version}`,
			`-DSOURCE_DIR=${stage}`,
			`-DOUT_FILE=${outFile}`,
			script,
		],
		repoRoot,
	);
	await mustExist(outFile);
	console.log(`wrote ${outFile}`);
}

/** Desktop entry + icon the AppImage and the Arch package share. */
function desktopEntry(version?: string): string {
	const versionLine = version ? `X-AppImage-Version=${normalizeVersion(version)}\n` : "";
	return `[Desktop Entry]
Type=Application
Name=Linxira Zeta
Comment=Linxira Zeta — projects, terminals and the coding agent
${versionLine}Exec=/usr/lib/zetawork/zetawork-gui %U
Icon=zetawork
Terminal=false
Categories=Development;
StartupWMClass=zetawork-gui
`;
}

/** Copy the canonical Zeta mark for every Linux desktop surface. */
async function writeIcon(file: string): Promise<void> {
	const source = path.join(repoRoot, "main", "crates", "zetawork-gui", "assets", "icon.png");
	await mustExist(source);
	await fs.copyFile(source, file);
}

async function packageLinux(): Promise<void> {
	const version = await resolveVersion();
	const gui = arg("gui") ?? "packages/coding-agent/binaries/zetawork-gui-linux-x64";
	const tui = arg("tui") ?? "packages/coding-agent/binaries/zeta-work-linux-x64";
	const agent = arg("agent") ?? "packages/coding-agent/binaries/zeta-cli-linux-x64";
	const ide = arg("ide") ?? "packages/coding-agent/binaries/zeta-ide-linux-x64";
	const outDir = path.resolve(arg("out") ?? "packages/coding-agent/binaries");
	for (const file of [gui, tui, agent, ide]) await mustExist(file);

	const work = await fs.mkdtemp(path.join(Bun.env.RUNNER_TEMP ?? "/tmp", "zetawork-linux-"));
	const appDir = path.join(work, "zetawork.AppDir");
	await fs.mkdir(path.join(appDir, "usr", "lib", "zetawork"), { recursive: true });
	await fs.mkdir(path.join(appDir, "usr", "bin"), { recursive: true });
	await fs.mkdir(path.join(appDir, "usr", "share", "applications"), { recursive: true });
	await fs.mkdir(path.join(appDir, "usr", "share", "icons", "hicolor", "256x256", "apps"), { recursive: true });

	// GUI + companions beside each other; the TUI stays the only PATH command.
	const payload: Array<[string, string]> = [
		[gui, "zetawork-gui"],
		[agent, "zetacode"],
		[ide, "zetaide"],
	];
	for (const [source, name] of payload) {
		const target = path.join(appDir, "usr", "lib", "zetawork", name);
		await fs.copyFile(source, target);
		await fs.chmod(target, 0o755);
	}
	await stageWebUi(path.join(appDir, "usr", "lib", "zetawork"), await resolveWebUi());
	await fs.copyFile(tui, path.join(appDir, "usr", "bin", "zetawork"));
	await fs.chmod(path.join(appDir, "usr", "bin", "zetawork"), 0o755);
	await fs.writeFile(path.join(appDir, "usr", "share", "applications", "zetawork.desktop"), desktopEntry(version));
	await writeIcon(path.join(appDir, "usr", "share", "icons", "hicolor", "256x256", "apps", "zetawork.png"));
	await fs.writeFile(path.join(appDir, "AppRun"), `#!/bin/sh\nexec "$APPDIR/usr/lib/zetawork/zetawork-gui" "$@"\n`);
	await fs.chmod(path.join(appDir, "AppRun"), 0o755);

	// Top-level entries AppDir tooling expects.
	await fs.rm(path.join(appDir, "zetawork.desktop"), { force: true });
	await fs.copyFile(
		path.join(appDir, "usr", "share", "applications", "zetawork.desktop"),
		path.join(appDir, "zetawork.desktop"),
	);
	await fs.copyFile(
		path.join(appDir, "usr", "share", "icons", "hicolor", "256x256", "apps", "zetawork.png"),
		path.join(appDir, "zetawork.png"),
	);
	// AppImage integration tools (Shelly included) read the root icon through
	// `.DirIcon`; a missing one downgrades the entry to a generic icon.
	await fs.copyFile(path.join(appDir, "zetawork.png"), path.join(appDir, ".DirIcon"));

	// AppImage: appimagetool refuses to run under FUSE in most CI images, so
	// the runner extracts it (APPIMAGE_EXTRACT_AND_RUN) and we pass -n.
	const tool = Bun.env.APPIMAGETOOL ?? path.join(work, "appimagetool");
	if (!Bun.env.APPIMAGETOOL) {
		const url = "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";
		await run(["curl", "-fsSL", "-o", tool, url]);
		await fs.chmod(tool, 0o755);
	}
	await fs.mkdir(outDir, { recursive: true });
	const appimage = path.join(outDir, desktopAssetNames(version).appImage);
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
	await fs.copyFile(agent, path.join(pkgDir, "zetacode"));
	await fs.copyFile(ide, path.join(pkgDir, "zetaide"));
	// makepkg accepts files/archives in `source`, not directories: stage the
	// portable layout, then hand it over as a tarball.
	await stageWebUi(pkgDir, await resolveWebUi());
	await run(["tar", "-czf", path.join(pkgDir, "web-ui.tar.gz"), "-C", pkgDir, "web-ui"]);
	await fs.rm(path.join(pkgDir, "web-ui"), { recursive: true, force: true });
	await fs.copyFile(path.join(repoRoot, "LICENSE"), path.join(pkgDir, "LICENSE"));
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
	const expected = desktopAssetNames(version).archPackage;
	if (produced !== expected) throw new Error(`makepkg produced ${produced}, expected ${expected}`);
	await fs.copyFile(path.join(pkgDir, produced), path.join(outDir, produced));
	console.log(`wrote ${path.join(outDir, produced)}`);
}

if (import.meta.main) {
	const mode = process.argv[2];
	try {
		if (mode === "windows") await packageWindows();
		else if (mode === "windows-installer") await packageWindowsInstaller();
		else if (mode === "linux") await packageLinux();
		else {
			console.error("Usage: package-desktop-archives.ts <windows|windows-installer|linux> [options]");
			process.exit(2);
		}
	} catch (error) {
		console.error(`packaging failed: ${(error as Error).message}`);
		process.exit(1);
	}
}
