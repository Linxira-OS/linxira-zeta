/**
 * Embedded terminal (spec §15, batch 4) — PTY sessions owned by the gateway
 * process, shared by web-ui and the desktop shell.
 *
 * Control plane (REST, authorized like every other gateway route):
 *   POST   /api/terminal            create {cwd?, file?, line?, col?} → {id, shell, ticket}
 *   POST   /api/terminal/ensure     ensure {cwd?, instanceId?, file?, line?, col?} → same, + {reused}
 *   GET    /api/terminal            list live sessions + retained exited sessions
 *   DELETE /api/terminal/:id        kill and drop a session
 *   POST   /api/terminal/:id/resize {cols, rows}
 *   POST   /api/terminal/:id/ticket one-time connect ticket for the WS data plane
 *
 * Session identity (P1 workbench + reattach): a session owns a slot keyed by
 * `(resolved cwd, instance id)`, where the instance id is allocated by the UI
 * (see `DEFAULT_TERMINAL_INSTANCE` for the id-less caller). `ensure` returns the
 * slot's live PTY — replaying its ring buffer, so pane close/reopen resumes the
 * *same* shell — and only spawns when the slot is empty or its session died;
 * a reuse never consumes another slot of the live-terminal budget. Two
 * workspaces never share a session: the key starts with the absolute cwd.
 * Retained exited records are dropped with an `expired` signal, and an explicit
 * DELETE emits `session_ended` (reason `killed`) before the PTY is reaped.
 *
 * The default program is the framework workbench `zetawork` (npm bins `zeta` /
 * `zetawork` / `zeta-work`); when it is not installed the session falls back to
 * the platform shell and reports `fallbackReason` so the UI can say so out
 * loud instead of hiding the substitution.
 *
 * Data plane: GET /api/terminal/:id/ws (WebSocket upgrade). Browsers cannot
 * attach `Authorization`/`X-Zeta-Token` headers to a WebSocket, so the upgrade
 * accepts a one-time connect ticket from the control plane; loopback callers
 * pass directly (same trust level as the REST gate).
 *
 * Wire protocol (mirrors the opencode shape): the first outbound frame is a
 * binary frame prefixed `0x00` carrying JSON metadata (`{replayedBytes}` on
 * attach, `{event:"exit", exitCode}` on PTY exit, `{event:"session_ended",
 * reason}` when the gateway ends the session — reason `killed` for an explicit
 * DELETE, `expired` when a retained exited record is pruned); every later
 * outbound frame is raw PTY bytes. Inbound text frames are raw stdin.
 *
 * PTY backend: `PtySession` from @linxiraos/pi-natives (the same NAPI PTY the
 * interactive bash tool uses). node-pty was evaluated and rejected with
 * evidence: under the Bun runtime that hosts this gateway its ConPTY data
 * plane stalls and its winpty write path silently drops input, while
 * PtySession round-trips (see batch-4 report). The `TerminalPty` seam keeps
 * the manager testable and lets a future backend slot in.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WebSocketHandler } from "bun";
import { PtySession } from "@linxiraos/pi-natives";
import { defaultProbeContext, discoverBin, pathImpl, type OpenProbeContext } from "../../utils/bin-discovery";
import { hostIsLoopback, isAllowedOrigin } from "../web-gateway";
import { ZETA_IDE_BINS, resolveTerminal, type ResolvedTerminal } from "./open";

// --- tunables (spec §15) ---

/** Concurrent live terminals; request #5 gets 429. */
export const MAX_LIVE_TERMINALS = 4;
/** Reconnect replay budget per session. */
export const RING_BUFFER_BYTES = 64 * 1024;
/** Exited sessions kept (with their final replay buffer) for list/replay. */
export const RETAINED_EXITED_TERMINALS = 25;
/** Connect-ticket TTL and pending cap (one-time WS handshakes). */
const TICKET_TTL_MS = 60_000;
const MAX_PENDING_TICKETS = 128;
/** Small grace so the shell has painted its prompt before an injected command. */
const INJECT_DELAY_MS = 400;
/** Slot when a caller passes no instance id (legacy `create` callers). */
export const DEFAULT_TERMINAL_INSTANCE = "default";
/** Instance ids land in a Map key next to an absolute cwd; keep them tame. */
const INSTANCE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Framework workbench launchers, in probe order. The npm form
 * (`@linxiraos/main`) installs `zeta` / `zetawork` / `zeta-work`; distro and
 * pacman packages ship `zetawork` alone. In-repo shorthand: never rename it.
 */
