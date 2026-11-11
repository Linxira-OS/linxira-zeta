/**
 * IM instance / agent-profile / binding gateway routes (ADR-IM-0007).
 *
 * These are the stable API for the Studio IM page. They read/write the same
 * `web.yml` the runtime uses; no second store and no platform-wide credential
 * path.
 */

import { logger } from "@linxiraos/pi-utils";
import {
	getChannelStatus,
	getPendingWechatQr,
	triggerRestartChannels,
	triggerWechatReconnect,
	triggerWechatUnbind,
} from "../../channels";
import type { ChannelInstanceConfig, ImAgentProfile, ImBinding, ImTarget } from "../../channels/im-config";
import { bindingKey, credentialFields, targetKey } from "../../channels/im-config";
import { runCredentialLogin } from "../../channels/credential-login";
import { WebConfig } from "../../config/web-config";
import { resolveTeamDbPath, TeamDb } from "../../team/db";
import { imAgentRuntimeId } from "../../agent-profile";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
	try {
		const body = (await req.json()) as unknown;
		return typeof body === "object" && body !== null && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function maskedInstances(instances: readonly ChannelInstanceConfig[]): unknown[] {
	return instances.map(instance => ({
		...instance,
		credentials: Object.fromEntries(
			Object.keys(instance.credentials).map(key => [
				key,
				typeof instance.credentials[key] === "string" && instance.credentials[key] !== ""
					? "••••"
					: instance.credentials[key],
			]),
		),
		...(instance.options?.peerTokens
			? { options: { peerTokens: Object.fromEntries(Object.keys(instance.options.peerTokens).map(peer => [peer, "••••"])) } }
			: {}),
		credentialFields: credentialFields(instance.platform),
	}));
}

function targetAvailability(webConfig: WebConfig, target: ImTarget): { display: string; available: boolean; reason?: string } {
	if (target.kind === "workspace") {
		if (target.workspace === "main") return { display: "默认工作区", available: true };
		const workspace = webConfig.findWorkspace(target.workspace);
		return workspace
			? { display: `workspace:${target.workspace}`, available: true }
			: { display: `workspace:${target.workspace}`, available: false, reason: "unknown-workspace" };
	}
	let db: TeamDb | null = null;
	try {
		db = new TeamDb(resolveTeamDbPath());
		const team = db.listTeams().find(candidate => candidate.name === target.team || candidate.id === target.team);
		if (!team) return { display: `Team ${target.team}`, available: false, reason: "unknown-team" };
		const pm = db.listPms(team.id).find(candidate => candidate.name === target.pm || candidate.id === target.pm);
		if (!pm) return { display: `Team ${team.name} · PM ${target.pm}`, available: false, reason: "unknown-pm" };
		if (target.kind === "team-pm") return { display: `Team ${team.name} · PM ${pm.name}`, available: true };
		const engineer = db
			.listEngineers(team.id)
			.find(candidate => candidate.pmId === pm.id && (candidate.name === target.engineer || candidate.id === target.engineer));
		if (!engineer) return { display: `Team ${team.name} · PM ${pm.name} · engineer ${target.engineer}`, available: false, reason: "unknown-engineer" };
		const worktrees = db
			.listWorktrees(team.id)
			.filter(
				candidate =>
					candidate.engineerId === engineer.id &&
					candidate.kind === "home" &&
					(target.repo === undefined || candidate.repoId === target.repo),
			);
		if (worktrees.length === 0) {
			return { display: `Team ${team.name} · PM ${pm.name} · engineer ${engineer.name}`, available: false, reason: "no-home-worktree" };
		}
		if (worktrees.length > 1 && target.repo === undefined) {
			return { display: `Team ${team.name} · PM ${pm.name} · engineer ${engineer.name}`, available: false, reason: "ambiguous-repo" };
		}
		return { display: `Team ${team.name} · PM ${pm.name} · engineer ${engineer.name} · ${worktrees[0]!.name}`, available: true };
	} catch (error) {
		logger.warn("IM target availability check failed", { error: error instanceof Error ? error.message : String(error) });
		return { display: targetKey(target), available: false, reason: "team-db-unavailable" };
	} finally {
		db?.close();
	}
}

function hasCredentials(instance: ChannelInstanceConfig): boolean {
	const c = instance.credentials;
	const has = (key: string) => typeof c[key] === "string" && (c[key] as string).trim() !== "";
	switch (instance.platform) {
		case "wechat":
			return has("botToken");
		case "feishu":
			return has("appId") && has("appSecret");
		case "telegram":
		case "discord":
			return has("botToken");
		case "qq":
			return has("endpoint");
	}
}

function targetDisplayFor(webConfig: WebConfig, target: ImTarget): string {
	return targetAvailability(webConfig, target).display;
}

function bindingView(webConfig: WebConfig, binding: ImBinding): Record<string, unknown> {
	const target = targetAvailability(webConfig, binding.target);
	const profile = webConfig.getImAgent(binding.agentProfileId);
	return {
		...binding,
		agentProfileLabel: profile?.label ?? binding.agentProfileId,
		targetDisplay: target.display,
		targetAvailable: target.available,
		...(target.reason ? { targetReason: target.reason } : {}),
	};
}

export async function handleChannelsStatus(): Promise<Response> {
	const webConfig = await WebConfig.shared();
	const data = webConfig.getData();
	const runtime = new Map(getChannelStatus().map(status => [status.id, status]));
	const instances = data.channels.instances.map(instance => {
		const status = runtime.get(instance.id);
		const profile = webConfig.getImAgent(instance.agentProfile);
		const target = profile ? targetAvailability(webConfig, profile.location) : { display: "missing profile", available: false, reason: "unknown-profile" };
		const qr = getPendingWechatQr(instance.id);
		return {
			id: instance.id,
			platform: instance.platform,
			label: instance.label,
			note: instance.note,
			enabled: instance.enabled,
			configured: status?.configured ?? hasCredentials(instance),
			running: status?.running ?? false,
			state: status?.state ?? "stopped",
			detail: status?.detail,
			lastError: status?.lastError,
			since: status?.since,
			lastInboundAt: status?.lastInboundAt,
			agentProfileId: instance.agentProfile,
			agentProfileLabel: profile?.label ?? instance.agentProfile,
			targetDisplay: target.display,
			targetAvailable: target.available,
			...(target.reason ? { targetReason: target.reason } : {}),
			...(instance.platform === "wechat" ? { qrPending: qr !== null } : {}),
			boundPeers: data.remote.imBindings?.filter(binding => binding.instanceId === instance.id).length ?? 0,
		};
	});
	return json({
		instances,
		runtime: { hosting: getChannelStatus().some(status => status.running), instances: getChannelStatus().map(status => status.id) },
	});
}

export async function handleChannelInstancesGet(): Promise<Response> {
	const webConfig = await WebConfig.shared();
	return json({ instances: maskedInstances(webConfig.getChannelInstances()) });
}

function mergeSecrets(incoming: unknown, stored: ChannelInstanceConfig | undefined): ChannelInstanceConfig {
	const record = incoming as ChannelInstanceConfig;
	const credentials: Record<string, unknown> = {
		...(stored?.credentials ?? {}),
		...(record.credentials ?? {}),
	};
	for (const key of Object.keys(credentials)) {
		if (credentials[key] === "••••") {
			credentials[key] = stored?.credentials[key];
		}
		if (credentials[key] === null) delete credentials[key];
	}
	const options =
		record.options === undefined
			? stored?.options
			: {
					...(stored?.options ?? {}),
					...record.options,
					...(record.options?.peerTokens
						? {
								peerTokens: {
									...(stored?.options?.peerTokens ?? {}),
									...record.options.peerTokens,
								},
							}
						: {}),
				};
	return { ...record, credentials, ...(options === undefined ? {} : { options }) };
}

export async function handleChannelInstancesPut(req: Request): Promise<Response> {
	const body = await readBody(req);
	if (!body || !Array.isArray(body.instances)) return json({ ok: false, error: "Missing instances array" }, 400);
	const webConfig = await WebConfig.shared();
	const stored = new Map(webConfig.getChannelInstances().map(instance => [instance.id, instance]));
	const merged = body.instances.map(entry => mergeSecrets(entry, typeof entry === "object" && entry !== null ? stored.get(String((entry as Record<string, unknown>).id)) : undefined));
	try {
		await webConfig.setChannelInstances(merged);
	} catch (error) {
		return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
	}
	void triggerRestartChannels()?.catch(() => {});
	return json({ ok: true });
}

export async function handleImAgentsGet(): Promise<Response> {
	const webConfig = await WebConfig.shared();
	return json({
		profiles: webConfig.getImAgents(),
		targets: webConfig.getImAgents().map(profile => {
			const target = targetAvailability(webConfig, profile.location);
			return {
				targetKey: targetKey(profile.location),
				key: targetKey(profile.location),
				display: target.display,
				available: target.available,
				...(target.reason ? { reason: target.reason } : {}),
				kind: profile.location.kind,
			};
		}),
	});
}

export async function handleImAgentsPut(req: Request): Promise<Response> {
	const body = await readBody(req);
	if (!body || !Array.isArray(body.profiles)) return json({ ok: false, error: "Missing profiles array" }, 400);
	const webConfig = await WebConfig.shared();
	try {
		await webConfig.setImAgents(body.profiles as ImAgentProfile[]);
	} catch (error) {
		return json({ ok: false, error: error instanceof Error ? error.message : String(error), errors: [] }, 400);
	}
	void triggerRestartChannels()?.catch(() => {});
	return json({ ok: true });
}

export async function handleImBindingsGet(req: Request): Promise<Response> {
	const webConfig = await WebConfig.shared();
	const url = new URL(req.url);
	const instanceId = url.searchParams.get("instanceId") ?? undefined;
	const bindings = webConfig
		.getImBindings()
		.filter(binding => instanceId === undefined || binding.instanceId === instanceId)
		.map(binding => bindingView(webConfig, binding));
	return json({ bindings });
}

export async function handleImBindingsPut(req: Request): Promise<Response> {
	const body = await readBody(req);
	if (!body || !Array.isArray(body.bindings)) return json({ ok: false, error: "Missing bindings array" }, 400);
	const webConfig = await WebConfig.shared();
	try {
		await webConfig.setImBindings(body.bindings as ImBinding[]);
	} catch (error) {
		return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
	}
	return json({ ok: true });
}

export async function handleImCommands(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const instanceId = url.searchParams.get("instanceId");
	const chatId = url.searchParams.get("chatId");
	const webConfig = await WebConfig.shared();
	const instance = instanceId ? webConfig.getChannelInstance(instanceId) : undefined;
	if (!instance) return json({ error: "Unknown instance" }, 404);
	const binding = chatId ? webConfig.findImBinding(instance.id, chatId) : undefined;
	const profile = binding ? webConfig.getImAgent(binding.agentProfileId) : webConfig.getImAgent(instance.agentProfile);
	const session = binding ? webConfig.getBotSession(binding.sessionId) : undefined;
	return json({
		bot: { instanceId: instance.id, label: instance.label, platform: instance.platform },
		...(binding ? { binding: { id: binding.id, role: binding.role, agentRuntimeId: imAgentRuntimeId(instance.id, binding.agentProfileId, binding.id) } } : {}),
		...(session ? { session: { id: session.id, display: session.name } } : {}),
		...(binding?.model ? { model: { ...binding.model, display: `${binding.model.provider}/${binding.model.model}` } } : {}),
		voice: { supported: false, reason: "IM voice delivery is not implemented; the tts tool writes a file" },
		examples: ["!status", "!session list", "!session use {1}", "!model", "!lang zh", "!workspace list"],
	});
}

export async function handleChannelValidate(req: Request, instanceId: string): Promise<Response> {
	const webConfig = await WebConfig.shared();
	const instance = webConfig.getChannelInstance(instanceId);
	if (!instance) return json({ error: "Unknown instance" }, 404);
	if (instance.platform === "wechat") return json({ state: "error", error: "WeChat validates by QR, not credentials" }, 400);
	const body = (await readBody(req)) ?? {};
	const field = (key: string): string | undefined =>
		typeof body[key] === "string" && (body[key] as string).trim() !== "" ? (body[key] as string).trim() : undefined;
	const result = await runCredentialLogin(instance.platform, {
		webConfig,
		instanceId,
		appId: field("appId"),
		appSecret: field("appSecret"),
		domain: body.domain === "lark" ? "lark" : body.domain === "feishu" ? "feishu" : undefined,
		botToken: field("botToken"),
		endpoint: field("endpoint"),
		token: field("token"),
		mode: body.mode === "reverse" ? "reverse" : body.mode === "forward" ? "forward" : undefined,
		port: typeof body.port === "number" ? body.port : undefined,
	});
	if (result.state !== "connected") {
		return json({ state: result.state, error: result.error ?? "validation failed" }, result.state === "timeout" ? 504 : 400);
	}
	return json({ state: "connected", identity: result.identity, credentialsPersisted: result.credentialsPersisted });
}

export async function handleChannelInstanceToggle(instanceId: string, enabled: boolean): Promise<Response> {
	const webConfig = await WebConfig.shared();
	if (!webConfig.getChannelInstance(instanceId)) return json({ error: "Unknown instance" }, 404);
	await webConfig.setInstance(instanceId, { enabled });
	void triggerRestartChannels()?.catch(() => {});
	return json({ ok: true });
}

export async function handleWechatQr(instanceId: string): Promise<Response> {
	const webConfig = await WebConfig.shared();
	const instance = webConfig.getChannelInstance(instanceId);
	if (!instance) return json({ error: "Unknown instance" }, 404);
	if (instance.platform !== "wechat") return json({ error: "Not a WeChat instance" }, 400);
	const qr = getPendingWechatQr(instanceId);
	if (!qr) return json({ pending: false });
	return json({ pending: true, qrcodeUrl: qr.qrcodeUrl, status: qr.status });
}

export async function handleWechatAction(instanceId: string, action: "reconnect" | "unbind"): Promise<Response> {
	const webConfig = await WebConfig.shared();
	const instance = webConfig.getChannelInstance(instanceId);
	if (!instance) return json({ error: "Unknown instance" }, 404);
	if (instance.platform !== "wechat") return json({ error: "Not a WeChat instance" }, 400);
	const hook = action === "reconnect" ? triggerWechatReconnect(instanceId) : triggerWechatUnbind(instanceId);
	if (!hook) return json({ error: "WeChat instance is not running" }, 404);
	await hook;
	return json({ ok: true });
}
