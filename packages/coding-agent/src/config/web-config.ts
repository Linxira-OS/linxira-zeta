/**
 * WebConfig — standalone configuration for the Zeta web/desktop layer
 * (`~/.zeta/agent/web.yml`).
 *
 * Deliberately independent from the CLI `Settings` singleton: this file holds
 * tray/autostart behavior, IM channel credentials, and remote-access state
 * that only the web/desktop runtime consumes. `zeta serve` and the desktop
 * shell read and write it; CLI-only sessions never touch it. Not shipped in
 * the npm package.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@linxiraos/pi-utils";
import { YAML } from "bun";

export const WEB_CONFIG_FILENAME = "web.yml";

export interface WebConfigChannelBase {
	enabled: boolean;
}

export interface WeChatChannelConfig extends WebConfigChannelBase {
	botToken?: string;
	ilinkBotId?: string;
	ilinkUserId?: string;
	baseUrl?: string;
}

export interface FeishuChannelConfig extends WebConfigChannelBase {
	appId?: string;
	appSecret?: string;
	domain?: "feishu" | "lark";
}

export interface TelegramChannelConfig extends WebConfigChannelBase {
	botToken?: string;
}

export interface WebConfigData {
	tray: {
		minimizeToTray: boolean;
		autostart: boolean;
	};
	channels: {
		wechat: WeChatChannelConfig;
		feishu: FeishuChannelConfig;
		telegram: TelegramChannelConfig;
	};
	remote: {
		host?: string;
		token?: string;
		/** Registered remote workspaces (absolute paths). */
		workspaces?: string[];
	};
}

const DEFAULT_DATA: WebConfigData = {
	tray: { minimizeToTray: true, autostart: false },
	channels: {
		wechat: { enabled: false },
		feishu: { enabled: false },
		telegram: { enabled: false },
	},
	remote: {},
};

/** Paths that must never be revealed through the gateway; masked as "••••". */
const SECRET_PATHS: Record<string, true> = {
	"channels.wechat.botToken": true,
	"channels.feishu.appSecret": true,
	"channels.telegram.botToken": true,
	"remote.token": true,
};

type LeafType = "boolean" | "string" | "domain" | "strings";

/** Known dot paths → expected leaf type (for PUT validation). */
const KNOWN_PATHS: Record<string, LeafType> = {
	"tray.minimizeToTray": "boolean",
	"tray.autostart": "boolean",
	"channels.wechat.enabled": "boolean",
	"channels.wechat.botToken": "string",
	"channels.wechat.ilinkBotId": "string",
	"channels.wechat.ilinkUserId": "string",
	"channels.wechat.baseUrl": "string",
	"channels.feishu.enabled": "boolean",
	"channels.feishu.appId": "string",
	"channels.feishu.appSecret": "string",
	"channels.feishu.domain": "domain",
	"channels.telegram.enabled": "boolean",
	"channels.telegram.botToken": "string",
	"remote.host": "string",
	"remote.token": "string",
	"remote.workspaces": "strings",
};

export function isKnownWebConfigPath(value: unknown): value is string {
	return typeof value === "string" && value in KNOWN_PATHS;
}

function validateValue(leafType: LeafType, value: unknown): void {
	switch (leafType) {
		case "boolean":
			if (typeof value !== "boolean") throw new Error("Expected a boolean value");
			return;
		case "string":
			if (typeof value !== "string") throw new Error("Expected a string value");
			return;
		case "domain":
			if (value !== "feishu" && value !== "lark") throw new Error('Expected "feishu" or "lark"');
			return;
		case "strings":
			if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
				throw new Error("Expected an array of strings");
			}
			return;
	}
}

function setByPath(obj: Record<string, unknown>, segments: readonly string[], value: unknown): void {
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		const segment = segments[i];
		const next = current[segment];
		if (typeof next !== "object" || next === null || Array.isArray(next)) {
			current[segment] = {};
		}
		current = current[segment] as Record<string, unknown>;
	}
	current[segments[segments.length - 1]] = value;
}

