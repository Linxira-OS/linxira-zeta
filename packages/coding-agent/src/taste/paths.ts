/**
 * Taste storage layout.
 *
 * Everything is home-scoped under `<agentDir>/memories/taste/`, next to the
 * sharpshooter banks and never inside the project working tree:
 *
 *     global/taste.md                                cross-repository habits
 *     projects/<projectBankSegment>/taste.md         one repository
 *     agents/<projectBankSegment>/<agentSlug>/taste.md   one agent in one repository
 *     <scope>/state.json                             machine state beside the visible file
 *     <scope>/queue/<sessionId>/<ts36>-<nonce>.json  extraction candidates
 *     <scope>/consolidate.lock                       single-writer guard
 *
 * `bots/<botId>/`, `rooms/<roomId>/` and `team/` are reserved for the
 * super-agent runtime and are deliberately not created: a directory nobody
 * writes is a directory nobody should have to find.
 *
 * The root comes from `getAgentDir()` + `getMemoriesDir()`, so a named profile
 * or an XDG data home resolves to its own store without a literal path here.
 */
import * as path from "node:path";
import { getMemoriesDir } from "@linxiraos/pi-utils";

import { sanitizeBankName } from "../mnemopi/config";
import type { TasteScopeKey } from "./scope";

/** Domains a path may name. Anything else is a programming error, not a fallback. */
const KNOWN_DOMAINS: Record<string, true> = {
	global: true,
	projects: true,
	agents: true,
	bots: true,
	rooms: true,
	team: true,
};

/** Root of every taste store for this agent directory. */
export function tasteRoot(agentDir: string): string {
	return path.join(getMemoriesDir(agentDir), "taste");
}

/** Directory of one scope. */
export function tasteScopeDir(agentDir: string, key: TasteScopeKey): string {
	if (KNOWN_DOMAINS[key.domain] !== true) {
		throw new Error(`unknown taste domain: ${String(key.domain)}`);
	}
	const segments = key.segments.map(segment => {
		const sanitized = sanitizeBankName(segment);
		if (!sanitized) throw new Error(`unsafe taste segment: ${JSON.stringify(segment)}`);
		return sanitized;
	});
	return path.join(tasteRoot(agentDir), key.domain, ...segments);
}

/** The human-readable (and Command Code compatible) preference file. */
export function tasteFilePath(agentDir: string, key: TasteScopeKey): string {
	return path.join(tasteScopeDir(agentDir, key), "taste.md");
}

/** Machine state that does not belong in the visible file. */
export function tasteStatePath(agentDir: string, key: TasteScopeKey): string {
	return path.join(tasteScopeDir(agentDir, key), "state.json");
}

/** Candidate queue root of one scope; one subdirectory per session. */
export function tasteQueueDir(agentDir: string, key: TasteScopeKey): string {
	return path.join(tasteScopeDir(agentDir, key), "queue");
}

/**
 * Advisory lock stem guarding consolidation of one scope. `withFileLock`
 * appends `.lock` itself.
 */
export function tasteLockPath(agentDir: string, key: TasteScopeKey): string {
	return path.join(tasteScopeDir(agentDir, key), "consolidate");
}

/** Stable identity of a scope for in-process maps and logs. */
export function tasteScopeId(key: TasteScopeKey): string {
	return [key.domain, ...key.segments].join("/");
}

/**
 * Command Code's own store, the only foreign file this layer ever reads.
 * Imported once per project store; never written, never watched.
 */
export function commandCodeTasteFile(cwd: string): string {
	return path.join(cwd, ".commandcode", "taste", "taste.md");
}
