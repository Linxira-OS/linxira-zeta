import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { editBlackboxPath, readEditBlackbox } from "./blackbox";
import { revertLastEdit } from "./revert";

let tempDir: TempDir;
let dir: string;

beforeEach(() => {
	tempDir = TempDir.createSync("@omp-edit-revert-");
	dir = tempDir.path();
});

afterEach(async () => {
	await tempDir.remove();
});

/** Append one blackbox entry, as the recorder would. */
function record(targetPath: string, prev: string, next: string): void {
	fs.appendFileSync(
		editBlackboxPath(dir),
		`${JSON.stringify({ path: targetPath, prev, new: next, model: "test", variant: "replace", arg: {} })}\n`,
	);
}

/** Write the on-disk file and give it a recorded transition into that content. */
function seed(name: string, before: string, after: string): string {
	const absolute = path.join(dir, name);
	fs.writeFileSync(absolute, after);
	record(name, before, after);
	return absolute;
}

describe("revertLastEdit", () => {
	test("restores the file to its pre-edit content", async () => {
		const absolute = seed("a.txt", "BEFORE", "AFTER");

		const outcome = await revertLastEdit(dir, "a.txt", absolute);

		expect(outcome.status).toBe("reverted");
		expect(fs.readFileSync(absolute, "utf8")).toBe("BEFORE");
	});

	test("refuses when the file changed outside the recorded edits", async () => {
		const absolute = seed("b.txt", "BEFORE", "AFTER");
		// A bash edit, a hand edit or another agent leaves no trace in the log.
		fs.writeFileSync(absolute, "HAND EDITED");

		const outcome = await revertLastEdit(dir, "b.txt", absolute);

		expect(outcome.status).toBe("diverged");
		// The whole point: an untracked change is never overwritten.
		expect(fs.readFileSync(absolute, "utf8")).toBe("HAND EDITED");
	});

	test("reports a deleted file instead of recreating it", async () => {
		record("c.txt", "BEFORE", "AFTER");

		const outcome = await revertLastEdit(dir, "c.txt", path.join(dir, "c.txt"));

		expect(outcome.status).toBe("missing");
		expect(fs.existsSync(path.join(dir, "c.txt"))).toBe(false);
	});

	test("reports unrecorded when the path has no entries", async () => {
		const absolute = path.join(dir, "d.txt");
		fs.writeFileSync(absolute, "UNTOUCHED");

		const outcome = await revertLastEdit(dir, "d.txt", absolute);

		expect(outcome.status).toBe("unrecorded");
		expect(fs.readFileSync(absolute, "utf8")).toBe("UNTOUCHED");
	});

	test("reverts to the state before the newest edit", async () => {
		const absolute = path.join(dir, "e.txt");
		fs.writeFileSync(absolute, "V1");
		record("e.txt", "V0", "V1");
		fs.writeFileSync(absolute, "V2");
		record("e.txt", "V1", "V2");

		const outcome = await revertLastEdit(dir, "e.txt", absolute);

		expect(outcome.status).toBe("reverted");
		expect(fs.readFileSync(absolute, "utf8")).toBe("V1");
	});

	test("only reverts the requested path", async () => {
		const target = seed("target.txt", "BEFORE", "AFTER");
		const other = seed("other.txt", "OBEFORE", "OAFTER");

		await revertLastEdit(dir, "target.txt", target);

		expect(fs.readFileSync(target, "utf8")).toBe("BEFORE");
		expect(fs.readFileSync(other, "utf8")).toBe("OAFTER");
	});

	test("records the revert so the log stays a truthful sequence", async () => {
		const absolute = seed("f.txt", "BEFORE", "AFTER");

		await revertLastEdit(dir, "f.txt", absolute);
		const { entries } = await readEditBlackbox(dir, { path: "f.txt" });

		expect(entries).toHaveLength(2);
		expect(entries[1]?.model).toBe("revert");
		// The revert's own "new" is the content it wrote back.
		expect(entries[1]?.new).toBe("BEFORE");
		expect(entries[1]?.prev).toBe("AFTER");
	});

	test("a revert can itself be reverted", async () => {
		const absolute = seed("g.txt", "BEFORE", "AFTER");

		await revertLastEdit(dir, "g.txt", absolute);
		expect(fs.readFileSync(absolute, "utf8")).toBe("BEFORE");

		// The appended revert entry is itself a recorded transition, so undoing
		// the undo restores the file rather than dead-ending.
		const second = await revertLastEdit(dir, "g.txt", absolute);

		expect(second.status).toBe("reverted");
		expect(fs.readFileSync(absolute, "utf8")).toBe("AFTER");
	});
});

describe("readEditBlackbox", () => {
	test("returns nothing when the log does not exist", async () => {
		expect((await readEditBlackbox(dir)).entries).toEqual([]);
	});

	test("keeps earlier lines when the final append was torn", async () => {
		record("a.txt", "p1", "n1");
		record("a.txt", "p2", "n2");
		// A write interrupted mid-append leaves a partial final line.
		fs.appendFileSync(editBlackboxPath(dir), '{"path":"torn.txt","prev":"x"');

		const { entries, corruptLines } = await readEditBlackbox(dir);

		expect(entries.map(entry => entry.path)).toEqual(["a.txt", "a.txt"]);
		// A torn tail is an expected outcome, not corruption.
		expect(corruptLines).toBe(0);
	});

	test("skips a corrupt line that is followed by more content", async () => {
		record("a.txt", "p1", "n1");
		fs.appendFileSync(editBlackboxPath(dir), "not json at all\n");
		record("c.txt", "p3", "n3");

		const { entries, corruptLines } = await readEditBlackbox(dir);

		expect(entries.map(entry => entry.path)).toEqual(["a.txt", "c.txt"]);
		expect(corruptLines).toBe(1);
	});

	test("returns entries written before path existed without inventing one", async () => {
		fs.appendFileSync(
			editBlackboxPath(dir),
			`${JSON.stringify({ prev: "p", new: "n", model: "old", variant: "replace", arg: { file: "x" } })}\n`,
		);

		const { entries } = await readEditBlackbox(dir);
		const [entry] = entries;

		expect(entry?.prev).toBe("p");
		// `arg` sometimes holds a path; it is not a substitute for a real one.
		expect(entry?.path).toBeUndefined();
	});

	test("filters by path", async () => {
		record("a.txt", "p1", "n1");
		record("b.txt", "p2", "n2");

		const { entries } = await readEditBlackbox(dir, { path: "b.txt" });

		expect(entries).toHaveLength(1);
		expect(entries[0]?.path).toBe("b.txt");
	});

	test("since keeps the most recent entries", async () => {
		record("a.txt", "p1", "n1");
		record("a.txt", "p2", "n2");
		record("a.txt", "p3", "n3");

		const { entries } = await readEditBlackbox(dir, { since: 2 });

		expect(entries.map(entry => entry.new)).toEqual(["n2", "n3"]);
	});

	test("ignores entries missing the content fields", async () => {
		fs.appendFileSync(editBlackboxPath(dir), `${JSON.stringify({ path: "x.txt" })}\n`);
		record("y.txt", "p", "n");

		const { entries, corruptLines } = await readEditBlackbox(dir);

		expect(entries.map(entry => entry.path)).toEqual(["y.txt"]);
		expect(corruptLines).toBe(1);
	});
});