export const ZETAWORK_BINS = ["zetawork", "zeta-work", "zeta"] as const;

/** Why a session runs a plain shell instead of the workbench. */
export type SessionFallbackReason = "workbench-not-found";

/** Interactive program the PTY starts: the workbench, or the shell fallback. */
export interface SessionProgram {
	kind: "workbench" | "shell";
	/** Status-bar label: the resolved bin basename, or the shell label. */
	label: string;
	/** Absolute executable for the PTY. */
	command: string;
	/** argv after `command`. */
	args: string[];
	/** Non-null on the fallback branch, so the UI can state it. */
	fallbackReason: SessionFallbackReason | null;
}

// --- PTY backend seam ---

/** Spawn argv for one terminal session. */
export interface TerminalSpawnSpec {
	application: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	cols: number;
	rows: number;
	onData: (chunk: string) => void;
	onExit: (exitCode: number | null) => void;
}

/** Live handle into one PTY. Mirrors the PtySession surface actually used. */
export interface TerminalPty {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
}

export type TerminalPtyFactory = (spec: TerminalSpawnSpec) => TerminalPty;

function nativesPtyFactory(spec: TerminalSpawnSpec): TerminalPty {
	const session = new PtySession();
	const run = session.startArgv(
		{
			application: spec.application,
			args: spec.args,
			cwd: spec.cwd,
			env: spec.env,
			cols: spec.cols,
			rows: spec.rows,
		},
		(err, chunk) => {
			if (!err) spec.onData(chunk);
		},
	);
	void run.then(
		result => {
			spec.onExit(result.exitCode ?? null);
		},
		() => spec.onExit(null),
	);
	return {
		write: data => {
			try {
				session.write(data);
			} catch {
				// Writes race the PTY teardown after exit; the shell is gone anyway.
			}
		},
		resize: (cols, rows) => {
			try {
				session.resize(cols, rows);
			} catch {
				// Resize after exit is a no-op; clients can race the exit frame.
			}
		},
		kill: () => {
			try {
				session.kill();
			} catch {
				// Already dead.
			}
		},
	};
}

let ptyFactory: TerminalPtyFactory = nativesPtyFactory;

/** Swap the PTY backend (tests inject an in-memory fake). */
export function setPtyBackendForTests(factory: TerminalPtyFactory): void {
	ptyFactory = factory;
}

export function resetPtyBackend(): void {
	ptyFactory = nativesPtyFactory;
}

// --- ring buffer ---

/**
 * Byte-budgeted replay buffer. Chunks stay string-typed (the PTY bridge emits
 * UTF-8 strings); when the budget overflows, whole oldest chunks are dropped.
 */
export class TerminalRingBuffer {
	readonly #limit: number;
	#chunks: string[] = [];
	#bytes = 0;

	constructor(limit: number = RING_BUFFER_BYTES) {
		this.#limit = limit;
	}

	get byteLength(): number {
		return this.#bytes;
	}

	push(chunk: string): void {
		if (chunk.length === 0) return;
		this.#chunks.push(chunk);
		this.#bytes += Buffer.byteLength(chunk);
		while (this.#bytes > this.#limit && this.#chunks.length > 1) {
			this.#bytes -= Buffer.byteLength(this.#chunks[0]);
			this.#chunks.shift();
		}
		if (this.#bytes > this.#limit) {
			// Single chunk larger than the whole budget: keep its tail.
			const [only] = this.#chunks;
			this.#chunks = [
				Buffer.from(only, "utf8")
					.subarray(Buffer.byteLength(only) - this.#limit)
					.toString("utf8"),
			];
			this.#bytes = Math.min(this.#limit, Buffer.byteLength(this.#chunks[0]));
		}
	}

	replay(): string {
		return this.#chunks.join("");
	}
}

// --- sessions ---

