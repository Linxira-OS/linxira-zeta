/**
 * Pi Messenger - Configuration
 *
 * Priority (highest to lowest):
 * 1. Project: <project>/.zeta/pi-messenger.json
 * 2. Extension-specific: ~/.zeta/agent/pi-messenger.json
 * 3. Defaults
 *
 * (The historical third source, the upstream pi "messenger" key in
 * ~/.pi/agent/settings.json, belonged to the pi CLI's own settings file and
 * has no zeta equivalent; it is no longer read.)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath } from "./paths.ts";
import { ensureProjectStateMigrated } from "./crew/utils/migrations.ts";

export interface MessengerConfig {
	autoRegister: boolean;
	autoRegisterPaths: string[];
	scopeToFolder: boolean;
	contextMode: "full" | "minimal" | "none";
	registrationContext: boolean;
	replyHint: boolean;
	senderDetailsOnFirstContact: boolean;
	nameTheme: string;
	nameWords?: { adjectives: string[]; nouns: string[] };
	feedRetention: number;
	stuckThreshold: number;
	stuckNotify: boolean;
	autoStatus: boolean;
	autoOverlay: boolean;
	autoOverlayPlanning: boolean;
	crewEventsInFeed: boolean;
}

const DEFAULT_CONFIG: MessengerConfig = {
	autoRegister: false,
	autoRegisterPaths: [],
	scopeToFolder: false,
	contextMode: "full",
	registrationContext: true,
	replyHint: true,
	senderDetailsOnFirstContact: true,
	nameTheme: "default",
	feedRetention: 50,
	stuckThreshold: 900,
	stuckNotify: true,
	autoStatus: true,
	autoOverlay: true,
	autoOverlayPlanning: true,
	crewEventsInFeed: true,
};

function readJsonFile(path: string): Record<string, unknown> | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function expandHome(p: string): string {
	if (p.startsWith("~/")) {
		return join(homedir(), p.slice(2));
	}
	return p;
}

export function matchesAutoRegisterPath(cwd: string, paths: string[]): boolean {
	const normalizedCwd = cwd.replace(/\/+$/, ""); // Remove trailing slashes

	for (const pattern of paths) {
		const expanded = expandHome(pattern).replace(/\/+$/, "");

		// Simple glob support: trailing /* matches any subdirectory
		if (expanded.endsWith("/*")) {
			const base = expanded.slice(0, -2);
			if (normalizedCwd === base || normalizedCwd.startsWith(base + "/")) {
				return true;
			}
		} else if (expanded.endsWith("*")) {
			// Prefix match: /path/prefix* matches /path/prefix-anything
			const prefix = expanded.slice(0, -1);
			if (normalizedCwd.startsWith(prefix)) {
				return true;
			}
		} else {
			// Exact match
			if (normalizedCwd === expanded) {
				return true;
			}
		}
	}

	return false;
}

export function saveAutoRegisterPaths(paths: string[]): void {
	const configPath = getGlobalConfigPath();
	let existing: Record<string, unknown> = {};

	if (existsSync(configPath)) {
		try {
			existing = JSON.parse(readFileSync(configPath, "utf-8"));
		} catch {
			// Start fresh if malformed
		}
	}

	existing.autoRegisterPaths = paths;

	const dir = dirname(configPath);
	mkdirSync(dir, { recursive: true });
	writeFileSync(configPath, JSON.stringify(existing, null, 2));
}

export function getAutoRegisterPaths(): string[] {
	const configPath = getGlobalConfigPath();
	if (!existsSync(configPath)) return [];

	try {
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		return Array.isArray(config.autoRegisterPaths) ? config.autoRegisterPaths : [];
	} catch {
		return [];
	}
}

function buildConfig(projectConfig?: Partial<MessengerConfig> | null): MessengerConfig {
	const extensionGlobalPath = getGlobalConfigPath();

	// Load extension-specific global config
	const extensionConfig = readJsonFile(extensionGlobalPath) as Partial<MessengerConfig> | null;

	const merged = {
		...DEFAULT_CONFIG,
		...extensionConfig,
		...projectConfig,
	};

	const nameWords = (merged as Record<string, unknown>).nameWords as
		| { adjectives: string[]; nouns: string[] }
		| undefined;

	const sharedFields = {
		nameTheme: typeof merged.nameTheme === "string" ? merged.nameTheme : DEFAULT_CONFIG.nameTheme,
		nameWords:
			nameWords && Array.isArray(nameWords.adjectives) && Array.isArray(nameWords.nouns) ? nameWords : undefined,
		feedRetention: typeof merged.feedRetention === "number" ? merged.feedRetention : DEFAULT_CONFIG.feedRetention,
		stuckThreshold: typeof merged.stuckThreshold === "number" ? merged.stuckThreshold : DEFAULT_CONFIG.stuckThreshold,
		stuckNotify: merged.stuckNotify !== false,
		autoStatus: merged.autoStatus !== false,
		autoOverlay: merged.autoOverlay !== false,
		autoOverlayPlanning: merged.autoOverlayPlanning !== false,
		crewEventsInFeed: merged.crewEventsInFeed !== false,
	};

	if (merged.contextMode === "none") {
		return {
			autoRegister: merged.autoRegister === true,
			autoRegisterPaths: Array.isArray(merged.autoRegisterPaths) ? merged.autoRegisterPaths : [],
			scopeToFolder: merged.scopeToFolder === true,
			contextMode: "none",
			registrationContext: false,
			replyHint: false,
			senderDetailsOnFirstContact: false,
			...sharedFields,
		};
	}

	if (merged.contextMode === "minimal") {
		return {
			autoRegister: merged.autoRegister === true,
			autoRegisterPaths: Array.isArray(merged.autoRegisterPaths) ? merged.autoRegisterPaths : [],
			scopeToFolder: merged.scopeToFolder === true,
			contextMode: "minimal",
			registrationContext: false,
			replyHint: true,
			senderDetailsOnFirstContact: false,
			...sharedFields,
		};
	}

	return {
		autoRegister: merged.autoRegister === true,
		autoRegisterPaths: Array.isArray(merged.autoRegisterPaths) ? merged.autoRegisterPaths : [],
		scopeToFolder: merged.scopeToFolder === true,
		contextMode: "full",
		registrationContext: merged.registrationContext !== false,
		replyHint: merged.replyHint !== false,
		senderDetailsOnFirstContact: merged.senderDetailsOnFirstContact !== false,
		...sharedFields,
	};
}

export function loadGlobalConfig(): MessengerConfig {
	return buildConfig();
}

export function loadConfig(cwd: string): MessengerConfig {
	ensureProjectStateMigrated(cwd);
	const projectConfig = readJsonFile(getProjectConfigPath(cwd)) as Partial<MessengerConfig> | null;
	return buildConfig(projectConfig);
}

/**
 * Conservative project-trust gate. Project-supplied crew agents and skills,
 * and project-scope agent registration via /teamagent, only load when the
 * project config (<project>/.zeta/pi-messenger.json) explicitly opts in with
 * `"trustProjectAgents": true`. Defaults to false so cloning an untrusted
 * repository cannot silently register tool-capable subagents. Only the
 * project-level file grants this — a user-global setting must not trust every
 * repository on the machine.
 */
export function isProjectAgentsTrusted(cwd: string): boolean {
	return readJsonFile(getProjectConfigPath(cwd))?.trustProjectAgents === true;
}
