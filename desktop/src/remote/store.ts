/**
 * Durable SSH profile storage for the desktop bridge.
 *
 * Only non-secret fields are persisted: host/auth mode/install root/last
 * directory. Passwords are never written here; `RemoteCredentials` lives for
 * one connect call and is dropped afterwards.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	normalizeHost,
	normalizePort,
	profilePlatform,
	safeSshToken,
	type RemoteAuthMode,
	type RemoteConnectionDraft,
	type RemoteConnectionProfile,
	type RemoteNetworkMode,
} from "./protocol";

interface StoredFile {
	readonly version: 1;
	readonly activeId: string | null;
	readonly profiles: readonly RemoteConnectionProfile[];
}

const EMPTY: StoredFile = { version: 1, activeId: null, profiles: [] };

function authMode(value: unknown): RemoteAuthMode {
	return value === "password" ? "password" : "agent";
}

function networkMode(value: unknown): RemoteNetworkMode {
	return value === "remote-only" || value === "local-only" ? value : "remote-first";
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseProfile(value: unknown): RemoteConnectionProfile | null {
	if (value === null || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.host !== "string") return null;
	try {
		const id = safeSshToken(row.id, "connection id");
		const host = normalizeHost(row.host);
		const user = optionalString(row.user);
		if (user !== undefined) safeSshToken(user, "SSH user");
		const port = typeof row.port === "number" ? normalizePort(row.port) : undefined;
		const profile: RemoteConnectionProfile = {
			id,
			name: row.name.slice(0, 80),
			host,
			authMode: authMode(row.authMode),
			platform: profilePlatform(row.platform),
			networkMode: networkMode(row.networkMode),
			...(user !== undefined ? { user } : {}),
			...(port !== undefined ? { port } : {}),
			...(optionalString(row.installRoot) !== undefined ? { installRoot: optionalString(row.installRoot) } : {}),
			...(optionalString(row.localProxyUrl) !== undefined ? { localProxyUrl: optionalString(row.localProxyUrl) } : {}),
			...(optionalString(row.lastDirectory) !== undefined ? { lastDirectory: optionalString(row.lastDirectory) } : {}),
		};
		return profile;
	} catch {
		return null;
	}
}

/** Atomic JSON write; the directory/file are private to the current user. */
export function writePrivateJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(temporary, file);
	} catch (error) {
		try {
			fs.unlinkSync(temporary);
		} catch {
			// Best effort: the original file is authoritative.
		}
		throw error;
	}
	try {
		fs.chmodSync(file, 0o600);
	} catch {
		// Windows has no POSIX mode; the file still sits under userData.
	}
}

export class RemoteProfileStore {
	readonly #file: string;
	#value: StoredFile = EMPTY;

	constructor(userData: string) {
		this.#file = path.join(userData, "remote-connections.json");
	}

	get file(): string {
		return this.#file;
	}

	load(): RemoteInventoryState {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.#file, "utf8")) as unknown;
			if (parsed === null || typeof parsed !== "object") return { ...EMPTY };
			const row = parsed as Record<string, unknown>;
			const profiles = Array.isArray(row.profiles) ? row.profiles.map(parseProfile).filter((value): value is RemoteConnectionProfile => value !== null) : [];
			const activeId = typeof row.activeId === "string" && profiles.some(profile => profile.id === row.activeId) ? row.activeId : null;
			this.#value = { version: 1, activeId, profiles };
		} catch {
			this.#value = { ...EMPTY };
		}
		return this.snapshot();
	}

	snapshot(): RemoteInventoryState {
		return {
			activeId: this.#value.activeId,
			profiles: this.#value.profiles.map(profile => ({ ...profile })),
		};
	}

	upsert(draft: RemoteConnectionDraft): RemoteConnectionProfile {
		const host = normalizeHost(draft.host);
		const user = draft.user?.trim();
		if (user) safeSshToken(user, "SSH user");
		const port = normalizePort(draft.port);
		const name = draft.name.trim().slice(0, 80) || host;
		const existing = draft.id ? this.#value.profiles.find(profile => profile.id === draft.id) : undefined;
		const profile: RemoteConnectionProfile = {
			id: existing?.id ?? crypto.randomUUID(),
			name,
			host,
			authMode: authMode(draft.authMode),
			networkMode: networkMode(draft.networkMode),
			platform: existing?.platform ?? "linux",
			...(user ? { user } : {}),
			...(port !== undefined ? { port } : {}),
			...(draft.installRoot?.trim() ? { installRoot: draft.installRoot.trim() } : {}),
			...(draft.localProxyUrl?.trim() ? { localProxyUrl: draft.localProxyUrl.trim() } : {}),
			...(existing?.lastDirectory ? { lastDirectory: existing.lastDirectory } : {}),
		};
		const profiles = existing
			? this.#value.profiles.map(value => (value.id === existing.id ? profile : value))
			: [...this.#value.profiles, profile];
		this.#value = { ...this.#value, profiles };
		this.#persist();
		return { ...profile };
	}

	remove(id: string): boolean {
		const profiles = this.#value.profiles.filter(profile => profile.id !== id);
		if (profiles.length === this.#value.profiles.length) return false;
		this.#value = {
			...this.#value,
			profiles,
			activeId: this.#value.activeId === id ? null : this.#value.activeId,
		};
		this.#persist();
		return true;
	}

	update(id: string, patch: Partial<Pick<RemoteConnectionProfile, "platform" | "lastDirectory" | "installRoot">>): void {
		const profiles = this.#value.profiles.map(profile => (profile.id === id ? { ...profile, ...patch } : profile));
		this.#value = { ...this.#value, profiles };
		this.#persist();
	}

	select(id: string | null): void {
		if (id !== null && !this.#value.profiles.some(profile => profile.id === id)) throw new Error("SSH connection not found");
		this.#value = { ...this.#value, activeId: id };
		this.#persist();
	}

	#persist(): void {
		writePrivateJson(this.#file, this.#value);
	}
}

export interface RemoteInventoryState {
	readonly activeId: string | null;
	readonly profiles: readonly RemoteConnectionProfile[];
}