export interface TerminalInfo {
	id: string;
	shellLabel: string;
	shellCommand: string;
	cwd: string;
	/** Slot key half allocated by the UI (`DEFAULT_TERMINAL_INSTANCE` if none). */
	instance: string;
	/** Whether the session runs the workbench or the shell fallback. */
	program: "workbench" | "shell";
	/** Why the shell fallback happened; null for a workbench session. */
	fallbackReason: SessionFallbackReason | null;
	exited: boolean;
	exitCode: number | null;
	startedAt: number;
	exitedAt: number | null;
}

interface AttachedSocket {
	send(data: string | Uint8Array): number | undefined;
	close(code?: number, reason?: string): void;
}

/** How a session reached the gateway's own end-of-life (natural exit uses `exit`). */
export type SessionEndReason = "killed" | "expired";

interface TerminalSession {
	id: string;
	/** Monotonic creation sequence — deterministic retention ordering. */
	seq: number;
	/** Slot key: `(absolute cwd, instance id)` — the reattach identity. */
	key: string;
	instance: string;
	cwd: string;
	program: SessionProgram;
	pty: TerminalPty | null;
	ring: TerminalRingBuffer;
	sockets: Set<AttachedSocket>;
	startedAt: number;
	exited: boolean;
	exitCode: number | null;
	exitedAt: number | null;
}

const TERMINAL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Slot key for a resolved cwd + UI instance id. NUL keeps the halves apart. */
export function sessionSlotKey(cwd: string, instanceId: string): string {
	return `${cwd}\u0000${instanceId}`;
}

/** A failed control-plane call: HTTP status plus a machine-readable code. */
interface TerminalFailure {
	ok: false;
	status: number;
	code: string;
	error: string;
}

class TerminalManager {
	#sessions = new Map<string, TerminalSession>();
	/** Slot key → session id, for live sessions only (reattach identity). */
	#slots = new Map<string, string>();
	#creationSeq = 0;
	#tickets = new Map<string, { terminalId: string; expiresAt: number }>();

	list(): TerminalInfo[] {
		this.#pruneExited();
		return [...this.#sessions.values()].sort((a, b) => a.startedAt - b.startedAt).map(session => this.#info(session));
	}

	get(id: string): TerminalSession | null {
		return this.#sessions.get(id) ?? null;
	}

	info(id: string): TerminalInfo | null {
		const session = this.get(id);
		return session ? this.#info(session) : null;
	}

	/** Live session occupying a slot, or null (stale slot entries self-heal). */
	findBySlot(key: string): TerminalSession | null {
		const id = this.#slots.get(key);
		if (id === undefined) return null;
		const session = this.#sessions.get(id);
		if (!session || session.exited) {
			this.#slots.delete(key);
			return null;
		}
		return session;
	}

	#createId(): string {
		const id = crypto.randomUUID();
		if (TERMINAL_ID_RE.test(id)) return id;
		return crypto.randomBytes(16).toString("hex").slice(0, 32);
	}

