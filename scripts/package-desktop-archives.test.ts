import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { desktopAssetNames, normalizeVersion } from "./package-desktop-archives";

const repoRoot = path.join(import.meta.dir, "..");
const scriptPath = path.join(import.meta.dir, "package-desktop-archives.ts");

const temps: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-desktop-archive-test-"));
	temps.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Decompressed contents of `file`, keyed by archive name. `writeZip` writes no
 * prefix data, comment or extra fields of its own, so the central directory
 * walk is the plain 46-byte header followed by the local header it points at.
 */
function zipContents(file: string): Map<string, Buffer> {
	const bytes = fs.readFileSync(file);
	const end = bytes.length - 22;
	if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) {
		throw new Error(`${file}: no end-of-central-directory record`);
	}
	const count = bytes.readUInt16LE(end + 10);
	let offset = bytes.readUInt32LE(end + 16);
	const out = new Map<string, Buffer>();
	for (let index = 0; index < count; index++) {
		if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${file}: bad central header at ${offset}`);
		const method = bytes.readUInt16LE(offset + 10);
		const packedSize = bytes.readUInt32LE(offset + 20);
		const nameLength = bytes.readUInt16LE(offset + 28);
		const extraLength = bytes.readUInt16LE(offset + 30);
		const commentLength = bytes.readUInt16LE(offset + 32);
		const localOffset = bytes.readUInt32LE(offset + 42);
		const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
		const localNameLength = bytes.readUInt16LE(localOffset + 26);
		const localExtraLength = bytes.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const packed = bytes.subarray(dataStart, dataStart + packedSize);
		out.set(name, method === 0 ? Buffer.from(packed) : zlib.inflateRawSync(packed));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return out;
}

describe("normalizeVersion", () => {
	it("strips the release tag's leading v", () => {
		expect(normalizeVersion("v1.3.2")).toBe("1.3.2");
		expect(normalizeVersion("1.3.2")).toBe("1.3.2");
		expect(normalizeVersion(" v1.3.2\n")).toBe("1.3.2");
	});
});

describe("desktopAssetNames", () => {
	it("names all four release assets with the numeric version", () => {
		expect(desktopAssetNames("v1.3.2")).toEqual({
			installer: "linxira-zeta-1.3.2-setup-x64.exe",
			windowsZip: "linxira-zeta-1.3.2-windows-x64.zip",
			appImage: "linxira-zeta-1.3.2-x86_64.AppImage",
			archPackage: "linxira-zeta-1.3.2-1-x86_64.pkg.tar.zst",
		});
	});
});

/**
 * The portable archive is the only desktop asset a release job can assemble on
 * any host, so it doubles as the end-to-end guard for `windows`: the payload
 * must hold the runtime suite *and* the notices that ship with it. Nothing else
 * executes this path outside a release-mode CI run, which is how a missing
 * notice constant reached a tag.
 */
describe("the portable Windows archive", () => {
	it("carries the runtime suite with the third-party notices and the font license", () => {
		const out = tempDir();
		const inputs = tempDir();
		const webUi = path.join(inputs, "web-ui");
		fs.mkdirSync(path.join(webUi, ".next", "standalone"), { recursive: true });
		fs.writeFileSync(path.join(webUi, ".next", "standalone", "server.js"), "// standalone server\n");
		fs.mkdirSync(path.join(webUi, ".next", "static"), { recursive: true });
		fs.writeFileSync(path.join(webUi, ".next", "static", "app.js"), "// static asset\n");

		const inputsByFlag: Record<string, string> = {
			"--exe": "zetawork-gui-win-x64.exe",
			"--tui": "zeta-work-win-x64.exe",
			"--agent": "zeta-cli-windows-x64.exe",
			"--ide": "zeta-ide-win-x64.exe",
			"--dll": "zetawork-gui-win-x64.dll",
		};
		const args = ["--version", "v1.3.2", "--webui", webUi, "--out", out];
		for (const [flag, name] of Object.entries(inputsByFlag)) {
			const file = path.join(inputs, name);
			fs.writeFileSync(file, `stub ${name}\n`);
			args.push(flag, file);
		}

		const proc = Bun.spawnSync({
			cmd: [process.execPath, scriptPath, "windows", ...args],
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(`${proc.stdout.toString()}${proc.stderr.toString()}`).toContain("wrote");
		expect(proc.exitCode).toBe(0);

		const archive = path.join(out, "linxira-zeta-1.3.2-windows-x64.zip");
		const contents = zipContents(archive);

		// The five files a portable copy needs beside each other, each holding the
		// binary its flag named: the shell, the TUI, both companions, and the
		// loader the PE imports.
		const runtimePayload: Record<string, string> = {
			"zetawork-gui.exe": "zetawork-gui-win-x64.exe",
			"zetawork.exe": "zeta-work-win-x64.exe",
			"zetacode.exe": "zeta-cli-windows-x64.exe",
			"zetaide.exe": "zeta-ide-win-x64.exe",
			"WebView2Loader.dll": "zetawork-gui-win-x64.dll",
		};
		for (const [archiveName, inputName] of Object.entries(runtimePayload)) {
			expect(contents.get(archiveName)?.toString("utf8")).toBe(`stub ${inputName}\n`);
		}
		expect(contents.has("web-ui/.next/standalone/server.js")).toBe(true);
		expect(contents.has("web-ui/.next/standalone/.next/static/app.js")).toBe(true);

		// License payload: the archive must ship the repository's own aggregate
		// notice and the OFL text that the embedded Maple Mono font requires.
		expect(contents.get("THIRD-PARTY-NOTICES.txt")).toEqual(
			fs.readFileSync(path.join(repoRoot, "THIRD-PARTY-NOTICES.txt")),
		);
		expect(contents.get("MapleMono-OFL.txt")).toEqual(
			fs.readFileSync(path.join(repoRoot, "main", "crates", "zetawork-gui", "assets", "fonts", "OFL.txt")),
		);
	}, 120_000);
});
