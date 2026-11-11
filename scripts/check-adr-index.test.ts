import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAdrIndex } from "./check-adr-index";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

interface Fixture {
	dir: string;
	rows: string[];
}

function makeFixture(): Fixture {
	const dir = mkdtempSync(join(tmpdir(), "adr-check-"));
	tempDirs.push(dir);
	return { dir, rows: [] };
}

function addAdr(fixture: Fixture, id: string, slug: string): void {
	const file = `${id}-${slug}.md`;
	const title = `Decision ${id}`;
	const source = [
		`# ${id}. ${title}`,
		"",
		"- **Status:** Accepted",
		"- **Date:** 2026-11-11",
		"- **Deciders:** Test fixture",
		"- **Links:** none",
		"",
		"## Context",
		"",
		`Context for ${id}.`,
		"",
		"## Decision",
		"",
		`Decision for ${id}.`,
		"",
		"## Consequences",
		"",
		`Consequences of ${id}.`,
		"",
		"## Alternatives",
		"",
		`Alternatives for ${id}.`,
		"",
		"## Links",
		"",
		"None.",
		"",
	].join("\n");
	writeFileSync(join(fixture.dir, file), source);
	fixture.rows.push(`| [${id}](${file}) | ${title} | Accepted | 2026-11-11 | — | — |`);
}

function writeIndex(fixture: Fixture): void {
	const header = [
		"# Architecture Decision Records",
		"",
		"| ID | Title | Status | Date | Supersedes / superseded by | Links |",
		"| --- | --- | --- | --- | --- | --- |",
	];
	writeFileSync(join(fixture.dir, "README.md"), [...header, ...fixture.rows, ""].join("\n"));
}

function messagesFor(fixture: Fixture): string[] {
	return checkAdrIndex(fixture.dir).problems;
}

describe("checkAdrIndex", () => {
	it("accepts a monotonic ID set with gaps", () => {
		const fixture = makeFixture();
		for (const id of ["0001", "0003", "0007"]) addAdr(fixture, id, `decision-${id}`);
		writeIndex(fixture);

		const result = checkAdrIndex(fixture.dir);
		expect(result.problems).toEqual([]);
		expect(result.count).toBe(3);
	});

	it("accepts the integrated ADR set 0001-0009, 0011, 0015, 0020, 0025, 0026, 0027", () => {
		const fixture = makeFixture();
		const ids = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0011", "0015", "0020", "0025", "0026", "0027"];
		for (const id of ids) addAdr(fixture, id, `decision-${id}`);
		writeIndex(fixture);

		const result = checkAdrIndex(fixture.dir);
		expect(result.problems).toEqual([]);
		expect(result.count).toBe(ids.length);
	});

	it("rejects a duplicate ADR ID", () => {
		const fixture = makeFixture();
		addAdr(fixture, "0001", "first-decision");
		addAdr(fixture, "0001", "second-decision");
		writeIndex(fixture);

		const problems = messagesFor(fixture);
		expect(problems.some(problem => /duplicate ADR ID 0001/.test(problem))).toBe(true);
		expect(problems.some(problem => /duplicate index ID 0001/.test(problem))).toBe(true);
	});

	it("rejects an ADR with no index row", () => {
		const fixture = makeFixture();
		addAdr(fixture, "0001", "unindexed-decision");
		fixture.rows = [];
		writeIndex(fixture);

		const problems = messagesFor(fixture);
		expect(problems.some(problem => /missing index row for 0001-unindexed-decision\.md/.test(problem))).toBe(true);
	});

	it("rejects illegal filenames and the reserved ID 0000", () => {
		const fixture = makeFixture();
		writeFileSync(join(fixture.dir, "1-not-padded.md"), "# 1. Not padded\n");
		writeFileSync(join(fixture.dir, "0001-Bad_Slug.md"), "# 0001. Bad slug\n");
		addAdr(fixture, "0000", "reserved-id");

		const problems = messagesFor(fixture);
		expect(problems.some(problem => /1-not-padded\.md: expected NNNN-kebab-slug\.md/.test(problem))).toBe(true);
		expect(problems.some(problem => /0001-Bad_Slug\.md: expected NNNN-kebab-slug\.md/.test(problem))).toBe(true);
		expect(problems.some(problem => /0000-reserved-id\.md: ADR ID 0000 is not a legal identifier/.test(problem))).toBe(true);
	});

	it("rejects an empty placeholder ADR", () => {
		const fixture = makeFixture();
		const file = "0002-empty-placeholder.md";
		writeFileSync(
			join(fixture.dir, file),
			[
				"# 0002. Empty placeholder",
				"",
				"- **Status:** Proposed",
				"- **Date:** 2026-11-11",
				"- **Deciders:** Test fixture",
				"- **Links:** none",
				"",
				"## Context",
				"",
				"## Decision",
				"",
				"## Consequences",
				"",
				"## Alternatives",
				"",
				"## Links",
				"",
			].join("\n"),
		);
		fixture.rows.push(`| [0002](${file}) | 0002. Empty placeholder | Proposed | 2026-11-11 | — | — |`);
		writeIndex(fixture);

		const problems = messagesFor(fixture);
		expect(problems.some(problem => /empty placeholder \(no body text\)/.test(problem))).toBe(true);
	});
});
