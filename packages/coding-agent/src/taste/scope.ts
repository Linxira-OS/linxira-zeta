/**
 * Taste domains and the scope list a caller is allowed to read.
 *
 * A preference store is addressed by domain plus caller-chosen segments; the
 * store never interprets what a segment means. Three domains are live today —
 * `global` (habits that hold across repositories), `projects` (bound to one
 * repository's bank id) and `agents` (one agent's own preferences inside a
 * repository) — and three are reserved for the super-agent work (`bots`,
 * `rooms`, `team`). See `document/agent-mesh.md`: an agent is an addressable
 * entity (id + workspace + role), so "this agent's taste" has to be a scope of
 * its own or every bot in a room shares one opinion.
 *
 * `resolveTasteScopes` is the only place that knows about sessions. Everything
 * else (`store`, `score`, `consolidate`, `inject`) consumes a `TasteScopeKey[]`
 * and never looks at a session, a bot or a room — which is why wiring the
 * reserved domains later only touches this file.
 */
import { projectBankSegment } from "../mnemopi/config";

import { cfgTasteScoping } from "./settings";
import type { Settings } from "../config/settings";

/** Domains the store knows how to address. Reserved ones are never produced yet. */
export type TasteDomain = "global" | "projects" | "agents" | "bots" | "rooms" | "team";

/** One addressable store. */
export interface TasteScopeKey {
	domain: TasteDomain;
	/** Path segments under the domain, chosen by the caller; already slug-safe. */
	segments: string[];
}

/** Injective path segment for an agent identity. */
function encodeTasteSegment(value: string): string {
	let out = "";
	for (const byte of new TextEncoder().encode(value)) {
		const ch = String.fromCharCode(byte);
		const safe =
			(byte >= 48 && byte <= 57) ||
			(byte >= 65 && byte <= 90) ||
			(byte >= 97 && byte <= 122) ||
			byte === 46 ||
			byte === 95 ||
			byte === 45;
		out += safe ? ch : `~${byte.toString(16).padStart(2, "0").toUpperCase()}`;
	}
	return out.length === 0 ? "_" : out;
}

/** What the caller knows about where it runs. Reserved fields are accepted and ignored. */
export interface TasteScopeContext {
	cwd: string;
	/** Agent identity (`Main` for the top-level session); selects the `agents` domain. */
	agentId?: string;
	/** Per-agent memory namespace; preferred over `agentId` when present. */
	namespace?: string;
	/** Reserved: super-agent bot id. */
	botId?: string;
	/** Reserved: super-agent room id. */
	roomId?: string;
}

/**
 * The scopes a caller reads, most specific first: the first store that has an
 * entry for a topic wins, and a broader scope only fills topics the narrower one
 * does not cover.
 *
 * - `per-project`: this project's store.
 * - `per-project-tagged`: this project's store, then `global` for cross-project
 *   habits.
 * - `global`: the shared store only.
 *
 * An `agentId` always adds the `agents` scope first, in every mode: an agent's
 * own preferences are narrower than any project view, and two agents in one
 * repository must not see each other's.
 */
export function resolveTasteScopes(ctx: TasteScopeContext, settings: Settings): TasteScopeKey[] {
	const scopes: TasteScopeKey[] = [];
	const bank = projectBankSegment(ctx.cwd);
	// `namespace` is already per-binding; encode it to a slug-safe segment so a
	// colon or slash cannot collapse two identities into one directory.
	const identity = ctx.namespace?.trim() ? encodeTasteSegment(ctx.namespace.trim()) : ctx.agentId;
	if (identity) scopes.push({ domain: "agents", segments: [bank, identity] });
	switch (cfgTasteScoping.get(settings)) {
		case "global":
			scopes.push({ domain: "global", segments: [] });
			break;
		case "per-project":
			scopes.push({ domain: "projects", segments: [bank] });
			break;
		default:
			scopes.push({ domain: "projects", segments: [bank] });
			scopes.push({ domain: "global", segments: [] });
			break;
	}
	// `botId`/`roomId` are accepted but deliberately produce no source until the
	// super-agent runtime exists: a scope nobody writes is a directory nobody
	// should create.
	return scopes;
}
