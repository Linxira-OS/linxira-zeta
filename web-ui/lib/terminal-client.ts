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
