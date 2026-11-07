import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const sourcePath = path.join(repoRoot, "assets", "icon.svg");
const buildDir = path.join(desktopDir, "build");
const webPublicDir = path.join(repoRoot, "web-app", "public");
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

async function render(size) {
	return sharp(fs.readFileSync(sourcePath)).resize(size, size).png().toBuffer();
}

const svg = fs.readFileSync(sourcePath);
const png512 = await sharp(svg).resize(512, 512).png().toBuffer();
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(icoSizes.map(async (size) => ({ size, png: await render(size) })));
const ico = createIco(icoImages);

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(webPublicDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, "icon.png"), png512);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);
// One canonical render for the browser: the tab icon, sidebar/About AppIcon,
// and the PWA metadata all read these two files.
fs.writeFileSync(path.join(webPublicDir, "icon.png"), png512);
fs.writeFileSync(path.join(webPublicDir, "favicon.ico"), ico);
