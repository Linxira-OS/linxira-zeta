import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TimeTravelSettings } from "../contract/time-travel.js";
import { invalid } from "../errors.js";
import { TimeTravelStore } from "./time-travel-store.js";

const DEFAULT_SETTINGS: TimeTravelSettings = { enabled: false, retentionDays: null, exclusions: [] };

function settingsValue(value: unknown): TimeTravelSettings {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("Invalid Time Travel settings");
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some(key => !["enabled", "retentionDays", "exclusions"].includes(key)) ||
		typeof input.enabled !== "boolean" || !Array.isArray(input.exclusions) || input.exclusions.length > 256 ||
		input.exclusions.some(pattern => typeof pattern !== "string" || pattern.length > 4096 || pattern.includes("\0")))
		throw invalid("Invalid Time Travel settings");
	if (input.retentionDays !== null && (!Number.isSafeInteger(input.retentionDays) || (input.retentionDays as number) < 1))
		throw invalid("Retention must be a positive number of days");
	return { enabled: input.enabled, retentionDays: input.retentionDays as number | null, exclusions: input.exclusions as string[] };
}

/** One profile queue excludes settings/cleanup/capture for the whole code/tree restore. */
export class TimeTravelService {
	readonly #store: TimeTravelStore;
	readonly #settingsFile: string;
	#queue: Promise<unknown> = Promise.resolve();
	#lastCleanupAt = 0;
	constructor(profileDirectory: string) {
		this.#store = new TimeTravelStore(profileDirectory);
		this.#settingsFile = join(profileDirectory, "time-travel", "settings.json");
	}
	#serial<T>(action: () => Promise<T>): Promise<T> {
		const result = this.#queue.then(action, action);
		this.#queue = result.catch(() => undefined);
		return result;
	}
	async settings(): Promise<TimeTravelSettings> {
		try { return settingsValue(JSON.parse(await readFile(this.#settingsFile, "utf8"))); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SETTINGS; throw error; }
	}
	updateSettings(patch: Partial<TimeTravelSettings>, authorize: () => void = () => {}): Promise<TimeTravelSettings> {
		return this.#serial(async () => {
			const settings = settingsValue({ ...(await this.settings()), ...patch });
			authorize();
			await mkdir(dirname(this.#settingsFile), { recursive: true, mode: 0o700 });
			const temporary = `${this.#settingsFile}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, JSON.stringify(settings), { flag: "wx", mode: 0o600 });
				authorize();
				await rename(temporary, this.#settingsFile);
			} finally { await rm(temporary, { force: true }); }
			return settings;
		});
	}
	capture(input: { workspace: string; sessionId: string; leafId: string | null; phase: "before" | "after" }) {
		return this.#serial(async () => {
			const settings = await this.settings();
			if (!settings.enabled) return undefined;
			const snapshot = await this.#store.capture({ ...input, exclusions: settings.exclusions });
			if (settings.retentionDays !== null && Date.now() - this.#lastCleanupAt >= 86_400_000) {
				await this.#store.cleanup(new Date(Date.now() - settings.retentionDays * 86_400_000));
				this.#lastCleanupAt = Date.now();
			}
			return snapshot;
		});
	}
	list(workspace: string, sessionId: string) {
		return this.#serial(async () => {
			if (!(await this.settings()).enabled) throw invalid("Time Travel is disabled");
			return this.#store.list(workspace, sessionId);
		});
	}
	preview(workspace: string, sessionId: string, snapshotId: string) {
		return this.#serial(async () => {
			const settings = await this.settings();
			if (!settings.enabled) throw invalid("Time Travel is disabled");
			return this.#store.preview(workspace, sessionId, snapshotId, settings.exclusions);
		});
	}
	withRestore<T>(action: (store: TimeTravelStore, settings: TimeTravelSettings) => Promise<T>): Promise<T> {
		return this.#serial(async () => {
			const settings = await this.settings();
			if (!settings.enabled) throw invalid("Time Travel is disabled");
			return action(this.#store, settings);
		});
	}
	storage() { return this.#serial(() => this.#store.storage()); }
	cleanup(scope: "expired" | "all", authorize: () => void = () => {}) {
		return this.#serial(async () => {
			const settings = await this.settings();
			authorize();
			if (scope === "expired" && settings.retentionDays === null) return { removed: 0 };
			return this.#store.cleanup(scope === "all" ? null : new Date(Date.now() - settings.retentionDays! * 86_400_000));
		});
	}
}
