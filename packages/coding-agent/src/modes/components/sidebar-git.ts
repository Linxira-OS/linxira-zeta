/**
 * Cached Git snapshot backing the sidebar's Git widget: the checked-out branch,
 * ahead/behind against its upstream, staged/unstaged/untracked counts, and the
 * last five commits. Every read the render path performs is a cached getter;
 * `refresh()` does the only IO, off the render loop, when the status line
 * reports a HEAD/branch/status change (no sidebar polling timer). Outside a
 * repository — or on any git failure — the snapshot is `null` and the widget
 * hides.
 */

/** Commits the snapshot keeps (and the widget shows) when available. */
export const SIDEBAR_GIT_COMMIT_LIMIT = 5;
/** `git status --porcelain=v2` output cap: a huge untracked tree must not balloon a refresh. */
const MAX_STATUS_BYTES = 256 * 1024;
/** `git log` output cap; five one-line commits fit comfortably. */
const MAX_LOG_BYTES = 32 * 1024;

/** One recent commit, pre-formatted for the gutter. */
export interface SidebarGitCommit {
	shortSha: string;
	subject: string;
	/** Compact relative age (`now`, `5m`, `2h`, `3d`, `2w`, `4mo`, `1y`). */
	age: string;
}

/** Committed Git state the sidebar renders. */
export interface SidebarGitSnapshot {
	/** Checked-out branch, or `null` for a detached HEAD. */
	branch: string | null;
	ahead: number;
	behind: number;
	staged: number;
	unstaged: number;
	untracked: number;
	commits: readonly SidebarGitCommit[];
}

/** Porcelain v2 branch header + working-tree counts. */
export interface SidebarGitStatusSummary {
	branch: string | null;
	ahead: number;
	behind: number;
	staged: number;
	unstaged: number;
	untracked: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Compact relative age for a commit row, so the 36-column gutter keeps its subject. */
export function formatSidebarCommitAge(committedAtMs: number, nowMs: number): string {
	const delta = Math.max(0, nowMs - committedAtMs);
	if (delta < MINUTE_MS) return "now";
	if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m`;
	if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h`;
	if (delta < WEEK_MS) return `${Math.floor(delta / DAY_MS)}d`;
	if (delta < MONTH_MS) return `${Math.floor(delta / WEEK_MS)}w`;
	if (delta < YEAR_MS) return `${Math.floor(delta / MONTH_MS)}mo`;
	return `${Math.floor(delta / YEAR_MS)}y`;
}

/**
 * Parse `git status --porcelain=v2 --branch` into the branch header facts and
 * the staged/unstaged/untracked counts the status line reports. Renames (`2`)
 * and ordinary changes (`1`) split their XY letters across the index and the
 * worktree; unmerged (`u`) entries count on both sides; ignored (`!`) entries
 * are not work.
 */
export function parseSidebarGitStatus(output: string): SidebarGitStatusSummary {
	let branch: string | null = null;
	let ahead = 0;
	let behind = 0;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;

	for (const line of output.split("\n")) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			branch = head === "(detached)" ? null : head;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = /^\+(\d+) -(\d+)$/.exec(line.slice("# branch.ab ".length).trim());
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
			continue;
		}
		if (line.startsWith("# ")) continue;
		if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// `1 XY sub mH mI mW hH hI path` / `2 XY sub mH mI mW hH hI Rscore path`
			const x = line[2];
			const y = line[3];
			if (x !== ".") staged++;
			if (y !== ".") unstaged++;
			continue;
		}
		if (line.startsWith("u ")) {
			staged++;
			unstaged++;
			continue;
		}
		if (line.startsWith("? ")) untracked++;
	}

	return { branch, ahead, behind, staged, unstaged, untracked };
}

/**
 * Parse `git log -n 5 --pretty=format:%h%x1f%s%x1f%ct` output. The unit
 * separator keeps subjects containing spaces (or any printable character)
 * intact; the commit timestamp is rendered as a compact relative age.
 */
export function parseSidebarGitLog(output: string, nowMs: number = Date.now()): SidebarGitCommit[] {
	const commits: SidebarGitCommit[] = [];
	for (const line of output.split("\n")) {
		if (!line) continue;
		const [shortSha, subject, seconds] = line.split("\x1f");
		if (!shortSha || subject === undefined || seconds === undefined) continue;
		const committedAtSeconds = Number(seconds);
		if (!Number.isFinite(committedAtSeconds)) continue;
		commits.push({
			shortSha,
			subject,
			age: formatSidebarCommitAge(committedAtSeconds * 1000, nowMs),
		});
		if (commits.length >= SIDEBAR_GIT_COMMIT_LIMIT) break;
	}
	return commits;
}

/** Combine one status read and one log read into the widget's snapshot. */
export function buildSidebarGitSnapshot(
	statusOutput: string,
	logOutput: string,
	nowMs: number = Date.now(),
): SidebarGitSnapshot {
	return {
		...parseSidebarGitStatus(statusOutput),
		commits: parseSidebarGitLog(logOutput, nowMs),
	};
}

interface BoundedOutput {
	text: string;
	truncated: boolean;
}

