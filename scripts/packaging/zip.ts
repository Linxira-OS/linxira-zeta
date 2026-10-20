/**
 * A deflate zip writer, shared by the release packagers.
 *
 * The release image is an ubuntu runner where `/usr/bin/zip` exists, but a
 * local Windows verification has no zip in PATH, and a packaging step that only
 * works on one host is a trap. Two release assets need a real zip — the desktop
 * archive and the example-plugin environment — so the writer lives here rather
 * than in either script.
 *
 * No external dependency: local file headers + central directory + end record,
 * deflate via `node:zlib`, UTF-8 names flagged (bit 11) so a plugin directory
 * called with non-ASCII filenames still extracts. Entries are stored in the
 * order given, which is what makes a rebuild byte-identical when both inputs
 * are.
 */
import * as fs from "node:fs/promises";
import * as zlib from "node:zlib";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

/** One file to pack: the archive name and the file on disk. */
export interface ZipEntry {
	/** Path inside the archive, POSIX separators, no leading slash. */
	name: string;
	/** Absolute or relative path of the file to read. */
	file: string;
}

export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** Write `entries` as a deflate-compressed zip at `outPath`. */
export async function writeZip(entries: ReadonlyArray<ZipEntry>, outPath: string): Promise<void> {
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
