/**
 * The prompt block and the tool that writes to the store.
 *
 * Both are the user-visible surface of the layer: the block is what the model
 * reads every turn, and the tool is what the model may call. The tests pin the
 * two promises made in the docs — nothing is injected while the layer is off,
 * and nothing the model writes can raise its own confidence.
 */
import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getAgentDir, setAgentDir, TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { TASTE_PRECEDENCE_LINE, buildTasteInstructions, renderTasteBlock } from "@linxiraos/zeta/taste/inject";
import { type TasteScopeKey, resolveTasteScopes } from "@linxiraos/zeta/taste/scope";
import {
	readTasteScope,
	TOMBSTONE_RENDER_DAYS,
	today,
	topicKey,
	writeTasteScope,
	type TasteEntry,
} from "@linxiraos/zeta/taste/store";
import { SuperMemoryTool } from "@linxiraos/zeta/tools/super-memory";
import type { ToolSession } from "@linxiraos/zeta/tools";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const undo of cleanup.splice(0)) undo();
});

function harness(values: Record<string, unknown> = {}) {
	const root = TempDir.createSync("@taste-inject-");
	const agentDir = path.join(root.path(), "agent");
	const cwd = path.join(root.path(), "project");
	const previousAgentDir = getAgentDir();
	setAgentDir(agentDir);
	cleanup.push(() => {
		setAgentDir(previousAgentDir);
		root.removeSync();
	});
	const settings = Settings.isolated({ "memory.backend": "mnemopi", "taste.enabled": true, ...values });
	return { agentDir, cwd, settings };
}

/** The first text part of a tool result, as the model would read it. */
function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
	const part = result.content.find(entry => entry.type === "text");
	return part?.text ?? "";
}

function entry(overrides: Partial<TasteEntry> = {}): TasteEntry {
	const statement = overrides.statement ?? "Prefers explicit return types";
	return {
		topicKey: topicKey(statement),
		category: "typescript",
		statement,
		polarity: "prefer",
		confidence: 0.62,
		mentions: 2,
		lastConfirmed: today(),
		lastUsed: today(),
		evidence: ["stated×2"],
		...overrides,
	};
}

async function seed(
	agentDir: string,
	scope: TasteScopeKey,
	entries: TasteEntry[],
	tombstones: Parameters<typeof writeTasteScope>[3]["tombstones"] = [],
): Promise<void> {
	await writeTasteScope(agentDir, scope, entries, { v: 1, entries: {}, tombstones, lastConsolidatedAt: 0 });
}

