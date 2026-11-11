import { describe, expect, test } from "bun:test";
import path from "node:path";
import { parseFrontmatter } from "@linxiraos/pi-utils";

/**
 * Content guard for the html-report official skill. The pack-wide hygiene test
 * checks frontmatter and the docs table; this one keeps the report contract
 * and the shipped template usable, since the template is copied by hand into
 * user artifacts and cannot be exercised by a browser test here.
 */
const skillPath = path.resolve(import.meta.dir, "../../../skills/official/html-report/SKILL.md");

describe("html-report official skill", () => {
	test("frontmatter names the directory and describes the trigger", async () => {
		const body = await Bun.file(skillPath).text();
		const { frontmatter } = parseFrontmatter(body, { source: skillPath, repair: false });
		expect(frontmatter.name).toBe("html-report");
		const description = String(frontmatter.description);
		expect(description.toLowerCase()).toContain("visual report");
		expect(description).toContain("local://");
		expect(description.toLowerCase()).toContain("skip it");
	});

	test("keeps the required contract sections", async () => {
		const body = await Bun.file(skillPath).text();
		for (const heading of [
			"When to use",
			"Input contract",
			"Output contract",
			"Required structure",
			"Visual rules",
			"Evidence rules",
			"Validation",
			"Workflow",
			"Template",
			"Anti-patterns",
		]) {
			expect(body, `missing "## ${heading}"`).toContain(`## ${heading}`);
		}
		expect(body).toContain("local://<name>.html");
		expect(body).toContain("local://<name>.md");
		expect(body).toContain("[INFERENCE]");
	});

	test("template is self-contained, script-free, and anchor-complete", async () => {
		const body = await Bun.file(skillPath).text();
		const match = body.match(/```html\n([\s\S]*?)```/);
		expect(match, "SKILL.md must contain one ```html template block").not.toBeNull();
		const html = match![1];
		const lower = html.toLowerCase();

		expect(lower).toContain("<!doctype html>");
		expect(lower).toContain("@media print");
		expect(lower).toContain("prefers-color-scheme:light");
		expect(lower).toContain("size:a4");

		expect(lower).not.toContain("<script");
		expect(html).not.toMatch(/\s(?:src|href)=["'](?:https?:)?\/\//i);
		expect(html).not.toMatch(/\s(?:src)=/i);
		expect(html).not.toMatch(/<img\b/i);
		expect(html).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);

		const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
		expect(new Set(ids).size, "duplicate element ids").toBe(ids.length);
		expect(ids).toContain("summary");
		expect(ids).toContain("findings");
		expect(ids).toContain("appendix");

		for (const anchor of [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1])) {
			expect(ids, `dangling anchor #${anchor}`).toContain(anchor);
		}

		for (const section of [
			"Executive summary",
			"Status and metrics",
			"Architecture",
			"Findings",
			"Risks and decisions",
			"Evidence and method",
		]) {
			expect(html, `template missing "${section}"`).toContain(section);
		}
	});
});
