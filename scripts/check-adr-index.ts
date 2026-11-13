#!/usr/bin/env bun
/**
 * Structural guard for `document/adr/`.
 *
 * Checks that:
 * - every ADR filename is `NNNN-kebab-slug.md`, and IDs are legal, unique, and
 *   strictly increasing (gaps are allowed);
 * - every ADR has a title, a status, non-empty body text, and the required sections;
 * - the README index has exactly one row per ADR and no orphan rows;
 * - index ID, filename, title, and status match the ADR;
 * - no ADR ID or filename is duplicated.
 *
 * Numbering is a stable identifier, not a dense sequence: an ID is never reused,
 * renumbered, or backfilled with a placeholder. A gap means the ID was consumed
 * elsewhere, so the guard accepts `0001, 0002, 0005` but still rejects a
 * duplicate or a filename that does not encode a legal ID.
 *
 * It deliberately does not judge the content of a decision. Run it with
 * `bun run check:adr`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADR_DIR = "document/adr";
const STATUSES: Record<string, true> = {
	Proposed: true,
	Accepted: true,
	Superseded: true,
	Deprecated: true,
};
const REQUIRED_SECTIONS = ["Context", "Decision", "Consequences", "Alternatives", "Links"];
const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const METADATA_LINE = /^-\s+\*\*(?:Status|Date|Deciders|Links|Supersedes|Superseded by):\*\*/;

export interface IndexRow {
	id: string;
	file: string;
	title: string;
	status: string;
}

export interface AdrIndexCheck {
	adrDir: string;
	readmePath: string;
	problems: string[];
	count: number;
}

/**
 * Check one ADR directory. Returns every structural problem instead of exiting,
 * so tests can assert on individual failures.
 */
export function checkAdrIndex(adrDir: string = ADR_DIR): AdrIndexCheck {
	const readmePath = join(adrDir, "README.md");
	const problems: string[] = [];
	const fail = (message: string): void => {
		problems.push(message);
	};

	const readText = (path: string): string => {
		try {
			return readFileSync(path, "utf8");
		} catch {
			fail(`cannot read ${path}`);
			return "";
		}
	};

	const parseIndex = (source: string): IndexRow[] => {
		const rows: IndexRow[] = [];
		for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
			if (!line.startsWith("|")) continue;
			const match = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([A-Za-z]+)\s*\|/.exec(line);
			if (!match) continue;
			const [, id, file, title, status] = match;
			rows.push({ id, file, title: title.trim(), status });
			if (!ADR_FILE.test(file) || !file.startsWith(`${id}-`)) {
				fail(`${readmePath}:${lineNumber + 1}: index link ${file} does not match ID ${id}`);
			}
		}
		return rows;
	};

	let entries: string[];
	try {
		entries = readdirSync(adrDir, { withFileTypes: true })
			.filter(entry => entry.isFile() && entry.name.endsWith(".md"))
			.map(entry => entry.name)
			.sort();
	} catch {
		fail(`cannot read ${adrDir}`);
		return { adrDir, readmePath, problems, count: 0 };
	}

	for (const name of entries) {
		if (name === "README.md" || name === "template.md") continue;
		if (!ADR_FILE.test(name)) {
			fail(`${adrDir}/${name}: expected NNNN-kebab-slug.md`);
		}
	}

	const adrFiles = entries.filter(name => ADR_FILE.test(name));
	const indexRows = parseIndex(readText(readmePath));

	const seenFiles = new Set<string>();
	const seenIds = new Set<string>();
	const seenNumericIds = new Set<number>();
	const indexByFile = new Map<string, IndexRow>();

	for (const row of indexRows) {
		if (seenIds.has(row.id)) fail(`${readmePath}: duplicate index ID ${row.id}`);
		seenIds.add(row.id);
		if (indexByFile.has(row.file)) fail(`${readmePath}: duplicate index row for ${row.file}`);
		indexByFile.set(row.file, row);
		if (STATUSES[row.status] !== true) {
			fail(`${readmePath}: ${row.id} has unknown status "${row.status}"`);
		}
	}

	const ids: number[] = [];
	for (const file of adrFiles) {
		const id = file.slice(0, 4);
		const numericId = Number(id);
		ids.push(numericId);
		if (numericId < 1) {
			fail(`${adrDir}/${file}: ADR ID ${id} is not a legal identifier (0000 is reserved)`);
		}
		if (seenNumericIds.has(numericId)) {
			fail(`${adrDir}/${file}: duplicate ADR ID ${id}`);
		}
		seenNumericIds.add(numericId);
		if (seenFiles.has(file)) fail(`${adrDir}/${file}: duplicate filename`);
		seenFiles.add(file);

		const source = readText(join(adrDir, file));
		const heading = /^#\s+(\d{4})\.\s+(.+?)\s*$/m.exec(source);
		if (!heading) {
			fail(`${adrDir}/${file}: missing "# NNNN. Title" heading`);
		} else if (heading[1] !== id) {
			fail(`${adrDir}/${file}: heading ID ${heading[1]} does not match filename ID ${id}`);
		}

		const body = source
			.replace(/^#\s+.*$/gm, "")
			.replace(/^##\s+.*$/gm, "")
			.split(/\r?\n/)
			.filter(line => !METADATA_LINE.test(line))
			.join("")
			.trim();
		if (body.length === 0) {
			fail(`${adrDir}/${file}: empty placeholder (no body text)`);
		}

		const statusMatch = /^-\s+\*\*Status:\*\*\s+([A-Za-z]+)/m.exec(source);
		const status = statusMatch?.[1];
		if (!status) {
			fail(`${adrDir}/${file}: missing "- **Status:**" metadata`);
		} else if (STATUSES[status] !== true) {
			fail(`${adrDir}/${file}: unknown status "${status}"`);
		}

		for (const section of REQUIRED_SECTIONS) {
			const sectionPattern = new RegExp(`^##\\s+${section}\\s*$`, "m");
			if (!sectionPattern.test(source)) fail(`${adrDir}/${file}: missing "## ${section}" section`);
		}

		const row = indexByFile.get(file);
		if (!row) {
			fail(`${readmePath}: missing index row for ${file}`);
			continue;
		}
		if (row.id !== id) fail(`${readmePath}: row for ${file} uses ID ${row.id}`);
		if (heading && row.title !== heading[2]) {
			fail(`${readmePath}: row for ${file} has title "${row.title}", expected "${heading[2]}"`);
		}
		if (status && row.status !== status) {
			fail(`${readmePath}: row for ${file} has status ${row.status}, expected ${status}`);
		}
	}

	for (const row of indexRows) {
		if (!seenFiles.has(row.file)) fail(`${readmePath}: row for ${row.file} has no ADR file`);
	}

	ids.sort((a, b) => a - b);
	for (let index = 1; index < ids.length; index++) {
		if (ids[index] <= ids[index - 1]) {
			const previous = String(ids[index - 1]).padStart(4, "0");
			const current = String(ids[index]).padStart(4, "0");
			fail(`${adrDir}: ADR IDs must be strictly increasing (${previous} then ${current})`);
		}
	}

	return { adrDir, readmePath, problems, count: adrFiles.length };
}

if (import.meta.main) {
	const { problems, count } = checkAdrIndex();
	if (problems.length > 0) {
		console.error("ADR index check failed:");
		for (const problem of problems) console.error(`- ${problem}`);
		process.exit(1);
	}
	console.log(`ADR index check passed: ${count} records.`);
}
