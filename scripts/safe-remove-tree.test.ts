// The landmine this guards: a linked directory whose contents must survive the
// removal of the tree that links to it (Windows junction / symlink).

import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { safeRemoveTree, scanLinks } from "./safe-remove-tree";

const roots: string[] = [];

function fixture(): { root: string; victim: string; sentinel: string } {
	const root = mkdtempSync(join(tmpdir(), "safe-remove-tree-"));
	roots.push(root);
	const victim = join(root, "victim");
	mkdirSync(victim);
	writeFileSync(join(victim, "keep.txt"), "do not delete me");
	const tree = join(root, "tree");
	mkdirSync(join(tree, "sub"), { recursive: true });
	writeFileSync(join(tree, "sub", "file.txt"), "owned by the tree");
	symlinkSync(victim, join(tree, "link"), "junction");
	return { root, victim, sentinel: join(victim, "keep.txt") };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("safe-remove-tree", () => {
	it("scanLinks reports a junction and its target without following it", () => {
		const { victim, root } = fixture();
		const links = scanLinks(join(root, "tree"));
		expect(links.length).toBe(1);
		expect(links[0]!.target).toBe(victim);
	});

	it("safeRemoveTree deletes the tree but never the linked-to directory", () => {
		const { root, sentinel } = fixture();
		const tree = join(root, "tree");
		const result = safeRemoveTree(tree);
		expect(result.links.length).toBe(1);
		expect(readFileSync(sentinel, "utf8")).toBe("do not delete me");
		expect(scanLinks(tree).length).toBe(0);
	});
});
