/**
 * Desktop terminal surface (`window.zetaStudioTerminal`).
 *
 * The PTY still belongs to the gateway; the desktop owns the socket, the
 * renderer event fan-out, and recording. Local terminals use the shell's own
 * Web UI origin; a remote execution target uses that connection's SSH tunnel.
 * Reconnect asks for a fresh one-time ticket, exactly like the browser client.
 */

import * as path from "node:path";
import { StudioEventSocket } from "../remote/http";
import { TerminalRecorder, type RecordingStatus } from "./recorder";

export interface TerminalCreateInput {
	cols?: number;
	rows?: number;
	targetId?: string;
	workspaceId?: string;
	instanceId?: string;
	profileId?: string;
	cwd?: string;
}

export interface TerminalSessionInfo {
	readonly id: string;
	readonly name: string;
	readonly cwd: string;
	readonly profile?: string | null;
	readonly instance?: string;
	readonly reused?: boolean;
}

interface GatewayTerminalInfo {
	readonly id: string;
	readonly shell?: string;
	readonly cwd?: string;
	readonly instance?: string;
	readonly profile?: string | null;
	readonly program?: string;
	readonly ticket?: string;
	readonly reused?: boolean;
}

interface Attached {
	readonly id: string;
	readonly base: string;
	readonly info: GatewayTerminalInfo;
	readonly decoder: TextDecoder;
	readonly recorder: TerminalRecorder;
	readonly cols: number;
	readonly rows: number;
	socket?: StudioEventSocket;
	ended: boolean;
	attempt: number;
}

export interface TerminalBridgeDeps {
	readonly localBase: () => string;
	readonly remoteBase: (targetId: string) => string | undefined;
	readonly userData: string;
	readonly data: (terminalId: string, data: string) => void;
	readonly exit: (terminalId: string) => void;
}

export class TerminalBridge {
	readonly #deps: TerminalBridgeDeps;
	readonly #recorder: TerminalRecorder;
	readonly #attached = new Map<string, Attached>();

	constructor(deps: TerminalBridgeDeps) {
		this.#deps = deps;
		this.#recorder = new TerminalRecorder(deps.userData);
	}

