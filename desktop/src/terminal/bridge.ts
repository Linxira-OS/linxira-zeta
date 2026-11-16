/**
 * Desktop terminal surface (`window.zetaStudioTerminal`).
 *
 * The PTY still belongs to the gateway; the desktop owns the socket, the
 * renderer event fan-out, and recording. Local terminals use the shell's own
 * Web UI origin; a remote execution target uses that connection's SSH tunnel.
 * Reconnect asks for a fresh one-time ticket, exactly like the browser client.
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type { StudioEventSocket } from "../remote/http";
import type { DesktopHostConnection } from "../host-http";
import { TerminalOutput } from "./output";
import { parseTerminalCreate, terminalDimension, type TerminalCreateInput } from "./validation";
export type { TerminalCreateInput } from "./validation";
import { TerminalRecorder, type RecordingStatus } from "./recorder";

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
	readonly host: DesktopHostConnection;
	readonly info: GatewayTerminalInfo;
	readonly output: TerminalOutput;
	cols: number;
	rows: number;
	socket?: StudioEventSocket;
	ended: boolean;
	attempt: number;
}

export interface TerminalBridgeDeps {
	readonly connection: (targetId?: string) => DesktopHostConnection;
	readonly userData: string;
	readonly data: (terminalId: string, data: string, bytes: number) => void;
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

	async create(value: TerminalCreateInput = {}, onCreated?: (id: string) => void): Promise<TerminalSessionInfo> {
		const input = parseTerminalCreate(value);
		const host = this.#deps.connection(input.targetId);
		const info = await host.gateway<GatewayTerminalInfo>("/api/terminal/ensure", {
			method: "POST",
			body: JSON.stringify({
				cols: input.cols,
				rows: input.rows,
				instanceId: input.instanceId ?? `desktop-${randomUUID()}`,
				...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
				...(input.command ? { command: input.command } : {}),
				...(input.profileId ? { profileId: input.profileId } : {}),
				...(input.cwd ? { cwd: input.cwd } : {}),
			}),
		});
		if (!info || typeof info.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(info.id) || typeof info.ticket !== "string" || !info.ticket) {
			throw new Error("Host returned an invalid terminal session");
		}
		const existing = this.#attached.get(info.id);
		if (existing) {
			if (existing.host.base !== host.base) throw new Error("Terminal identity belongs to another Host");
			onCreated?.(info.id);
		} else {
			onCreated?.(info.id);
			const output = new TerminalOutput((data, bytes) => {
				this.#recorder.append(info.id, data);
				this.#deps.data(info.id, data, bytes);
			});
			const attached: Attached = { id: info.id, host, info, output, cols: input.cols, rows: input.rows, ended: false, attempt: 0 };
			this.#attached.set(info.id, attached);
			try { await this.#attach(attached, info.ticket); }
			catch (error) { this.#exit(attached); throw error; }
		}
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
		terminalDimension(cols, "cols");
		terminalDimension(rows, "rows");
		await attached.host.gateway(`/api/terminal/${encodeURIComponent(id)}/resize`, {
			method: "POST",
			body: JSON.stringify({ cols, rows }),
		});
		attached.cols = cols;
		attached.rows = rows;
	}

	async dispose(id: string): Promise<void> {
		const attached = this.#attached.get(id);
		if (!attached) return;
		attached.ended = true;
		attached.output.close();
		this.#recorder.stop(id);
		this.#attached.delete(id);
		attached.socket?.close("terminal disposed");
		await attached.host.gateway(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" });
	}

	async profiles(targetId?: string): Promise<unknown> {
		return this.#deps.connection(targetId).gateway("/api/terminal/profiles");
	}

	async list(targetId?: string): Promise<unknown> {
		return this.#deps.connection(targetId).gateway("/api/terminal");
	}

	recordingStart(input: { id: string; workspaceId?: string; sessionId?: string }): RecordingStatus {
		const attached = this.#attached.get(input.id);
		if (!attached) throw new Error("Terminal not found");
		attached.output.flush();
		return this.#recorder.start({
			terminalId: input.id,
			cols: attached.cols,
			rows: attached.rows,
			title: input.sessionId ?? input.workspaceId ?? path.basename(attached.info.cwd ?? "terminal"),
		});
	}

	recordingStop(id: string): RecordingStatus {
		this.#attached.get(id)?.output.flush();
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

	shutdown(): void {
		for (const attached of [...this.#attached.values()]) this.#exit(attached);
	}

	detach(id: string): void {
		const attached = this.#attached.get(id);
		if (attached) this.#exit(attached);
	}

	async #attach(attached: Attached, ticket: string): Promise<void> {
		const socket = await attached.host.socket(`/api/terminal/${encodeURIComponent(attached.id)}/ws?ticket=${encodeURIComponent(ticket)}`);
		if (attached.ended || this.#attached.get(attached.id) !== attached) { socket.close("terminal closed"); return; }
		attached.socket = socket;
		socket.onBinary = chunk => {
			if (chunk.length > 0 && chunk[0] === 0) {
				this.#control(attached, chunk.subarray(1).toString("utf8"));
				return;
			}
			attached.output.append(chunk);
		};
		socket.onMessage = text => attached.output.append(text);
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
				void attached.host.gateway<{ ticket?: string }>(`/api/terminal/${encodeURIComponent(attached.id)}/ticket`, { method: "POST" })
					.then(async body => {
						if (body.ticket) await this.#attach(attached, body.ticket);
						else this.#exit(attached);
					})
					.catch(() => this.#exit(attached));
			}, delay);
			void reason;
		};
		await socket.opened;
	}

	#control(attached: Attached, json: string): void {
		try {
			const frame = JSON.parse(json) as { event?: string };
			if (frame.event === "exit" || frame.event === "session_ended") this.#exit(attached);
		} catch {
			// Malformed control frame: keep the terminal alive.
		}
	}

	#exit(attached: Attached): void {
		if (attached.ended) return;
		attached.ended = true;
		attached.output.close();
		this.#recorder.stop(attached.id);
		attached.socket?.close("terminal exited");
		this.#attached.delete(attached.id);
		this.#deps.exit(attached.id);
	}
}
