#!/usr/bin/env bun
/**
 * Guard the committed logo asset set.
 *
 * The product mark is the concept-04 Cluster drawing (two rounded tiles, L + Z).
 * Every raster, favicon and app icon is derived from the SVGs under `assets/`,
 * so a hand-edited raster, a broken mask reference, or an external URL in an
 * SVG would ship a mark no one drew. This check is intentionally offline and
 * dependency-free: it parses the SVG/PNG/ICO bytes itself.
 *
 * Run: bun scripts/check-logo-assets.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const problems: string[] = [];

const resolve = (relative: string): string => path.join(repoRoot, relative);
const readText = (relative: string): string => fs.readFileSync(resolve(relative), "utf8");

/** Production drawings plus the archived concept set. */
const SVG_ASSETS = [
	"assets/zeta-mark.svg",
	"assets/zeta-mark-light.svg",
	"assets/zeta-mark-mono.svg",
	"assets/zeta-mark-mono-inverse.svg",
	"assets/zeta-mark-16.svg",
	"assets/icon.svg",
	"assets/icon-maskable.svg",
	"assets/legacy/zeta-mark-lz-legacy.svg",
	"assets/legacy/icon-lz-legacy.svg",
	"assets/archive/logo-2026/concepts/01-fold.svg",
	"assets/archive/logo-2026/concepts/02-aperture.svg",
	"assets/archive/logo-2026/concepts/02-aperture-16.svg",
	"assets/archive/logo-2026/concepts/03-prompt.svg",
	"assets/archive/logo-2026/concepts/03-prompt-16.svg",
	"assets/archive/logo-2026/concepts/04-cluster.svg",
	"assets/archive/logo-2026/concepts/04-cluster-16.svg",
	"assets/archive/logo-2026/concepts/05-loop.svg",
	"assets/archive/logo-2026/concepts/05-loop-16.svg",
	"assets/archive/logo-2026/concepts/06-lockup.svg",
] as const;

/** Rasters that must exist at exactly this pixel size. */
const PNG_ASSETS: ReadonlyArray<readonly [string, number]> = [
	["assets/zeta-mark-512.png", 512],
	["assets/zeta-mark-1024.png", 1024],
	["assets/zeta-mark-16.png", 16],
	["assets/zeta-mark-32.png", 32],
	["assets/zeta-mark-64.png", 64],
	["assets/icon-512.png", 512],
	["assets/icon-1024.png", 1024],
	["web-app/public/icon.png", 512],
	["web-ui/public/icons/icon-192.png", 192],
	["web-ui/public/icons/icon-512.png", 512],
	["web-ui/public/icons/icon-maskable-512.png", 512],
	["web-ui/public/icons/apple-touch-icon.png", 180],
	["main/crates/zetawork-gui/assets/icon.png", 256],
];

/** ICO carriers that must expose the tab/taskbar sizes. */
const ICO_ASSETS = [
	"assets/favicon.ico",
	"web-app/public/favicon.ico",
	"main/crates/zetawork-gui/assets/icon.ico",
	"packages/stats/src/client/favicon.ico",
] as const;

const REQUIRED_ICO_SIZES = [16, 32, 48, 64] as const;

