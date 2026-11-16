import { StudioMessagePrediction } from "./message-prediction";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { randomBytes, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import {
	WordCompletionProvider,
	type WordPredictionBackend,
	type WordCompletionEngine,
} from "@linxiraos/pi-tui/prompt/word-completion";
import { sanitizeText } from "@linxiraos/pi-utils";
import { cfgSpellingAutocomplete } from "../../../modes/settings";
import { resolveTextPredictMethod } from "../../../predict/client";
import { StudioPredictionEngine, type StudioPredictionQuery } from "./prediction-engine";
import type { PredictionControlAction } from "../protocol/contracts/prediction";
import { readForeignPrompts } from "../../../predict/foreign-history";

import type { AgentSession } from "../../../session/agent-session";
import {
	type PredictionChannelOperation,
	type PredictionSettings,
	type PredictionEvent,
	type PredictionInput,
} from "../protocol/contracts/prediction-channel";
import { unavailable } from "../errors";
import { parsePredictionInput } from "./prediction-input";
export interface PredictionView {
	readonly id: string;
	isLive(): boolean;
}
interface Channel {
	owner: PredictionView;
	revision: number;
	protocolVersion?: 2;
	id: string;
	sessionId: string;
	descriptor: string;
	endpoint: string;
	token: string;
	server: Server;
	socket?: Socket;
	peers: Set<Socket>;
	timer: NodeJS.Timeout;
	lastSeen: number;
	closed: boolean;
	provider: WordCompletionProvider;
	input?: { revision: number; lines: string[]; line: number; column: number; suffix: string | null };
	importing: boolean;
}
const clean = (cause: unknown) =>
	sanitizeText(cause instanceof Error ? cause.message : String(cause))
		.replaceAll("\0", "")
		.slice(0, 1024) || "Prediction unavailable";
export function predictionSocketName(id: string): string {
	return "p-" + createHash("sha256").update(id).digest("hex").slice(0, 16) + ".sock";
}
/** Native completion/prose gates; typed settings over Bridge, draft text only over private sockets. */
export class StudioPredictionService {
	readonly #engine: StudioPredictionEngine;
	get running(): boolean {
		return this.#engine.running || [...this.#channels.values()].some(channel => channel.importing);
	}
	query(input: StudioPredictionQuery) {
		return this.#engine.query(input);
	}
	async control(action: PredictionControlAction, assertCurrent?: () => void) {
		const result = await this.#engine.control(action, assertCurrent);
		if (action === "clear" || action === "import")
			for (const channel of this.#channels.values()) {
				channel.provider.setMethod("off");
				channel.provider.setMethod(cfgSpellingAutocomplete.get(this.session.settings));
				channel.input = undefined;
				this.#send(channel, { kind: "suggestion", channelId: channel.id, revision: 0, suffix: null });
			}
		return result;
	}
	observeSent(id: string, text: string) {
		return this.#engine.observeSent(id, text);
	}
	#messagePrediction: StudioMessagePrediction | undefined;
	enableMessagePrediction(session: AgentSession): void {
		this.#messagePrediction?.dispose();
		this.#messagePrediction = new StudioMessagePrediction(session, (channelId, revision, suffix, choices, rank) => {
			const channel = this.#channels.get(channelId);
			if (channel && !channel.closed)
				this.#send(channel, {
					kind: "next",
					channelId,
					revision,
					suffix,
					...(channel.protocolVersion === 2 ? { choices, rank } : {}),
				});
		});
	}
	readonly #channels = new Map<string, Channel>();
	#disposed = false;
	readonly #unsubscribe: () => void;
	constructor(
		readonly session: Pick<AgentSession, "sessionId" | "settings"> &
			Partial<Pick<AgentSession, "registerSessionChangeCallback" | "subscribe">>,
		readonly directory: string,
		readonly socketDirectory: string,
		readonly isLive: () => boolean = () => true,
		engineOptions: ConstructorParameters<typeof StudioPredictionEngine>[1] = {},
	) {
		this.#engine = new StudioPredictionEngine(session, engineOptions);
		this.#unsubscribe =
			session.registerSessionChangeCallback?.(() => {
				for (const channel of this.#channels.values()) this.#close(channel);
			}) ?? (() => {});
	}
	#check(id: string): void {
		if (this.#disposed || !this.isLive() || id !== this.session.sessionId)
			throw unavailable("Prediction requires the current session");
	}
	async #status(): Promise<PredictionSettings> {
		const method = cfgSpellingAutocomplete.get(this.session.settings);
		const status = await this.#engine.control("status");
		return {
			method,
			effective:
				method === "off"
					? "off"
					: method === "smollm" && !status.modelReady
						? "ngram"
						: resolveTextPredictMethod(method),
			source: this.session.settings.getProvenance(cfgSpellingAutocomplete),
			download: {
				state: status.modelReady
					? "ready"
					: status.download.state === "running"
						? "downloading"
						: status.download.state === "completed"
							? "ready"
							: status.download.state,
				bytes: status.download.loaded,
				total: status.download.total,
				...(status.download.error ? { error: status.download.error } : {}),
			},
		};
	}
	async execute(operation: PredictionChannelOperation, owner: PredictionView): Promise<unknown> {
		this.#check(operation.sessionId);
		if (!owner.isLive()) throw unavailable("Prediction view closed");
		if (operation.kind === "prediction.prepare") return this.#prepare(owner, operation.protocolVersion);
		if (operation.kind === "prediction.release") {
			const channel = this.#channels.get(operation.channelId);
			if (channel && channel.sessionId === operation.sessionId && channel.owner.id === owner.id)
				this.#close(channel);
			return { released: true };
		}
		if (operation.kind === "prediction.download.cancel") await this.#engine.control("cancel");
		if (operation.kind === "prediction.clearOverride") cfgSpellingAutocomplete.clearOverride(this.session.settings);
		if (operation.kind === "prediction.configure") {
			cfgSpellingAutocomplete.assertWritable(operation.method);
			if (operation.method === "apple" && process.platform !== "darwin")
				throw unavailable("Apple prediction is only available on macOS");
			if (operation.scope === "session") cfgSpellingAutocomplete.override(this.session.settings, operation.method);
			else {
				cfgSpellingAutocomplete.set(this.session.settings, operation.method);
				await this.session.settings.flush();
				if (!owner.isLive()) throw unavailable("Prediction view closed");
			}
		}
		const method = cfgSpellingAutocomplete.get(this.session.settings);
		if (operation.kind === "prediction.configure" && method === "smollm") await this.#engine.control("download");
		if (method !== "smollm" && this.#engine.running) await this.#engine.control("cancel");
		if (operation.kind !== "prediction.status")
			for (const channel of this.#channels.values()) {
				channel.provider.setMethod(method);
				channel.input = undefined;
				this.#send(channel, { kind: "suggestion", channelId: channel.id, revision: 0, suffix: null });
			}
		return this.#status();
	}
	async #prepare(
		owner: PredictionView,
		protocolVersion?: 2,
	): Promise<{ channelId: string; sessionId: string; expiresAt: number; protocolVersion?: 2 }> {
		if (!this.directory || (!this.socketDirectory && process.platform !== "win32"))
			throw unavailable("Private prediction transport is unavailable");
		if (!owner.isLive() || this.#channels.size >= 4)
			throw unavailable("Prediction view is unavailable or has too many channels");
		const id = randomUUID(),
			sessionId = this.session.sessionId,
			token = randomBytes(32).toString("hex"),
			folder = path.join(this.directory, "prediction");
		const endpoint =
			process.platform === "win32"
				? "\\\\.\\pipe\\zeta-studio-predict-" + id
				: path.join(this.socketDirectory!, predictionSocketName(id));
		if (process.platform !== "win32" && Buffer.byteLength(endpoint) > 103)
			throw unavailable("Prediction socket path is too long");
		await fs.mkdir(folder, { recursive: true, mode: 0o700 });
		this.#check(sessionId);
		if (!owner.isLive() || this.#channels.size >= 4)
			throw unavailable("Prediction view is unavailable or has too many channels");
		const server = createServer(socket => this.#connect(channel, socket));
		const backend = (method: WordCompletionEngine): WordPredictionBackend => ({
			complete: async (before, prefix) => {
				try {
					return (
						(await this.#engine.completeNative(resolveTextPredictMethod(method), before, prefix)).suggestion
							?.suffix ?? null
					);
				} catch (cause) {
					this.#send(channel, { kind: "error", channelId: id, message: clean(cause) });
					throw cause;
				}
			},
			feedback: (before, prefix, suggestion, accepted) =>
				this.#engine.feedback(method, before, prefix, suggestion, accepted),
		});
		const provider = new WordCompletionProvider(backend);
		provider.setMethod(cfgSpellingAutocomplete.get(this.session.settings));
		const channel: Channel = {
			id,
			owner,
			revision: -1,
			sessionId,
			descriptor: path.join(folder, id + ".json"),
			endpoint,
			token,
			server,
			peers: new Set(),
			timer: setInterval(() => {
				if (
					Date.now() - channel.lastSeen > 45000 ||
					channel.sessionId !== this.session.sessionId ||
					!owner.isLive() ||
					!this.isLive()
				)
					this.#close(channel);
			}, 5000),
			lastSeen: Date.now(),
			closed: false,
			provider,
			importing: false,
			protocolVersion,
		};
		channel.timer.unref();
		provider.onUpdate = () => this.#suggest(channel);
		this.#channels.set(id, channel);
		try {
			const ready = Promise.withResolvers<void>();
			server.once("error", ready.reject);
			server.listen(endpoint, ready.resolve);
			await ready.promise;
			this.#check(sessionId);
			if (channel.closed || !owner.isLive()) throw unavailable("Prediction view closed");
			const expiresAt = Date.now() + 15000;
			await fs.writeFile(
				channel.descriptor,
				JSON.stringify({ version: 1, channelId: id, sessionId, endpoint, token, expiresAt }),
				{ flag: "wx", mode: 0o600 },
			);
			this.#check(sessionId);
			if (channel.closed || !owner.isLive()) {
				await fs.unlink(channel.descriptor).catch(() => {});
				throw unavailable("Prediction channel closed");
			}
			return { channelId: id, sessionId, expiresAt, ...(protocolVersion === 2 ? { protocolVersion } : {}) };
		} catch (error) {
			this.#close(channel);
			await fs.unlink(channel.descriptor).catch(() => {});
			throw error;
		}
	}
	#suggest(channel: Channel): void {
		const input = channel.input;
		if (!input || channel.closed) return;
		const suffix = channel.provider.getWordCompletion(input.lines, input.line, input.column);
		input.suffix = suffix && suffix.length <= 256 ? suffix : null;
		this.#send(channel, {
			kind: "suggestion",
			channelId: channel.id,
			revision: input.revision,
			suffix: input.suffix,
		});
	}
	#connect(channel: Channel, socket: Socket): void {
		if (channel.closed || channel.socket || channel.peers.size >= 2) {
			socket.destroy();
			return;
		}
		channel.peers.add(socket);
		let authenticated = false,
			pendingLength = 0;
		const pending = Buffer.alloc(32768);
		const timer = setTimeout(() => socket.destroy(), 3000);
		timer.unref();
		socket.on("error", () => {});
		socket.once("close", () => {
			clearTimeout(timer);
			channel.peers.delete(socket);
			if (channel.socket === socket) this.#close(channel);
		});
		socket.on("data", (chunk: Buffer) => {
			if (typeof chunk === "string" || pendingLength + chunk.length > pending.length) {
				socket.destroy();
				return;
			}
			chunk.copy(pending, pendingLength);
			pendingLength += chunk.length;
			for (
				let at = pending.subarray(0, pendingLength).indexOf(10);
				at >= 0;
				at = pending.subarray(0, pendingLength).indexOf(10)
			) {
				const line = pending.subarray(0, at).toString("utf8");
				pending.copyWithin(0, at + 1, pendingLength);
				pendingLength -= at + 1;
				try {
					this.#check(channel.sessionId);
					if (channel.closed || !channel.owner.isLive()) throw new Error("Prediction channel closed");
					if (!authenticated) {
						if (
							!/^[a-f0-9]{64}$/.test(line) ||
							!timingSafeEqual(Buffer.from(line), Buffer.from(channel.token)) ||
							channel.socket
						)
							throw new Error("Invalid prediction authentication");
						authenticated = true;
						clearTimeout(timer);
						channel.socket = socket;
						socket.write("OK\n");
						void fs.unlink(channel.descriptor).catch(() => {});
						continue;
					}
					const request: unknown = JSON.parse(line);
					const input = parsePredictionInput(request);
					channel.lastSeen = Date.now();
					void this.#input(channel, input).catch(cause =>
						this.#send(channel, {
							kind: "error",
							channelId: channel.id,
							message: clean(cause),
							...(input.kind === "import" ? { requestId: input.requestId } : {}),
						}),
					);
				} catch {
					socket.destroy();
					return;
				}
			}
		});
	}
	async #input(channel: Channel, input: PredictionInput): Promise<void> {
		if (input.kind === "ping") return;
		if (input.kind === "next" || input.kind === "update") {
			if (input.revision <= channel.revision) return;
			channel.revision = input.revision;
		} else if ("revision" in input && input.revision !== channel.revision) return;
		if (input.kind === "next") {
			this.#messagePrediction?.update(channel.id, input.revision, input.empty, input.text);
			return;
		}
		if (input.kind === "next.shown") {
			this.#messagePrediction?.shown(channel.id, input.revision);
			return;
		}
		if (input.kind === "next.accepted") {
			this.#messagePrediction?.accepted(channel.id, input.revision, input.rank);
			return;
		}
		if (input.kind === "update") {
			this.#messagePrediction?.update(
				channel.id,
				input.revision,
				false,
				channel.protocolVersion === 2 ? input.text : undefined,
			);
			if (channel.input && input.revision <= channel.input.revision) return;
			const head = input.text.slice(0, input.caret),
				line = head.split("\n").length - 1,
				column = head.length - (head.lastIndexOf("\n") + 1);
			channel.provider.setMethod(cfgSpellingAutocomplete.get(this.session.settings));
			channel.input = { revision: input.revision, lines: input.text.split("\n"), line, column, suffix: null };
			this.#suggest(channel);
			return;
		}
		if (input.kind === "feedback") {
			if (this.#messagePrediction?.dismiss(channel.id, input.revision, input.accepted)) return;
			const shown = channel.input;
			if (shown?.revision === input.revision && shown.suffix)
				channel.provider.wordCompletionFeedback(
					shown.lines,
					shown.line,
					shown.column,
					shown.suffix,
					input.accepted,
				);
			return;
		}
		if (channel.importing) throw new Error("A prediction history import is already running");
		channel.importing = true;
		const file = path.join(this.directory!, "prediction-imports", input.transferId + ".jsonl");
		try {
			const stat = await fs.lstat(file);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
				throw new Error("Prediction history must be a regular JSONL file under 8 MiB");
			const prompts = await readForeignPrompts([file]);
			this.#check(channel.sessionId);
			if (channel.closed || !channel.owner.isLive()) throw new Error("Prediction channel closed");
			if (!prompts.length) throw new Error("No Claude Code or Codex prompt records were found in the selected file");
			const selected = prompts.slice(0, 2000).map(text => text.slice(0, 4096));
			const count = await this.#engine.importPrompts(selected, () => {
				this.#check(channel.sessionId);
				if (channel.closed || !channel.owner.isLive()) throw unavailable("Prediction channel closed");
			});
			for (const current of this.#channels.values()) {
				current.provider.setMethod("off");
				current.provider.setMethod(cfgSpellingAutocomplete.get(this.session.settings));
			}
			this.#send(channel, {
				kind: "imported",
				channelId: channel.id,
				requestId: input.requestId,
				count,
				truncated: prompts.length > 2000 || prompts.some(text => text.length > 4096),
			});
		} finally {
			channel.importing = false;
			await fs.unlink(file).catch(() => {});
		}
	}
	#send(channel: Channel, event: PredictionEvent): void {
		if (channel.closed || !channel.socket) return;
		if (!channel.owner.isLive() || !this.isLive()) {
			this.#close(channel);
			return;
		}
		if (channel.socket.writableLength > 65536) {
			this.#close(channel);
			return;
		}
		channel.socket.write(JSON.stringify(event) + "\n");
	}
	#close(channel: Channel): void {
		if (channel.closed) return;
		channel.closed = true;
		this.#messagePrediction?.release(channel.id);
		if (channel.socket && !channel.socket.destroyed && channel.socket.writableLength < 65536)
			channel.socket.write(JSON.stringify({ kind: "closed", channelId: channel.id }) + "\n");
		clearInterval(channel.timer);
		channel.provider.setMethod("off");
		channel.provider.onUpdate = undefined;
		channel.input = undefined;
		for (const socket of channel.peers) socket.destroy();
		channel.server.close();
		if (process.platform !== "win32") void fs.unlink(channel.endpoint).catch(() => {});
		void fs.unlink(channel.descriptor).catch(() => {});
		this.#channels.delete(channel.id);
	}
	releaseOwner(owner: string): void {
		for (const channel of this.#channels.values()) if (channel.owner.id === owner) this.#close(channel);
	}
	dispose(): void {
		this.#disposed = true;
		this.#unsubscribe();
		for (const channel of this.#channels.values()) this.#close(channel);
		this.#engine.dispose();
		this.#messagePrediction?.dispose();
	}
}
