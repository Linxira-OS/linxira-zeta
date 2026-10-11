import { describe, expect, it } from "bun:test";
import { computeUserMessageMetrics } from "../src/user-metrics";

/**
 * The Chinese and voice-input layer. Chinese traffic reaches the agent mostly
 * through speech transcription, so these cases are written the way dictation
 * looks: no punctuation, run-on clauses, homophone swearing. The neutral cases
 * matter as much as the hits - a lexicon that fires on ordinary Chinese is
 * worse than no lexicon, because it makes the dashboard untrustworthy.
 */
describe("Chinese frustration signals", () => {
	it("reads corrective negation and reproach", () => {
		const m = computeUserMessageMetrics("不对啊你怎么又改错了");
		expect(m.negation).toBeGreaterThan(0);
		expect(m.blame).toBeGreaterThan(0);
	});

	it("counts a repeated denial as emphasis", () => {
		const m = computeUserMessageMetrics("不是不是 我说的是这个");
		expect(m.emphasis).toBeGreaterThan(0);
		expect(m.negation).toBeGreaterThan(0);
	});

	it("counts homophone swearing the recogniser produces", () => {
		for (const text of ["卧槽又来了", "我艹这什么破玩意", "淦 还是不行"]) {
			const m = computeUserMessageMetrics(text);
			expect(m.profanity, text).toBeGreaterThan(0);
		}
	});

	it("reads exasperation registers rather than literal cursing", () => {
		expect(computeUserMessageMetrics("这不就是垃圾吗，我服了").anguish).toBeGreaterThan(0);
		expect(computeUserMessageMetrics("离谱 真的无语了").anguish).toBeGreaterThan(0);
		expect(computeUserMessageMetrics("搞什么呢").anguish).toBeGreaterThan(0);
	});

	it("reads a long unpunctuated complaint the way dictation produces it", () => {
		const m = computeUserMessageMetrics("我说了多少遍了这个接口还是不行你到底是没听懂还是不想改");
		expect(m.repetition).toBeGreaterThan(1);
	});

	it("scores a repeated character run as emphasis, not as anguish", () => {
		const m = computeUserMessageMetrics("不不不 别这样");
		expect(m.emphasis).toBeGreaterThan(0);
	});

	it("leaves ordinary Chinese and dictation filler alone", () => {
		for (const text of [
			"嗯那个就是说帮我改一下这个函数",
			"帮我加一个测试",
			"这个是干什么用的",
			"看看这个函数有没有问题",
		]) {
			const m = computeUserMessageMetrics(text);
			expect(
				{ profanity: m.profanity, anguish: m.anguish, negation: m.negation, blame: m.blame, emphasis: m.emphasis },
				text,
			).toEqual({ profanity: 0, anguish: 0, negation: 0, blame: 0, emphasis: 0 });
		}
	});

	it("keeps `不是`/`你怎么` neutral when they are not complaints", () => {
		expect(computeUserMessageMetrics("不是我做的这部分").negation).toBe(0);
		expect(computeUserMessageMetrics("你怎么看这个方案").blame).toBe(0);
	});

	it("counts full-width bursts but leaves ASCII shouting to the English signals", () => {
		const wide = computeUserMessageMetrics("怎么还是不行！！！");
		expect(wide.emphasis).toBeGreaterThan(0);
		const ascii = computeUserMessageMetrics("HOW IS THAT STILL BROKEN!!!");
		expect(ascii.emphasis).toBe(0);
		expect(ascii.anguish + ascii.yelling).toBeGreaterThan(0);
	});

	it("flags prose in a script no lexicon covers", () => {
		// Kana stands in for any script the shipped en/zh lexicons do not cover
		// (Hangul, Cyrillic, Arabic, ...). Its zero signal counts must be
		// reported as unscored rather than read as a calm user.
		expect(computeUserMessageMetrics("ビルドが失敗しました").unsupportedScript).toBe(1);
		expect(computeUserMessageMetrics("这个构建失败了").unsupportedScript).toBe(0);
		expect(computeUserMessageMetrics("the build failed").unsupportedScript).toBe(0);
	});
});

describe("whole-message repetition", () => {
	it("counts a re-sent request in either language", () => {
		const en = computeUserMessageMetrics("Please fix the retry logic", { prevText: "please fix the retry logic" });
		expect(en.repetition).toBeGreaterThan(0);
		const zh = computeUserMessageMetrics("把这个接口的错误处理改一下", { prevText: "把这个接口的错误处理改一下" });
		expect(zh.repetition).toBeGreaterThan(0);
	});

	it("does not fire on a different follow-up, or without a predecessor", () => {
		expect(computeUserMessageMetrics("现在帮我加个测试", { prevText: "把这个接口的错误处理改一下" }).repetition).toBe(
			0,
		);
		expect(computeUserMessageMetrics("把这个接口的错误处理改一下").repetition).toBe(0);
	});
});

describe("English signals stay unchanged", () => {
	it("still counts recall and reproach", () => {
		const m = computeUserMessageMetrics("The build still doesn't work, why would you do that?");
		expect(m.repetition).toBeGreaterThan(0);
		expect(m.blame).toBeGreaterThan(0);
		expect(m.emphasis).toBe(0);
		expect(m.unsupportedScript).toBe(0);
	});
});
