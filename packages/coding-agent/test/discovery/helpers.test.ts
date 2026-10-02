import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrontmatter, removeSyncWithRetries } from "@linxiraos/pi-utils";
import { clearCache } from "@linxiraos/zeta/capability/fs";
import type { LoadContext } from "@linxiraos/zeta/capability/types";
import { loadFilesFromDir, scanSkillsFromDir } from "@linxiraos/zeta/discovery/helpers";

describe("parseFrontmatter", () => {
	const parse = (content: string) => parseFrontmatter(content, { source: "tests:frontmatter", level: "off" });

	test("parses mixed complex YAML", () => {
		const content = `---
name: complex-test
version: 1.0.0
tags:
  - prod
  - critical
metadata:
  author: tester
  created: 2024-01-01
description: |
  Multi-line description
  with formatting
---
Body content`;

		const result = parse(content);
		expect(result.frontmatter).toEqual({
			name: "complex-test",
			version: "1.0.0",
			tags: ["prod", "critical"],
			metadata: {
				author: "tester",
				created: "2024-01-01",
			},
			description: "Multi-line description\nwith formatting\n",
		});
		expect(result.body).toBe("Body content");
	});

	test("handles missing frontmatter", () => {
		const content = "Just body content";
		const result = parse(content);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Just body content");
	});

	test("handles empty frontmatter", () => {
		const content = `---
---
Body content`;

		const result = parse(content);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Body content");
	});

	test("normalizes kebab-case keys to camelCase", () => {
		const content = `---
thinking-level: medium
output-schema: json
nested-field:
  inner-key: value
---
Body content`;

		const result = parse(content);
		expect(result.frontmatter).toEqual({
			thinkingLevel: "medium",
			outputSchema: "json",
			nestedField: { innerKey: "value" },
		});
		expect(result.body).toBe("Body content");
	});
});

describe("loadFilesFromDir recursion", () => {
	let tempDir!: string;
	let ctx!: LoadContext;

	const write = (rel: string, content: string) => {
		const full = path.join(tempDir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content);
	};

	beforeEach(() => {
		clearCache();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-loadfiles-recursion-"));
		ctx = { cwd: tempDir, home: tempDir, repoRoot: tempDir };
		// Top-level tool plus a Python-venv-style frontend asset nested below it,
		// mirroring the ~/.codex/tools/mineru/Lib/site-packages layout from #8552.
		write("my-tool.ts", "export default () => ({});\n");
		write(
			path.join("mineru", "Lib", "site-packages", "gradio", "assets", "svelte", "media-query-D37ajmZt.js"),
			"window.matchMedia;\n",
		);
	});

	afterEach(() => {
		clearCache();
		removeSyncWithRetries(tempDir);
	});

	const names = (dir: string, recursive?: boolean) =>
		loadFilesFromDir<{ name: string }>(ctx, dir, "test", "user", {
			extensions: ["ts", "js"],
			recursive,
			transform: (_name, _content, filePath) => ({ name: path.relative(dir, filePath) }),
		}).then(r => r.items.map(i => i.name).sort());

	// Regression for #8552: the non-recursive default must NOT descend into the
	// venv subtree. The native glob defaults recursive=true, so before the fix
	// `*.{ts,js}` was rewritten to `**/*.{ts,js}` and imported the Svelte asset.
	test("default scan stays top-level and skips the venv subtree", async () => {
		expect(await names(tempDir)).toEqual(["my-tool.ts"]);
	});

	test("recursive:true still walks the whole subtree", async () => {
		expect(await names(tempDir, true)).toEqual([
			path.join("mineru", "Lib", "site-packages", "gradio", "assets", "svelte", "media-query-D37ajmZt.js"),
			"my-tool.ts",
		]);
	});
});

describe("scanSkillsFromDir router trees", () => {
	let tempDir!: string;
	let ctx!: LoadContext;

	const skill = (name: string, description: string) =>
		`---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.\n`;

	const write = (rel: string, content: string) => {
		const full = path.join(tempDir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content);
	};

	beforeEach(() => {
		clearCache();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-scan-skills-router-"));
		ctx = { cwd: tempDir, home: tempDir, repoRoot: tempDir };
		// Three-level linxira-style router tree: router SKILL.md (level 1) with
		// frontmatter, a category grouping directory holding only INDEX.md
		// (level 2), and leaf skills (level 3).
		write("research-router/SKILL.md", skill("research-router", "top-level navigation entry"));
		write("research-router/life-sciences/INDEX.md", "# Life sciences index\n");
		write("research-router/life-sciences/proteins/SKILL.md", skill("proteins", "leaf skill"));
		write("research-router/life-sciences/cells/SKILL.md", skill("cells", "leaf skill"));
		// Depth cap: `mid` is level 3 (discovered), `leaf` would be level 4.
		write("deep/a/mid/SKILL.md", skill("mid", "last discoverable level"));
		write("deep/a/mid/leaf/SKILL.md", skill("leaf", "beyond the depth cap"));
		// A plain level-1 skill that itself nests a level-2 skill.
		write("plain/SKILL.md", skill("plain", "level one"));
		write("plain/nested/SKILL.md", skill("nested", "level two"));
		// Noise that must never surface: support dirs of real skills, excluded
		// directories, and non-SKILL.md markdown.
		write("research-router/life-sciences/node_modules/fake/SKILL.md", skill("fake", "node_modules"));
		write(".hidden/secret/SKILL.md", skill("secret", "dot dir"));
		write("plain/references/INDEX.md", "# plain references\n");
	});

	afterEach(() => {
		clearCache();
		removeSyncWithRetries(tempDir);
	});

	const scanNames = (dir: string) =>
		scanSkillsFromDir(ctx, { dir, providerId: "test", level: "user" }).then(r => r.items.map(i => i.name).sort());

	test("three-level router tree yields the router plus every leaf", async () => {
		expect(await scanNames(tempDir)).toEqual(["cells", "mid", "nested", "plain", "proteins", "research-router"]);
	});

	test("INDEX.md never becomes a skill", async () => {
		const result = await scanSkillsFromDir(ctx, {
			dir: path.join(tempDir, "research-router", "life-sciences"),
			providerId: "test",
			level: "user",
		});
		expect(result.items.map(i => i.name)).toEqual(["cells", "proteins"]);
	});

	test("node_modules and dot directories are skipped", async () => {
		const names = await scanNames(tempDir);
		expect(names).not.toContain("fake");
		expect(names).not.toContain("secret");
	});
});
