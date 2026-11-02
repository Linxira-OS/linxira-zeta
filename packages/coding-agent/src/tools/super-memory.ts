/**
 * `super_memory` — the agent-facing door to the taste store.
 *
 * Tools are the one place a model can *propose* a preference, so the same rule as
 * extraction applies: `record` needs the user's own words and only enqueues a
 * candidate. Nothing this tool writes reaches a prompt until consolidation has
 * scored it, which is why `record` cannot inflate confidence — it can only add
 * evidence, once, for a statement the user actually made.
 *
 * `forget` and `resolve` do change the store directly: they are the user's
 * decisions, not the model's, and each leaves a retraction (or clears a conflict)
 * so the next prompt rebuild reflects it immediately.
 */
import type { AgentTool, AgentToolResult } from "@linxiraos/pi-agent-core";
import { type } from "@linxiraos/pi-omptype";
import { prompt, withFileLock } from "@linxiraos/pi-utils";

import { cfgMemoryBackend } from "../memory-backend/settings";
import { tasteLockPath } from "../taste/paths";
import { appendTasteCandidate } from "../taste/queue";
import { resolveTasteScopes, type TasteScopeKey } from "../taste/scope";
import { cfgTasteEnabled } from "../taste/settings";
import {
	readTasteScope,
	readTasteState,
	TASTE_CATEGORIES,
	TOMBSTONE_RENDER_DAYS,
	today,
	topicKey,
	type TasteCategory,
	type TasteEntry,
	type TastePolarity,
	writeTasteScope,
} from "../taste/store";
import superMemoryDescription from "../prompts/tools/super-memory.md" with { type: "text" };
import type { ToolSession } from ".";

const schema = type({
	action: "'record' | 'query' | 'resolve' | 'forget' | 'stats'",
	"statement?": "string",
	"category?": "'cli' | 'typescript' | 'architecture' | 'style' | 'workflow' | 'other'",
	"polarity?": "'prefer' | 'avoid'",
	"evidenceText?": "string",
	"query?": "string",
	"limit?": "number",
	"topicKey?": "string",
	"keep?": "'prefer' | 'avoid'",
});

export type SuperMemoryParams = typeof schema.infer;

/** A stored preference as `query` and `stats` report it. */
interface StoredRow {
	topicKey: string;
	statement: string;
	category: TasteCategory;
	polarity: TastePolarity;
	confidence: number;
	mentions: number;
	lastUsed: string;
	conflict?: string;
}

export class SuperMemoryTool implements AgentTool<typeof schema> {
	readonly name = "super_memory";
	readonly loadMode = "discoverable";
	readonly approval = "read" as const;
	readonly label = "Super Memory";
	readonly parameters = schema;

	constructor(private readonly session: ToolSession) {}

	/** Offered only where a memory backend runs and the taste layer is on. */
	static createIf(session: ToolSession): SuperMemoryTool | null {
		if (cfgMemoryBackend.get(session.settings) === "off") return null;
		if (cfgTasteEnabled.get(session.settings) !== true) return null;
		return new SuperMemoryTool(session);
	}

	get description(): string {
		return prompt.render(superMemoryDescription);
	}

	async execute(_id: string, params: SuperMemoryParams): Promise<AgentToolResult> {
		switch (params.action) {
			case "record":
				return this.#record(params);
			case "query":
				return this.#query(params);
			case "resolve":
				return this.#resolve(params);
			case "forget":
				return this.#forget(params);
			default:
				return this.#stats();
		}
	}