describe("taste injection", () => {
	it("injects nothing while the layer is off or the backend is off", async () => {
		const { agentDir, cwd, settings } = harness({ "taste.enabled": false });
		const scope = resolveTasteScopes({ cwd }, settings)[0]!;
		await seed(agentDir, scope, [entry()]);
		expect(await buildTasteInstructions({ agentDir, cwd, settings })).toBeUndefined();

		const backendOff = harness({ "memory.backend": "off" });
		const offScope = resolveTasteScopes({ cwd: backendOff.cwd }, backendOff.settings)[0]!;
		await seed(backendOff.agentDir, offScope, [entry()]);
		expect(
			await buildTasteInstructions({
				agentDir: backendOff.agentDir,
				cwd: backendOff.cwd,
				settings: backendOff.settings,
			}),
		).toBeUndefined();
	});

	it("opens with the precedence line, then the preferences", async () => {
		const { agentDir, cwd, settings } = harness();
		const scope = resolveTasteScopes({ cwd }, settings)[0]!;
		await seed(agentDir, scope, [entry({ statement: "Prefers named exports" })]);
		const block = await buildTasteInstructions({ agentDir, cwd, settings });
		expect(block).toBeDefined();
		expect(block!.startsWith(TASTE_PRECEDENCE_LINE)).toBe(true);
		expect(block).toContain("## Preferences");
		expect(block).toContain("- Prefers named exports. Confidence: 0.62");
	});

	it("hides an unresolved conflict and shows its retraction instead", async () => {
		const { agentDir, cwd, settings } = harness();
		const scope = resolveTasteScopes({ cwd }, settings)[0]!;
		const conflicted = entry({ statement: "Prefers named exports", conflict: "abc", conflictSince: today() });
		await seed(agentDir, scope, [conflicted]);
		expect(await buildTasteInstructions({ agentDir, cwd, settings })).toBeUndefined();
	});

	it("retracts a forgotten preference for the render window and drops it afterwards", async () => {
		const { agentDir, cwd, settings } = harness();
		const scope = resolveTasteScopes({ cwd }, settings)[0]!;
		const recent = { statement: "Prefers tabs", retiredAt: today(), reason: "manual", lastP: 0.6 };
		const old = { statement: "Prefers two-space indentation", retiredAt: "2025-01-01", reason: "idle", lastP: 0.4 };
		await seed(agentDir, scope, [], [recent, old]);
		const block = await buildTasteInstructions({ agentDir, cwd, settings });
		expect(block).toContain("## Retracted");
		expect(block).toContain("Prefers tabs");
		expect(block).not.toContain("two-space indentation");
		expect(block).toContain(String(TOMBSTONE_RENDER_DAYS) === "0" ? "" : "retracted");
	});

	it("never shows one agent's store to another", async () => {
		const { agentDir, cwd, settings } = harness({ "taste.scoping": "per-project-tagged" });
		const mine = resolveTasteScopes({ cwd, agentId: "Agent-A" }, settings)[0]!;
		await seed(agentDir, mine, [entry({ statement: "Prefers Agent A's naming" })]);
		const a = await buildTasteInstructions({ agentDir, cwd, settings, agentId: "Agent-A" });
		const b = await buildTasteInstructions({ agentDir, cwd, settings, agentId: "Agent-B" });
		expect(a).toContain("Agent A's naming");
		expect(b).toBeUndefined();
	});

	it("lets the narrowest scope claim a topic, so a project entry shadows a global one", async () => {
		const { agentDir, cwd, settings } = harness({ "taste.scoping": "per-project-tagged" });
		const [project] = resolveTasteScopes({ cwd, agentId: "Main" }, settings).filter(
			scope => scope.domain === "projects",
		);
		const global = resolveTasteScopes({ cwd, agentId: "Main" }, settings).find(scope => scope.domain === "global")!;
		const statement = "Prefers explicit return types";
		await seed(agentDir, project!, [entry({ statement, confidence: 0.7 })]);
		await seed(agentDir, global, [entry({ statement, confidence: 0.9 })]);
		const block = await buildTasteInstructions({ agentDir, cwd, settings, agentId: "Main" });
		expect(block!.match(/Prefers explicit return types/g)).toHaveLength(1);
		expect(block).toContain("Confidence: 0.7");
	});

	it("respects the token budget", async () => {
		const { agentDir, cwd, settings } = harness({ "taste.injectionTokenLimit": 60 });
		const scope = resolveTasteScopes({ cwd }, settings)[0]!;
		const entries = Array.from({ length: 20 }, (_, index) =>
			entry({ statement: `Prefers a very specific convention number ${index} for formatting output` }),
		);
		await seed(agentDir, scope, entries);
		const block = await buildTasteInstructions({ agentDir, cwd, settings });
		expect(block).toBeDefined();
		// ~60 tokens is well under every line combined; the block must be cut.
		expect(block!.length).toBeLessThan(600);
	});

	it("renders nothing for an empty store rather than an empty heading", async () => {
		const { agentDir, cwd, settings } = harness();
		expect(await renderTasteBlock({ agentDir, cwd, settings, scopes: [] })).toBeUndefined();
	});
});

