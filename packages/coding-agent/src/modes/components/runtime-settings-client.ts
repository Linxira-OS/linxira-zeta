import { randomBytes } from "node:crypto";
import { VERSION, ZETA_WEB_PORT } from "@linxiraos/pi-utils";
import {
	targetKey,
	validateChannelInstances,
	validateImAgentProfiles,
	validateImBindings,
	type ChannelInstanceConfig,
	type ImAgentProfile,
	type ImBinding,
} from "../../channels/im-config";
import { discoverServeInstance } from "../../server/serve-registry";
import type { TwoFactorStatus, EnrollmentResult } from "../../server/auth/two-factor-store";

export interface RuntimeConversation {
	id: string;
	name: string;
	attached: boolean;
	available: boolean;
	reason?: string;
	targetKey?: string;
	targetDisplay: string;
	agentProfileId?: string;
	model?: { provider: string; model: string };
	entrances: number;
}
export interface RuntimeDevice {
	id: string;
	label: string;
	scopes: string[];
	revoked: boolean;
}
export interface ImRuntimeSnapshot {
	instances: ChannelInstanceConfig[];
	profiles: ImAgentProfile[];
	bindings: ImBinding[];
	conversations: RuntimeConversation[];
	statuses: Record<string, unknown>[];
}
export interface BindingDraft {
	id?: string;
	instanceId: string;
	chatId: string;
	threadId: string;
	userId: string;
	agentProfileId: string;
	conversationId: string;
	role: ImBinding["role"];
	lang?: ImBinding["lang"];
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed gateway response");
	return value as Record<string, unknown>;
}
function string(value: unknown): string {
	if (typeof value !== "string") throw new Error("Malformed gateway response");
	return value;
}
function rows(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new Error("Malformed gateway response");
	return value.map(record);
}
function strings(value: unknown): string[] {
	if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === "string"))
		throw new Error("Malformed gateway response");
	return value;
}
function conversation(value: unknown): RuntimeConversation {
	const row = record(value);
	const model = row.model === undefined ? undefined : record(row.model);
	return {
		id: string(row.id),
		name: string(row.name),
		attached: row.attached === true,
		available: row.available === true,
		targetDisplay: string(row.targetDisplay),
		entrances: typeof row.entrances === "number" ? row.entrances : 0,
		...(typeof row.reason === "string" ? { reason: row.reason } : {}),
		...(typeof row.targetKey === "string" ? { targetKey: row.targetKey } : {}),
		...(typeof row.agentProfileId === "string" ? { agentProfileId: row.agentProfileId } : {}),
		...(model ? { model: { provider: string(model.provider), model: string(model.model) } } : {}),
	};
}

/** Local client only: the live serve remains the sole runtime/config/auth authority. */
export class RuntimeSettingsClient {
	#connection: Promise<string> | undefined;
	readonly #abort = new AbortController();
	constructor(private readonly options: { baseUrl?: string; fetchImpl?: typeof fetch; registryFile?: string } = {}) {}

	dispose(): void {
		this.#abort.abort();
		this.#connection = undefined;
	}

