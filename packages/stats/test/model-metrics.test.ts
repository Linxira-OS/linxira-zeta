import { describe, expect, it } from "bun:test";
import {
	computeAssistantMessageMetrics,
	EMPTY_ASSISTANT_METRICS,
	TOOL_ERROR_COLLAPSE_CAP,
	TOOL_SPIRAL_THRESHOLD,
	VERBOSE_CHAR_THRESHOLD,
	VERBOSE_WORD_THRESHOLD,
} from "@linxiraos/pi-stats/model-metrics";
import { analysisProse } from "@linxiraos/pi-stats/user-metrics";

/** Analyze raw assistant text through the same strip the ingest path uses. */
function analyze(text: string, options: { prevText?: string; toolErrors?: number } = {}) {
	return computeAssistantMessageMetrics(analysisProse(text), options);
}

describe("computeAssistantMessageMetrics", () => {
	it("returns zeros for empty text", () => {
		expect(computeAssistantMessageMetrics("")).toEqual(EMPTY_ASSISTANT_METRICS);
		expect(computeAssistantMessageMetrics("   \n\t ")).toEqual(EMPTY_ASSISTANT_METRICS);
	});

	it("keeps the tool-error count visible even without prose", () => {
		const m = computeAssistantMessageMetrics("", { toolErrors: 4 });
		expect(m.toolErrors).toBe(4);
		expect(m.toolSpiral).toBe(1);
		expect(m.collapse).toBe(0);
	});

	it("counts English apologies, restatement and hedged fallbacks", () => {
		const m = analyze(
			"I'm sorry about that, that's my mistake. As I said earlier, the test still fails. I'm not sure why; you could also try clearing the cache.",
		);
		expect(m.selfBlame).toBe(2);
		expect(m.restatement).toBe(1);
		expect(m.hedge).toBe(2);
		expect(m.collapse).toBe(5);
	});

	it("sums the Chinese lexicons without needing spaces between clauses", () => {
		const m = analyze("抱歉，是我搞错了。如前所述，这个接口可能已经改了，你可以试试重新生成。");
		expect(m.selfBlame).toBe(2);
		expect(m.restatement).toBe(1);
		expect(m.hedge).toBeGreaterThanOrEqual(2);
	});

	it("sums English and Chinese markers in one mixed reply", () => {
		const m = analyze("抱歉，I'm not sure. As I said earlier, 我不确定这个版本。");
		expect(m.selfBlame).toBe(1);
		expect(m.hedge).toBe(2);
		expect(m.restatement).toBe(1);
	});

	it("ignores markers inside fenced code, inline code and quoted files", () => {
		const m = analyze(
			[
				"I'm sorry, but here is the fix:",
				"```python",
				"# I'm not sure why; hopefully this works",
				'raise ValueError("my mistake")',
				"```",
				"Run `say sorry` and `as I said earlier` to reproduce.",
			].join("\n"),
		);
		expect(m.selfBlame).toBe(1);
		expect(m.hedge).toBe(0);
		expect(m.restatement).toBe(0);
	});

	it("does not reward a code-heavy reply with verbosity", () => {
		const code = Array.from({ length: 120 }, (_, i) => `const value${i} = compute(${i});`).join("\n");
		const m = analyze(`Here is the patch.\n\`\`\`ts\n${code}\n\`\`\``);
		expect(m.verbose).toBe(0);
		expect(m.chars).toBeLessThan(VERBOSE_CHAR_THRESHOLD);
	});

	it("flags long-winded prose by words and by characters (Chinese has no spaces)", () => {
		expect(analyze(`word. `.repeat(VERBOSE_WORD_THRESHOLD)).verbose).toBe(1);
		expect(analyze(`word. `.repeat(20)).verbose).toBe(0);
		expect(analyze("这是一段很长的说明。".repeat(300)).verbose).toBe(1);
	});

	it("detects near-duplicate restatement of the previous reply", () => {
		const previous = "The configuration file lives in the project root and is loaded on startup.";
		const m = analyze("The configuration file lives in the project root and is loaded on startup.", {
			prevText: previous,
		});
		expect(m.restatement).toBe(1);
	});

	it("requires a tool-failure spiral before counting failures as breakdown", () => {
		const below = analyze("Trying a different approach.", { toolErrors: TOOL_SPIRAL_THRESHOLD - 1 });
		expect(below.toolSpiral).toBe(0);
		expect(below.collapse).toBe(0);
		const at = analyze("Trying a different approach.", { toolErrors: TOOL_SPIRAL_THRESHOLD });
		expect(at.toolSpiral).toBe(1);
		expect(at.collapse).toBe(TOOL_SPIRAL_THRESHOLD);
		const beyond = analyze("Trying a different approach.", { toolErrors: TOOL_ERROR_COLLAPSE_CAP + 5 });
		expect(beyond.collapse).toBe(TOOL_ERROR_COLLAPSE_CAP);
	});

	it("marks prose in a script no lexicon covers as unscored", () => {
		const m = analyze("設定ファイルを読み込めませんでした。もう一度試してください。");
		expect(m.unsupportedScript).toBe(1);
		expect(m.collapse).toBe(0);
	});
});
