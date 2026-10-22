#!/usr/bin/env bun
/**
 * Regenerate `main/crates/zetawork-gui/assets/icon.ico` from `assets/icon.png`.
 *
 * Windows needs a real icon resource in the PE — the window icon at runtime is
 * not what Explorer, the Start Menu or the installer display. This script
 * decodes the source PNG, box-filters it to the sizes Windows asks for and
 * packs them as an ICO with PNG-compressed entries (Vista and later read those
 * at every size).
 *
 * Run: bun scripts/packaging/windows/generate-icon.ts
 */

import { deflateSync, inflateSync } from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const SRC = path.join(ROOT, "main", "crates", "zetawork-gui", "assets", "icon.png");
const OUT = path.join(ROOT, "main", "crates", "zetawork-gui", "assets", "icon.ico");

interface Rgba {
	width: number;
	height: number;
	/** Unpremultiplied RGBA, row-major. */
	pixels: Buffer;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode the non-interlaced 8-bit RGBA/RGB PNG this asset uses. */
function decodePng(data: Buffer): Rgba {
	if (data.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
	let offset = 8;
	let width = 0;
	let height = 0;
	let colorType = 0;
	let bitDepth = 0;
	const idat: Buffer[] = [];
	while (offset < data.length) {
		const length = data.readUInt32BE(offset);
		const type = data.toString("ascii", offset + 4, offset + 8);
		const body = data.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			bitDepth = body[8]!;
			colorType = body[9]!;
			if (body[12] !== 0) throw new Error("interlaced PNGs are not supported");
		} else if (type === "IDAT") {
			idat.push(body);
		} else if (type === "IEND") {
			break;
		}
		offset += 12 + length;
	}
	if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
		throw new Error(`unsupported PNG: depth=${bitDepth} colorType=${colorType}`);
	}
	const channels = colorType === 6 ? 4 : 3;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const out = Buffer.alloc(width * height * 4);
	let previous = Buffer.alloc(stride);
	let position = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[position++]!;
		const line = Buffer.from(raw.subarray(position, position + stride));
		position += stride;
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? line[x - channels]! : 0;
			const up = previous[x]!;
			const upLeft = x >= channels ? previous[x - channels]! : 0;
			let value = line[x]!;
			if (filter === 1) value = (value + left) & 0xff;
			else if (filter === 2) value = (value + up) & 0xff;
			else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff;
			else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 0xff;
			else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
			line[x] = value;
		}
		for (let x = 0; x < width; x++) {
			const source = x * channels;
			const target = (y * width + x) * 4;
			out[target] = line[source]!;
			out[target + 1] = line[source + 1]!;
			out[target + 2] = line[source + 2]!;
			out[target + 3] = channels === 4 ? line[source + 3]! : 0xff;
		}
		previous = line;
	}
	return { width, height, pixels: out };
}

/** Area-average downscale; alpha is premultiplied first so edges stay clean. */
function resize(source: Rgba, size: number): Rgba {
	const out = Buffer.alloc(size * size * 4);
	const scaleX = source.width / size;
	const scaleY = source.height / size;
	for (let y = 0; y < size; y++) {
		const y0 = Math.floor(y * scaleY);
		const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
		for (let x = 0; x < size; x++) {
			const x0 = Math.floor(x * scaleX);
			const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let count = 0;
			for (let sy = y0; sy < Math.min(y1, source.height); sy++) {
				for (let sx = x0; sx < Math.min(x1, source.width); sx++) {
					const index = (sy * source.width + sx) * 4;
					const alpha = source.pixels[index + 3]! / 255;
					r += source.pixels[index]! * alpha;
					g += source.pixels[index + 1]! * alpha;
					b += source.pixels[index + 2]! * alpha;
					a += alpha;
					count++;
				}
			}
			const target = (y * size + x) * 4;
			const alpha = count > 0 ? a / count : 0;
			out[target] = alpha > 0 ? Math.round(r / count / alpha) : 0;
			out[target + 1] = alpha > 0 ? Math.round(g / count / alpha) : 0;
			out[target + 2] = alpha > 0 ? Math.round(b / count / alpha) : 0;
			out[target + 3] = Math.round(alpha * 255);
		}
	}
	return { width: size, height: size, pixels: out };
}

function crc32(buffer: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([head, body, crc]);
}

function encodePng(image: Rgba): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(image.width, 0);
	header.writeUInt32BE(image.height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const stride = image.width * 4;
	const raw = Buffer.alloc((stride + 1) * image.height);
	for (let y = 0; y < image.height; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function buildIco(images: Array<{ size: number; png: Buffer }>): Buffer {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: icon
	header.writeUInt16LE(images.length, 4);
	const entries: Buffer[] = [];
	let offset = 6 + images.length * 16;
	for (const { size, png } of images) {
		const entry = Buffer.alloc(16);
		entry[0] = size >= 256 ? 0 : size; // 0 means 256
		entry[1] = size >= 256 ? 0 : size;
		entry[2] = 0; // palette
		entry[3] = 0; // reserved
		entry.writeUInt16LE(1, 4); // colour planes
		entry.writeUInt16LE(32, 6); // bits per pixel
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		entries.push(entry);
		offset += png.length;
	}
	return Buffer.concat([header, ...entries, ...images.map(image => image.png)]);
}

const source = decodePng(fs.readFileSync(SRC));
const images = SIZES.map(size => ({ size, png: encodePng(resize(source, size)) }));
fs.writeFileSync(OUT, buildIco(images));
console.log(`wrote ${path.relative(ROOT, OUT)} (${SIZES.join(", ")} px)`);
