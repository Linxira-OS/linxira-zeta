"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { IDisposable } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import {
	buildTerminalWsUrl,
	isTerminalEnsureSuccess,
	parseTerminalFrame,
	terminalFailureMessage,
	terminalReconnectDelayMs,
	terminalSessionNotice,
	type TerminalEnsurePayload,
} from "@/lib/terminal-client";

/** File-open request from the chat path chips (spec U9): inject `zetaide <file>`. */
export interface TerminalFileRequest {
	file: string;
	line?: number;
	col?: number;
	/** Monotonic nonce so re-clicking the same chip re-fires the effect. */
	nonce: number;
}

interface TerminalViewProps {
	/** Workspace cwd for the slot; null → gateway default (server cwd). */
	cwd: string | null;
	/** UI-allocated slot id for this workspace (see lib/terminal-workspaces). */
	instanceId: string;
	/** Slots this workspace has, in allocation order — the header chip strip. */
	instances: readonly string[];
	/**
	 * Session this slot last resumed. A *different* id coming back from
	 * `ensure` means the previous PTY is gone (gateway restart, recycle, or a
	 * kill elsewhere), which the pane announces instead of pretending.
	 */
	knownSessionId?: string | null;
	/** Header chip selected: show another slot of this workspace. */
	onSelectInstance?: (instanceId: string) => void;
	/** Header "+" (explicit second terminal, spec P1 §4). */
	onNewInstance?: () => void;
	/** Slot resumed: remember the session id for the reattach check. */
	onSessionCreated?: (sessionId: string) => void;
	/** Explicit stop: forget the slot's session so no notice fires next open. */
	onSessionStopped?: () => void;
	/** Chip-flow request; a fresh nonce replaces the session with a file injected. */
	openFileRequest?: TerminalFileRequest | null;
}

interface EnsureResponse extends Partial<TerminalEnsurePayload> {
	error?: string;
	code?: string;
	limit?: number;
}

type ConnState = "connecting" | "open" | "reconnecting" | "exited" | "ended" | "error";

const MAX_PENDING_INPUT_CHARS = 4096;

/**
 * xterm.js 16-colour palette. Deliberately literal and deliberately outside the
 * `lib/theme/tokens.ts` three-layer tokens: a terminal emulator's palette is a
 * protocol artifact (the PTY writes SGR codes, not theme roles), not a theme
 * choice. The colour guard exempts the table itself — and only the table —
 * through the marked region below, so the rest of this file stays under the
 * guard.
 */
/* zeta-style-literal-allow-start: xterm.js 16-colour ANSI palette — the terminal owns these values, they are not theme roles */
const TERMINAL_THEME = {
	background: "#1e1e1e",
	foreground: "#e5e5e5",
	cursor: "#ffffff",
	selectionBackground: "#264f78",
	black: "#000000",
	red: "#cd3131",
	green: "#0dbc79",
	yellow: "#e5e510",
	blue: "#2472c8",
	magenta: "#bc3fbc",
	cyan: "#11a8cd",
	white: "#e5e5e5",
	brightBlack: "#666666",
	brightRed: "#f14c4c",
	brightGreen: "#23d18b",
	brightYellow: "#f5f543",
	brightBlue: "#3b8eea",
	brightMagenta: "#d670d6",
	brightCyan: "#29b8db",
	brightWhite: "#ffffff",
};
/* zeta-style-literal-allow-end */

/**
 * Embedded terminal pane (spec §15, P1): xterm.js over the gateway PTY WS.
 *
 * The pane is a *view* of a `(cwd, instanceId)` slot, never the owner of a
 * PTY: opening it calls `POST /api/terminal/ensure`, which replays the slot's
 * live session (history included) when one exists and spawns one only when the
 * slot is empty. Unmounting — closing the dock, switching panes — therefore
 * only closes the socket; the shell keeps running and the next open reattaches
 * to it. Switching workspaces switches the slot key, so two workspaces never
 * see each other's sessions.
 */
