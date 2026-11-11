/**
 * IM instance / agent-profile / binding schema (ADR-IM-0007).
 *
 * This module owns the persisted shapes and their validation. `web-config.ts`
 * stores them; the runtime and gateway consume them. There is no legacy
 * runtime shape: the loader migrates the old `channels.<platform>` /
 * `remote.sessionMappings` form once and removes it.
 */

import * as path from "node:path";

export type ChannelPlatform = "wechat" | "feishu" | "telegram" | "discord" | "qq";

export interface WeChatCredentials {
	botToken?: string;
	ilinkBotId?: string;
	ilinkUserId?: string;
	baseUrl?: string;
	endpoint?: string;
}
export interface FeishuCredentials {
	appId?: string;
	appSecret?: string;
	domain?: "feishu" | "lark";
}
export interface TelegramCredentials {
	botToken?: string;
}
export interface DiscordCredentials {
	botToken?: string;
	allowedChannels?: string[];
	allowedUsers?: string[];
}
export interface QqCredentials {
	endpoint?: string;
	token?: string;
	mode?: "forward" | "reverse";
	port?: number;
	selfId?: string;
	allowedGroups?: string[];
	allowedUsers?: string[];
}

export type ChannelCredentials =
	| WeChatCredentials
	| FeishuCredentials
	| TelegramCredentials
	| DiscordCredentials
	| QqCredentials;

export interface ChannelInstanceConfig {
	id: string;
	platform: ChannelPlatform;
	label: string;
	note?: string;
	enabled: boolean;
	agentProfile: string;
	allow: { peers: string[]; users?: string[] };
	credentials: Record<string, unknown>;
	options?: { peerTokens?: Record<string, string> };
}

export type ImTarget =
	| { kind: "workspace"; workspace: "main" | string }
	| { kind: "team-pm"; team: string; pm: string }
	| { kind: "engineer"; team: string; pm: string; engineer: string; repo?: string };

export type ImAgentPreset = "companion" | "read-only-chat" | "roleplay" | "team-pm" | "engineer";

export interface ImAgentTools {
	preset?: ImAgentPreset;
	builtin: string[];
	extensions: string[];
	customTools: string[];
	mcpServers: string[];
	skills: string[];
	commands: string[];
	approvalMode?: "always-ask" | "write" | "yolo";
}

export interface ImAgentProfile {
	id: string;
	label: string;
	persona: { mode: "file" | "inline" | "workspace"; file?: string; text?: string };
	model?: { provider: string; model: string };
	location: ImTarget;
	tools: ImAgentTools;
	memory: {
		backend?: "off" | "local" | "hindsight" | "mnemopi" | "sharpshooter";
		namespace?: string;
		workspaceContext?: boolean;
	};
}

export type ImBindingRole = "answer" | "mention" | "observe";

export interface ImBinding {
	id: string;
	instanceId: string;
	platform: ChannelPlatform;
	chatId: string;
	threadId?: string;
	userId?: string;
	agentProfileId: string;
	sessionId: string;
	target: ImTarget;
	role: ImBindingRole;
	lang?: "zh" | "en";
	model?: { provider: string; model: string };
	createdAt: string;
	needsReview?: boolean;
	needsReviewReason?: string;
}

export const CHANNEL_PLATFORMS: readonly ChannelPlatform[] = ["wechat", "feishu", "telegram", "discord", "qq"];
export const IM_AGENT_PRESETS: readonly ImAgentPreset[] = [
	"companion",
	"read-only-chat",
	"roleplay",
	"team-pm",
	"engineer",
];
export const INSTANCE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export interface ConfigIssue {
	path: string;
	message: string;
}