	/** Absolute, existing directory or a coded failure the UI can explain. */
	#resolveCwd(cwd: string | undefined): { ok: true; cwd: string } | TerminalFailure {
		const requested = cwd?.trim() ? path.resolve(cwd.trim()) : path.resolve(process.cwd());
		let stat: fs.Stats;
		try {
			stat = fs.statSync(requested);
		} catch {
			return { ok: false, status: 400, code: "cwd_missing", error: `cwd does not exist: ${requested}` };
		}
		if (!stat.isDirectory()) {
			return { ok: false, status: 400, code: "cwd_not_directory", error: `cwd is not a directory: ${requested}` };
		}
		return { ok: true, cwd: requested };
	}

	async create(options: {
		cwd?: string;
		file?: string;
		line?: number;
		col?: number;
		/** Slot to claim; `ensure` supplies one, a bare create allocates "default". */
		instanceId?: string;
	}): Promise<{ ok: true; session: TerminalSession; ticket: string; injected: boolean } | TerminalFailure> {
		this.#pruneTickets();
		const resolved = this.#resolveCwd(options.cwd);
		if (!resolved.ok) return resolved;
		const cwd = resolved.cwd;
		const instance = options.instanceId ?? DEFAULT_TERMINAL_INSTANCE;
		if (!INSTANCE_ID_RE.test(instance)) {
			return {
				ok: false,
				status: 400,
				code: "invalid_instance",
				error: `invalid terminal instance id: ${instance}`,
			};
		}

		const live = [...this.#sessions.values()].filter(session => !session.exited);
		if (live.length >= MAX_LIVE_TERMINALS) {
			return {
				ok: false,
				status: 429,
				code: "terminal_limit",
				error: `terminal limit reached (${MAX_LIVE_TERMINALS}); close one before opening another`,
			};
		}

		const program = resolveSessionProgram(defaultProbeContext());
		if (!program)
			return { ok: false, status: 500, code: "no_program", error: "no terminal shell found on this system" };

		const id = this.#createId();
		this.#creationSeq += 1;
		const session: TerminalSession = {
			id,
			seq: this.#creationSeq,
			key: sessionSlotKey(cwd, instance),
			instance,
			cwd,
			program,
			pty: null,
			ring: new TerminalRingBuffer(),
			sockets: new Set(),
			startedAt: Date.now(),
			exited: false,
			exitCode: null,
			exitedAt: null,
		};

		const injectCommand = options.file
			? buildZetaIdeCommand({ file: options.file, line: options.line, col: options.col })
			: null;

		session.pty = ptyFactory({
			application: program.command,
			args: [...program.args],
			cwd,
			env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
			cols: 80,
			rows: 24,
			onData: chunk => this.#broadcast(session, chunk),
			onExit: code => this.#markExited(session, code),
		});

		this.#sessions.set(id, session);
		this.#slots.set(session.key, id);
		this.#pruneExited();

		if (injectCommand) {
			const pty = session.pty;
			setTimeout(() => {
				if (!session.exited) pty.write(`${injectCommand}\r`);
			}, INJECT_DELAY_MS);
		}

		return { ok: true, session, ticket: this.#issueTicket(id), injected: injectCommand !== null };
	}

	/**
	 * Reattach-or-spawn for one `(cwd, instance)` slot — the reattach entry
	 * point. A live session for the slot is returned as-is (its ring buffer
	 * replays the history on attach) and costs no extra slot of the live
	 * budget, so reopening a closed pane never mints a second PTY. A slot whose
	 * session exited, was killed, or died with a previous gateway process is
	 * spawned fresh.
	 *
	 * `replace` inverts the reuse: the slot's live session is ended (its
	 * clients get `session_ended`/`killed`) before the new one spawns. That is
	 * the explicit-action path — the file-chip flow, which needs the spawn-time
	 * injection — and never the pane's plain reattach.
	 */
	async ensure(options: {
		cwd?: string;
		instanceId?: string;
		file?: string;
		line?: number;
		col?: number;
		replace?: boolean;
	}): Promise<
		{ ok: true; session: TerminalSession; ticket: string; reused: boolean; injected: boolean } | TerminalFailure
	> {
		const instance = options.instanceId?.trim() || DEFAULT_TERMINAL_INSTANCE;
		if (!INSTANCE_ID_RE.test(instance)) {
			return {
				ok: false,
				status: 400,
				code: "invalid_instance",
				error: `invalid terminal instance id: ${instance}`,
			};
		}
		const resolved = this.#resolveCwd(options.cwd);
		if (!resolved.ok) return resolved;

		const existing = this.findBySlot(sessionSlotKey(resolved.cwd, instance));
		if (existing) {
			if (!options.replace) {
				this.#pruneTickets();
				return {
					ok: true,
					session: existing,
					ticket: this.#issueTicket(existing.id),
					reused: true,
					injected: false,
				};
			}
			this.remove(existing.id);
		}

		const created = await this.create({ ...options, cwd: resolved.cwd, instanceId: instance });
		if (!created.ok) return created;
		return { ok: true, session: created.session, ticket: created.ticket, reused: false, injected: created.injected };
	}

	/** Kill a live session and drop it, or drop a retained exited one. */
	remove(id: string): boolean {
		const session = this.#sessions.get(id);
		if (!session) return false;
		const reason: SessionEndReason = session.exited ? "expired" : "killed";
		this.#endSession(session, reason);
		// Kill after the bookkeeping so the natural-exit callback is a no-op
		// and the client sees exactly one end signal.
		session.pty?.kill();
		session.pty = null;
		this.#sessions.delete(id);
		this.#pruneExited();
		return true;
	}

	resize(id: string, cols: number, rows: number): boolean {
		const session = this.#sessions.get(id);
		if (!session) return false;
		if (session.exited) return false;
		session.pty?.resize(cols, rows);
		return true;
	}

	/** One-time connect ticket for the WS data plane. */
	issueTicket(id: string): string | null {
		if (!this.#sessions.has(id)) return null;
		return this.#issueTicket(id);
	}

	/** Consume a one-time ticket; valid only for its terminal and TTL. */
	consumeTicket(ticket: string, terminalId: string): boolean {
		this.#pruneTickets();
		const entry = this.#tickets.get(ticket);
		if (!entry) return false;
		this.#tickets.delete(ticket);
		return entry.terminalId === terminalId && entry.expiresAt > Date.now();
	}

	#issueTicket(terminalId: string): string {
		const ticket = crypto.randomBytes(24).toString("base64url");
		this.#tickets.set(ticket, { terminalId, expiresAt: Date.now() + TICKET_TTL_MS });
		while (this.#tickets.size > MAX_PENDING_TICKETS) {
			const oldest = this.#tickets.keys().next().value;
			if (oldest === undefined) break;
			this.#tickets.delete(oldest);
		}
		return ticket;
	}

	#markExited(session: TerminalSession, exitCode: number | null): void {
		if (session.exited) return;
		session.exited = true;
		session.exitCode = exitCode;
		session.exitedAt = Date.now();
		this.#releaseSlot(session);
		this.#broadcastControl(session, { event: "exit", exitCode });
		this.#closeSockets(session, "terminal exited");
		this.#pruneExited();
	}

	/**
	 * Free the slot — but only when it still points at *this* session. A bare
	 * `create` (legacy control-plane callers) can claim an already-claimed slot,
	 * and the older session must not evict the newer one on its way out.
	 */
	#releaseSlot(session: TerminalSession): void {
		if (this.#slots.get(session.key) === session.id) this.#slots.delete(session.key);
	}

	/**
	 * Gateway-initiated end (explicit DELETE, or a retained record ageing out):
	 * flag the session first so the PTY's own exit callback cannot emit a
	 * second, contradictory signal, then tell the attached clients and close
	 * them. The slot is released so the next `ensure` spawns fresh.
	 */
	#endSession(session: TerminalSession, reason: SessionEndReason): void {
		this.#releaseSlot(session);
		if (!session.exited) {
			session.exited = true;
			session.exitCode = null;
			session.exitedAt = Date.now();
		}
		this.#broadcastControl(session, { event: "session_ended", reason });
		this.#closeSockets(session, `terminal ${reason}`);
	}

	#closeSockets(session: TerminalSession, reason: string): void {
		// 1000 = normal closure: the client treats it as a state change, not a
		// dropped link to reconnect.
		for (const socket of session.sockets) {
			try {
				socket.close(1000, reason);
			} catch {
				// Already closing.
			}
		}
		session.sockets.clear();
	}

	#pruneExited(): void {
		// Retain the newest sessions by *creation order* (monotonic seq), not
		// exit-arrival order: PTY exit callbacks can land out of order across
		// platforms, and same-millisecond exits must not flip who survives.
		const exited = [...this.#sessions.values()].filter(session => session.exited).sort((a, b) => a.seq - b.seq);
		for (const session of exited.slice(0, Math.max(0, exited.length - RETAINED_EXITED_TERMINALS))) {
			// Its PTY is already gone; the record (and any late reattacher) is
			// told the session expired rather than silently vanishing.
			this.#endSession(session, "expired");
			this.#sessions.delete(session.id);
		}
	}

	#pruneTickets(): void {
		const now = Date.now();
		for (const [ticket, entry] of this.#tickets) {
			if (entry.expiresAt <= now) this.#tickets.delete(ticket);
		}
	}

	#broadcast(session: TerminalSession, chunk: string): void {
		session.ring.push(chunk);
		if (chunk.length === 0 || session.sockets.size === 0) return;
		const bytes = Buffer.from(chunk, "utf8");
		for (const socket of session.sockets) {
			try {
				socket.send(new Uint8Array(bytes));
			} catch {
				// Dead socket; its close handler removes it.
			}
		}
	}

	#broadcastControl(session: TerminalSession, payload: Record<string, unknown>): void {
		if (session.sockets.size === 0) return;
		const frame = controlFrame(payload);
		for (const socket of session.sockets) {
			try {
				socket.send(frame);
			} catch {
				// Dead socket; its close handler removes it.
			}
		}
	}

	#info(session: TerminalSession): TerminalInfo {
		return {
			id: session.id,
			shellLabel: session.program.label,
			shellCommand: session.program.command,
			cwd: session.cwd,
			instance: session.instance,
			program: session.program.kind,
			fallbackReason: session.program.fallbackReason,
			exited: session.exited,
			exitCode: session.exitCode,
			startedAt: session.startedAt,
			exitedAt: session.exitedAt,
		};
	}

	// --- WS attachment (exercised from the Bun websocket handlers below) ---

	attachSocket(session: TerminalSession, socket: AttachedSocket): void {
		session.sockets.add(socket);
		socket.send(controlFrame({ replayedBytes: session.ring.byteLength }));
		if (session.ring.byteLength > 0) {
			socket.send(new Uint8Array(Buffer.from(session.ring.replay(), "utf8")));
		}
	}

	detachSocket(session: TerminalSession, socket: AttachedSocket): void {
		session.sockets.delete(socket);
	}

	writeInput(session: TerminalSession, data: string): void {
		if (session.exited) return;
		session.pty?.write(data);
	}

	/** Test hook: drop every session and ticket without killing PTYs. */
	resetForTests(): void {
		for (const session of this.#sessions.values()) {
			try {
				session.pty?.kill();
			} catch {
				// Ignore.
			}
		}
		this.#sessions.clear();
		this.#slots.clear();
		this.#tickets.clear();
	}
}

