/**
 * Cross-surface handoff — the file zeta and the TTT editor use to hand work
 * to each other.
 *
 * Both surfaces are the same product split across two processes: the agent
 * CLI owns the conversation, the editor owns the files. Switching between
 * them has to carry three things or the user re-does work by hand: where
 * they were (cwd), which repository that is (gitRoot), and what the agent
 * was doing (sessionFile, plus the file:line:col the cursor was on).
 *
 * The file is write-once / read-once: the side that switches writes it and
 * consumes it on arrival, so a stale handoff can never re-open yesterday's
 * context. It lives in the user config dir, not the project, because
 * switching surfaces is a global action rather than per-repository state.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Which surface produced this handoff. */
export type HandoffSource = "zeta" | "editor";

export interface Handoff {
	/** Absolute working directory the user was in. */
	cwd: string;
	/** Repository root when cwd is inside one; empty when it is not. */
	gitRoot: string;
	/** Agent session file, so `zeta --resume` can restore the conversation. */
	sessionFile?: string;
	/** Cursor target as `path:line:col` (line/col optional, 1-based). */
	file?: string;
	/** Surface that wrote the handoff. */
	from: HandoffSource;
	/** Epoch ms, for diagnostics when a handoff is ignored. */
	ts: number;
}

/** `~/.zeta/handoff.json` — overridable for tests via ZETA_HANDOFF_PATH. */
export function handoffPath(): string {
	const override = process.env.ZETA_HANDOFF_PATH;
	if (override) return override;
	const home = process.env.ZETA_CONFIG_DIR ?? path.join(os.homedir(), ".zeta");
	return path.join(home, "handoff.json");
}

/**
 * Write a handoff. The parent directory is created because a fresh install
 * has no `~/.zeta` yet, and failing the switch over a missing directory
 * would be a pointless error.
 */
export async function writeHandoff(handoff: Omit<Handoff, "ts" | "from"> & { from: HandoffSource }): Promise<string> {
	const target = handoffPath();
	await fs.promises.mkdir(path.dirname(target), { recursive: true });
	const payload: Handoff = { ...handoff, ts: Date.now() };
	// Write-then-rename so a reader never sees a half-written file when both
	// surfaces switch at the same moment.
	const tmp = `${target}.${process.pid}.tmp`;
	await fs.promises.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	await fs.promises.rename(tmp, target);
	return target;
}

/**
 * Read and remove the handoff, if any. Returns null when absent or
 * unreadable — a corrupt handoff must not block the surface from starting.
 */
export async function consumeHandoff(): Promise<Handoff | null> {
	const target = handoffPath();
	let raw: string;
	try {
		raw = await fs.promises.readFile(target, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return null;
		return null;
	}
	try {
		await fs.promises.unlink(target);
	} catch {
		// Already consumed by the other surface; fall through and parse.
	}
	try {
		const parsed = JSON.parse(raw) as Handoff;
		if (typeof parsed?.cwd !== "string" || parsed.cwd === "") return null;
		return parsed;
	} catch {
		return null;
	}
}

/** Split a `path:line:col` target into its parts (line/col 1-based, optional). */
export function parseFileTarget(target: string): { path: string; line?: number; col?: number } {
	// Windows drive letters contain a colon, so only treat a colon as a
	// separator when what follows it looks like a line number.
	const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(target);
	if (!match) return { path: target };
	const [, filePath, line, col] = match;
	return { path: filePath, line: Number(line), col: col === undefined ? undefined : Number(col) };
}

/** Build a `path:line:col` target from parts, omitting absent positions. */
export function formatFileTarget(filePath: string, line?: number, col?: number): string {
	if (!line) return filePath;
	if (!col) return `${filePath}:${line}`;
	return `${filePath}:${line}:${col}`;
}
