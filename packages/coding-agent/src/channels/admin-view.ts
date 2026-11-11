/**
 * `/channels` admin view — instances, targets and bindings for the TUI.
 *
 * The frozen ADR-IM-0007 contract makes `channels.instances`, `imAgents` and
 * `remote.imBindings` the runtime truth. The TUI reads the same `web.yml`, so
 * this module builds a redacted snapshot from the file and the live runtime
 * and renders one page. When the file still has the legacy platform shape the
 * snapshot synthesizes instances with `id = platform` (the documented
 * migration), and says so instead of pretending the file was migrated.
 *
 * No secret (bot token, app secret, peer token) is ever put in the snapshot or
 * the transcript. This module performs no writes of its own.
 */

import { isRecord } from "@linxiraos/pi-utils";

export interface AdminInstance {
	id: string;
	platform: string;
	label: string;
	enabled: boolean;
	running: boolean;
	configured?: boolean;
	state?: string;
	detail?: string;
	lastError?: string;
	agentProfile?: string;
	targetDisplay?: string;
	targetAvailable?: boolean;
	targetReason?: string;
	/** Incremental per-instance step-up / login state, when the host reports it. */
	qrPending?: boolean;
}

export interface AdminBinding {
	instanceId: string;
	chatId: string;
	threadId?: string;
	userId?: string;
	agentProfileId?: string;
	sessionId: string;
	role: "answer" | "observe";
	targetDisplay?: string;
	needsReview?: boolean;
	targetAvailable?: boolean;
	targetReason?: string;
}

export interface AdminTarget {
	key?: string;
	display: string;
	kind: string;
	available: boolean;
	reason?: string;
}