export function TerminalView({
	cwd,
	instanceId,
	instances,
	knownSessionId,
	onSelectInstance,
	onNewInstance,
	onSessionCreated,
	onSessionStopped,
	openFileRequest,
}: TerminalViewProps) {
	const { t } = useI18n();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<XTermTerminal | null>(null);
	const fitRef = useRef<XTermFitAddon | null>(null);
	const dataSubRef = useRef<IDisposable | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const pendingInputRef = useRef<string[]>([]);
	const reconnectTimerRef = useRef<number | null>(null);
	const resizeTimerRef = useRef<number | null>(null);
	const attemptRef = useRef(0);
	const disposedRef = useRef(false);
	/** Latest parent-known session id, read inside ensure without re-booting. */
	const knownSessionRef = useRef<string | null>(knownSessionId ?? null);
	/** Latest chip request, so the boot effect never reads a stale prop. */
	const openFileRequestRef = useRef(openFileRequest);
	/** Chip nonce the boot effect already served (skips the duplicate effect run). */
	const bootNonceRef = useRef(0);
	const [connState, setConnState] = useState<ConnState>("connecting");
	const [statusText, setStatusText] = useState<string>("");
	const [notice, setNotice] = useState<string | null>(null);
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [sessionLabel, setSessionLabel] = useState<string>("");
	const [injected, setInjected] = useState(false);

	useEffect(() => {
		knownSessionRef.current = knownSessionId ?? null;
	}, [knownSessionId]);

	useEffect(() => {
		openFileRequestRef.current = openFileRequest;
	}, [openFileRequest]);

	// Latest-state refs so WS callbacks observe current values without
	// re-registering the socket on every render.
	const connStateRef = useRef<ConnState>(connState);
	useEffect(() => {
		connStateRef.current = connState;
	}, [connState]);
	const connectRef = useRef<(sessionId: string, ticket?: string) => Promise<void>>(async () => {});

	const clearReconnectTimer = useCallback(() => {
		if (reconnectTimerRef.current !== null) {
			window.clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
	}, []);

	function scheduleReconnect() {
		if (disposedRef.current) return;
		attemptRef.current += 1;
		setConnState("reconnecting");
		const delay = terminalReconnectDelayMs(attemptRef.current);
		clearReconnectTimer();
		reconnectTimerRef.current = window.setTimeout(() => {
			const id = sessionIdRef.current;
			if (id && !disposedRef.current) void connectRef.current(id);
		}, delay);
	}

	const flushPendingInput = useCallback(() => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		if (pendingInputRef.current.length === 0) return;
		ws.send(pendingInputRef.current.join(""));
		pendingInputRef.current = [];
	}, []);

	const sendResize = useCallback(async (cols: number, rows: number) => {
		const id = sessionIdRef.current;
		if (!id) return;
		try {
			await fetch(`/api/terminal/${encodeURIComponent(id)}/resize`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cols, rows }),
			});
		} catch {
			// Transient network errors are healed by the next resize tick.
		}
	}, []);

	const connectWs = useCallback(
		async (sessionId: string, ticket?: string) => {
			if (disposedRef.current) return;
			setConnState(attemptRef.current > 0 ? "reconnecting" : "connecting");
			let wsTicket = ticket ?? null;
			if (!wsTicket) {
				try {
					const res = await fetch(`/api/terminal/${encodeURIComponent(sessionId)}/ticket`, { method: "POST" });
					if (res.status === 404) {
						// Session purged (retention, kill, or a gateway restart):
						// surface as ended so the client stops reconnecting.
						setConnState("ended");
						return;
					}
					if (!res.ok) throw new Error(`ticket HTTP ${res.status}`);
					const payload = (await res.json()) as { ticket: string };
					wsTicket = payload.ticket;
				} catch {
					scheduleReconnect();
					return;
				}
			}
			let ws: WebSocket;
			try {
				ws = new WebSocket(buildTerminalWsUrl(window.location.origin, sessionId, wsTicket));
			} catch {
				scheduleReconnect();
				return;
			}
			wsRef.current = ws;
			ws.binaryType = "arraybuffer";
			ws.onopen = () => {
				attemptRef.current = 0;
				setConnState("open");
				flushPendingInput();
			};
			ws.onmessage = (event: MessageEvent) => {
				// Server sends binary frames only; narrow defensively.
				const raw: ArrayBuffer | string =
					typeof event.data === "string"
						? event.data
						: event.data instanceof ArrayBuffer
							? event.data
							: new ArrayBuffer(0);
				const frame = parseTerminalFrame(raw);
				if (frame.kind === "control") {
					if (frame.payload.event === "exit") {
						setExitCode(typeof frame.payload.exitCode === "number" ? frame.payload.exitCode : null);
						setConnState("exited");
						wsRef.current = null;
						ws.close();
					} else if (frame.payload.event === "session_ended") {
						// Gateway-side end (explicit DELETE, or a retained record
						// ageing out). The socket follows; do not reconnect.
						setConnState("ended");
						wsRef.current = null;
					}
					return;
				}
				terminalRef.current?.write(frame.bytes);
			};
			ws.onclose = () => {
				if (wsRef.current === ws) wsRef.current = null;
				// exit/session_ended flip state before close fires; anything else
				// (gateway restart, dropped LAN link, ticket expiry) reconnects.
				if (!disposedRef.current && connStateRef.current !== "exited" && connStateRef.current !== "ended") {
					scheduleReconnect();
				}
			};
		},
		[flushPendingInput],
	);
	useEffect(() => {
		connectRef.current = connectWs;
	}, [connectWs]);

	/**
	 * Reattach-or-spawn this slot. `replace` asks the gateway to end the slot's
	 * live session first — the explicit-action path (the chip flow's injected
	 * command), never a plain reattach, which must resume the running PTY.
	 */
	const ensureSession = useCallback(
		async (options: { replace?: boolean; file?: TerminalFileRequest | null } = {}) => {
			if (disposedRef.current) return;
			setExitCode(null);
			setStatusText("");
			setNotice(null);
			setInjected(false);
			const previous = sessionIdRef.current;
			try {
				const body: Record<string, unknown> = { instanceId };
				if (cwd) body.cwd = cwd;
				if (options.replace) body.replace = true;
				if (options.file) {
					body.file = options.file.file;
					if (options.file.line) body.line = options.file.line;
					if (options.file.col) body.col = options.file.col;
				}
				const res = await fetch("/api/terminal/ensure", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				const payload = (await res.json().catch(() => ({}))) as EnsureResponse;
				if (!isTerminalEnsureSuccess(payload, res)) {
					const message = terminalFailureMessage(payload, res.status);
					setConnState("error");
					setStatusText(t(message.key, message.params));
					return;
				}
				if (previous !== payload.id) {
					// A different PTY than the pane was showing: stale screen
					// content would masquerade as this session's history.
					terminalRef.current?.clear();
				}
				sessionIdRef.current = payload.id;
				setSessionLabel(payload.shell);
				setInjected(payload.injected);
				const reason = terminalSessionNotice(payload, knownSessionRef.current);
				if (reason) setNotice(t(reason.key, reason.params));
				onSessionCreated?.(payload.id);
				await connectWs(payload.id, payload.ticket);
			} catch (error) {
				setConnState("error");
				setStatusText(error instanceof Error ? error.message : String(error));
			}
		},
		[connectWs, cwd, instanceId, onSessionCreated, t],
	);
	const ensureRef = useRef(ensureSession);
	useEffect(() => {
		ensureRef.current = ensureSession;
	}, [ensureSession]);

	// xterm boot + slot attach. Re-runs on a workspace/slot switch (which is
	// exactly what re-ensuring wants); teardown closes the socket and disposes
	// xterm but never touches the PTY, so the dock can be closed mid-command.
	useEffect(() => {
		disposedRef.current = false;
		let localDisposed = false;
		// A pending chip request rides along with the boot: this pane mounts to
		// serve it, so it must not also spawn a plain session first.
		const pending = openFileRequestRef.current;
		if (pending) bootNonceRef.current = pending.nonce;
		void (async () => {
			const container = containerRef.current;
			if (!container) return;
			const [{ Terminal }, { FitAddon }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
				import("@xterm/xterm/css/xterm.css"),
			]);
			if (localDisposed) return;
			const terminal = new Terminal({
				convertEol: false,
				cursorBlink: true,
				fontSize: 12.5,
				theme: TERMINAL_THEME,
				scrollback: 5000,
			});
			const fit = new FitAddon();
			terminal.loadAddon(fit);
			terminal.open(container);
			dataSubRef.current = terminal.onData(data => {
				const ws = wsRef.current;
				if (ws && ws.readyState === WebSocket.OPEN) {
					ws.send(data);
					return;
				}
				const total = pendingInputRef.current.reduce((n, chunk) => n + chunk.length, 0);
				if (total < MAX_PENDING_INPUT_CHARS) pendingInputRef.current.push(data);
			});
			terminalRef.current = terminal;
			fitRef.current = fit;
			try {
				fit.fit();
			} catch {
				// Hidden container (dock animating open) — the observer fits later.
			}
			void ensureRef.current(pending ? { replace: true, file: pending } : {});
		})();
		return () => {
			localDisposed = true;
			disposedRef.current = true;
			clearReconnectTimer();
			if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
			wsRef.current?.close();
			wsRef.current = null;
			dataSubRef.current?.dispose();
			dataSubRef.current = null;
			terminalRef.current?.dispose();
			terminalRef.current = null;
			fitRef.current = null;
			// Deliberately NOT killing the session: the gateway keeps the PTY
			// running for the slot so reopening this pane reattaches to it.
			sessionIdRef.current = null;
			pendingInputRef.current = [];
		};
	}, [cwd, instanceId, clearReconnectTimer]);

	// Later chip requests (pane already open): replace this slot's session in
	// place instead of rebuilding the pane. The nonce the boot consumed is
	// skipped — it was already served above.
	const openFileNonce = openFileRequest?.nonce ?? 0;
	useEffect(() => {
		if (openFileNonce === 0 || bootNonceRef.current === openFileNonce) return;
		void ensureRef.current({ replace: true, file: openFileRequest ?? null });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [openFileNonce]);

	// Resize: fit immediately, debounce the REST push.
	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			const fit = fitRef.current;
			const terminal = terminalRef.current;
			if (!fit || !terminal) return;
			try {
				fit.fit();
			} catch {
				return;
			}
			if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
			resizeTimerRef.current = window.setTimeout(() => {
				void sendResize(terminal.cols, terminal.rows);
			}, 200);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, [sendResize]);

	const handleKill = useCallback(() => {
		const id = sessionIdRef.current;
		clearReconnectTimer();
		attemptRef.current = 0;
		sessionIdRef.current = null;
		setConnState("ended");
		setExitCode(null);
		onSessionStopped?.();
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		if (id) {
			void fetch(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
		}
	}, [clearReconnectTimer, onSessionStopped]);

	const handleRestart = useCallback(() => {
		clearReconnectTimer();
		attemptRef.current = 0;
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		sessionIdRef.current = null;
		void ensureRef.current();
	}, [clearReconnectTimer]);

	const statusColor = useMemo(() => {
		switch (connState) {
			case "open":
				return "var(--zeta-alias-status-success-foreground)";
			case "exited":
			case "ended":
			case "error":
				return "var(--zeta-alias-status-error-foreground)";
			default:
				return "var(--zeta-alias-status-warning-foreground)";
		}
	}, [connState]);

	const chipStyle = (active: boolean) => ({
		...actionButtonStyle,
		...(active ? { borderColor: "var(--accent)", color: "var(--accent)" } : null),
	});

	return (
		<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} data-testid="terminal-view">
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexShrink: 0,
					padding: "4px 10px",
					borderBottom: "1px solid var(--zeta-alias-border)",
					fontSize: 11,
					color: "var(--zeta-alias-text-muted)",
				}}
			>
				<span style={{ color: statusColor }} aria-label={`terminal-${connState}`}>
					●
				</span>
				<span>{sessionLabel || t("terminal.title")}</span>
				{(connState === "connecting" || connState === "reconnecting") && <span>{t("terminal.reconnecting")}</span>}
				{connState === "exited" && (
					<span>
						{t("terminal.exited")}
						{exitCode !== null ? ` · ${t("terminal.exitCode", { code: exitCode })}` : ""}
					</span>
				)}
				{connState === "ended" && <span>{t("terminal.ended")}</span>}
				{connState === "error" && (
					<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{statusText}</span>
				)}
				{notice && <span style={{ color: "var(--status-warning-foreground)" }}>{notice}</span>}
				{injected && <span>{t("terminal.injected")}</span>}
				<div style={{ flex: 1 }} />
				{instances.length > 0 && (
					<div style={{ display: "flex", alignItems: "center", gap: 4 }} data-testid="terminal-slots">
						{instances.map(id => (
							<button
								key={id}
								type="button"
								onClick={() => onSelectInstance?.(id)}
								style={chipStyle(id === instanceId)}
								aria-pressed={id === instanceId}
								title={t("terminal.slotTitle", { instance: id })}
							>
								{id}
							</button>
						))}
					</div>
				)}
				<button type="button" onClick={() => onNewInstance?.()} style={actionButtonStyle}>
					{t("terminal.newSlot")}
				</button>
				{connState === "open" && (
					<button type="button" onClick={handleKill} style={actionButtonStyle}>
						{t("terminal.kill")}
					</button>
				)}
				{(connState === "exited" || connState === "ended") && (
					<button type="button" onClick={handleRestart} style={actionButtonStyle}>
						{t("terminal.restart")}
					</button>
				)}
				{connState === "error" && (
					<button type="button" onClick={handleRestart} style={actionButtonStyle}>
						{t("terminal.retry")}
					</button>
				)}
			</div>
			<div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: "4px 6px", background: "var(--zeta-alias-bg)" }} />
		</div>
	);
}

const actionButtonStyle = {
	background: "transparent",
	border: "1px solid var(--zeta-alias-border)",
	borderRadius: 6,
	color: "var(--zeta-alias-text-muted)",
	cursor: "pointer",
	fontSize: 11,
	padding: "2px 8px",
} as const;
