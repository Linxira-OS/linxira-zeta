/**
 * Team/persona memory: durable notes under `<team>/.zeta/memory/`, never in a
 * repository worktree and never an AGENTS.md substitute.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const TEAM_MEMORY_DIR = path.join(".zeta", "memory");
const KEY = /^[a-z][a-z0-9-]{0,63}$/;

export function teamMemoryDir(teamRoot: string): string {
	return path.join(teamRoot, TEAM_MEMORY_DIR);
}

function memoryFile(teamRoot: string, key: string): string {
	if (!KEY.test(key)) throw new Error("Team memory key must be a lowercase slug");
	return path.join(teamMemoryDir(teamRoot), `${key}.md`);
}

export async function readTeamMemory(teamRoot: string, key: string): Promise<string | undefined> {
	try {
		return await fs.readFile(memoryFile(teamRoot, key), "utf8");
	} catch {
		return undefined;
	}
}

export async function listTeamMemory(teamRoot: string): Promise<readonly string[]> {
	try {
		return (await fs.readdir(teamMemoryDir(teamRoot)))
			.filter(name => name.endsWith(".md"))
			.map(name => name.slice(0, -3))
			.sort();
	} catch {
		return [];
	}
}

/** Append one entry. The caller supplies the timestamp so tests stay deterministic. */
export async function appendTeamMemory(teamRoot: string, key: string, text: string, at = Date.now()): Promise<void> {
	const body = text.trim();
	if (!body) throw new Error("Team memory entry must not be empty");
	const file = memoryFile(teamRoot, key);
	await fs.mkdir(teamMemoryDir(teamRoot), { recursive: true });
	const stamp = new Date(at).toISOString();
	await fs.appendFile(file, `\n## ${stamp}\n${body}\n`, { encoding: "utf8", mode: 0o600 });
}
