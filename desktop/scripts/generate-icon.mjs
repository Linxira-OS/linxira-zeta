import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const assetsDir = path.join(repoRoot, "assets");
const sourcePath = path.join(assetsDir, "icon.svg");
// Concept 04 Cluster: below 32px the two tiles stop reading, so 16/24 render
// the declared single-tile LZ fallback. See document/agents/brand/registry.md.
const smallSourcePath = path.join(assetsDir, "zeta-mark-16.svg");
const markSourcePath = path.join(assetsDir, "zeta-mark.svg");
const maskableSourcePath = path.join(assetsDir, "icon-maskable.svg");
const buildDir = path.join(desktopDir, "build");
const webPublicDir = path.join(repoRoot, "web-app", "public");
const webUiIconsDir = path.join(repoRoot, "web-ui", "public", "icons");
const guiAssetsDir = path.join(repoRoot, "main", "crates", "zetawork-gui", "assets");
const require = createRequire(import.meta.url);
const sharp = require("sharp");

/** Multi-size ICO so Explorer, the installer, the tray, and favicons stay sharp. */
function createIco(images) {
	const header = Buffer.alloc(6 + images.length * 16);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // icon type
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	const payloads = [];
	for (const [index, { size, png }] of images.entries()) {
		const at = 6 + index * 16;
		header[at] = size >= 256 ? 0 : size;
		header[at + 1] = size >= 256 ? 0 : size;
		header[at + 2] = 0; // palette
		header[at + 3] = 0;
		header.writeUInt16LE(1, at + 4); // color planes
		header.writeUInt16LE(32, at + 6); // RGBA
		header.writeUInt32LE(png.length, at + 8);
		header.writeUInt32LE(offset, at + 12);
		offset += png.length;
		payloads.push(png);
	}
	return Buffer.concat([header, ...payloads]);
}

async function render(source, size) {
	return sharp(fs.readFileSync(source)).resize(size, size).png().toBuffer();
}

/** Render one size from the source that is legible at that size. */
function sourceFor(size) {
	return size < 32 ? smallSourcePath : sourcePath;
}

const svg = fs.readFileSync(sourcePath);
const png512 = await sharp(svg).resize(512, 512).png().toBuffer();
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(icoSizes.map(async (size) => ({ size, png: await render(sourceFor(size), size) })));
const ico = createIco(icoImages);
const favicon = createIco(
	await Promise.all([16, 32, 48, 64].map(async (size) => ({ size, png: await render(sourceFor(size), size) }))),
);

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(webPublicDir, { recursive: true });
fs.mkdirSync(webUiIconsDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, "icon.png"), png512);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);
// One canonical render for the browser: the tab icon, sidebar/About AppIcon,
// and the PWA metadata all read these two files.
fs.writeFileSync(path.join(webPublicDir, "icon.png"), png512);
fs.writeFileSync(path.join(webPublicDir, "favicon.ico"), ico);

// Committed brand exports, regenerated from the SVGs so the raster set can
// never drift from the source drawings.
const assets = [
	["zeta-mark-512.png", markSourcePath, 512],
	["zeta-mark-1024.png", markSourcePath, 1024],
	["zeta-mark-16.png", smallSourcePath, 16],
	["zeta-mark-32.png", markSourcePath, 32],
	["zeta-mark-64.png", markSourcePath, 64],
	["icon-512.png", sourcePath, 512],
	["icon-1024.png", sourcePath, 1024],
];
for (const [name, source, size] of assets) {
	fs.writeFileSync(path.join(assetsDir, name), await render(source, size));
}
fs.writeFileSync(path.join(assetsDir, "favicon.ico"), favicon);

// The workbench's About/tray raster and the Rust unit test that decodes it.
fs.writeFileSync(path.join(guiAssetsDir, "icon.png"), await render(sourcePath, 256));

// PWA + iOS: full-bleed maskable plate, 180 for apple-touch-icon.
fs.writeFileSync(path.join(webUiIconsDir, "icon-192.png"), await render(sourcePath, 192));
fs.writeFileSync(path.join(webUiIconsDir, "icon-512.png"), await render(sourcePath, 512));
fs.writeFileSync(path.join(webUiIconsDir, "icon-maskable-512.png"), await render(maskableSourcePath, 512));
fs.writeFileSync(path.join(webUiIconsDir, "apple-touch-icon.png"), await render(maskableSourcePath, 180));