/** Anything the calibration pass banned: flat marks only, no external loads. */
const FORBIDDEN_SVG = [
	[/\b(?:href|src)\s*=\s*["'](?!#)[^"']*["']/i, "references a non-local href/src"],
	[/\bxlink:href\s*=\s*["'](?!#)/i, "uses a non-local xlink:href"],
	[/url\(\s*["']?(?!#)/i, "builds a url() that is not a local id reference"],
	[/<script\b/i, "contains a script"],
	[/<image\b/i, "embeds a raster image"],
	[/@import\b/i, "imports an external stylesheet"],
	[/<(linearGradient|radialGradient|filter|pattern|feGaussianBlur)\b/i, "uses a gradient/filter/pattern"],
	[/\bfilter\s*=/i, "uses a filter attribute"],
	[/\bxmlns:(?:xlink|inkscape|sodipodi)\b/i, "carries editor/namespace baggage"],
] as const;

/** Find the end of a tag's `>` while ignoring `>` inside attribute quotes. */
function tagEnd(source: string, from: number): number {
	let quote: string | null = null;
	for (let index = from; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === ">") return index;
	}
	return -1;
}

/** Minimal XML well-formedness: balanced elements, terminated comments/PIs. */
function xmlProblems(source: string): string[] {
	const out: string[] = [];
	const stack: string[] = [];
	let index = 0;
	while (index < source.length) {
		const lt = source.indexOf("<", index);
		if (lt === -1) break;
		if (source.startsWith("<!--", lt)) {
			const end = source.indexOf("-->", lt + 4);
			if (end === -1) {
				out.push("unterminated comment");
				break;
			}
			index = end + 3;
			continue;
		}
		if (source.startsWith("<![CDATA[", lt)) {
			const end = source.indexOf("]]>", lt + 9);
			if (end === -1) {
				out.push("unterminated CDATA");
				break;
			}
			index = end + 3;
			continue;
		}
		if (source.startsWith("<?", lt)) {
			const end = source.indexOf("?>", lt + 2);
			if (end === -1) {
				out.push("unterminated processing instruction");
				break;
			}
			index = end + 2;
			continue;
		}
		const gt = tagEnd(source, lt + 1);
		if (gt === -1) {
			out.push("unterminated tag");
			break;
		}
		const tag = source.slice(lt + 1, gt).trim();
		if (tag.startsWith("/")) {
			const name = tag.slice(1).trim();
			const open = stack.pop();
			if (open !== name) out.push(`</${name}> closes <${open ?? "nothing"}>`);
		} else if (tag !== "" && !tag.endsWith("/") && !tag.startsWith("!")) {
			const name = /^[A-Za-z_][\w:.-]*/.exec(tag)?.[0];
			if (name) stack.push(name);
		}
		index = gt + 1;
	}
	if (stack.length > 0) out.push(`unclosed <${stack.join(">, <")}>`);
	return out;
}

function checkSvg(relative: string): void {
	const source = readText(relative);
	if (!source.includes("<svg")) problems.push(`${relative}: no <svg> root`);
	for (const [pattern, why] of FORBIDDEN_SVG) {
		if (pattern.test(source)) problems.push(`${relative}: ${why}`);
	}
	for (const issue of xmlProblems(source)) problems.push(`${relative}: ${issue}`);
	const ids = new Set(Array.from(source.matchAll(/\bid="([^"]+)"/g), match => match[1]));
	for (const match of source.matchAll(/url\(#([^)]+)\)/g)) {
		if (!ids.has(match[1]!)) problems.push(`${relative}: url(#${match[1]}) has no matching id`);
	}
}

interface PngSize {
	width: number;
	height: number;
}

function pngSize(bytes: Buffer): PngSize | undefined {
	if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return undefined;
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

interface IcoEntry {
	size: number;
	payload: Buffer;
}

function icoEntries(bytes: Buffer): IcoEntry[] | undefined {
	if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return undefined;
	const count = bytes.readUInt16LE(4);
	if (count === 0) return undefined;
	const entries: IcoEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		const at = 6 + index * 16;
		if (at + 16 > bytes.length) return undefined;
		const size = bytes[at] === 0 ? 256 : bytes[at]!;
		const offset = bytes.readUInt32LE(at + 12);
		const length = bytes.readUInt32LE(at + 8);
		if (offset + length > bytes.length) return undefined;
		entries.push({ size, payload: bytes.subarray(offset, offset + length) });
	}
	return entries;
}

function checkPng(relative: string, expected: number): void {
	const file = resolve(relative);
	if (!fs.existsSync(file)) {
		problems.push(`${relative}: missing`);
		return;
	}
	const size = pngSize(fs.readFileSync(file));
	if (!size) problems.push(`${relative}: not a PNG`);
	else if (size.width !== expected || size.height !== expected) {
		problems.push(`${relative}: ${size.width}x${size.height}, expected ${expected}x${expected}`);
	}
}

function checkIco(relative: string): void {
	const file = resolve(relative);
	if (!fs.existsSync(file)) {
		problems.push(`${relative}: missing`);
		return;
	}
	const entries = icoEntries(fs.readFileSync(file));
	if (!entries) {
		problems.push(`${relative}: not a non-empty ICO`);
		return;
	}
	const sizes = new Set(entries.map(entry => entry.size));
	for (const size of REQUIRED_ICO_SIZES) {
		if (!sizes.has(size)) problems.push(`${relative}: no ${size}px entry`);
	}
	for (const entry of entries) {
		const png = pngSize(entry.payload);
		if (!png) problems.push(`${relative}: ${entry.size}px entry is not a PNG payload`);
		else if (png.width !== entry.size) {
			problems.push(`${relative}: ${entry.size}px entry holds ${png.width}px pixels`);
		}
	}
}

for (const relative of SVG_ASSETS) {
	if (!fs.existsSync(resolve(relative))) problems.push(`${relative}: missing`);
	else checkSvg(relative);
}
for (const [relative, size] of PNG_ASSETS) checkPng(relative, size);
for (const relative of ICO_ASSETS) checkIco(relative);

// The stats dashboard serves a committed copy of the canonical favicon; a
// stale copy shows the previous mark in a browser tab.
if (
	!fs
		.readFileSync(resolve("packages/stats/src/client/favicon.ico"))
		.equals(fs.readFileSync(resolve("assets/favicon.ico")))
) {
	problems.push("packages/stats/src/client/favicon.ico: differs from assets/favicon.ico");
}

// 16px fallback: the cluster holds from 32px up, and the generator must switch.
const cluster = readText("assets/zeta-mark.svg");
if (!cluster.includes("zeta-mark-16.svg")) problems.push("assets/zeta-mark.svg: does not name the 16px fallback");
if (!cluster.includes("32px")) problems.push("assets/zeta-mark.svg: does not document the 32px threshold");
const fallback = readText("assets/zeta-mark-16.svg");
if (!fallback.includes("32 is the minimum")) problems.push("assets/zeta-mark-16.svg: does not document the threshold");
const generator = readText("desktop/scripts/generate-icon.mjs");
if (!generator.includes("size < 32 ? smallSourcePath")) {
	problems.push("desktop/scripts/generate-icon.mjs: 16/24 are not rendered from the fallback");
}
const registry = readText("document/agents/brand/registry.md");
for (const needle of ["zeta-mark-16.svg", "assets/legacy/zeta-mark-lz-legacy.svg", "32px"]) {
	if (!registry.includes(needle)) problems.push(`document/agents/brand/registry.md: missing ${needle}`);
}

// The archive is history: production drawings must not reach into it.
for (const relative of SVG_ASSETS.filter(name => !name.includes("/archive/") && !name.includes("/legacy/"))) {
	const source = readText(relative);
	if (source.includes("archive/logo-2026") || source.includes("legacy/")) {
		problems.push(`${relative}: references the archived/legacy set`);
	}
}
if (!fs.existsSync(resolve("assets/archive/logo-2026/README.md"))) {
	problems.push("assets/archive/logo-2026/README.md: missing");
}
const board = "assets/archive/logo-2026/concept-board.html";
if (!fs.existsSync(resolve(board))) problems.push(`${board}: missing`);
else {
	const html = readText(board);
	for (const needle of ["<style>", "m-c4", "m-c4-sm"]) {
		if (!html.includes(needle)) problems.push(`${board}: missing ${needle}`);
	}
	if (/<link\b[^>]*\bhref\s*=\s*["']https?:/i.test(html)) problems.push(`${board}: loads an external stylesheet`);
}

if (problems.length > 0) {
	for (const problem of problems) console.error(`logo asset: ${problem}`);
	process.exit(1);
}
console.log(
	`logo assets ok: ${SVG_ASSETS.length} SVG, ${PNG_ASSETS.length} PNG, ${ICO_ASSETS.length} ICO, archive + legacy preserved`,
);
