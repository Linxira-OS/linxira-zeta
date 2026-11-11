#!/usr/bin/env bun
/**
 * Structural guard for `document/adr/`.
 *
 * Checks that:
 * - every ADR filename is `NNNN-kebab-slug.md` and IDs are sequential;
 * - every ADR has a title, a status, and the required sections;
 * - the README index has exactly one row per ADR and no orphan rows;
 * - index ID, filename, title, and status match the ADR;
 * - no ADR ID or filename is duplicated.
 *
 * It deliberately does not judge the content of a decision. Run it with
 * `bun run check:adr`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADR_DIR = "document/adr";
const README_PATH = join(ADR_DIR, "README.md");
const STATUSES: Record<string, true> = {
	Proposed: true,
	Accepted: true,
	Superseded: true,
	Deprecated: true,
};
const REQUIRED_SECTIONS = ["Context", "Decision", "Consequences", "Alternatives", "Links"];
const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

interface IndexRow {
	id: string;
	file: string;
	title: string;
	status: string;
}

const problems: string[] = [];

function fail(message: string): void {
	problems.push(message);
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		fail(`cannot read ${path}`);
		return "";
	}
}

function parseIndex(source: string): IndexRow[] {
	const rows: IndexRow[] = [];
	for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
		if (!line.startsWith("|")) continue;
		const match = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([A-Za-z]+)\s*\|/.exec(line);
		if (!match) continue;
		const [, id, file, title, status] = match;
		rows.push({ id, file, title: title.trim(), status });
		if (!ADR_FILE.test(file) || !file.startsWith(`${id}-`)) {
			fail(`${README_PATH}:${lineNumber + 1}: index link ${file} does not match ID ${id}`);
		}
	}
	return rows;
}

const entries = readdirSync(ADR_DIR, { withFileTypes: true })
	.filter(entry => entry.isFile() && entry.name.endsWith(".md"))
	.map(entry => entry.name)
	.sort();

for (const name of entries) {
	if (name === "README.md" || name === "template.md") continue;
	if (!ADR_FILE.test(name)) {
		fail(`${ADR_DIR}/${name}: expected NNNN-kebab-slug.md`);
	}
}

const adrFiles = entries.filter(name => ADR_FILE.test(name));
const indexRows = parseIndex(readText(README_PATH));

const seenFiles = new Set<string>();
const seenIds = new Set<string>();
const indexByFile = new Map<string, IndexRow>();

for (const row of indexRows) {
	if (seenIds.has(row.id)) fail(`${README_PATH}: duplicate index ID ${row.id}`);
	seenIds.add(row.id);
	if (indexByFile.has(row.file)) fail(`${README_PATH}: duplicate index row for ${row.file}`);
	indexByFile.set(row.file, row);
	if (STATUSES[row.status] !== true) {
		fail(`${README_PATH}: ${row.id} has unknown status "${row.status}"`);
	}
}

const ids: number[] = [];
for (const file of adrFiles) {
	const id = file.slice(0, 4);
	ids.push(Number(id));
	if (seenFiles.has(file)) fail(`${ADR_DIR}/${file}: duplicate filename`);
	seenFiles.add(file);

	const source = readText(join(ADR_DIR, file));
	const heading = /^#\s+(\d{4})\.\s+(.+?)\s*$/m.exec(source);
	if (!heading) {
		fail(`${ADR_DIR}/${file}: missing "# NNNN. Title" heading`);
	} else if (heading[1] !== id) {
		fail(`${ADR_DIR}/${file}: heading ID ${heading[1]} does not match filename ID ${id}`);
	}

	const statusMatch = /^-\s+\*\*Status:\*\*\s+([A-Za-z]+)/m.exec(source);
	const status = statusMatch?.[1];
	if (!status) {
		fail(`${ADR_DIR}/${file}: missing "- **Status:**" metadata`);
	} else if (STATUSES[status] !== true) {
		fail(`${ADR_DIR}/${file}: unknown status "${status}"`);
	}

	for (const section of REQUIRED_SECTIONS) {
		const sectionPattern = new RegExp(`^##\\s+${section}\\s*$`, "m");
		if (!sectionPattern.test(source)) fail(`${ADR_DIR}/${file}: missing "## ${section}" section`);
	}

	const row = indexByFile.get(file);
	if (!row) {
		fail(`${README_PATH}: missing index row for ${file}`);
		continue;
	}
	if (row.id !== id) fail(`${README_PATH}: row for ${file} uses ID ${row.id}`);
	if (heading && row.title !== heading[2]) {
		fail(`${README_PATH}: row for ${file} has title "${row.title}", expected "${heading[2]}"`);
	}
	if (status && row.status !== status) {
		fail(`${README_PATH}: row for ${file} has status ${row.status}, expected ${status}`);
	}
}

for (const row of indexRows) {
	if (!seenFiles.has(row.file)) fail(`${README_PATH}: row for ${row.file} has no ADR file`);
}

ids.sort((a, b) => a - b);
for (const [index, id] of ids.entries()) {
	const expected = index + 1;
	if (id !== expected) {
		fail(`${ADR_DIR}: expected ADR ${String(expected).padStart(4, "0")}, found ${String(id).padStart(4, "0")}`);
	}
}

if (problems.length > 0) {
	console.error("ADR index check failed:");
	for (const problem of problems) console.error(`- ${problem}`);
	process.exit(1);
}

console.log(`ADR index check passed: ${adrFiles.length} records.`);
