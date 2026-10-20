/**
 * Offline mailboxes.
 *
 * One file per message, written with an atomic rename, injected in `sentAt`
 * order when the agent next starts or is woken, then moved to `delivered/`.
 * The delivered directory doubles as the dedupe record: an envelope id that
 * already reached `delivered/` is never injected twice (at-least-once
 * delivery, effectively-once injection).
 */

import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@linxiraos/pi-utils";
import { type MeshPaths, meshPaths } from "./paths";
import { MESH_MAILBOX_RETENTION_MS, type MeshEnvelope } from "./types";
import { validateEnvelope } from "./envelope";

/** Sortable name: zero-padded `sentAt`, then the (encoded) envelope id. */
function messageFileName(envelope: MeshEnvelope): string {
	return `${String(envelope.sentAt).padStart(16, "0")}-${encodeURIComponent(envelope.id)}.json`;
}

/** Envelope id encoded in a `sentAt-id.json` filename, or undefined. */
function idFromFileName(name: string): string | undefined {
	if (!name.endsWith(".json")) return undefined;
	const dash = name.indexOf("-", 16);
	if (dash === -1) return undefined;
	try {
		return decodeURIComponent(name.slice(dash + 1, -".json".length));
	} catch {
		return undefined;
	}
}

export class MeshMailbox {
	readonly paths: MeshPaths;

	constructor(paths: MeshPaths = meshPaths()) {
		this.paths = paths;
	}

	/**
	 * Atomically enqueue one envelope. A repeated envelope id (pending or
	 * already delivered) is ignored, so retries cannot duplicate deliveries.
	 */
	async enqueue(workspaceId: string, agentId: string, envelope: MeshEnvelope): Promise<"queued" | "duplicate"> {
		const dir = this.paths.mailboxDir(workspaceId, agentId);
		const file = path.join(dir, messageFileName(envelope));
		if (await this.#exists(file)) return "duplicate";
		if ((await this.deliveredIds(workspaceId, agentId)).has(envelope.id)) return "duplicate";
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const temp = path.join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
		try {
			await fs.writeFile(temp, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
			try {
				await fs.rename(temp, file);
			} catch (error) {
				// Windows refuses to rename onto an existing target; the existing
				// file is the same envelope id, so keeping it is correct.
				if (await this.#exists(file)) {
					await fs.rm(temp, { force: true });
					return "duplicate";
				}
				throw error;
			}
			return "queued";
		} catch (error) {
			await fs.rm(temp, { force: true }).catch(() => {});
			throw error;
		}
	}

	/** Pending envelopes in `sentAt` order, deduplicated by id. */
	async pending(workspaceId: string, agentId: string): Promise<MeshEnvelope[]> {
		const dir = this.paths.mailboxDir(workspaceId, agentId);
		let names: string[];
		try {
			names = await fs.readdir(dir);
		} catch {
			return [];
		}
		const delivered = await this.deliveredIds(workspaceId, agentId);
		const seen = new Set<string>();
		const envelopes: MeshEnvelope[] = [];
		for (const name of names) {
			const id = idFromFileName(name);
			if (!name.endsWith(".json") || id === undefined) continue;
			if (delivered.has(id) || seen.has(id)) continue;
			let envelope: MeshEnvelope;
			try {
				envelope = validateEnvelope(JSON.parse(await fs.readFile(path.join(dir, name), "utf8")));
			} catch (error) {
				logger.warn("mesh: dropping unreadable mailbox message", {
					workspaceId,
					agentId,
					file: name,
					error: String(error),
				});
				await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
				continue;
			}
			seen.add(id);
			envelopes.push(envelope);
		}
		envelopes.sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
		return envelopes;
	}

	/** Move one injected envelope to `delivered/`. Idempotent. */
	async markDelivered(workspaceId: string, agentId: string, envelope: MeshEnvelope): Promise<void> {
		const dir = this.paths.mailboxDir(workspaceId, agentId);
		const deliveredDir = this.paths.deliveredDir(workspaceId, agentId);
		const source = path.join(dir, messageFileName(envelope));
		const target = path.join(deliveredDir, messageFileName(envelope));
		await fs.mkdir(deliveredDir, { recursive: true, mode: 0o700 });
		try {
			await fs.rename(source, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// Already moved (or never queued); write a marker so a re-queued
				// copy of the same id stays deduplicated.
				await fs.writeFile(target, `${JSON.stringify(envelope)}\n`, { mode: 0o600 }).catch(() => {});
				return;
			}
			throw error;
		}
	}

	/** Ids already injected for this agent. */
	async deliveredIds(workspaceId: string, agentId: string): Promise<Set<string>> {
		const ids = new Set<string>();
		let names: string[];
		try {
			names = await fs.readdir(this.paths.deliveredDir(workspaceId, agentId));
		} catch {
			return ids;
		}
		for (const name of names) {
			const id = idFromFileName(name);
			if (id !== undefined) ids.add(id);
		}
		return ids;
	}

	/**
	 * Retention policy: a workspace whose process is `gone` keeps its mailbox
	 * for 30 days. Older mailboxes are removed and the eviction is logged.
	 * `isGone` reports whether the workspace currently has no live process.
	 */
	async cleanupGone(
		isGone: (workspaceId: string) => boolean,
		retentionMs: number = MESH_MAILBOX_RETENTION_MS,
		now: number = Date.now(),
	): Promise<string[]> {
		let workspaces: string[];
		try {
			workspaces = await fs.readdir(this.paths.mailboxesDir);
		} catch {
			return [];
		}
		const removed: string[] = [];
		for (const workspaceId of workspaces) {
			if (!isGone(workspaceId)) continue;
			const dir = path.join(this.paths.mailboxesDir, workspaceId);
			const newest = await this.#newestMtime(dir);
			if (newest === undefined || now - newest <= retentionMs) continue;
			await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
			removed.push(workspaceId);
			logger.info("mesh: evicted expired offline mailbox", {
				workspaceId,
				ageDays: Math.floor((now - newest) / 86_400_000),
				retentionDays: Math.floor(retentionMs / 86_400_000),
			});
		}
		return removed;
	}

	async #exists(file: string): Promise<boolean> {
		try {
			await fs.access(file);
			return true;
		} catch {
			return false;
		}
	}

	async #newestMtime(dir: string): Promise<number | undefined> {
		let newest: number | undefined;
		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return undefined;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				const nested = await this.#newestMtime(full);
				if (nested !== undefined && (newest === undefined || nested > newest)) newest = nested;
				continue;
			}
			const stat = await fs.stat(full).catch(() => undefined);
			if (stat && (newest === undefined || stat.mtimeMs > newest)) newest = stat.mtimeMs;
		}
		return newest;
	}
}
