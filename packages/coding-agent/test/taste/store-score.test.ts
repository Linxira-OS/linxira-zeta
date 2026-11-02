/**
 * Store format, score math and scope resolution.
 *
 * The format half pins the Command Code compatibility contract: the file this
 * layer writes must be readable by the tool that wrote `.commandcode/taste/taste.md`,
 * and that file must be readable here — one fixture, both directions.
 */
import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { resolveTasteScopes } from "@linxiraos/zeta/taste/scope";
import { tasteFilePath } from "@linxiraos/zeta/taste/paths";
import {
	betaPosterior,
	detectConflict,
	evidenceCounts,
	injectionScore,
	isProtected,
	repeatWeight,
	retentionScore,
	shouldInject,
} from "@linxiraos/zeta/taste/score";
import {
	daysBetween,
	formatTasteFile,
	parseTasteFile,
	readTasteScope,
	TOMBSTONE_RENDER_DAYS,
	today,
	topicKey,
	type TasteEntry,
} from "@linxiraos/zeta/taste/store";
import { projectBankSegment } from "@linxiraos/zeta/mnemopi/config";

/** The exact Command Code file this repository used to carry. */
const COMMAND_CODE_FILE = `# Taste

- Prefers the outer framework/harness to run directly on the target kernel (in-process, kernel as a swappable ABI), rather than integrating through a process/protocol boundary like ACP. Confidence: 0.6
`;

function entry(overrides: Partial<TasteEntry> = {}): TasteEntry {
	const statement = overrides.statement ?? "Prefers explicit return types on exported functions";
	return {
		topicKey: topicKey(statement),
		category: "typescript",
		statement,
		polarity: "prefer",
		confidence: 0.6,
		mentions: 1,
		lastConfirmed: today(),
		lastUsed: today(),
		evidence: ["stated×1"],
		...overrides,
	};
}

describe("taste store format", () => {
	it("reads Command Code's own file byte-for-byte", () => {
		const bullets = parseTasteFile(COMMAND_CODE_FILE);
		expect(bullets).toHaveLength(1);
		expect(bullets[0]!.statement).toBe(
			"Prefers the outer framework/harness to run directly on the target kernel (in-process, kernel as a swappable ABI), rather than integrating through a process/protocol boundary like ACP",
		);
		expect(bullets[0]!.confidence).toBe(0.6);
	});

	it("round-trips its own output", () => {
		const formatted = formatTasteFile(parseTasteFile(COMMAND_CODE_FILE));
		expect(formatted).toBe(COMMAND_CODE_FILE);
	});

	it("ignores prose lines and keeps one bullet per preference", () => {
		const bullets = parseTasteFile(
			[
				"# Taste",
				"",
				"Some prose about taste.",
				"- Prefers tabs. Confidence: 0.5",
				"- Avoids barrels. Confidence: 0.9",
				"",
			].join("\n"),
		);
		expect(bullets.map(bullet => bullet.statement)).toEqual(["Prefers tabs", "Avoids barrels"]);
		expect(bullets.map(bullet => bullet.confidence)).toEqual([0.5, 0.9]);
	});

	it("reads a file with no state as other/prefer entries with empty evidence", async () => {
		const temp = TempDir.createSync("@taste-store-");
		try {
			const agentDir = path.join(temp.path(), "agent");
			const projectDir = path.join(agentDir, "memories", "taste", "projects", projectBankSegment(process.cwd()));
			await Bun.write(path.join(projectDir, "taste.md"), COMMAND_CODE_FILE);
			const settings = Settings.isolated({ "taste.scoping": "per-project" });
			const [scope] = resolveTasteScopes({ cwd: process.cwd() }, settings);
			const snapshot = await readTasteScope(agentDir, scope!);
			expect(snapshot.entries).toHaveLength(1);
			expect(snapshot.entries[0]!.category).toBe("other");
			expect(snapshot.entries[0]!.polarity).toBe("prefer");
			expect(snapshot.entries[0]!.confidence).toBe(0.6);
			expect(snapshot.entries[0]!.evidence).toEqual([]);
		} finally {
			temp.removeSync();
		}
	});
});

