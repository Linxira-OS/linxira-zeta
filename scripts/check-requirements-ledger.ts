#!/usr/bin/env bun
/**
 * Structural guard for `document/requirements-ledger.md`.
 *
 * Checks that:
 * - every ledger row has a `REQ-NNN` ID and IDs are sequential with no gaps;
 * - no ID is duplicated;
 * - the status is one of the vocabulary values;
 * - the priority is P0-P3;
 * - every row carries requirement, scope, acceptance, lane, evidence, remaining;
 * - dependencies point at IDs that exist in the ledger;
 * - IMPLEMENTED rows point at a file/commit/PR;
 * - VERIFIED rows point at a check/test/CI/PR;
 * - RELEASED rows point at a release/tag.
 *
 * It deliberately does not judge whether the evidence is honest. Run it with
 * `bun run check:reqs`.
 */
import { readFileSync } from "node:fs";

const LEDGER_PATH = "document/requirements-ledger.md";
const STATUSES: Record<string, true> = {
	INBOX: true,
	TRIAGED: true,
	SCOPED: true,
	IN_PROGRESS: true,
	IMPLEMENTED: true,
	VERIFIED: true,
	RELEASED: true,
	DEFERRED: true,
	BLOCKED: true,
};
const PRIORITIES: Record<string, true> = { P0: true, P1: true, P2: true, P3: true };
const DONE_STATUSES: Record<string, true> = { IMPLEMENTED: true, VERIFIED: true, RELEASED: true };
const REQUIRED_COLUMNS = 10;
const ID_PATTERN = /^REQ-\d{3}$/;
const VERIFIED_MARKER = /\b(test|tests|check|checks|CI|PR #|bun run|workflow)\b/i;
const RELEASED_MARKER = /\b(release|tag|published|shipped)\b/i;

const problems: string[] = [];

function fail(message: string): void {
	problems.push(message);
}

interface Row {
	line: number;
	id: string;
	cells: string[];
}

const source = (() => {
	try {
		return readFileSync(LEDGER_PATH, "utf8");
	} catch {
		fail(`cannot read ${LEDGER_PATH}`);
		return "";
	}
})();

const rows: Row[] = [];
for (const [index, line] of source.split(/\r?\n/).entries()) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("| REQ-")) continue;
	const cells = trimmed
		.split("|")
		.slice(1, -1)
		.map(cell => cell.trim());
	if (cells.length !== REQUIRED_COLUMNS) {
		fail(`${LEDGER_PATH}:${index + 1}: expected ${REQUIRED_COLUMNS} columns, found ${cells.length}`);
		continue;
	}
	const [id, requirement, scope, acceptance, priority, status, lane, , evidence, remaining] = cells;
	if (!ID_PATTERN.test(id)) fail(`${LEDGER_PATH}:${index + 1}: invalid ID "${id}"`);
	for (const [name, value] of [
		["Requirement", requirement],
		["Scope", scope],
		["Acceptance", acceptance],
		["Lane / owner", lane],
		["Evidence", evidence],
		["Remaining", remaining],
	] as const) {
		if (value === "" || value === "—") fail(`${LEDGER_PATH}:${index + 1}: ${id} has empty ${name}`);
	}
	if (PRIORITIES[priority] !== true) fail(`${LEDGER_PATH}:${index + 1}: ${id} has invalid priority "${priority}"`);
	if (STATUSES[status] !== true) fail(`${LEDGER_PATH}:${index + 1}: ${id} has invalid status "${status}"`);
	if (DONE_STATUSES[status] === true) {
		if (evidence === "" || evidence === "—") {
			fail(`${LEDGER_PATH}:${index + 1}: ${id} is ${status} without evidence`);
		} else if (status === "VERIFIED" && !VERIFIED_MARKER.test(evidence)) {
			fail(`${LEDGER_PATH}:${index + 1}: ${id} is VERIFIED but evidence names no test/check/CI/PR`);
		} else if (status === "RELEASED" && !RELEASED_MARKER.test(evidence)) {
			fail(`${LEDGER_PATH}:${index + 1}: ${id} is RELEASED but evidence names no release/tag`);
		}
	}
	rows.push({ line: index + 1, id, cells });
}

const ids = new Set<string>();
for (const row of rows) {
	if (ids.has(row.id)) fail(`${LEDGER_PATH}:${row.line}: duplicate ID ${row.id}`);
	ids.add(row.id);
}

const numbers = [...ids].map(id => Number(id.slice(4))).sort((a, b) => a - b);
for (const [index, number] of numbers.entries()) {
	const expected = index + 1;
	if (number !== expected) {
		fail(
			`${LEDGER_PATH}: expected REQ-${String(expected).padStart(3, "0")}, found REQ-${String(number).padStart(3, "0")}`,
		);
	}
}

for (const row of rows) {
	const dependsOn = row.cells[7];
	if (dependsOn === "—") continue;
	for (const dependency of dependsOn.split(",").map(value => value.trim())) {
		if (!ID_PATTERN.test(dependency)) {
			fail(`${LEDGER_PATH}:${row.line}: ${row.id} has malformed dependency "${dependency}"`);
		} else if (!ids.has(dependency)) {
			fail(`${LEDGER_PATH}:${row.line}: ${row.id} depends on missing ${dependency}`);
		}
	}
}

if (problems.length > 0) {
	console.error("Requirements ledger check failed:");
	for (const problem of problems) console.error(`- ${problem}`);
	process.exit(1);
}

const counts = new Map<string, number>();
for (const row of rows) counts.set(row.cells[5], (counts.get(row.cells[5]) ?? 0) + 1);
const summary = [...counts.entries()]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([status, count]) => `${status} ${count}`)
	.join(", ");
console.log(`Requirements ledger check passed: ${rows.length} rows (${summary}).`);