/** Read at most `limit` bytes so one pathological repo cannot stall a refresh. */
async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<BoundedOutput> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let bytes = 0;
	let truncated = false;
	try {
		while (bytes < limit) {
			const { done, value } = await reader.read();
			if (done) break;
			const take = Math.min(value.byteLength, limit - bytes);
			if (take > 0) {
				text += decoder.decode(value.subarray(0, take), { stream: true });
				bytes += take;
			}
			if (take < value.byteLength) {
				truncated = true;
				break;
			}
		}
		if (bytes >= limit) truncated = true;
	} finally {
		if (truncated) void reader.cancel().catch(() => {});
	}
	text += decoder.decode();
	return { text, truncated };
}

interface GitCapture {
	code: number;
	stdout: string;
	truncated: boolean;
}

async function runGitBounded(
	cwd: string,
	args: readonly string[],
	maxBytes: number,
	signal: AbortSignal,
): Promise<GitCapture> {
	const proc = Bun.spawn(["git", "-C", cwd, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
		// Read-only status must not touch the index, and it must never wait on a
		// credential prompt.
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
		signal,
	});
	const { text, truncated } = await readBounded(proc.stdout as ReadableStream<Uint8Array>, maxBytes);
	if (truncated) proc.kill();
	const code = await proc.exited.catch(() => 1);
	return { code, stdout: text, truncated };
}

/**
 * Read the sidebar snapshot for `cwd`; `null` outside a repository or when git
 * itself fails. A truncated status read still yields a partial snapshot: the
 * counts are bounded but usable.
 */
export async function readSidebarGitSnapshot(
	cwd: string,
	signal: AbortSignal = new AbortController().signal,
): Promise<SidebarGitSnapshot | null> {
	const [status, log] = await Promise.all([
		runGitBounded(cwd, ["status", "--porcelain=v2", "--branch"], MAX_STATUS_BYTES, signal),
		runGitBounded(
			cwd,
			["log", "-n", String(SIDEBAR_GIT_COMMIT_LIMIT), "--pretty=format:%h%x1f%s%x1f%ct"],
			MAX_LOG_BYTES,
			signal,
		).catch(() => null),
	]);
	if (status.code !== 0 && !status.truncated) return null;
	const logOutput = log && (log.code === 0 || log.truncated) ? log.stdout : "";
	return buildSidebarGitSnapshot(status.stdout, logOutput, Date.now());
}

/** Options injected by the interactive mode; all reads are synchronous. */
export interface SidebarGitSourceOptions {
	/** Directory the repository is discovered from (the session cwd). */
	cwd: () => string;
	/** Called after a refresh changes the snapshot so the TUI can repaint. */
	onChange?: () => void;
	/** False disables Git reads entirely (the `git.enabled` setting). */
	enabled?: () => boolean;
}

/**
 * Owns the cached snapshot. `refresh()` coalesces overlapping requests into at
 * most one in-flight read plus one trailing pass, and a result arriving after
 * the cwd moved is discarded instead of flashing stale rows.
 */
export class SidebarGitSource {
	readonly #cwd: () => string;
	readonly #onChange?: () => void;
	readonly #enabled: () => boolean;
	#snapshot: SidebarGitSnapshot | null = null;
	#drain: Promise<void> | null = null;
	#queued = false;
	#disposed = false;
	#controller: AbortController | null = null;

	constructor(options: SidebarGitSourceOptions) {
		this.#cwd = options.cwd;
		this.#onChange = options.onChange;
		this.#enabled = options.enabled ?? (() => true);
	}

	/** Last completed snapshot; `null` hides the Git widget. Never performs IO. */
	snapshot(): SidebarGitSnapshot | null {
		return this.#snapshot;
	}

	/** Refresh in the background; safe to call from any event callback. */
	refresh(): Promise<void> {
		if (this.#disposed) return Promise.resolve();
		if (!this.#enabled()) {
			this.#controller?.abort();
			this.#controller = null;
			this.#setSnapshot(null);
			return Promise.resolve();
		}
		if (this.#drain) {
			this.#queued = true;
			return this.#drain;
		}
		const drain = this.#run();
		this.#drain = drain;
		const settle = (): void => {
			if (this.#drain === drain) this.#drain = null;
		};
		void drain.then(settle, settle);
		return drain;
	}

	/** Stop reading and drop the snapshot; idempotent. */
	dispose(): void {
		this.#disposed = true;
		this.#queued = false;
		this.#controller?.abort();
		this.#controller = null;
		this.#snapshot = null;
	}

	async #run(): Promise<void> {
		try {
			while (!this.#disposed) {
				this.#queued = false;
				if (!this.#enabled()) {
					this.#setSnapshot(null);
					return;
				}
				const cwd = this.#cwd();
				const controller = new AbortController();
				this.#controller = controller;
				let next: SidebarGitSnapshot | null = null;
				try {
					next = await readSidebarGitSnapshot(cwd, controller.signal);
				} catch {
					next = null;
				}
				this.#controller = null;
				if (this.#disposed) return;
				// A cwd/repo switch during the read makes this result stale.
				if (cwd !== this.#cwd()) {
					this.#queued = true;
					continue;
				}
				this.#setSnapshot(next);
				if (!this.#queued) return;
			}
		} finally {
			this.#controller = null;
		}
	}

	#setSnapshot(next: SidebarGitSnapshot | null): void {
		if (JSON.stringify(next) === JSON.stringify(this.#snapshot)) return;
		this.#snapshot = next;
		try {
			this.#onChange?.();
		} catch {
			// A repaint callback must not tear down the refresh loop.
		}
	}
}
