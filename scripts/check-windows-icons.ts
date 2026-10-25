#!/usr/bin/env bun
/**
 * Guard the Windows product icon surface.
 *
 * `bun scripts/check-windows-icons.ts` checks the source wiring: every Windows
 * executable builder must reference the same committed logo. `--binaries <exe…>`
 * additionally inspects built PE files and fails when a binary has no RT_ICON /
 * RT_GROUP_ICON resource, which is what Explorer, Start Menu and the installer
 * actually read. The release job runs this after building each Windows leg.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const icon = path.join(repoRoot, "main", "crates", "zetawork-gui", "assets", "icon.ico");

interface Problems {
	problems: string[];
}

function read(relative: string): string {
	return fs.readFileSync(path.join(repoRoot, relative), "utf8");
}

function expectIncludes(problems: string[], relative: string, needle: string): void {
	const content = read(relative);
	if (!content.includes(needle)) problems.push(`${relative}: missing ${JSON.stringify(needle)}`);
}

function checkSources(): Problems {
	const problems: string[] = [];
	if (!fs.existsSync(icon)) problems.push(`missing canonical icon: ${icon}`);
	expectIncludes(problems, "main/crates/zetawork-gui/assets/zetawork-gui.rc", '1 ICON "icon.ico"');
	expectIncludes(problems, "main/crates/zeta-main/assets/zeta-main.rc", "../zetawork-gui/assets/icon.ico");
	expectIncludes(problems, "termide/assets/termide.rc", "../../../main/crates/zetawork-gui/assets/icon.ico");
	expectIncludes(problems, "termide/assets/termide.rc", "@ZETA_ICON@");
	expectIncludes(problems, "termide/build.rs", 'join("zetawork-gui")');
	expectIncludes(
		problems,
		"packages/coding-agent/scripts/compile-binary.ts",
		'main", "crates", "zetawork-gui", "assets", "icon.ico"',
	);
	const installer = read("scripts/packaging/windows/installer.nsi");
	for (const needle of [
		'!if /FileExists "${SOURCE_DIR}/zetawork-gui.exe"',
		'File "${SRC}zetawork.ico"',
		'"$INSTDIR\\zetawork.ico" 0',
		'DisplayIcon" "$INSTDIR\\zetawork.ico"',
	]) {
		if (!installer.includes(needle)) problems.push(`scripts/packaging/windows/installer.nsi: missing ${needle}`);
	}
	return { problems };
}

/** Map a PE RVA to its file offset through the section table. */
function rvaToOffset(
	buffer: Buffer,
	peOffset: number,
	optionalOffset: number,
	sizeOfOptional: number,
	rva: number,
): number | undefined {
	const sectionOffset = optionalOffset + sizeOfOptional;
	const count = buffer.readUInt16LE(peOffset + 6);
	for (let index = 0; index < count; index++) {
		const at = sectionOffset + index * 40;
		const virtualAddress = buffer.readUInt32LE(at + 12);
		const virtualSize = buffer.readUInt32LE(at + 8);
		const rawSize = buffer.readUInt32LE(at + 16);
		const rawPointer = buffer.readUInt32LE(at + 20);
		if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) {
			return rawPointer + (rva - virtualAddress);
		}
	}
	return undefined;
}

interface PeResource {
	buffer: Buffer;
	peOffset: number;
	optionalOffset: number;
	sizeOfOptional: number;
	base: number;
}

interface ResourceEntry {
	id: number;
	directory: boolean;
	offset: number;
}

