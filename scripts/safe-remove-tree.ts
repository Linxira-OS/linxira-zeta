// Safe tree removal for the Windows junction landmine.
//
// On Windows, bun's workspace links are *junctions*; `rm -rf` walks through
// them and deletes the linked-to source tree (2026-10-15: a stray
// `node_modules/@linxiraos/pi-ai` junction pointed at `<repo>/packages/ai`).
// This tool therefore never deletes a linked directory's contents:
//
//   list  <dir>   report every link and its target, plus entry counts. No writes.
//   apply <dir>   delete links first, re-scan to prove zero links remain, and
//                 only then remove the (now plain) tree. If any link survives
//                 the first pass it stops with exit 3 and deletes nothing else.
//
// use: bun scripts/safe-remove-tree.ts <list|apply> <dir>

import { lstatSync, readdirSync, readlinkSync, rmdirSync, rmSync, unlinkSync } from "node:fs";

export type LinkHit = { path: string; target: string };

/** Every symbolic link / junction in `dir`, depth-first, never following one. */
export function scanLinks(dir: string, hits: LinkHit[] = []): LinkHit[] {
	let st;
	try {
		st = lstatSync(dir);
	} catch {
		return hits;
	}
	if (st.isSymbolicLink()) {
		let target = "?";
		try {
			target = readlinkSync(dir);
		} catch {}
		hits.push({ path: dir, target });
		return hits;
	}
	if (st.isDirectory()) {
		let entries: string[] = [];
		try {
			entries = readdirSync(dir);
		} catch {}
		for (const entry of entries) scanLinks(`${dir}\\${entry}`, hits);
	}
	return hits;
}

/** Remove each entry that is a link; leaves every real directory alone. */
export function removeLinks(dir: string): void {
	let st;
	try {
		st = lstatSync(dir);
	} catch {
		return;
	}
	if (st.isSymbolicLink()) {
		// A junction is a directory with a reparse point: rmdir drops the link
		// itself, while unlink covers file symlinks.
		try {
			rmdirSync(dir);
		} catch {
			unlinkSync(dir);
		}
		return;
	}
	if (!st.isDirectory()) return;
	for (const entry of readdirSync(dir)) removeLinks(`${dir}\\${entry}`);
}

export function countEntries(dir: string): { dirs: number; files: number } {
	let dirs = 0;
	let files = 0;
	const walk = (path: string): void => {
		let st;
		try {
			st = lstatSync(path);
		} catch {
			return;
		}
		if (st.isSymbolicLink()) return;
		if (st.isDirectory()) {
			dirs++;
			for (const entry of readdirSync(path)) walk(`${path}\\${entry}`);
			return;
		}
		files++;
	};
	walk(dir);
	return { dirs, files };
}

export function safeRemoveTree(dir: string): { links: LinkHit[]; dirs: number; files: number } {
	const links = scanLinks(dir);
	const { dirs, files } = countEntries(dir);
	removeLinks(dir);
	const survivors = scanLinks(dir);
	if (survivors.length > 0) {
		const detail = survivors.map(hit => `  ${hit.path} -> ${hit.target}`).join("\n");
		throw new Error(`still ${survivors.length} link(s) after the first pass; nothing else deleted:\n${detail}`);
	}
	rmSync(dir, { recursive: true, force: true });
	return { links, dirs, files };
}

function main(): void {
	const [mode, dir] = process.argv.slice(2);
	if (!mode || !dir || (mode !== "list" && mode !== "apply")) {
		console.error("usage: bun scripts/safe-remove-tree.ts <list|apply> <dir>");
		process.exit(2);
	}
	if (mode === "list") {
		const links = scanLinks(dir);
		const { dirs, files } = countEntries(dir);
		console.log(`${dir}: ${links.length} link(s), ${dirs} dir(s), ${files} file(s)`);
		for (const hit of links) console.log(`  LINK ${hit.path}\n       -> ${hit.target}`);
		return;
	}
	const { links, dirs, files } = safeRemoveTree(dir);
	console.log(`removed ${dir}: ${links.length} link(s) deleted first, then ${dirs} dir(s) + ${files} file(s)`);
}

if (import.meta.main) main();
