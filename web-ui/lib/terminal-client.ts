/**
 * Terminal data-plane client logic (spec §15) — pure, testable pieces of
 * TerminalView: frame parsing for the `0x00`-prefixed control protocol,
 * reconnect backoff, and WS URL construction.
 */

export const TERMINAL_RECONNECT_BASE_MS = 500;
export const TERMINAL_RECONNECT_MAX_MS = 8_000;

/** One decoded WS frame: a `0x00`-prefixed control JSON or raw PTY bytes. */
export type TerminalFrame = { kind: "control"; payload: Record<string, unknown> } | { kind: "data"; bytes: Uint8Array };

function toBytes(data: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (typeof data === "string") return new TextEncoder().encode(data);
	return new Uint8Array(
		data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
	);
}

export function parseTerminalFrame(data: ArrayBuffer | Uint8Array | string): TerminalFrame {
	const bytes = toBytes(data);
	if (bytes.length > 0 && bytes[0] === 0) {
		let payload: Record<string, unknown> = {};
		try {
			payload = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as Record<string, unknown>;
		} catch {
			// Malformed control frame degrades to an empty payload.
		}
		return { kind: "control", payload };
	}
	return { kind: "data", bytes };
}

/**
 * Exponential reconnect delay with ±20% jitter: 500ms, 1s, 2s, 4s, 8s, 8s…
 * `attempt` counts consecutive failures starting at 1.
 */
export function terminalReconnectDelayMs(attempt: number, jitter: number = Math.random()): number {
	const exponential = Math.min(TERMINAL_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1), TERMINAL_RECONNECT_MAX_MS);
	const spread = 0.8 + 0.4 * Math.min(1, Math.max(0, jitter));
	return Math.round(exponential * spread);
}

/** WS data-plane URL for a terminal session carrying its one-time ticket. */
export function buildTerminalWsUrl(origin: string, sessionId: string, ticket: string): string {
	const base = origin.replace(/^http/, "ws").replace(/\/$/, "");
	return `${base}/api/terminal/${encodeURIComponent(sessionId)}/ws?ticket=${encodeURIComponent(ticket)}`;
}

// --- ensure contract (P1: workbench default + reattach) ---

/** Success body of `POST /api/terminal/ensure`. */
export interface TerminalEnsurePayload {
	id: string;
	ticket: string;
	/** Status-bar label: the resolved program basename. */
	shell: string;
	cwd: string;
	/** Slot half owned by the UI (see lib/terminal-workspaces). */
	instance: string;
	program: "workbench" | "shell";
	/** `workbench-not-found` when the pane runs the shell fallback. */
	fallbackReason: string | null;
	/** True when this resumed a live PTY instead of spawning one. */
	reused: boolean;
	injected: boolean;
}

/** Failure body of the terminal control plane. */
export interface TerminalFailurePayload {
	error?: string;
	code?: string;
	/** Present with `terminal_limit`. */
	limit?: number;
}

/** An i18n key + params, resolved by the pane through `t()`. */
export interface TerminalMessage {
	key: string;
	params: Record<string, string | number>;
}

/**
 * Narrow a parsed ensure/create body to a complete success payload: the pane
 * may not drive a session whose id, ticket, label, or program is missing.
 */
export function isTerminalEnsureSuccess(
	payload: Partial<TerminalEnsurePayload> & TerminalFailurePayload,
	res: Response,
): payload is TerminalEnsurePayload {
	return (
		res.ok &&
		typeof payload.id === "string" &&
		typeof payload.ticket === "string" &&
		typeof payload.shell === "string" &&
		typeof payload.cwd === "string" &&
		(payload.program === "workbench" || payload.program === "shell")
	);
}

/** Readable message for a failed ensure/create call. */
export function terminalFailureMessage(
	payload: TerminalFailurePayload,
	httpStatus: number,
): TerminalMessage {
	switch (payload.code) {
		case "terminal_limit":
			return { key: "terminal.limitReached", params: { limit: payload.limit ?? 4 } };
		case "cwd_missing":
		case "cwd_not_directory":
			return { key: "terminal.cwdMissing", params: {} };
		case "no_program":
			return { key: "terminal.noProgram", params: {} };
		default:
			return { key: "terminal.requestFailed", params: { status: httpStatus, detail: payload.error ?? "" } };
	}
}

/**
 * Notice for a successful ensure: the shell-fallback hint (the workbench was
 * not found, so the pane must say so rather than silently run a shell), or the
 * "previous session ended" notice (the slot resumed a *different* session than
 * the one the UI last saw — a gateway restart, a recycle, or a kill elsewhere).
 * `null` when the slot reattached to the same PTY or has no history.
 */
export function terminalSessionNotice(
	payload: TerminalEnsurePayload,
	knownSessionId: string | null | undefined,
): TerminalMessage | null {
	if (payload.program === "shell") {
		return { key: "terminal.shellFallback", params: { shell: payload.shell } };
	}
	if (knownSessionId && knownSessionId !== payload.id) {
		return { key: "terminal.previousEnded", params: {} };
	}
	return null;
}
