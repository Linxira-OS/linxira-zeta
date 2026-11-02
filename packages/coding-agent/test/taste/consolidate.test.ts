/**
 * Consolidation: candidate → entry → lifecycle.
 *
 * Each test pins one of the four deletion rules and the conflict rule, because
 * those are the only places this layer removes anything a user put there.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@linxiraos/pi-utils";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { CATEGORY_CAP, runTasteConsolidation, tasteWriteScope } from "@linxiraos/zeta/taste/consolidate";
import { tasteFilePath, tasteStatePath } from "@linxiraos/zeta/taste/paths";
import { appendTasteCandidate } from "@linxiraos/zeta/taste/queue";
import { resolveTasteScopes } from "@linxiraos/zeta/taste/scope";
import {
	readTasteScope,
	readTasteState,
	today,
	topicKey,
	writeTasteScope,
	type TasteEntry,
} from "@linxiraos/zeta/taste/store";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

interface Harness {
	root: TempDir;
	agentDir: string;
	cwd: string;
	settings: Settings;
	modelRegistry: ModelRegistry;
	sessionId: string;
	cleanup: () => void;
}

const harnesses: Harness[] = [];

function createHarness(): Harness {
	const root = TempDir.createSync("@taste-consolidate-");
	const agentDir = path.join(root.path(), "agent");
	const cwd = path.join(root.path(), "project");
	const authStorage = createInMemoryAuthStorage();
	// No runtime key: the judge tier falls through to T0, so these tests exercise
	// the host's own math and never make a model call.
	const modelRegistry = new ModelRegistry(authStorage, path.join(root.path(), "models.yml"));
	const harness: Harness = {
		root,
		agentDir,
		cwd,
		settings: Settings.isolated({ "memory.backend": "mnemopi", "taste.enabled": true }),
		modelRegistry,
		sessionId: "01900000-0000-7000-8000-0000000000aa",
		cleanup: () => {
			authStorage.close();
			root.removeSync();
		},
	};
	harnesses.push(harness);
	return harness;
}

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
});

async function queue(
	harness: Harness,
	statement: string,
	options: { polarity?: "prefer" | "avoid"; sessionId?: string; category?: TasteEntry["category"] } = {},
): Promise<void> {
	const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
	await appendTasteCandidate(harness.agentDir, scope, {
		v: 1,
		ts: Date.now(),
		sessionId: options.sessionId ?? harness.sessionId,
		category: options.category ?? "typescript",
		statement,
		polarity: options.polarity ?? "prefer",
		evidenceText: "I always want this",
	});
}

function options(harness: Harness) {
	return {
		agentDir: harness.agentDir,
		cwd: harness.cwd,
		settings: harness.settings,
		modelRegistry: harness.modelRegistry,
		sessionId: harness.sessionId,
	};
}

describe("taste consolidation", () => {
	it("writes the candidate into the project store and clears the queue", async () => {
		const harness = createHarness();
		await queue(harness, "Prefers explicit return types on exported functions");
		const result = await runTasteConsolidation(options(harness));
		expect(result.ran).toBe(true);
		expect(result.entries).toBe(1);

		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const file = await Bun.file(tasteFilePath(harness.agentDir, scope)).text();
		expect(file).toContain("Prefers explicit return types on exported functions");
		expect(file.startsWith("# Taste\n")).toBe(true);
		const state = await readTasteState(harness.agentDir, scope);
		expect(Object.keys(state.entries)).toHaveLength(1);
		// The queue is drained, so a second pass has nothing to do.
		const second = await runTasteConsolidation(options(harness));
		expect(second.reason).toBe("empty");
	});

	it("counts a repeated topic across sessions as corroboration", async () => {
		const harness = createHarness();
		const statement = "Prefers explicit return types on exported functions";
		await queue(harness, statement, { sessionId: "session-a" });
		await queue(harness, statement, { sessionId: "session-b" });
		await runTasteConsolidation(options(harness));
		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const snapshot = await readTasteScope(harness.agentDir, scope);
		const stored = snapshot.entries[0]!;
		expect(stored.evidence).toContain("repeat×1");
		expect(stored.confidence).toBeGreaterThan(0.5);
	});

	it("marks opposite polarities as an unresolved conflict and injects neither", async () => {
		const harness = createHarness();
		await queue(harness, "Prefers explicit return types", { polarity: "prefer" });
		await runTasteConsolidation(options(harness));
		await queue(harness, "Avoids explicit return types", { polarity: "avoid" });
		await runTasteConsolidation(options(harness));

		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const snapshot = await readTasteScope(harness.agentDir, scope);
		expect(snapshot.entries).toHaveLength(2);
		for (const stored of snapshot.entries) expect(stored.conflict).toBeDefined();
		expect(snapshot.entries[0]!.conflict).toBe(snapshot.entries[1]!.topicKey);
	});

	it("deletes an idle unprotected entry after the TTL and leaves a tombstone", async () => {
		const harness = createHarness();
		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const stale = entry({ lastUsed: "2025-01-01", lastConfirmed: "2025-01-01", confidence: 0.5, mentions: 1 });
		await writeTasteScope(harness.agentDir, scope, [stale], {
			v: 1,
			entries: {},
			tombstones: [],
			lastConsolidatedAt: 0,
		});
		// A queued candidate is what makes the pass run; it targets a different topic.
		await queue(harness, "Prefers named exports");
		const result = await runTasteConsolidation(options(harness));
		expect(result.removed).toBe(1);

		const snapshot = await readTasteScope(harness.agentDir, scope);
		expect(snapshot.entries.map(stored => stored.statement)).toEqual(["Prefers named exports"]);
		expect(snapshot.tombstones).toHaveLength(1);
		expect(snapshot.tombstones[0]).toMatchObject({ statement: stale.statement, reason: "idle" });
	});

	it("keeps a protected entry that has been idle for a year", async () => {
		const harness = createHarness();
		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const protectedEntry = entry({
			statement: "Prefers an in-process kernel boundary",
			lastUsed: "2024-06-01",
			lastConfirmed: "2024-06-01",
			confidence: 0.85,
			mentions: 6,
			protected: true,
		});
		await writeTasteScope(harness.agentDir, scope, [protectedEntry], {
			v: 1,
			entries: {},
			tombstones: [],
			lastConsolidatedAt: 0,
		});
		await queue(harness, "Prefers named exports");
		const result = await runTasteConsolidation(options(harness));
		expect(result.removed).toBe(0);

		const snapshot = await readTasteScope(harness.agentDir, scope);
		expect(snapshot.entries.map(stored => stored.statement)).toContain("Prefers an in-process kernel boundary");
	});

	it("caps one category and evicts the weakest retention first", async () => {
		const harness = createHarness();
		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const entries: TasteEntry[] = [];
		for (let index = 0; index < CATEGORY_CAP + 3; index++) {
			entries.push(
				entry({
					statement: `Prefers style rule ${index}`,
					category: "style",
					confidence: 0.4 + index * 0.02,
					mentions: 1,
				}),
			);
		}
		await writeTasteScope(harness.agentDir, scope, entries, {
			v: 1,
			entries: {},
			tombstones: [],
			lastConsolidatedAt: 0,
		});
		await queue(harness, "Prefers named exports");
		const result = await runTasteConsolidation(options(harness));
		expect(result.removed).toBe(3);

		const snapshot = await readTasteScope(harness.agentDir, scope);
		const styles = snapshot.entries.filter(stored => stored.category === "style");
		expect(styles).toHaveLength(CATEGORY_CAP);
		expect(styles.some(stored => stored.statement === "Prefers style rule 0")).toBe(false);
		expect(snapshot.tombstones.filter(tombstone => tombstone.reason === "cap")).toHaveLength(3);
	});

	it("imports Command Code's file on the first project read and leaves it untouched", async () => {
		const harness = createHarness();
		const foreign = path.join(harness.cwd, ".commandcode", "taste", "taste.md");
		const content = "# Taste\n\n- Prefers tabs over spaces. Confidence: 0.7\n";
		await Bun.write(foreign, content);

		const result = await runTasteConsolidation({ ...options(harness), force: true });
		expect(result.ran).toBe(true);

		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const snapshot = await readTasteScope(harness.agentDir, scope);
		expect(snapshot.entries.map(stored => stored.statement)).toEqual(["Prefers tabs over spaces"]);
		expect(snapshot.entries[0]!.confidence).toBe(0.7);
		expect(await Bun.file(foreign).text()).toBe(content);
	});

	it("keeps one store per agent inside the same repository", async () => {
		const harness = createHarness();
		const settings = Settings.isolated({ "memory.backend": "mnemopi", "taste.enabled": true });
		const bank = resolveTasteScopes({ cwd: harness.cwd, agentId: "Agent-A" }, settings)[0]!;
		const other = resolveTasteScopes({ cwd: harness.cwd, agentId: "Agent-B" }, settings)[0]!;
		expect(bank).not.toEqual(other);

		await appendTasteCandidate(harness.agentDir, bank, {
			v: 1,
			ts: Date.now(),
			sessionId: "session-a",
			category: "cli",
			statement: "Prefers short flags",
			polarity: "prefer",
			evidenceText: "I always want this",
		});
		await runTasteConsolidation({ ...options(harness), agentId: "Agent-A" });

		const mine = await readTasteScope(harness.agentDir, bank);
		const theirs = await readTasteScope(harness.agentDir, other);
		expect(mine.entries).toHaveLength(1);
		expect(theirs.entries).toHaveLength(0);
		expect(await Bun.file(tasteStatePath(harness.agentDir, other)).exists()).toBe(false);
	});

	it("records the pass time so the scheduler's interval means something", async () => {
		const harness = createHarness();
		await queue(harness, "Prefers named exports");
		const before = Date.now();
		await runTasteConsolidation(options(harness));
		const scope = tasteWriteScope({ cwd: harness.cwd }, harness.settings);
		const state = await readTasteState(harness.agentDir, scope);
		expect(state.lastConsolidatedAt).toBeGreaterThanOrEqual(before);
		expect(today()).toBe(today(new Date(state.lastConsolidatedAt)));
	});
});

function entry(overrides: Partial<TasteEntry> = {}): TasteEntry {
	const statement = overrides.statement ?? "Prefers explicit return types";
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