export class ImConfigError extends Error {
	readonly issues: ConfigIssue[];
	constructor(issues: ConfigIssue[]) {
		super(issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
		this.name = "ImConfigError";
		this.issues = issues;
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function strings(value: unknown, pathName: string, issues: ConfigIssue[], options: { optional?: boolean } = {}): string[] {
	if (value === undefined && options.optional) return [];
	if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
		issues.push({ path: pathName, message: "expected an array of strings" });
		return [];
	}
	return value as string[];
}
function isPlatform(value: unknown): value is ChannelPlatform {
	return typeof value === "string" && (CHANNEL_PLATFORMS as readonly string[]).includes(value);
}
function isPreset(value: unknown): value is ImAgentPreset {
	return typeof value === "string" && (IM_AGENT_PRESETS as readonly string[]).includes(value);
}

export function credentialFields(platform: ChannelPlatform): string[] {
	switch (platform) {
		case "wechat":
			return ["botToken", "ilinkBotId", "ilinkUserId", "baseUrl", "endpoint"];
		case "feishu":
			return ["appId", "appSecret", "domain"];
		case "telegram":
			return ["botToken"];
		case "discord":
			return ["botToken", "allowedChannels", "allowedUsers"];
		case "qq":
			return ["endpoint", "token", "mode", "port", "selfId", "allowedGroups", "allowedUsers"];
	}
}

function validateTarget(value: unknown, pathName: string, issues: ConfigIssue[]): ImTarget | undefined {
	const rec = record(value);
	if (!rec) {
		issues.push({ path: pathName, message: "expected a target object" });
		return undefined;
	}
	const kind = text(rec.kind);
	if (kind === "workspace") {
		const workspace = text(rec.workspace);
		if (!workspace) issues.push({ path: `${pathName}.workspace`, message: "workspace is required" });
		return workspace ? { kind, workspace } : undefined;
	}
	if (kind === "team-pm") {
		const team = text(rec.team);
		const pm = text(rec.pm);
		if (!team) issues.push({ path: `${pathName}.team`, message: "team is required" });
		if (!pm) issues.push({ path: `${pathName}.pm`, message: "pm is required" });
		return team && pm ? { kind, team, pm } : undefined;
	}
	if (kind === "engineer") {
		const team = text(rec.team);
		const pm = text(rec.pm);
		const engineer = text(rec.engineer);
		const repo = text(rec.repo) ?? undefined;
		if (!team) issues.push({ path: `${pathName}.team`, message: "team is required" });
		if (!pm) issues.push({ path: `${pathName}.pm`, message: "pm is required" });
		if (!engineer) issues.push({ path: `${pathName}.engineer`, message: "engineer is required" });
		return team && pm && engineer ? { kind, team, pm, engineer, ...(repo ? { repo } : {}) } : undefined;
	}
	issues.push({ path: `${pathName}.kind`, message: 'expected "workspace", "team-pm" or "engineer"' });
	return undefined;
}

export function validateImAgentProfiles(value: unknown): ImAgentProfile[] {
	const issues: ConfigIssue[] = [];
	if (!Array.isArray(value)) throw new ImConfigError([{ path: "imAgents", message: "expected an array" }]);
	const ids = new Set<string>();
	const profiles: ImAgentProfile[] = [];
	for (const [index, entry] of value.entries()) {
		const p = `imAgents[${index}]`;
		const rec = record(entry);
		if (!rec) {
			issues.push({ path: p, message: "expected an object" });
			continue;
		}
		const id = text(rec.id);
		if (!id || !INSTANCE_ID_RE.test(id)) issues.push({ path: `${p}.id`, message: "invalid id" });
		else if (ids.has(id)) issues.push({ path: `${p}.id`, message: `duplicate id ${id}` });
		else ids.add(id);
		const label = text(rec.label);
		if (!label) issues.push({ path: `${p}.label`, message: "label is required" });
		const personaRec = record(rec.persona) ?? {};
		const personaMode = text(personaRec.mode) ?? "workspace";
		if (personaMode !== "file" && personaMode !== "inline" && personaMode !== "workspace") {
			issues.push({ path: `${p}.persona.mode`, message: 'expected "file", "inline" or "workspace"' });
		}
		const persona = {
			mode: personaMode as "file" | "inline" | "workspace",
			...(text(personaRec.file) ? { file: text(personaRec.file)! } : {}),
			...(text(personaRec.text) ? { text: text(personaRec.text)! } : {}),
		};
		const location = validateTarget(rec.location, `${p}.location`, issues);
		const toolsRec = record(rec.tools) ?? {};
		const preset = toolsRec.preset;
		if (preset !== undefined && !isPreset(preset)) issues.push({ path: `${p}.tools.preset`, message: "unknown preset" });
		const tools: ImAgentTools = {
			...(preset !== undefined ? { preset: preset as ImAgentPreset } : {}),
			builtin: strings(toolsRec.builtin, `${p}.tools.builtin`, issues),
			extensions: strings(toolsRec.extensions, `${p}.tools.extensions`, issues),
			customTools: strings(toolsRec.customTools, `${p}.tools.customTools`, issues),
			mcpServers: strings(toolsRec.mcpServers, `${p}.tools.mcpServers`, issues),
			skills: strings(toolsRec.skills, `${p}.tools.skills`, issues),
			commands: strings(toolsRec.commands, `${p}.tools.commands`, issues),
			...(toolsRec.approvalMode === "always-ask" ||
			toolsRec.approvalMode === "write" ||
			toolsRec.approvalMode === "yolo"
				? { approvalMode: toolsRec.approvalMode }
				: {}),
		};
		const memRec = record(rec.memory) ?? {};
		const backend = text(memRec.backend);
		if (
			backend !== undefined &&
			!["off", "local", "hindsight", "mnemopi", "sharpshooter"].includes(backend)
		) {
			issues.push({ path: `${p}.memory.backend`, message: "unknown backend" });
		}
		if (id && label && location) {
			profiles.push({
				id,
				label,
				persona,
				...(record(rec.model) ? { model: rec.model as { provider: string; model: string } } : {}),
				location,
				tools,
				memory: {
					...(backend ? { backend: backend as ImAgentProfile["memory"]["backend"] } : {}),
					...(text(memRec.namespace) ? { namespace: text(memRec.namespace)! } : {}),
					...(typeof memRec.workspaceContext === "boolean"
						? { workspaceContext: memRec.workspaceContext }
						: {}),
				},
			});
		}
	}
	if (issues.length > 0) throw new ImConfigError(issues);
	return profiles;
}

export function validateChannelInstances(value: unknown, profiles: readonly ImAgentProfile[]): ChannelInstanceConfig[] {
	const issues: ConfigIssue[] = [];
	if (!Array.isArray(value)) throw new ImConfigError([{ path: "channels.instances", message: "expected an array" }]);
	const ids = new Set<string>();
	const profileIds = new Set(profiles.map(profile => profile.id));
	const instances: ChannelInstanceConfig[] = [];
	for (const [index, entry] of value.entries()) {
		const p = `channels.instances[${index}]`;
		const rec = record(entry);
		if (!rec) {
			issues.push({ path: p, message: "expected an object" });
			continue;
		}
		const id = text(rec.id);
		if (!id || !INSTANCE_ID_RE.test(id)) issues.push({ path: `${p}.id`, message: "invalid id" });
		else if (ids.has(id)) issues.push({ path: `${p}.id`, message: `duplicate id ${id}` });
		else ids.add(id);
		if (!isPlatform(rec.platform)) issues.push({ path: `${p}.platform`, message: "unknown platform" });
		const label = text(rec.label);
		if (!label) issues.push({ path: `${p}.label`, message: "label is required" });
		const agentProfile = text(rec.agentProfile);
		if (!agentProfile) issues.push({ path: `${p}.agentProfile`, message: "agentProfile is required" });
		else if (!profileIds.has(agentProfile)) {
			issues.push({ path: `${p}.agentProfile`, message: `unknown profile ${agentProfile}` });
		}
		const allowRec = record(rec.allow) ?? {};
		const peers = strings(allowRec.peers, `${p}.allow.peers`, issues);
		if (peers.length === 0) issues.push({ path: `${p}.allow.peers`, message: "must not be empty (deny-by-default)" });
		const users = strings(allowRec.users, `${p}.allow.users`, issues, { optional: true });
		const credentials = record(rec.credentials) ?? {};
		const optionsRec = record(rec.options);
		if (id && isPlatform(rec.platform) && label && agentProfile && profileIds.has(agentProfile)) {
			instances.push({
				id,
				platform: rec.platform,
				label,
				...(text(rec.note) ? { note: text(rec.note)! } : {}),
				enabled: rec.enabled === true,
				agentProfile,
				allow: { peers, ...(users.length > 0 ? { users } : {}) },
				credentials,
				...(optionsRec && record(optionsRec.peerTokens)
					? { options: { peerTokens: optionsRec.peerTokens as Record<string, string> } }
					: {}),
			});
		}
	}
	if (issues.length > 0) throw new ImConfigError(issues);
	return instances;
}

export function validateImBindings(
	value: unknown,
	instances: readonly ChannelInstanceConfig[],
	profiles: readonly ImAgentProfile[],
): ImBinding[] {
	const issues: ConfigIssue[] = [];
	if (!Array.isArray(value)) throw new ImConfigError([{ path: "remote.imBindings", message: "expected an array" }]);
	const instanceById = new Map(instances.map(instance => [instance.id, instance]));
	const profileIds = new Set(profiles.map(profile => profile.id));
	const keys = new Set<string>();
	const sessions = new Set<string>();
	const answers = new Set<string>();
	const bindings: ImBinding[] = [];
	for (const [index, entry] of value.entries()) {
		const p = `remote.imBindings[${index}]`;
		const rec = record(entry);
		if (!rec) {
			issues.push({ path: p, message: "expected an object" });
			continue;
		}
		const id = text(rec.id);
		const instanceId = text(rec.instanceId);
		const instance = instanceId ? instanceById.get(instanceId) : undefined;
		if (!id) issues.push({ path: `${p}.id`, message: "id is required" });
		if (!instance) issues.push({ path: `${p}.instanceId`, message: "unknown instance" });
		const chatId = text(rec.chatId);
		if (!chatId) issues.push({ path: `${p}.chatId`, message: "chatId is required" });
		const profileId = text(rec.agentProfileId);
		if (!profileId || !profileIds.has(profileId)) issues.push({ path: `${p}.agentProfileId`, message: "unknown profile" });
		const sessionId = text(rec.sessionId);
		if (!sessionId) issues.push({ path: `${p}.sessionId`, message: "sessionId is required" });
		else if (sessions.has(sessionId)) issues.push({ path: `${p}.sessionId`, message: "sessionId must be unique" });
		else sessions.add(sessionId);
		const role = rec.role === "mention" || rec.role === "observe" ? rec.role : "answer";
		if (instance && chatId) {
			const key = `${instanceId}\u0000${chatId}\u0000${text(rec.threadId) ?? ""}\u0000${text(rec.userId) ?? ""}`;
			if (keys.has(key)) issues.push({ path: p, message: "duplicate instance/chat binding" });
			keys.add(key);
			if (role === "answer") {
				const answerKey = `${instance.platform}\u0000${chatId}`;
				if (answers.has(answerKey)) {
					issues.push({ path: `${p}.role`, message: "another instance already answers this chat; use mention/observe" });
				}
				answers.add(answerKey);
			}
		}
		const target = validateTarget(rec.target, `${p}.target`, issues);
		if (id && instance && chatId && profileId && sessionId && target) {
			bindings.push({
				id,
				instanceId: instance.id,
				platform: instance.platform,
				chatId,
				...(text(rec.threadId) ? { threadId: text(rec.threadId)! } : {}),
				...(text(rec.userId) ? { userId: text(rec.userId)! } : {}),
				agentProfileId: profileId,
				sessionId,
				target,
				role,
				...(rec.lang === "zh" || rec.lang === "en" ? { lang: rec.lang } : {}),
				...(record(rec.model) ? { model: rec.model as { provider: string; model: string } } : {}),
				createdAt: text(rec.createdAt) ?? new Date().toISOString(),
				...(rec.needsReview === true ? { needsReview: true } : {}),
				...(text(rec.needsReviewReason) ? { needsReviewReason: text(rec.needsReviewReason)! } : {}),
			});
		}
	}
	if (issues.length > 0) throw new ImConfigError(issues);
	return bindings;
}

export function bindingKey(binding: Pick<ImBinding, "instanceId" | "chatId" | "threadId" | "userId">): string {
	return [binding.instanceId, binding.chatId, binding.threadId ?? "", binding.userId ?? ""].join("\u0000");
}

/** Default runtime id: binding-scoped, never shared between two chats. */
export function imAgentRuntimeId(instanceId: string, profileId: string, bindingId: string): string {
	return `im:${instanceId}:${profileId}:${bindingId}`;
}

export function defaultMemoryNamespace(instanceId: string, profileId: string, bindingId: string): string {
	return imAgentRuntimeId(instanceId, profileId, bindingId);
}

export function defaultAgentHome(agentDir: string, runtimeId: string): string {
	return path.join(agentDir, "im-agents", runtimeId.replace(/[:/\\]/g, "-"));
}

/** A target that cannot be resolved must fail, never fall back to relay. */
export function targetKey(target: ImTarget): string {
	switch (target.kind) {
		case "workspace":
			return `workspace:${target.workspace}`;
		case "team-pm":
			return `team-pm:${target.team}/${target.pm}`;
		case "engineer":
			return `engineer:${target.team}/${target.pm}/${target.engineer}${target.repo ? `/${target.repo}` : ""}`;
	}
}