describe("super_memory tool", () => {
	function toolSession(
		settings: Settings,
		cwd: string,
		lastPrompt = "I always want explicit return types on exports.",
	) {
		const refreshed: number[] = [];
		const session = {
			settings,
			cwd,
			getAgentId: () => "Main",
			getSessionId: () => "session-tool",
			getLastUserPromptText: () => lastPrompt,
			refreshSystemPrompt: async () => {
				refreshed.push(Date.now());
			},
		} as unknown as ToolSession;
		return { session, refreshed };
	}

	it("is offered only where the layer is on", () => {
		const { settings, cwd } = harness();
		expect(SuperMemoryTool.createIf(toolSession(settings, cwd).session)).toBeInstanceOf(SuperMemoryTool);
		const off = harness({ "taste.enabled": false });
		expect(SuperMemoryTool.createIf(toolSession(off.settings, off.cwd).session)).toBeNull();
		const backendOff = harness({ "memory.backend": "off" });
		expect(SuperMemoryTool.createIf(toolSession(backendOff.settings, backendOff.cwd).session)).toBeNull();
	});

	it("records a candidate only from the user's own words", async () => {
		const { agentDir, cwd, settings } = harness();
		const { session, refreshed } = toolSession(settings, cwd);
		const tool = new SuperMemoryTool(session);

		const rejected = await tool
			.execute("id", {
				action: "record",
				statement: "Prefers explicit return types",
				category: "typescript",
				evidenceText: "the user said something else entirely",
			})
			.catch((error: unknown) => error);
		expect(rejected).toBeInstanceOf(Error);
		expect(String(rejected)).toContain("verbatim substring");

		const accepted = await tool.execute("id", {
			action: "record",
			statement: "Prefers explicit return types",
			category: "typescript",
			evidenceText: "explicit return types",
		});
		expect(accepted.details).toMatchObject({ queued: true });
		// A refresh is requested so the next prompt rebuild can pick up the store.
		expect(refreshed).toHaveLength(1);

		// The candidate is queued, not stored: nothing reaches the prompt yet.
		const scope = resolveTasteScopes({ cwd, agentId: "Main" }, settings)[0]!;
		const snapshot = await readTasteScope(agentDir, scope);
		expect(snapshot.entries).toHaveLength(0);
	});

	it("forgets by topic, leaves a retraction, and asks for a prompt rebuild", async () => {
		const { agentDir, cwd, settings } = harness();
		const scope = resolveTasteScopes({ cwd, agentId: "Main" }, settings)[0]!;
		const kept = entry({ statement: "Prefers named exports" });
		const gone = entry({ statement: "Prefers default exports" });
		await seed(agentDir, scope, [kept, gone]);

		const { session, refreshed } = toolSession(settings, cwd);
		const tool = new SuperMemoryTool(session);
		const result = await tool.execute("id", { action: "forget", statement: "Prefers default exports" });
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(refreshed).toHaveLength(1);

		const snapshot = await readTasteScope(agentDir, scope);
		expect(snapshot.entries.map(stored => stored.statement)).toEqual(["Prefers named exports"]);
		expect(snapshot.tombstones).toHaveLength(1);
		expect(snapshot.tombstones[0]).toMatchObject({ statement: "Prefers default exports", reason: "manual" });
	});

	it("resolves a conflict in favour of the kept polarity", async () => {
		const { agentDir, cwd, settings } = harness();
		const scope = resolveTasteScopes({ cwd, agentId: "Main" }, settings)[0]!;
		const statement = "Prefers explicit return types";
		const prefer = entry({ statement, conflict: "x", conflictSince: today() });
		const avoid = entry({
			statement: `Avoids ${statement.replace(/^Prefers /, "")}`,
			polarity: "avoid",
			conflict: "x",
		});
		await seed(agentDir, scope, [prefer, avoid]);

		const { session } = toolSession(settings, cwd);
		const tool = new SuperMemoryTool(session);
		await tool.execute("id", { action: "resolve", topicKey: prefer.topicKey, keep: "prefer" });

		const snapshot = await readTasteScope(agentDir, scope);
		for (const stored of snapshot.entries) {
			expect(stored.conflict).toBeUndefined();
			expect(stored.conflictSince).toBeUndefined();
		}
	});

	it("reports stored rows and totals from stats", async () => {
		const { agentDir, cwd, settings } = harness();
		const scope = resolveTasteScopes({ cwd, agentId: "Main" }, settings)[0]!;
		await seed(agentDir, scope, [entry({ statement: "Prefers named exports" })]);
		const { session } = toolSession(settings, cwd);
		const tool = new SuperMemoryTool(session);

		const query = await tool.execute("id", { action: "query", query: "named" });
		expect(textOf(query)).toContain("Prefers named exports");

		const stats = await tool.execute("id", { action: "stats" });
		expect(textOf(stats)).toContain("1");
	});
});