function deepMerge(base: WebConfigData, overlay: unknown): WebConfigData {
	if (typeof overlay !== "object" || overlay === null || Array.isArray(overlay)) return base;
	const result = structuredClone(base);
	const source = overlay as Record<string, unknown>;
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined) continue;
		const target = (result as unknown as Record<string, unknown>)[key];
		if (
			typeof target === "object" &&
			target !== null &&
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			(result as unknown as Record<string, unknown>)[key] = deepMerge(target as unknown as WebConfigData, value);
		} else {
			(result as unknown as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

/**
 * Loads and persists `~/.zeta/agent/web.yml`. A fresh instance per request —
 * like `Settings.loadIsolated` — so concurrent gateway callers never share a
 * stale in-memory copy.
 */
export class WebConfig {
	readonly #filePath: string;
	#data: WebConfigData;

	private constructor(filePath: string, data: WebConfigData) {
		this.#filePath = filePath;
		this.#data = data;
	}

	/** Default file location: `~/.zeta/agent/web.yml`. */
	static defaultPath(): string {
		return path.join(getAgentDir(), WEB_CONFIG_FILENAME);
	}

	/** Load from disk, deep-merging defaults; a missing/corrupt file falls back to defaults. */
	static async load(filePath = WebConfig.defaultPath()): Promise<WebConfig> {
		let raw: unknown = {};
		try {
			const content = await Bun.file(filePath).text();
			const parsed = YAML.parse(content) as unknown;
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				raw = parsed;
			} else {
				logger.warn("Ignoring non-object web.yml", { filePath });
			}
		} catch (err) {
			if (!isEnoent(err)) {
				logger.warn("Failed to read web.yml; using defaults", {
					filePath,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
		return new WebConfig(filePath, deepMerge(DEFAULT_DATA, raw));
	}

	get path(): string {
		return this.#filePath;
	}

	/** Deep copy of the merged data (safe for callers that mutate the result). */
	getData(): WebConfigData {
		return structuredClone(this.#data);
	}

	/** Merged data with every secret path masked. */
	getMasked(): WebConfigData {
		const masked = this.getData();
		for (const secretPath of Object.keys(SECRET_PATHS)) {
			const segments = secretPath.split(".");
			let current: Record<string, unknown> = masked as unknown as Record<string, unknown>;
			let reached = true;
			for (let i = 0; i < segments.length - 1; i++) {
				const segment = segments[i];
				if (typeof current[segment] !== "object" || current[segment] === null) {
					reached = false;
					break;
				}
				current = current[segment] as Record<string, unknown>;
			}
			if (reached) {
				const leaf = segments[segments.length - 1];
				if (typeof current[leaf] === "string" && current[leaf] !== "") {
					current[leaf] = "••••";
				}
			}
		}
		return masked;
	}

	/** Set one known dot path (e.g. `channels.wechat.enabled`) and persist. */
	async set(pathToSet: string, value: unknown): Promise<void> {
		const leafType = KNOWN_PATHS[pathToSet];
		if (leafType === undefined) throw new Error(`Unknown web config path: ${pathToSet}`);
		validateValue(leafType, value);
		setByPath(this.#data as unknown as Record<string, unknown>, pathToSet.split("."), value);
		await this.#write();
	}

	/** Replace the whole workspace list and persist. */
	async setWorkspaces(workspaces: string[]): Promise<void> {
		if (workspaces.some(item => typeof item !== "string")) throw new Error("Expected an array of strings");
		this.#data.remote.workspaces = [...workspaces];
		await this.#write();
	}

	/** Re-read the file from disk, discarding in-memory changes. */
	async reload(): Promise<void> {
		const fresh = await WebConfig.load(this.#filePath);
		this.#data = fresh.#data;
	}

	async #write(): Promise<void> {
		const dir = path.dirname(this.#filePath);
		await fs.promises.mkdir(dir, { recursive: true });
		const tempPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
		let removeTemp = false;
		try {
			const handle = await fs.promises.open(tempPath, "wx", 0o600);
			removeTemp = true;
			try {
				await handle.writeFile(YAML.stringify(this.#data, null, 2), "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await fs.promises.rename(tempPath, this.#filePath);
			removeTemp = false;
		} finally {
			if (removeTemp) {
				await fs.promises.rm(tempPath, { force: true }).catch(() => {});
			}
		}
	}
}