	/** Scopes this session may read, most specific first. */
	#scopes(): TasteScopeKey[] {
		return resolveTasteScopes(
			{ cwd: this.session.cwd, agentId: this.session.getAgentId?.() ?? undefined },
			this.session.settings,
		);
	}

	#agentDir(): string {
		return this.session.settings.getAgentDir();
	}

	async #record(params: SuperMemoryParams): Promise<AgentToolResult> {
		const statement = params.statement?.trim();
		if (!statement) throw new Error("super_memory record needs a statement");
		const category = params.category;
		if (!category || !(TASTE_CATEGORIES as readonly string[]).includes(category)) {
			throw new Error("super_memory record needs a valid category");
		}
		const polarity: TastePolarity = params.polarity === "avoid" ? "avoid" : "prefer";
		const evidenceText = params.evidenceText?.trim();
		if (!evidenceText) throw new Error("super_memory record needs evidenceText: the user's own words");
		const lastPrompt = this.session.getLastUserPromptText?.();
		if (lastPrompt !== undefined && !lastPrompt.includes(evidenceText)) {
			throw new Error(
				"super_memory record rejected: evidenceText must be a verbatim substring of the user's latest message",
			);
		}
		const scope = this.#scopes()[0] ?? { domain: "global", segments: [] };
		await appendTasteCandidate(this.#agentDir(), scope, {
			v: 1,
			ts: Date.now(),
			sessionId: this.session.getSessionId?.() ?? "tool",
			category: category as TasteCategory,
			statement,
			polarity,
			evidenceText,
		});
		await this.session.refreshSystemPrompt?.();
		return {
			content: [{ type: "text", text: `Queued preference candidate: ${statement}` }],
			details: { queued: true, scope: scope.domain },
		};
	}

	async #query(params: SuperMemoryParams): Promise<AgentToolResult> {
		const needle = params.query?.trim().toLowerCase();
		const limit = Math.max(1, Math.min(50, params.limit ?? 20));
		const rows: StoredRow[] = [];
		for (const entry of await this.#entries()) {
			if (needle && !`${entry.statement} ${entry.category}`.toLowerCase().includes(needle)) continue;
			rows.push(toRow(entry));
			if (rows.length >= limit) break;
		}
		const text =
			rows.length === 0
				? "No stored preferences match."
				: rows
						.map(
							row =>
								`- [${row.category}/${row.polarity}] ${row.statement}. Confidence: ${round(row.confidence)} (mentions ${row.mentions}, last used ${row.lastUsed}${row.conflict ? ", unresolved conflict" : ""})`,
						)
						.join("\n");
		return { content: [{ type: "text", text }], details: { rows } };
	}

	async #resolve(params: SuperMemoryParams): Promise<AgentToolResult> {
		const topic = params.topicKey?.trim();
		const keep = params.keep;
		if (!topic || (keep !== "prefer" && keep !== "avoid")) {
			throw new Error("super_memory resolve needs topicKey and keep=prefer|avoid");
		}
		const scope = this.#scopes()[0] ?? { domain: "global", segments: [] };
		let resolved = 0;
		await this.#mutate(scope, async entries => {
			const kept = entries.find(entry => entry.topicKey === topic && entry.polarity === keep);
			if (!kept) return entries;
			for (const entry of entries) {
				delete entry.conflict;
				delete entry.conflictSince;
			}
			resolved += 1;
			return entries;
		});
		if (resolved === 0) throw new Error(`super_memory resolve: no ${keep} entry with topicKey ${topic}`);
		await this.session.refreshSystemPrompt?.();
		return { content: [{ type: "text", text: `Resolved conflict on ${topic} in favour of ${keep}.` }] };
	}

	async #forget(params: SuperMemoryParams): Promise<AgentToolResult> {
		const statement = params.statement?.trim();
		const topic = params.topicKey?.trim() ?? (statement ? topicKey(statement) : undefined);
		if (!topic) throw new Error("super_memory forget needs a statement or topicKey");
		const scope = this.#scopes()[0] ?? { domain: "global", segments: [] };
		let forgotten = 0;
		const agentDir = this.#agentDir();
		await this.#mutate(scope, async entries => {
			const remaining = entries.filter(entry => {
				if (entry.topicKey !== topic) return true;
				forgotten += 1;
				return false;
			});
			if (forgotten > 0) {
				const state = await readTasteState(agentDir, scope);
				for (const entry of entries.filter(entry => entry.topicKey === topic)) {
					state.tombstones.push({
						statement: entry.statement,
						retiredAt: today(),
						reason: "manual",
						lastP: entry.confidence,
					});
				}
				await writeTasteScope(agentDir, scope, remaining, { ...state, entries: {} });
			}
			return remaining;
		});
		if (forgotten === 0) throw new Error(`super_memory forget: no entry with topicKey ${topic}`);
		await this.session.refreshSystemPrompt?.();
		return {
			content: [
				{
					type: "text",
					text: `Forgot ${forgotten} entr${forgotten === 1 ? "y" : "ies"}; the retraction stays visible for ${TOMBSTONE_RENDER_DAYS} days.`,
				},
			],
			details: { forgotten },
		};
	}

	async #stats(): Promise<AgentToolResult> {
		const agentDir = this.#agentDir();
		const byCategory: Record<string, number> = {};
		let unresolved = 0;
		let tombstones = 0;
		let entries = 0;
		for (const scope of this.#scopes()) {
			const snapshot = await readTasteScope(agentDir, scope);
			const state = await readTasteState(agentDir, scope);
			entries += snapshot.entries.length;
			for (const entry of snapshot.entries) {
				byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
				if (entry.conflict) unresolved += 1;
			}
			tombstones += state.tombstones.length;
		}
		const summary = { entries, byCategory, unresolved: Math.ceil(unresolved / 2), tombstones };
		const text = [
			`Stored preferences: ${summary.entries}`,
			Object.entries(byCategory)
				.map(([category, count]) => `  ${category}: ${count}`)
				.join("\n"),
			`Unresolved conflicts: ${summary.unresolved}`,
			`Retractions on record: ${summary.tombstones}`,
		]
			.filter(Boolean)
			.join("\n");
		return { content: [{ type: "text", text }], details: summary };
	}

	async #entries(): Promise<TasteEntry[]> {
		const seen = new Set<string>();
		const entries: TasteEntry[] = [];
		for (const scope of this.#scopes()) {
			for (const entry of (await readTasteScope(this.#agentDir(), scope)).entries) {
				if (seen.has(entry.topicKey)) continue;
				seen.add(entry.topicKey);
				entries.push(entry);
			}
		}
		return entries;
	}

	/** Apply a mutation to one scope's entries under the consolidation lock. */
	async #mutate(scope: TasteScopeKey, mutate: (entries: TasteEntry[]) => Promise<TasteEntry[]>): Promise<void> {
		const agentDir = this.#agentDir();
		await withFileLock(
			tasteLockPath(agentDir, scope),
			async () => {
				const snapshot = await readTasteScope(agentDir, scope);
				const state = await readTasteState(agentDir, scope);
				const next = await mutate(snapshot.entries);
				if (next !== snapshot.entries) await writeTasteScope(agentDir, scope, next, state);
			},
			{ retries: 2, retryDelayMs: 5 },
		);
	}
}

function toRow(entry: TasteEntry): StoredRow {
	return {
		topicKey: entry.topicKey,
		statement: entry.statement,
		category: entry.category,
		polarity: entry.polarity,
		confidence: entry.confidence,
		mentions: entry.mentions,
		lastUsed: entry.lastUsed,
		...(entry.conflict && { conflict: entry.conflict }),
	};
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