/** `0x00`-prefixed JSON control/metadata frame (see module docs). */
export function controlFrame(payload: Record<string, unknown>): Uint8Array {
	const json = Buffer.from(JSON.stringify(payload), "utf8");
	const frame = new Uint8Array(json.length + 1);
	frame[0] = 0;
	frame.set(json, 1);
	return frame;
}

/** Parse an inbound/outbound frame: `{control: payload}` or `{data: bytes}`. */
export function parseFrame(frame: Uint8Array): { control: Record<string, unknown> } | { data: Uint8Array } {
	if (frame.length > 0 && frame[0] === 0) {
		let payload: Record<string, unknown> = {};
		try {
			payload = JSON.parse(Buffer.from(frame.subarray(1)).toString("utf8")) as Record<string, unknown>;
		} catch {
			payload = {};
		}
		return { control: payload };
	}
	return { data: frame };
}

const manager = new TerminalManager();

/** Test hook: wipe sessions/tickets so tests start from a clean slate. */
export function resetTerminalManagerForTests(): void {
	manager.resetForTests();
}

// --- session program ---

/** Interactive argv for the embedded PTY (window flags from open.ts don't apply). */
export function shellSpawnArgs(shell: ResolvedTerminal): string[] {
	switch (shell.kind) {
		case "pwsh":
		case "powershell":
			return ["-NoLogo"];
		case "git-bash":
			return ["-l", "-i"];
		default:
			return [...shell.args];
	}
}