	async #origin(): Promise<string> {
		this.#connection ??= (async () => {
			const discovery = await discoverServeInstance({
				targetUrl: this.options.baseUrl ?? `http://127.0.0.1:${ZETA_WEB_PORT}`,
				...(this.options.registryFile ? { registryFile: this.options.registryFile } : {}),
				fetchImpl: this.options.fetchImpl ?? fetch,
			});
			if (!discovery.identity || !discovery.probedUrl)
				throw new Error("Start zetacode serve, then retry / 请先启动 zetacode serve 后重试");
			if (discovery.identity.version !== VERSION)
				throw new Error(
					`Serve version ${discovery.identity.version}; CLI ${VERSION}. Restart serve / 请重启 serve`,
				);
			const url = new URL(discovery.probedUrl);
			if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Local serve required");
			return url.origin;
		})().catch(error => {
			this.#connection = undefined;
			throw error;
		});
		return this.#connection;
	}

	async request(path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
		const origin = await this.#origin();
		const response = await (this.options.fetchImpl ?? fetch)(`${origin}${path}`, {
			method,
			redirect: "error",
			cache: "no-store",
			signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(15_000)]),
			...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
		});
		const payload = record(await response.json());
		if (!response.ok) {
			const reason =
				typeof payload.error === "string"
					? payload.error.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400)
					: "Gateway request failed";
			throw new Error(`HTTP ${response.status}: ${reason}`);
		}
		return payload;
	}

	async twoFactorStatus(): Promise<TwoFactorStatus> {
		const row = await this.request("/api/auth/2fa");
		if (
			typeof row.enrolled !== "boolean" ||
			typeof row.required !== "boolean" ||
			typeof row.pending !== "boolean" ||
			typeof row.recoveryCodesRemaining !== "number"
		)
			throw new Error("Malformed 2FA status");
		return {
			enrolled: row.enrolled,
			required: row.required,
			pending: row.pending,
			enrolledAt: typeof row.enrolledAt === "string" ? row.enrolledAt : null,
			recoveryCodesRemaining: row.recoveryCodesRemaining,
		};
	}
	async enroll(): Promise<EnrollmentResult> {
		const row = await this.request("/api/auth/2fa/enroll", "POST");
		return {
			secret: string(row.secret),
			otpauthUrl: string(row.otpauthUrl),
			recoveryCodes: strings(row.recoveryCodes),
			expiresAt: string(row.expiresAt),
		};
	}
	async recovery(code: string): Promise<string[]> {
		return strings(
			(await this.request("/api/auth/2fa/recovery/regenerate", "POST", this.credential(code))).recoveryCodes,
		);
	}
	credential(code: string): { code: string } | { recoveryCode: string } {
		const value = code.trim();
		return /^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value };
	}
	async pairing(): Promise<{ payload: string; code: string; expiresAt: string | null }> {
		const row = await this.request("/api/remote/pairing");
		return {
			payload: string(row.payload),
			code: string(row.code),
			expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
		};
	}
	async devices(): Promise<RuntimeDevice[]> {
		return rows((await this.request("/api/remote/devices")).devices).map(row => ({
			id: string(row.id),
			label: typeof row.name === "string" ? row.name : typeof row.label === "string" ? row.label : string(row.id),
			scopes: strings(row.scopes),
			revoked: row.revoked === true || typeof row.revokedAt === "string",
		}));
	}

	async im(): Promise<ImRuntimeSnapshot> {
		const [instances, profiles, bindings, conversations, status] = await Promise.all([
			this.request("/api/channels/instances"),
			this.request("/api/im/agents"),
			this.request("/api/im/bindings"),
			this.request("/api/im/conversations"),
			this.request("/api/channels/status"),
		]);
		const parsedProfiles = validateImAgentProfiles(profiles.profiles);
		const parsedInstances = validateChannelInstances(instances.instances, parsedProfiles);
		return {
			instances: parsedInstances,
			profiles: parsedProfiles,
			bindings: validateImBindings(bindings.bindings, parsedInstances, parsedProfiles),
			conversations: rows(conversations.conversations).map(conversation),
			statuses: rows(status.instances),
		};
	}
	async saveInstance(instance: ChannelInstanceConfig): Promise<void> {
		const current = rows((await this.request("/api/channels/instances")).instances);
		const stored = current.find(row => row.id === instance.id);
		const updated = {
			...instance,
			credentials: stored?.credentials ?? {},
			...(stored?.options ? { options: stored.options } : {}),
		};
		await this.request("/api/channels/instances", "PUT", {
			instances: [...current.filter(row => row.id !== instance.id), updated],
		});
	}
	async saveProfile(profile: ImAgentProfile): Promise<void> {
		const current = validateImAgentProfiles((await this.request("/api/im/agents")).profiles);
		await this.request("/api/im/agents", "PUT", {
			profiles: [...current.filter(row => row.id !== profile.id), profile],
		});
	}
	async saveBinding(draft: BindingDraft): Promise<void> {
		const snapshot = await this.im();
		const instance = snapshot.instances.find(row => row.id === draft.instanceId);
		let selected = snapshot.conversations.find(row => row.id === draft.conversationId);
		if (!instance || !selected || !selected.available)
			throw new Error(selected?.reason ?? "Select an available existing conversation / 请选择可用的已有会话");
		const profile = snapshot.profiles.find(row => row.id === draft.agentProfileId);
		if (!profile) throw new Error("Unknown Agent Profile");
		if (selected.agentProfileId && selected.agentProfileId !== profile.id)
			throw new Error("Conversation locks its Agent Profile / 会话已锁定 Agent Profile");
		if (selected.targetKey !== targetKey(profile.location))
			throw new Error("Conversation and profile targets differ / 会话与 Profile 目标不一致");
		const existing = snapshot.bindings.find(row => row.id === draft.id);
		if (draft.id && !existing) throw new Error("Binding removed; reload before editing / 绑定已删除，请刷新");
		const binding: ImBinding = {
			id: existing?.id ?? `b_${randomBytes(8).toString("hex")}`,
			instanceId: instance.id,
			platform: instance.platform,
			chatId: draft.chatId.trim(),
			...(draft.threadId.trim() ? { threadId: draft.threadId.trim() } : {}),
			...(draft.userId.trim() ? { userId: draft.userId.trim() } : {}),
			agentProfileId: profile.id,
			sessionId: selected.id,
			target: profile.location,
			role: draft.role,
			...(draft.lang ? { lang: draft.lang } : {}),
			...(selected.model
				? { model: selected.model }
				: existing?.model && existing.sessionId === selected.id
					? { model: existing.model }
					: {}),
			createdAt: existing?.createdAt ?? new Date().toISOString(),
		};
		validateImBindings(
			[...snapshot.bindings.filter(row => row.id !== binding.id), binding],
			snapshot.instances,
			snapshot.profiles,
		);
		if (!selected.attached)
			selected = conversation(
				(await this.request("/api/im/conversations/attach", "POST", { sessionId: selected.id })).conversation,
			);
		binding.sessionId = selected.id;
		if (selected.model) binding.model = selected.model;
		await this.request("/api/im/bindings", "PUT", {
			bindings: [...snapshot.bindings.filter(row => row.id !== binding.id), binding],
		});
	}
	async unbind(id: string): Promise<void> {
		const snapshot = await this.im();
		await this.request("/api/im/bindings", "PUT", { bindings: snapshot.bindings.filter(row => row.id !== id) });
	}
}