export interface ChannelsAdminSnapshot {
	configPath: string;
	/** Human line for the hosting lock; empty when no host. */
	host: string;
	/** Set when the config is still legacy and the instances are synthesized. */
	legacyNote?: string;
	instances: readonly AdminInstance[];
	bindings: readonly AdminBinding[];
	targets: readonly AdminTarget[];
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** One checked field read; the caller still narrows the value it needs. */
function field(value: unknown, key: string): unknown {
	return isRecord(value) ? value[key] : undefined;
}

/** Contract platform enum; an unknown platform is not an instance. */
const PLATFORMS: Record<string, true> = {
	wechat: true,
	feishu: true,
	telegram: true,
	discord: true,
	qq: true,
};

/** `channels.instances` from an untyped config read, narrowed field by field. */
export function parseAdminInstances(config: unknown): AdminInstance[] | null {
	const channels = field(config, "channels");
	const instances = field(channels, "instances");
	if (!Array.isArray(instances)) return null;
	const rows: AdminInstance[] = [];
	for (const entry of instances) {
		if (!isRecord(entry)) continue;
		const id = text(entry.id);
		const platform = text(entry.platform);
		if (id === undefined || platform === undefined || !Object.hasOwn(PLATFORMS, platform)) continue;
		const agentProfile = text(entry.agentProfile);
		rows.push({
			id,
			platform,
			label: text(entry.label) ?? id,
			enabled: entry.enabled === true,
			running: false,
			...(typeof entry.configured === "boolean" ? { configured: entry.configured } : {}),
			...(agentProfile !== undefined ? { agentProfile } : {}),
		});
	}
	return rows;
}

/** Legacy `channels.<platform>` rows synthesized as instances (migration view). */
export function legacyAdminInstances(config: unknown): AdminInstance[] {
	const channels = field(config, "channels");
	if (!isRecord(channels)) return [];
	const rows: AdminInstance[] = [];
	for (const platform of ["wechat", "feishu", "telegram", "discord", "qq"] as const) {
		const entry = channels[platform];
		if (!isRecord(entry)) continue;
		rows.push({
			id: platform,
			platform,
			label: platform,
			enabled: entry.enabled === true,
			running: false,
		});
	}
	return rows;
}

export function parseAdminBindings(config: unknown): AdminBinding[] | null {
	const bindings = field(field(config, "remote"), "imBindings");
	if (!Array.isArray(bindings)) return null;
	const rows: AdminBinding[] = [];
	for (const entry of bindings) {
		if (!isRecord(entry)) continue;
		const instanceId = text(entry.instanceId);
		const chatId = text(entry.chatId);
		const sessionId = text(entry.sessionId);
		if (instanceId === undefined || chatId === undefined || sessionId === undefined) continue;
		const target = isRecord(entry.target) ? entry.target : undefined;
		const threadId = text(entry.threadId);
		const userId = text(entry.userId);
		const agentProfileId = text(entry.agentProfileId);
		const display = text(target?.display);
		const reason = text(target?.reason);
		rows.push({
			instanceId,
			chatId,
			...(threadId !== undefined ? { threadId } : {}),
			...(userId !== undefined ? { userId } : {}),
			...(agentProfileId !== undefined ? { agentProfileId } : {}),
			sessionId,
			role: entry.role === "observe" ? "observe" : "answer",
			...(display !== undefined ? { targetDisplay: display } : {}),
			...(entry.needsReview === true ? { needsReview: true } : {}),
			...(typeof target?.available === "boolean" ? { targetAvailable: target.available } : {}),
			...(reason !== undefined ? { targetReason: reason } : {}),
		});
	}
	return rows;
}

/** Legacy `remote.sessionMappings`, shown as bindings with an explicit note. */
export function legacyAdminBindings(config: unknown): AdminBinding[] {
	const mappings = field(field(config, "remote"), "sessionMappings");
	if (!Array.isArray(mappings)) return [];
	const rows: AdminBinding[] = [];
	for (const entry of mappings) {
		if (!isRecord(entry)) continue;
		const platform = text(entry.platform);
		const chatId = text(entry.chatId);
		if (platform === undefined || chatId === undefined) continue;
		const targetDisplay = text(entry.workspaceAlias);
		rows.push({
			instanceId: platform,
			chatId,
			sessionId: text(entry.sessionId) ?? "—",
			role: "answer",
			...(targetDisplay !== undefined ? { targetDisplay } : {}),
		});
	}
	return rows;
}

export function parseAdminTargets(agents: unknown): AdminTarget[] {
	const targets = field(agents, "targets");
	if (!Array.isArray(targets)) return [];
	const rows: AdminTarget[] = [];
	for (const entry of targets) {
		if (!isRecord(entry)) continue;
		const key = text(entry.key);
		const display = text(entry.display) ?? key;
		if (display === undefined) continue;
		const reason = text(entry.reason);
		rows.push({
			display,
			kind: text(entry.kind) ?? "unknown",
			available: entry.available !== false,
			...(key !== undefined ? { key } : {}),
			...(reason !== undefined ? { reason } : {}),
		});
	}
	return rows;
}

/** Apply live runtime membership (`id` + `running`) to the snapshot rows. */
export function mergeAdminStatus(
	instances: readonly AdminInstance[],
	live: readonly { id: string; running: boolean }[],
): AdminInstance[] {
	return instances.map(instance => {
		const entry = live.find(status => status.id === instance.id);
		return entry === undefined ? { ...instance, running: false } : { ...instance, running: entry.running };
	});
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value.padEnd(width);
}

/** One redacted TUI page: no token, no app secret, no peer token. */
export function formatChannelsAdmin(snapshot: ChannelsAdminSnapshot, zh = false): string {
	const on = zh ? "启用" : "on";
	const off = zh ? "停用" : "off";
	const running = zh ? "运行" : "run";
	const stopped = zh ? "停止" : "stop";
	const lines = [
		"",
		`${zh ? "IM 运行时" : "IM runtime"} — ${snapshot.configPath}`,
		`  ${snapshot.host}`,
		...(snapshot.legacyNote === undefined ? [] : [`  ! ${snapshot.legacyNote}`]),
		"",
		zh ? "实例" : "INSTANCES",
		`  ${pad("id", 14)}${pad("platform", 10)}${pad("state", 14)}${pad("label", 20)}${zh ? "目标" : "target"}`,
	];
	if (snapshot.instances.length === 0) lines.push(`  ${zh ? "（无）" : "(none)"}`);
	for (const instance of snapshot.instances) {
		const state = [
			instance.enabled ? on : off,
			instance.running ? running : stopped,
			instance.configured === false ? (zh ? "未配置" : "no creds") : "",
			instance.state ?? "",
			instance.lastError ?? instance.detail ?? "",
		]
			.filter(Boolean)
			.join(",");
		const target =
			instance.targetDisplay ??
			(instance.targetAvailable === false ? (instance.targetReason ?? "unavailable") : "—");
		lines.push(
			`  ${pad(instance.id, 14)}${pad(instance.platform, 10)}${pad(state, 14)}${pad(instance.label, 20)}${target}`,
		);
	}
	lines.push("", zh ? "绑定" : "BINDINGS");
	if (snapshot.bindings.length === 0) lines.push(`  ${zh ? "（无）" : "(none)"}`);
	for (const binding of snapshot.bindings) {
		const review =
			binding.needsReview === true
				? ` !${zh ? "待复核" : "needs-review"}`
				: binding.targetAvailable === false
					? ` !${binding.targetReason ?? "target-unavailable"}`
					: "";
		lines.push(
			`  ${pad(binding.instanceId, 14)}${pad(binding.chatId, 18)}${pad(binding.role, 8)}${pad(binding.agentProfileId ?? "—", 16)}${pad(binding.sessionId, 16)}${binding.targetDisplay ?? "—"}${review}`,
		);
	}
	if (snapshot.targets.length > 0) {
		lines.push("", zh ? "可用目标" : "TARGETS");
		for (const target of snapshot.targets) {
			lines.push(
				`  ${pad(target.kind, 10)}${pad(target.display, 28)}${target.available ? "ok" : `unavailable: ${target.reason ?? "?"}`}`,
			);
		}
	}
	lines.push(
		"",
		zh
			? "秘密只写不读：TUI 不接收 token/secret，请用 Studio 或 CLI 登录。"
			: "Secrets are write-only: the TUI never accepts a token/secret; pair from Studio or the CLI.",
		"",
	);
	return lines.join("\n");
}
