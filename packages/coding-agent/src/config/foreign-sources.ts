/**
 * Native-only default for foreign **project** sources.
 *
 * `.zeta/**`, `AGENTS.md`, and the built-in prompt are Zeta's native standard.
 * `.claude/**`, `.codex/**`, `.gemini/**`, `.cursor/**`, `.windsurf/**`,
 * `.opencode/**`, `.github/instructions`, and `.vscode/mcp.json` are foreign:
 * a project copy is inert until the operator approves that exact source.
 *
 * Approval is hash-bound. The stored SHA-256 covers every file under the
 * provider's known project paths (relative name + bytes), so editing any of
 * them silently revokes the approval instead of carrying it to new content.
 * Consent lives in `<agentDir>/sources.json`, never in the repository.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, logger } from "@linxiraos/pi-utils";

export const FOREIGN_PROJECT_SOURCES_VERSION = 1;

/** Provider id → project paths (relative to cwd) that belong to it. */
const PROJECT_SOURCE_PATHS: Record<string, readonly string[]> = {
	claude: [".claude", "CLAUDE.md"],
	"claude-plugins": [".claude"],
	codex: [".codex"],
	gemini: [".gemini", "GEMINI.md"],
	cursor: [".cursor"],
	windsurf: [".windsurf", ".codeium/windsurf"],
	opencode: [".opencode", "opencode.json", "opencode.jsonc"],
	github: [".github/instructions", ".github/skills", ".github/prompts"],
	vscode: [".vscode/mcp.json"],
	cline: [".clinerules", ".cline"],
};

export interface ForeignSourceConsentEntry {
	enabled: boolean;
	/** SHA-256 of the provider's project files at approval time; `""` when none existed. */
	hash: string;
	approvedAt: string;
}

interface SourcesFile {
	version: number;
	repos: Record<string, Record<string, ForeignSourceConsentEntry>>;
}

function sourcesPath(agentDir = getAgentDir()): string {
	return path.join(agentDir, "sources.json");
}

function readSources(agentDir = getAgentDir()): SourcesFile {
	try {
		const parsed = JSON.parse(fs.readFileSync(sourcesPath(agentDir), "utf8")) as Partial<SourcesFile>;
		if (parsed && typeof parsed === "object" && parsed.repos && typeof parsed.repos === "object") {
			return { version: FOREIGN_PROJECT_SOURCES_VERSION, repos: parsed.repos as SourcesFile["repos"] };
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			logger.warn("foreign sources: unreadable consent store; treating as no consent", {
				path: sourcesPath(agentDir),
				error: String(error),
			});
		}
	}
	return { version: FOREIGN_PROJECT_SOURCES_VERSION, repos: {} };
}

function writeSources(file: SourcesFile, agentDir = getAgentDir()): void {
	const target = sourcesPath(agentDir);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const temp = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	fs.renameSync(temp, target);
}

/** Whether `providerId` is a foreign project source (native providers are never gated). */
export function isForeignProjectProvider(providerId: string): boolean {
	return Object.hasOwn(PROJECT_SOURCE_PATHS, providerId);
}

function walkFiles(root: string, out: string[], budget: { files: number }): void {
	if (budget.files <= 0) return;
	let stat: fs.Stats;
	try {
		stat = fs.statSync(root);
	} catch {
		return;
	}
	if (stat.isFile()) {
		budget.files -= 1;
		out.push(root);
		return;
	}
	if (!stat.isDirectory()) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		walkFiles(path.join(root, entry.name), out, budget);
		if (budget.files <= 0) return;
	}
}

/**
 * SHA-256 over the provider's present project paths. Empty when nothing exists.
 * File names are relative to cwd so a rename changes the hash.
 */
export function hashForeignProjectSource(providerId: string, cwd: string): string {
	const roots = PROJECT_SOURCE_PATHS[providerId];
	if (!roots) return "";
	const files: string[] = [];
	const budget = { files: 4096 };
	for (const root of roots) walkFiles(path.resolve(cwd, root), files, budget);
	if (files.length === 0) return "";
	const hasher = new Bun.CryptoHasher("sha256");
	for (const file of files) {
		let bytes: Buffer;
		try {
			bytes = fs.readFileSync(file);
		} catch {
			continue;
		}
		hasher.update(path.relative(cwd, file).split(path.sep).join("/"));
		hasher.update("\0");
		hasher.update(bytes);
		hasher.update("\0");
	}
	return hasher.digest("hex");
}

function envAllows(providerId: string): boolean {
	const raw = process.env.ZETA_FOREIGN_PROJECT_SOURCES?.trim().toLowerCase();
	if (!raw) return false;
	if (raw === "all" || raw === "*") return true;
	return raw
		.split(",")
		.map(value => value.trim())
		.includes(providerId);
}

/**
 * Native-only default: a foreign project source is loaded only when the
 * operator approved this provider for this repository **and** its files still
 * match the approved hash. `ZETA_FOREIGN_PROJECT_SOURCES=all|a,b` is the
 * explicit non-interactive escape (CI).
 */
export function isForeignProjectSourceAllowed(providerId: string, cwd: string, agentDir = getAgentDir()): boolean {
	if (!isForeignProjectProvider(providerId)) return true;
	if (envAllows(providerId)) return true;
	const repo = path.resolve(cwd);
	const entry = readSources(agentDir).repos[repo]?.[providerId];
	if (!entry?.enabled) return false;
	const current = hashForeignProjectSource(providerId, cwd);
	if (current !== entry.hash) return false;
	return true;
}

/** Record or revoke consent for one provider in one repository. */
export function setForeignProjectSourceConsent(
	providerId: string,
	cwd: string,
	enabled: boolean,
	agentDir = getAgentDir(),
): ForeignSourceConsentEntry {
	if (!isForeignProjectProvider(providerId)) {
		throw new Error(`Not a foreign project source: ${providerId}`);
	}
	const file = readSources(agentDir);
	const repo = path.resolve(cwd);
	const repos = file.repos;
	const entries = (repos[repo] ??= {});
	const entry: ForeignSourceConsentEntry = {
		enabled,
		hash: hashForeignProjectSource(providerId, cwd),
		approvedAt: new Date().toISOString(),
	};
	entries[providerId] = entry;
	writeSources(file, agentDir);
	return entry;
}

export interface ForeignProjectSourceStatus {
	providerId: string;
	present: boolean;
	approved: boolean;
	stale: boolean;
	hash: string;
}

/** Inventory for a CLI/UI surface: present, approved, and whether approval is stale. */
export function listForeignProjectSources(cwd: string, agentDir = getAgentDir()): ForeignProjectSourceStatus[] {
	const repo = path.resolve(cwd);
	const entries = readSources(agentDir).repos[repo] ?? {};
	return Object.keys(PROJECT_SOURCE_PATHS)
		.sort()
		.map(providerId => {
			const hash = hashForeignProjectSource(providerId, cwd);
			const entry = entries[providerId];
			return {
				providerId,
				present: hash.length > 0,
				approved: entry?.enabled === true,
				stale: entry?.enabled === true && entry.hash !== hash,
				hash,
			};
		});
}