describe("taste score", () => {
	it("moves the Beta posterior with evidence, and with judge pseudo-counts", () => {
		const noEvidence = betaPosterior(0, 0);
		const stated = betaPosterior(1, 0);
		const contested = betaPosterior(1, 2);
		expect(noEvidence).toBe(0.5);
		expect(stated).toBeGreaterThan(noEvidence);
		expect(contested).toBeLessThan(noEvidence);
		// A confident judge over an empty tally lands between the prior and 1.
		const judged = betaPosterior(0, 0, { p: 0.9, strength: 1 });
		expect(judged).toBeGreaterThan(noEvidence);
		expect(judged).toBeLessThan(0.9);
	});

	it("weakens the repeat bonus monotonically", () => {
		const weights = [2, 3, 4, 6, 12].map(repeatWeight);
		for (let i = 1; i < weights.length; i++) expect(weights[i]!).toBeLessThanOrEqual(weights[i - 1]!);
		expect(weights.at(-1)!).toBeGreaterThanOrEqual(0.25);
	});

	it("decays from last use, so a habit that keeps being applied does not age out", () => {
		const fresh = entry({ lastUsed: today() });
		const stale = entry({ lastUsed: "2025-01-01" });
		expect(retentionScore(fresh)).toBeGreaterThan(retentionScore(stale));
		// The clock is `lastUsed` alone: `lastConfirmed` only records when the claim
		// was last seen, and consolidation refreshes `lastUsed` on every observation,
		// which is what revives an entry.
		const confirmedOnly = entry({ lastUsed: "2025-01-01", lastConfirmed: today() });
		expect(retentionScore(confirmedOnly)).toBe(retentionScore(stale));
	});

	it("protects an entry that is strong and repeatedly corroborated", () => {
		const strong = entry({ confidence: 0.85, mentions: 6 });
		expect(isProtected(strong)).toBe(true);
		const used = entry({ confidence: 0.85, mentions: 6, lastUsed: "2024-01-01", protected: true });
		// Protection slows the decay; it never boosts the score above retention.
		expect(retentionScore(used)).toBeLessThanOrEqual(strong.confidence);
		expect(retentionScore(used)).toBeGreaterThan(0);
	});

	it("penalizes divergence and rewards coverage", () => {
		const candidate = entry();
		const plain = injectionScore(candidate, new Date(), { divergence: 0, coverage: 0 });
		const divergent = injectionScore(candidate, new Date(), { divergence: 1, coverage: 0 });
		const covered = injectionScore(candidate, new Date(), { divergence: 0, coverage: 1 });
		expect(divergent).toBeLessThan(plain);
		expect(covered).toBeGreaterThan(plain);
	});

	it("never injects a conflicted entry, whatever its score", () => {
		const strong = entry({ confidence: 0.95, mentions: 9, conflict: "abc123" });
		expect(shouldInject(strong, new Date(), 0.6)).toBe(false);
	});

	it("detects opposite polarities on one topic, and only those", () => {
		const prefer = entry({ statement: "Prefers explicit return types", polarity: "prefer" });
		const avoid = entry({ statement: "Avoids explicit return types", polarity: "avoid" });
		const same = entry({ statement: "Prefers explicit return types", polarity: "prefer" });
		expect(detectConflict(prefer, avoid)).toBe(true);
		expect(detectConflict(prefer, same)).toBe(false);
	});

	it("sums positive and negative evidence separately", () => {
		const counts = evidenceCounts({ evidence: ["stated×2", "contradiction×1", "tool_outcome×2"] });
		expect(counts.positive).toBeCloseTo(1.0 * 2 + 0.5 * 2, 6);
		expect(counts.negative).toBeCloseTo(1.0, 6);
	});

	it("ages a retraction out after the render window", () => {
		expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
		expect(daysBetween("2026-01-01", "2026-02-01")).toBeGreaterThan(TOMBSTONE_RENDER_DAYS);
	});
});

describe("taste scopes and paths", () => {
	it("adds the agent scope only when an agent id is present", () => {
		const bank = projectBankSegment(process.cwd());
		const perProject = Settings.isolated({ "taste.scoping": "per-project" });
		expect(resolveTasteScopes({ cwd: process.cwd() }, perProject)).toEqual([
			{ domain: "projects", segments: [bank] },
		]);
		expect(resolveTasteScopes({ cwd: process.cwd(), agentId: "Sub-1" }, perProject)).toEqual([
			{ domain: "agents", segments: [bank, "Sub-1"] },
			{ domain: "projects", segments: [bank] },
		]);

		const tagged = Settings.isolated({ "taste.scoping": "per-project-tagged" });
		expect(resolveTasteScopes({ cwd: process.cwd(), agentId: "Main" }, tagged)).toEqual([
			{ domain: "agents", segments: [bank, "Main"] },
			{ domain: "projects", segments: [bank] },
			{ domain: "global", segments: [] },
		]);

		const global = Settings.isolated({ "taste.scoping": "global" });
		expect(resolveTasteScopes({ cwd: process.cwd(), agentId: "Main" }, global)).toEqual([
			{ domain: "agents", segments: [bank, "Main"] },
			{ domain: "global", segments: [] },
		]);
	});

	it("accepts the reserved bot/room fields without inventing a source", () => {
		const settings = Settings.isolated({ "taste.scoping": "per-project" });
		const without = resolveTasteScopes({ cwd: process.cwd() }, settings);
		const withReserved = resolveTasteScopes({ cwd: process.cwd(), botId: "bot-1", roomId: "room-1" }, settings);
		expect(withReserved).toEqual(without);
	});

	it("refuses an unknown domain instead of guessing a path", () => {
		expect(() => tasteFilePath("/agent", { domain: "nowhere" as never, segments: [] })).toThrow(
			"unknown taste domain",
		);
	});

	it("keeps every store under the agent memories directory", () => {
		const file = tasteFilePath("/agent", { domain: "projects", segments: ["repo-abc"] });
		expect(file).toContain(path.join("memories", "taste", "projects", "repo-abc", "taste.md"));
	});
});