	async create(input: TerminalCreateInput = {}): Promise<TerminalSessionInfo> {
		const base = this.#base(input.targetId);
		const info = await this.#request<GatewayTerminalInfo>(base, "/api/terminal/ensure", {
			method: "POST",
			body: JSON.stringify({
				cols: input.cols ?? 80,
				rows: input.rows ?? 24,
				instanceId: input.instanceId ?? `desktop-${Date.now().toString(36)}`,
				...(input.profileId ? { profileId: input.profileId } : {}),
				...(input.cwd ? { cwd: input.cwd } : {}),
			}),
		});
		const attached: Attached = {
			id: info.id,
			base,
			info,
			decoder: new TextDecoder("utf-8"),
			recorder: this.#recorder,
			cols: input.cols ?? 80,
			rows: input.rows ?? 24,
			ended: false,
			attempt: 0,
		};
		this.#attached.set(info.id, attached);
		this.#attach(attached, info.ticket ?? "");
		return {
			id: info.id,
			name: info.shell ?? info.program ?? "shell",
			cwd: info.cwd ?? input.cwd ?? "",
			profile: info.profile ?? null,
			instance: info.instance,
			reused: info.reused ?? false,
		};
	}

	write(id: string, data: string): void {
		this.#attached.get(id)?.socket?.sendText(data);
	}

	async resize(id: string, cols: number, rows: number): Promise<void> {
		const attached = this.#attached.get(id);
		if (!attached) throw new Error("Terminal not found");
		await this.#request(attached.base, `/api/terminal/${encodeURIComponent(id)}/resize`, {
			method: "POST",
			body: JSON.stringify({ cols, rows }),
		});
	}

	async dispose(id: string): Promise<void> {
		const attached = this.#attached.get(id);
		if (!attached) return;
		this.#attached.delete(id);
		attached.socket?.close("terminal disposed");
		await this.#request(attached.base, `/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
	}

	async profiles(targetId?: string): Promise<unknown> {
		return this.#request(this.#base(targetId), "/api/terminal/profiles");
	}

	async list(targetId?: string): Promise<unknown> {
		return this.#request(this.#base(targetId), "/api/terminal");
	}

	recordingStart(input: { id: string; workspaceId?: string; sessionId?: string }): RecordingStatus {
		const attached = this.#attached.get(input.id);
		if (!attached) throw new Error("Terminal not found");
		return this.#recorder.start({
			terminalId: input.id,
			cols: attached.cols,
			rows: attached.rows,
			title: input.sessionId ?? input.workspaceId ?? path.basename(attached.info.cwd ?? "terminal"),
		});
	}

	recordingStop(id: string): RecordingStatus {
		return this.#recorder.stop(id);
	}

	recordingStatus(id: string): RecordingStatus {
		return this.#recorder.status(id);
	}

	recordingExport(artifactId: string, destination: string): void {
		this.#recorder.exportTo(artifactId, destination);
	}

	artifactPath(name: string): string | null {
		return this.#recorder.artifactPath(name);
	}

	#base(targetId: string | undefined): string {
		if (!targetId) return this.#deps.localBase().replace(/\/$/, "");
		const remote = this.#deps.remoteBase(targetId);
		if (!remote) throw new Error("SSH target is not connected; terminal creation was not sent");
		return remote.replace(/\/$/, "");
	}

	#attach(attached: Attached, ticket: string): void {
		const socket = new StudioEventSocket(
			`${attached.base.replace(/^http/, "ws")}/api/terminal/${encodeURIComponent(attached.id)}/ws?ticket=${encodeURIComponent(ticket)}`,
			undefined,
		);
		attached.socket = socket;
		socket.onBinary = chunk => {
			if (chunk.length > 0 && chunk[0] === 0) {
				this.#control(attached, chunk.subarray(1).toString("utf8"));
				return;
			}
			this.#output(attached, chunk.toString("utf8"));
		};
		socket.onMessage = text => this.#output(attached, text);
		socket.onClose = reason => {
			if (attached.ended || this.#attached.get(attached.id) !== attached) return;
			if (attached.attempt >= 3) {
				this.#exit(attached);
				return;
			}
			attached.attempt += 1;
			const delay = Math.min(4_000, 250 * 2 ** attached.attempt);
			setTimeout(() => {
				if (attached.ended || this.#attached.get(attached.id) !== attached) return;
				void this.#request<{ ticket?: string }>(attached.base, `/api/terminal/${encodeURIComponent(attached.id)}/ticket`, { method: "POST" })
					.then(body => {
						if (body.ticket) this.#attach(attached, body.ticket);
						else this.#exit(attached);
					})
					.catch(() => this.#exit(attached));
			}, delay);
			void reason;
		};
		socket.opened.catch(() => {
			// `onClose` drives reconnect/exit; the failed promise is observed.
		});
	}

	#control(attached: Attached, json: string): void {
		try {
			const frame = JSON.parse(json) as { event?: string };
			if (frame.event === "exit" || frame.event === "session_ended") this.#exit(attached);
		} catch {
			// Malformed control frame: keep the terminal alive.
		}
	}

	#output(attached: Attached, data: string): void {
		if (data === "") return;
		this.#recorder.append(attached.id, data);
		this.#deps.data(attached.id, data);
	}

	#exit(attached: Attached): void {
		if (attached.ended) return;
		attached.ended = true;
		this.#recorder.stop(attached.id);
		attached.socket?.close("terminal exited");
		this.#attached.delete(attached.id);
		this.#deps.exit(attached.id);
	}

	async #request<T = unknown>(base: string, route: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${base}${route}`, {
			...init,
			headers: { "content-type": "application/json", ...(init.headers ?? {}) },
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(text || `Terminal request failed (${response.status})`);
		}
		return (await response.json()) as T;
	}
}
