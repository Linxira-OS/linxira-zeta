/**
 * D1 + D2 prompt contracts — the tracking tool description.
 *
 * Verifies through the product's own renderers (`prompt.render` and
 * `buildSystemPrompt`) that:
 * - the cache-ordering + memory-boundary contract lands in the tracking prompt;
 * - the prompt renders cleanly with and without the tracking tool, with the
 *   tracking entry as the only delta (neighbouring inventory entries never move);
 * - no Handlebars template residue leaks into the rendered prompt.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prompt } from "@linxiraos/pi-utils";
import { buildSystemPrompt, type SystemPromptToolMetadata } from "@linxiraos/zeta/system-prompt";
import { cleanupTempHome } from "./helpers/temp-home-cleanup";

const TRACKING_MD = fs.readFileSync(path.join(import.meta.dir, "..", "src", "prompts", "tools", "tracking.md"), "utf8");

const READ_TOOL: SystemPromptToolMetadata = {
	label: "Read",
	description: "Reads files from disk.",
	parameters: { type: "object", properties: { path: { type: "string" } } },
};

const TRACKING_TOOL: SystemPromptToolMetadata = {
	label: "Tracking Update",
	description: TRACKING_MD,
	parameters: { type: "object", properties: { op: { type: "string" } } },
};

const EMPTY_TREE = { rootPath: "", rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] };

describe("tracking prompt contracts (D1/D2)", () => {
	let tempDir = "";
	let tempHomeDir = "";
	let originalHome: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tracking-contracts-"));
		tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tracking-contracts-home-"));
		originalHome = process.env.HOME;
		process.env.HOME = tempHomeDir;
	});

	afterEach(cleanupTempHome(() => ({ tempDir, tempHomeDir, originalHome })));

	async function renderSystemPrompt(withTracking: boolean): Promise<string> {
		const tools = new Map<string, SystemPromptToolMetadata>([["read", READ_TOOL]]);
		const toolNames = ["read"];
		if (withTracking) {
			tools.set("tracking_update", TRACKING_TOOL);
			toolNames.push("tracking_update");
		}
		const { systemPrompt } = await buildSystemPrompt({
			cwd: tempDir,
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames,
			tools,
			workspaceTree: { ...EMPTY_TREE, rootPath: tempDir },
			// Verbose inventory mode: descriptions render into the prompt so the
			// tool-present/absent delta is observable.
			nativeTools: false,
			inlineToolDescriptors: false,
		});
		return systemPrompt.join("\n\n");
	}

	function functionsSection(text: string): string {
		const start = text.indexOf("namespace functions {");
		expect(start).toBeGreaterThan(-1);
		const end = text.indexOf("} // namespace functions", start);
		expect(end).toBeGreaterThan(start);
		return text.slice(start, end);
	}

	it("keeps the cache-ordering and memory-boundary contract in the tracking prompt", () => {
		expect(TRACKING_MD).toContain("Cache ordering");
		// The contract is prompt-only and states plainly that nothing enforces it.
		expect(TRACKING_MD).toContain("prompt-only convention with no enforcement point");
		expect(TRACKING_MD).toContain("Memory boundary");
		// The sanctioned cache-neutral delivery path is named, not invented.
		expect(TRACKING_MD).toContain("phase-progress nudge");
	});

	it("renders the tracking prompt through the product renderer with no template residue", () => {
		const rendered = prompt.render(TRACKING_MD, {});
		expect(rendered).toContain("Cache ordering");
		expect(rendered).toContain("Memory boundary");
		expect(rendered).not.toMatch(/\{\{|\}\}/);
	});

	it("renders the prompt with and without the tracking tool, leaving neighbours untouched", async () => {
		const without = await renderSystemPrompt(false);
		const withTool = await renderSystemPrompt(true);

		// No template residue in either context.
		expect(without).not.toMatch(/\{\{|\}\}/);
		expect(withTool).not.toMatch(/\{\{|\}\}/);

		// The tracking entry appears only when the tool is present.
		expect(withTool).toContain("Cache ordering");
		expect(without).not.toContain("Cache ordering");

		// The tracking entry is the only delta: everything before it is
		// byte-identical, so neighbouring entries never moved.
		const withoutSection = functionsSection(without);
		const withSection = functionsSection(withTool);
		expect(withSection.startsWith(withoutSection)).toBe(true);
		const trackingEntry = withSection.slice(withoutSection.length);
		expect(trackingEntry).toContain("Cache ordering");
		expect(trackingEntry).toContain("type tracking_update =");
		expect(trackingEntry).not.toContain("type read =");
	});
});
