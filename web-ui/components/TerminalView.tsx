"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { IDisposable } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import { buildTerminalWsUrl, parseTerminalFrame, terminalReconnectDelayMs } from "@/lib/terminal-client";

/** File-open request from the chat path chips (spec U9): inject `zeta-ide <file>`. */
export interface TerminalFileRequest {
	file: string;
	line?: number;
	col?: number;
	/** Monotonic nonce so re-clicking the same chip re-fires the effect. */
	nonce: number;
}

interface TerminalViewProps {
	/** Workspace cwd for new sessions; null → gateway default (server cwd). */
	cwd: string | null;
	/** Existing session to reattach to (dock reopened); null → create one. */
	attachSessionId: string | null;
	/** Reported after create so the shell survives pane close/reopen. */
	onSessionCreated?: (sessionId: string | null) => void;
	/** Chip-flow request; a fresh nonce creates a session with the file injected. */
	openFileRequest?: TerminalFileRequest | null;
}

interface CreateResponse {
	id: string;
	shell: string;
	cwd: string;
	ticket: string;
	injected: boolean;
}

type ConnState = "connecting" | "open" | "reconnecting" | "exited" | "error";

const MAX_PENDING_INPUT_CHARS = 4096;

const TERMINAL_THEME = {
	background: "rgba(0,0,0,0)",
	foreground: "#d4d4d4",
	cursor: "#d4d4d4",
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

/**
 * Embedded terminal pane (spec §15): xterm.js over the gateway PTY WS.
 * Reconnects with exponential backoff + server-side replay; resize is
 * debounced through the REST control plane; the session survives pane
 * close (attachSessionId reattach).
 */
export function TerminalView({ cwd, attachSessionId, onSessionCreated, openFileRequest }: TerminalViewProps) {
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
	const [connState, setConnState] = useState<ConnState>("connecting");
	const [statusText, setStatusText] = useState<string>("");
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [sessionLabel, setSessionLabel] = useState<string>("");

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
						// Session purged (retention/restart) — surface as exited.
						setConnState("exited");
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
					}
					return;
				}
				terminalRef.current?.write(frame.bytes);
			};
			ws.onclose = () => {
				if (wsRef.current === ws) wsRef.current = null;
				// The exit handler flips state before close fires; anything else
				// (gateway restart, dropped LAN link, ticket expiry) reconnects.
				if (!disposedRef.current && connStateRef.current !== "exited") scheduleReconnect();
			};
		},
		[flushPendingInput],
	);
	useEffect(() => {
		connectRef.current = connectWs;
	}, [connectWs]);

	const startSession = useCallback(
		async (options: { attach?: string | null; create?: TerminalFileRequest | null }) => {
			if (disposedRef.current) return;
			setExitCode(null);
			try {
				if (options.attach) {
					sessionIdRef.current = options.attach;
					setSessionLabel("…");
					await connectWs(options.attach);
					return;
				}
				const body: Record<string, unknown> = {};
				if (cwd) body.cwd = cwd;
				if (options.create) {
					body.file = options.create.file;
					if (options.create.line) body.line = options.create.line;
					if (options.create.col) body.col = options.create.col;
				}
				const res = await fetch("/api/terminal", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				const payload = (await res.json().catch(() => ({}))) as Partial<CreateResponse> & { error?: string };
				if (!res.ok || typeof payload.id !== "string" || typeof payload.ticket !== "string") {
					setConnState("error");
					setStatusText(payload.error ?? `HTTP ${res.status}`);
					return;
				}
				sessionIdRef.current = payload.id;
				setSessionLabel(typeof payload.shell === "string" ? payload.shell : "");
				setStatusText(payload.injected === true ? t("terminal.injected") : "");
				onSessionCreated?.(payload.id);
				await connectWs(payload.id, payload.ticket);
			} catch (error) {
				setConnState("error");
				setStatusText(error instanceof Error ? error.message : String(error));
			}
		},
		[connectWs, cwd, onSessionCreated, t],
	);

	// xterm boot (client-only dynamic import keeps SSR clean).
	useEffect(() => {
		disposedRef.current = false;
		let localDisposed = false;
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
			void startSession({
				attach: openFileRequest ? null : attachSessionId,
				create: openFileRequest ?? null,
			});
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
			sessionIdRef.current = null;
			onSessionCreated?.(null);
		};
		// Boot once per mount; chip re-fires below through the nonce effect.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Chip flow: a fresh openFileRequest tears down and opens a new session.
	const openFileNonce = openFileRequest?.nonce ?? 0;
	useEffect(() => {
		if (openFileNonce === 0) return;
		const id = sessionIdRef.current;
		if (id) {
			void fetch(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
			terminalRef.current?.write("\r\n");
		}
		sessionIdRef.current = null;
		void startSession({ create: openFileRequest ?? null });
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
		if (!id) return;
		void fetch(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
	}, []);

	const handleRestart = useCallback(() => {
		clearReconnectTimer();
		attemptRef.current = 0;
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
		void startSession({ create: null });
	}, [clearReconnectTimer, startSession]);

	const statusColor = useMemo(() => {
		switch (connState) {
			case "open":
				return "var(--status-success-foreground, #0dbc79)";
			case "exited":
			case "error":
				return "var(--status-error-foreground, #cd3131)";
			default:
				return "var(--status-warning-foreground, #e5e510)";
		}
	}, [connState]);

	return (
		<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} data-testid="terminal-view">
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexShrink: 0,
					padding: "4px 10px",
					borderBottom: "1px solid var(--border)",
					fontSize: 11,
					color: "var(--text-muted)",
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
				{connState === "error" && (
					<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{statusText}</span>
				)}
				<div style={{ flex: 1 }} />
				{(connState === "exited" || connState === "error") && (
					<button type="button" onClick={handleRestart} style={actionButtonStyle}>
						{t("terminal.restart")}
					</button>
				)}
				{connState === "open" && (
					<button type="button" onClick={handleKill} style={actionButtonStyle}>
						{t("terminal.kill")}
					</button>
				)}
			</div>
			<div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: "4px 6px", background: "var(--bg)" }} />
		</div>
	);
}

const actionButtonStyle = {
	background: "transparent",
	border: "1px solid var(--border)",
	borderRadius: 6,
	color: "var(--text-muted)",
	cursor: "pointer",
	fontSize: 11,
	padding: "2px 8px",
} as const;
