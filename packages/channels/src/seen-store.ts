/**
 * Persistent per-channel dedupe of platform message ids.
 *
 * Platforms retry: Telegram replays the last updates after a reconnect when
 * its in-memory `offset` was lost, Feishu redelivers an event until it is
 * acknowledged, and a WeChat poll can return the same message twice. Without
 * a durable record a restart answers the same message a second time.
 *
 * The store keeps a bounded, TTL-limited id list per channel and writes it to
 * `<agent dir>/run/channels-seen.json` (next to `channels.lock`), atomically
 * via a temp file + rename so a reader never sees a half-written file.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@linxiraos/pi-utils";

export const CHANNEL_SEEN_FILENAME = "channels-seen.json";

/** Default seen-state location for an agent/config dir. */
export function channelSeenStatePath(agentDir: string): string {
	return path.join(agentDir, "run", CHANNEL_SEEN_FILENAME);
}

export interface ChannelSeenStoreOptions {
	/** Absolute state file; omit for memory-only dedupe (tests, CLI one-shots). */
	filePath?: string;
	/** Ids retained per channel; the oldest are evicted. */
	maxEntriesPerChannel?: number;
	/** Ids older than this are forgotten. */
	ttlMs?: number;
	now?: () => number;
}

/** 500 recent ids per channel is days of traffic for a busy bot. */
const DEFAULT_MAX_ENTRIES = 500;
/** A platform retry after a restart essentially never arrives a week later. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;

interface SeenEntry {
	id: string;
	at: number;
}

interface SeenFile {
	version: 1;
	channels: Record<string, SeenEntry[]>;
}

export class ChannelSeenStore {
	readonly #filePath?: string;
	readonly #maxEntries: number;
	readonly #ttlMs: number;
	readonly #now: () => number;
	readonly #channels = new Map<string, SeenEntry[]>();
	#dirty = false;
	#saveQueued = false;
	#writeChain: Promise<void> = Promise.resolve();

	private constructor(options: ChannelSeenStoreOptions) {
		this.#filePath = options.filePath;
		this.#maxEntries = Math.max(1, options.maxEntriesPerChannel ?? DEFAULT_MAX_ENTRIES);
		this.#ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
		this.#now = options.now ?? Date.now;
	}

	/** Load (or create) the store. A missing file is normal; a corrupt one is ignored. */
	static async open(options: ChannelSeenStoreOptions = {}): Promise<ChannelSeenStore> {
		const store = new ChannelSeenStore(options);
		await store.#load();
		return store;
	}

	/** Whether this id was already accepted on this channel. */
	has(channelId: string, messageId: string): boolean {
		if (!messageId) return false;
		const entries = this.#channels.get(channelId);
		if (!entries) return false;
		const entry = entries.find(candidate => candidate.id === messageId);
		if (!entry) return false;
		if (this.#now() - entry.at > this.#ttlMs) {
			this.#remove(channelId, messageId);
			return false;
		}
		return true;
	}

	/** Remember an accepted id and schedule a durable write. */
	record(channelId: string, messageId: string): void {
		if (!messageId) return;
		const entries = this.#pruned(channelId);
		if (entries.some(entry => entry.id === messageId)) return;
		entries.push({ id: messageId, at: this.#now() });
		while (entries.length > this.#maxEntries) entries.shift();
		this.#channels.set(channelId, entries);
		this.#dirty = true;
		this.#scheduleSave();
	}

	/** Number of channels holding seen ids. */
	get channelCount(): number {
		return this.#channels.size;
	}

	/** Total ids currently retained. */
	get size(): number {
		let total = 0;
		for (const entries of this.#channels.values()) total += entries.length;
		return total;
	}

	/** Force pending state to disk; safe to call concurrently. */
	async flush(): Promise<void> {
		this.#saveQueued = false;
		await this.#enqueueWrite();
	}

	/** Flush and release the timer-free store (writes are already chained). */
	async close(): Promise<void> {
		await this.flush();
	}

	#scheduleSave(): void {
		if (!this.#filePath || this.#saveQueued) return;
		this.#saveQueued = true;
		queueMicrotask(() => {
			this.#saveQueued = false;
			if (!this.#dirty) return;
			void this.#enqueueWrite();
		});
	}

	#enqueueWrite(): Promise<void> {
		this.#writeChain = this.#writeChain
			.then(() => this.#write())
			.catch(error => {
				logger.warn("Channel seen-state persistence failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return this.#writeChain;
	}

	async #write(): Promise<void> {
		if (!this.#filePath || !this.#dirty) return;
		const payload: SeenFile = { version: 1, channels: {} };
		for (const [channelId, entries] of this.#channels) {
			if (entries.length > 0) payload.channels[channelId] = entries;
		}
		// Clear first: a concurrent record() during the write re-marks it dirty.
		this.#dirty = false;
		const dir = path.dirname(this.#filePath);
		await fs.mkdir(dir, { recursive: true });
		const tmp = `${this.#filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
		try {
			await fs.writeFile(tmp, `${JSON.stringify(payload)}\n`, "utf8");
			await fs.rename(tmp, this.#filePath);
		} catch (error) {
			await fs.rm(tmp, { force: true }).catch(() => {});
			throw error;
		}
	}

	async #load(): Promise<void> {
		if (!this.#filePath) return;
		let raw: string;
		try {
			raw = await fs.readFile(this.#filePath, "utf8");
		} catch (error) {
			if (!isEnoent(error)) {
				logger.warn("Channel seen-state load failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			logger.warn("Channel seen-state file is not valid JSON; ignoring it");
			return;
		}
		if (!parsed || typeof parsed !== "object") return;
		// JSON boundary: the shape is validated field by field below.
		const file: { version?: unknown; channels?: unknown } = parsed;
		if (file.version !== 1 || !file.channels || typeof file.channels !== "object") return;
		const loaded = new Map<string, SeenEntry[]>();
		for (const [channelId, value] of Object.entries(file.channels)) {
			if (!Array.isArray(value)) continue;
			const entries: SeenEntry[] = [];
			for (const candidate of value) {
				if (!candidate || typeof candidate !== "object") continue;
				if (!("id" in candidate) || !("at" in candidate)) continue;
				const id = candidate.id;
				const at = candidate.at;
				if (typeof id !== "string" || id === "" || typeof at !== "number" || !Number.isFinite(at)) continue;
				if (this.#now() - at > this.#ttlMs) continue;
				entries.push({ id, at });
			}
			if (entries.length === 0) continue;
			loaded.set(channelId, entries.slice(-this.#maxEntries));
		}
		for (const [channelId, entries] of loaded) this.#channels.set(channelId, entries);
	}

	/** The live entry list for a channel, with expired ids dropped. */
	#pruned(channelId: string): SeenEntry[] {
		const entries = this.#channels.get(channelId) ?? [];
		const cutoff = this.#now() - this.#ttlMs;
		const kept = entries.filter(entry => entry.at >= cutoff);
		this.#channels.set(channelId, kept);
		return kept;
	}

	#remove(channelId: string, messageId: string): void {
		const entries = this.#channels.get(channelId);
		if (!entries) return;
		const next = entries.filter(entry => entry.id !== messageId);
		if (next.length === entries.length) return;
		if (next.length === 0) this.#channels.delete(channelId);
		else this.#channels.set(channelId, next);
		this.#dirty = true;
		this.#scheduleSave();
	}
}