function peResource(buffer: Buffer): PeResource | undefined {
	if (buffer.length < 0x40 || buffer.toString("ascii", 0, 2) !== "MZ") return undefined;
	const peOffset = buffer.readUInt32LE(0x3c);
	if (peOffset + 24 > buffer.length || buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") return undefined;
	const optionalOffset = peOffset + 24;
	if (optionalOffset + 2 > buffer.length) return undefined;
	const magic = buffer.readUInt16LE(optionalOffset);
	const dataDirectoryOffset = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
	if (dataDirectoryOffset < 0 || dataDirectoryOffset + 24 > buffer.length) return undefined;
	const resourceRva = buffer.readUInt32LE(dataDirectoryOffset + 16);
	const resourceSize = buffer.readUInt32LE(dataDirectoryOffset + 20);
	if (resourceRva === 0 || resourceSize === 0) return undefined;
	const sizeOfOptional = buffer.readUInt16LE(peOffset + 20);
	const base = rvaToOffset(buffer, peOffset, optionalOffset, sizeOfOptional, resourceRva);
	if (base === undefined || base + 16 > buffer.length) return undefined;
	return { buffer, peOffset, optionalOffset, sizeOfOptional, base };
}

function resourceEntries(pe: PeResource, relativeOffset: number): ResourceEntry[] {
	const { buffer, base } = pe;
	const at = base + relativeOffset;
	if (relativeOffset < 0 || at + 16 > buffer.length) return [];
	const named = buffer.readUInt16LE(at + 12);
	const ids = buffer.readUInt16LE(at + 14);
	const count = named + ids;
	if (count > 4096) return [];
	const entries: ResourceEntry[] = [];
	for (let index = 0; index < count; index++) {
		const entry = at + 16 + index * 8;
		if (entry + 8 > buffer.length) return [];
		const nameOrId = buffer.readUInt32LE(entry);
		const target = buffer.readUInt32LE(entry + 4);
		if ((nameOrId & 0x80000000) !== 0) continue;
		entries.push({ id: nameOrId & 0xffff, directory: (target & 0x80000000) !== 0, offset: target & 0x7fffffff });
	}
	return entries;
}

function resourceType(pe: PeResource, type: number): ResourceEntry[] {
	const root = resourceEntries(pe, 0);
	const entry = root.find(candidate => candidate.id === type && candidate.directory);
	return entry ? resourceEntries(pe, entry.offset) : [];
}

function resourceData(pe: PeResource, entry: ResourceEntry): Buffer | undefined {
	if (!entry.directory) return undefined;
	const leaf = resourceEntries(pe, entry.offset)[0];
	if (!leaf || leaf.directory) return undefined;
	const at = pe.base + leaf.offset;
	if (at + 16 > pe.buffer.length) return undefined;
	const rva = pe.buffer.readUInt32LE(at);
	const size = pe.buffer.readUInt32LE(at + 4);
	const offset = rvaToOffset(pe.buffer, pe.peOffset, pe.optionalOffset, pe.sizeOfOptional, rva);
	if (offset === undefined || offset + size > pe.buffer.length) return undefined;
	return pe.buffer.subarray(offset, offset + size);
}

/** True when the PE contains a real icon resource (type 3 or 14). */
export function hasIconResource(buffer: Buffer): boolean {
	const pe = peResource(buffer);
	return pe !== undefined && (resourceType(pe, 3).length > 0 || resourceType(pe, 14).length > 0);
}

interface IconGroup {
	id: number;
	payloads: Buffer[];
}

/** Every well-formed RT_GROUP_ICON, keyed by its resource id. */
function iconGroups(buffer: Buffer): IconGroup[] | undefined {
	const pe = peResource(buffer);
	if (!pe) return undefined;
	const icons = new Map<number, Buffer>();
	for (const entry of resourceType(pe, 3)) {
		const data = resourceData(pe, entry);
		if (data) icons.set(entry.id, data);
	}
	const groups: IconGroup[] = [];
	for (const group of resourceType(pe, 14)) {
		const data = resourceData(pe, group);
		if (!data || data.length < 6 || data.readUInt16LE(2) !== 1) continue;
		const count = data.readUInt16LE(4);
		if (count === 0 || 6 + count * 14 > data.length) continue;
		const payloads: Buffer[] = [];
		let valid = true;
		for (let index = 0; index < count; index++) {
			const entry = 6 + index * 14;
			const id = data.readUInt16LE(entry + 12);
			const expectedSize = data.readUInt32LE(entry + 8);
			const payload = icons.get(id);
			if (!payload || payload.length !== expectedSize) {
				valid = false;
				break;
			}
			payloads.push(payload);
		}
		if (valid) groups.push({ id: group.id, payloads });
	}
	return groups;
}

function icoPayloads(bytes: Buffer): Buffer[] | undefined {
	if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return undefined;
	const count = bytes.readUInt16LE(4);
	if (count === 0 || 6 + count * 16 > bytes.length) return undefined;
	const payloads: Buffer[] = [];
	for (let index = 0; index < count; index++) {
		const entry = 6 + index * 16;
		const size = bytes.readUInt32LE(entry + 8);
		const offset = bytes.readUInt32LE(entry + 12);
		if (offset + size > bytes.length) return undefined;
		payloads.push(bytes.subarray(offset, offset + size));
	}
	return payloads;
}

function digest(payload: Buffer): string {
	return createHash("sha256").update(payload).digest("hex");
}

function samePayloads(left: Buffer[], right: Buffer[]): boolean {
	if (left.length !== right.length) return false;
	const a = left.map(digest).sort();
	const b = right.map(digest).sort();
	return a.every((hash, index) => hash === b[index]);
}

function checkBinaries(paths: string[]): Problems {
	const problems: string[] = [];
	const expected = icoPayloads(fs.readFileSync(icon));
	if (!expected) return { problems: [`${icon}: not a valid ICO file`] };
	for (const file of paths) {
		let bytes: Buffer;
		try {
			bytes = fs.readFileSync(file);
		} catch (error) {
			problems.push(`${file}: cannot read (${String(error)})`);
			continue;
		}
		if (!hasIconResource(bytes)) {
			problems.push(`${file}: no RT_ICON/RT_GROUP_ICON resource`);
			continue;
		}
		const groups = iconGroups(bytes);
		// Bun's cross-compiled Windows runtime carries its own group (id 640)
		// next to the icon passed via `windows.icon` (id 0); Windows picks the
		// lowest group id, so that is the one the shell and Explorer display.
		const primary = groups?.sort((left, right) => left.id - right.id)[0];
		if (!primary) {
			problems.push(`${file}: no well-formed RT_ICON/RT_GROUP_ICON resource`);
		} else if (!samePayloads(primary.payloads, expected)) {
			problems.push(`${file}: icon payload differs from ${path.relative(repoRoot, icon)}`);
		}
	}
	return { problems };
}

function main(): void {
	const args = process.argv.slice(2);
	const binariesIndex = args.indexOf("--binaries");
	const paths = binariesIndex >= 0 ? args.slice(binariesIndex + 1) : [];
	const result = paths.length > 0 ? checkBinaries(paths) : checkSources();
	if (result.problems.length > 0) {
		for (const problem of result.problems) console.error(`check-windows-icons: ${problem}`);
		process.exit(1);
	}
	console.log(paths.length > 0 ? `Windows icon resources OK: ${paths.length} PE file(s)` : "Windows icon wiring OK");
}

if (import.meta.main) main();
