import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const sourcePath = path.join(repoRoot, "assets", "icon.svg");
const buildDir = path.join(repoRoot, "temp", "desktop", "build");
const webFavicon = path.join(repoRoot, "web-ui", "app", "favicon.ico");
const require = createRequire(import.meta.url);
const sharp = require(path.join(repoRoot, "web-ui", "node_modules", "sharp"));

function createIco(png) {
	const header = Buffer.alloc(22);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // icon type
	header.writeUInt16LE(1, 4); // one image
	header[6] = 0; // 0 means 256px
	header[7] = 0;
	header.writeUInt16LE(1, 10); // color planes
	header.writeUInt16LE(32, 12); // RGBA
	header.writeUInt32LE(png.length, 14);
	header.writeUInt32LE(header.length, 18);
	return Buffer.concat([header, png]);
}

fs.mkdirSync(buildDir, { recursive: true });
const svg = fs.readFileSync(sourcePath);
const png = await sharp(svg).resize(512, 512).png().toBuffer();
const ico = createIco(await sharp(svg).resize(256, 256).png().toBuffer());

fs.copyFileSync(sourcePath, path.join(buildDir, "icon.svg"));
fs.writeFileSync(path.join(buildDir, "icon.png"), png);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);
fs.writeFileSync(webFavicon, ico);