/**
 * Windows npm launcher shims (`zetawork.cmd`) are scripts, not images: ConPTY
 * cannot exec them, so the PTY starts `cmd.exe /c <shim>` (issue #148's ruling
 * for tool launches, applied to the terminal default program). Returns null on
 * every other platform and for real executables.
 */
function windowsShimWrapper(command: string, ctx: OpenProbeContext): { command: string; args: string[] } | null {
	if (ctx.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return null;
	const comspec = ctx.env.ComSpec?.trim() || ctx.env.COMSPEC?.trim() || "cmd.exe";
	return { command: comspec, args: ["/c", command] };
}

/**
 * Program for a new PTY: the workbench when `zetawork` resolves through the
 * shared discovery tiers, else the platform shell with `fallbackReason` set.
 * Null only when neither exists (no shell on the machine).
 */
export function resolveSessionProgram(ctx: OpenProbeContext = defaultProbeContext()): SessionProgram | null {
	const workbench = discoverBin(ZETAWORK_BINS, { env: ctx.env, platform: ctx.platform, exists: ctx.exists });
	if (workbench) {
		const wrapped = windowsShimWrapper(workbench, ctx);
		return {
			kind: "workbench",
			// The discovered path is spelled in the probed platform's style, so the
			// label must strip the extension with that platform's path impl (a POSIX
			// host probes `C:\npm\zetawork.cmd` on the win32 tier and must still call
			// it "zetawork", not the whole backslash path).
			label: pathImpl(ctx.platform)
				.basename(workbench)
				.replace(/\.(cmd|bat|exe)$/i, ""),
			command: wrapped?.command ?? workbench,
			args: wrapped?.args ?? [],
			fallbackReason: null,
		};
	}
	const shell = resolveTerminal(ctx);
	if (!shell) return null;
	return {
		kind: "shell",
		label: shell.label,
		command: shell.command,
		args: shellSpawnArgs(shell),
		fallbackReason: "workbench-not-found",
	};
}

// --- zeta-ide injection ---

export interface ZetaIdeTarget {
	file: string;
	line?: number;
	col?: number;
}

/**
 * Command string that opens `file[:line[:col]]` in zeta-ide, or null when no
 * bundled zeta-ide binary is on PATH (the session then stays a plain shell).
 * Line/col ride inside the quotes so PowerShell keeps the whole thing as one
 * argv (`"src/a.ts:10:4"` → `src/a.ts:10:4`).
 */
export function buildZetaIdeCommand(
	target: ZetaIdeTarget,
	ctx: OpenProbeContext = defaultProbeContext(),
): string | null {
	const file = target.file.trim();
	if (!file) return null;
	const bin = discoverBin(ZETA_IDE_BINS, { env: ctx.env, platform: ctx.platform, exists: ctx.exists });
	if (!bin) return null;
	let loc = "";
	if (typeof target.line === "number" && Number.isFinite(target.line) && target.line > 0) {
		loc += `:${Math.floor(target.line)}`;
		if (typeof target.col === "number" && Number.isFinite(target.col) && target.col > 0) {
			loc += `:${Math.floor(target.col)}`;
		}
	}
	return `${bin} "${file}${loc}"`;
}

// --- REST handlers ---

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
	try {
		const body = await req.json();
		return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function intOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Shared create/ensure response. `fallbackReason` is what lets the UI announce
 * the shell substitution instead of silently running a different program.
 */
function sessionPayload(
	session: TerminalSession,
	ticket: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: session.id,
		shell: session.program.label,
		cwd: session.cwd,
		instance: session.instance,
		program: session.program.kind,
		fallbackReason: session.program.fallbackReason,
		ticket,
		...extra,
	};
}

function failurePayload(result: TerminalFailure, extra: Record<string, unknown> = {}): Response {
	return json({ error: result.error, code: result.code, ...extra }, result.status);
}

export async function handleTerminalCreate(req: Request): Promise<Response> {
	const body = await readJsonBody(req);
	const result = await manager.create({
		cwd: typeof body.cwd === "string" ? body.cwd : undefined,
		file: typeof body.file === "string" ? body.file : undefined,
		line: intOrUndefined(body.line),
		col: intOrUndefined(body.col),
	});
	if (!result.ok) return failurePayload(result);
	return json(sessionPayload(result.session, result.ticket, { injected: result.injected }));
}

/**
 * Reattach-or-spawn for one `(cwd, instanceId)` slot: the UI's default open
 * path. `reused` tells the client whether it resumed a live PTY or minted one;
 * `replace` (explicit user action, e.g. the file-chip flow) discards the slot's
 * live session first so the new spawn carries the injected command.
 */
export async function handleTerminalEnsure(req: Request): Promise<Response> {
	const body = await readJsonBody(req);
	const result = await manager.ensure({
		cwd: typeof body.cwd === "string" ? body.cwd : undefined,
		instanceId: typeof body.instanceId === "string" ? body.instanceId : undefined,
		file: typeof body.file === "string" ? body.file : undefined,
		line: intOrUndefined(body.line),
		col: intOrUndefined(body.col),
		replace: body.replace === true,
	});
	if (!result.ok) {
		return failurePayload(result, result.code === "terminal_limit" ? { limit: MAX_LIVE_TERMINALS } : {});
	}
	return json(sessionPayload(result.session, result.ticket, { reused: result.reused, injected: result.injected }));
}

export function handleTerminalList(): Response {
	return json({ terminals: manager.list() });
}

export function handleTerminalDelete(id: string): Response {
	return manager.remove(id) ? json({ ok: true }) : json({ error: "terminal not found" }, 404);
}

export async function handleTerminalResize(req: Request, id: string): Promise<Response> {
	const body = await readJsonBody(req);
	const cols = intOrUndefined(body.cols);
	const rows = intOrUndefined(body.rows);
	if (!cols || !rows || cols < 2 || rows < 2 || cols > 1000 || rows > 1000) {
		return json({ error: "cols and rows must be integers in [2, 1000]" }, 400);
	}
	if (!manager.resize(id, Math.floor(cols), Math.floor(rows))) {
		const session = manager.get(id);
		if (session?.exited) return json({ error: "terminal already exited" }, 409);
		return json({ error: "terminal not found" }, 404);
	}
	return json({ ok: true });
}

export function handleTerminalTicket(id: string): Response {
	const ticket = manager.issueTicket(id);
	return ticket ? json({ ticket }) : json({ error: "terminal not found" }, 404);
}

// --- WS data plane ---

const TERMINAL_WS_RE = /^\/api\/terminal\/([A-Za-z0-9-]{8,64})\/ws$/;

/** Whether this request is a terminal data-plane WebSocket upgrade. */
export function isTerminalWsUpgradeRequest(req: Request): boolean {
	return (
		TERMINAL_WS_RE.test(new URL(req.url).pathname) && (req.headers.get("upgrade") ?? "").toLowerCase() === "websocket"
	);
}

export interface TerminalWsData {
	sessionId: string;
}

/** Structural stand-in for `Bun.Server` so handlers stay unit-testable. */
export interface TerminalWsUpgradeServer {
	upgrade(req: Request, options: { data: TerminalWsData }): boolean;
}

/**
 * Handle a terminal WS upgrade. Returns a Response to send (auth failure,
 * unknown session) or null when the socket was upgraded (or when the request
 * is not a terminal WS upgrade, in which case the caller falls through).
 */
export async function handleTerminalWsUpgrade(
	req: Request,
	srv: TerminalWsUpgradeServer,
	remoteAddr?: string,
): Promise<Response | null> {
	const url = new URL(req.url);
	const match = url.pathname.match(TERMINAL_WS_RE);
	if (!match) return null;
	if (!isTerminalWsUpgradeRequest(req)) {
		return json({ error: "expected websocket upgrade" }, 400);
	}
	const terminalId = match[1];
	const loopback = hostIsLoopback(req, remoteAddr);
	let authorized = false;
	if (loopback) {
		// CSRF parity with the REST gate: an unauthenticated loopback upgrade
		// must not carry a cross-site Origin (a hostile page driving a WS).
		authorized = isAllowedOrigin(req.headers.get("origin"));
	} else {
		// Remote browsers cannot attach auth headers to a WebSocket; the
		// one-time connect ticket from the authorized control plane vouches
		// for them instead.
		const ticket = url.searchParams.get("ticket") ?? "";
		authorized = ticket.length > 0 && manager.consumeTicket(ticket, terminalId);
	}
	if (!authorized)
		return json({ error: "Forbidden: terminal WS requires a loopback connection or a connect ticket" }, 403);

	const session = manager.get(terminalId);
	if (!session) return json({ error: "terminal not found" }, 404);

	const upgraded = srv.upgrade(req, { data: { sessionId: terminalId } });
	return upgraded ? null : json({ error: "websocket upgrade failed" }, 500);
}

/** Shared Bun websocket handler; both Bun.serve listeners register it. */
export const terminalWebSocketHandler: WebSocketHandler<TerminalWsData> = {
	open(ws) {
		const session = manager.get(ws.data.sessionId);
		if (!session) {
			ws.close(4004, "terminal not found");
			return;
		}
		manager.attachSocket(session, ws);
	},
	message(ws, message) {
		const session = manager.get(ws.data.sessionId);
		if (!session) return;
		const text = typeof message === "string" ? message : Buffer.from(message).toString("utf8");
		manager.writeInput(session, text);
	},
	close(ws) {
		const session = manager.get(ws.data.sessionId);
		if (session) manager.detachSocket(session, ws);
	},
};
