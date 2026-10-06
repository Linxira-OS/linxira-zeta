/**
 * Embedded terminal (spec §15, batch 4) — PTY sessions owned by the gateway
 * process, shared by web-ui and the desktop shell.
 *
 * Control plane (REST, authorized like every other gateway route):
 *   POST   /api/terminal            create {cwd?, file?, line?, col?} → {id, shell, ticket}
 *   GET    /api/terminal            list live sessions + retained exited sessions
 *   DELETE /api/terminal/:id        kill and drop a session
 *   POST   /api/terminal/:id/resize {cols, rows}
 *   POST   /api/terminal/:id/ticket one-time connect ticket for the WS data plane
 *
 * Data plane: GET /api/terminal/:id/ws (WebSocket upgrade). Browsers cannot
 * attach `Authorization`/`X-Zeta-Token` headers to a WebSocket, so the upgrade
 * accepts a one-time connect ticket from the control plane; loopback callers
 * pass directly (same trust level as the REST gate).
 *
 * Wire protocol (mirrors the opencode shape): the first outbound frame is a
 * binary frame prefixed `0x00` carrying JSON metadata (`{replayedBytes}` on
 * attach, `{event:"exit", exitCode}` on PTY exit); every later outbound frame
 * is raw PTY bytes. Inbound text frames are raw stdin for the shell.
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
import { defaultProbeContext, discoverBin, type OpenProbeContext } from "../../utils/bin-discovery";
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
	exited: boolean;
	exitCode: number | null;
	startedAt: number;
	exitedAt: number | null;
}

interface AttachedSocket {
	send(data: string | Uint8Array): number | undefined;
	close(code?: number, reason?: string): void;
}

interface TerminalSession {
	id: string;
	/** Monotonic creation sequence — deterministic retention ordering. */
	seq: number;
	cwd: string;
	shell: ResolvedTerminal;
	pty: TerminalPty | null;
	ring: TerminalRingBuffer;
	sockets: Set<AttachedSocket>;
	startedAt: number;
	exited: boolean;
	exitCode: number | null;
	exitedAt: number | null;
}

const TERMINAL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

class TerminalManager {
	#sessions = new Map<string, TerminalSession>();
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

	#createId(): string {
		const id = crypto.randomUUID();
		if (TERMINAL_ID_RE.test(id)) return id;
		return crypto.randomBytes(16).toString("hex").slice(0, 32);
	}

	async create(options: {
		cwd?: string;
		file?: string;
		line?: number;
		col?: number;
	}): Promise<
		| { ok: true; session: TerminalSession; ticket: string; injected: boolean }
		| { ok: false; status: number; error: string }
	> {
		this.#pruneTickets();
		let cwd = options.cwd?.trim() || process.cwd();
		cwd = path.resolve(cwd);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(cwd);
		} catch {
			return { ok: false, status: 400, error: `cwd does not exist: ${cwd}` };
		}
		if (!stat.isDirectory()) return { ok: false, status: 400, error: `cwd is not a directory: ${cwd}` };

		const live = [...this.#sessions.values()].filter(session => !session.exited);
		if (live.length >= MAX_LIVE_TERMINALS) {
			return {
				ok: false,
				status: 429,
				error: `terminal limit reached (${MAX_LIVE_TERMINALS}); close one before opening another`,
			};
		}

		const shell = resolveTerminal(defaultProbeContext());
		if (!shell) return { ok: false, status: 500, error: "no terminal shell found on this system" };

		const id = this.#createId();
		this.#creationSeq += 1;
		const session: TerminalSession = {
			id,
			seq: this.#creationSeq,
			cwd,
			shell,
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
			application: shell.command,
			args: shellSpawnArgs(shell),
			cwd,
			env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
			cols: 80,
			rows: 24,
			onData: chunk => this.#broadcast(session, chunk),
			onExit: code => this.#markExited(session, code),
		});

		this.#sessions.set(id, session);
		this.#pruneExited();

		if (injectCommand) {
			const pty = session.pty;
			setTimeout(() => {
				if (!session.exited) pty.write(`${injectCommand}\r`);
			}, INJECT_DELAY_MS);
		}

		return { ok: true, session, ticket: this.#issueTicket(id), injected: injectCommand !== null };
	}

	/** Kill a live session and drop it, or drop a retained exited one. */
	remove(id: string): boolean {
		const session = this.#sessions.get(id);
		if (!session) return false;
		if (!session.exited) session.pty?.kill();
		this.#sessions.delete(id);
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
		this.#broadcastControl(session, { event: "exit", exitCode });
		for (const socket of session.sockets) {
			try {
				socket.close(1000, "terminal exited");
			} catch {
				// Already closing.
			}
		}
		session.sockets.clear();
		this.#pruneExited();
	}

	#pruneExited(): void {
		// Retain the newest sessions by *creation order* (monotonic seq), not
		// exit-arrival order: PTY exit callbacks can land out of order across
		// platforms, and same-millisecond exits must not flip who survives.
		const exited = [...this.#sessions.values()].filter(session => session.exited).sort((a, b) => a.seq - b.seq);
		for (const session of exited.slice(0, Math.max(0, exited.length - RETAINED_EXITED_TERMINALS))) {
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
			shellLabel: session.shell.label,
			shellCommand: session.shell.command,
			cwd: session.cwd,
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

// --- shell argv ---

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

export async function handleTerminalCreate(req: Request): Promise<Response> {
	const body = await readJsonBody(req);
	const result = await manager.create({
		cwd: typeof body.cwd === "string" ? body.cwd : undefined,
		file: typeof body.file === "string" ? body.file : undefined,
		line: intOrUndefined(body.line),
		col: intOrUndefined(body.col),
	});
	if (!result.ok) return json({ error: result.error }, result.status);
	return json({
		id: result.session.id,
		shell: result.session.shell.label,
		cwd: result.session.cwd,
		ticket: result.ticket,
		injected: result.injected,
	});
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
