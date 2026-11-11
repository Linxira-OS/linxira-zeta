/**
 * IM binding / switch control from the running IM backend.
 *
 * The Team IM page shows the binding a candidate belongs to from the same
 * `GET /api/im/bindings` route the IM settings page uses. A workspace/session
 * switch preview and its confirm/cancel calls are the IM router's existing
 * confirm-gated handshake (`GET /api/im/switch`,
 * `POST /api/im/switch/{confirm,cancel}`); this client keeps no pending state
 * of its own and never applies a switch optimistically.
 */
import { defaultGatewayFetch, gatewayJson, type GatewayFetch } from "./settings/gatewayRequest";
import { isRecord } from "./typeGuards";

/** The chat identity the IM router scopes a pending switch to. */
export interface ImChatBindingRef {
	readonly id: string;
	readonly instanceId: string;
	readonly chatId: string;
	readonly threadId?: string;
	readonly userId?: string;
}

export interface ImChatSwitchTarget {
	readonly workspaceAlias?: string;
	readonly agentId?: string;
	readonly bindingId?: string;
	readonly targetKey?: string;
}

export interface ImChatSwitchPending {
	readonly requestId: string;
	readonly operation: "target" | "unbind";
	readonly from: ImChatSwitchTarget;
	readonly to: ImChatSwitchTarget;
	readonly requestedAt?: string;
	/** Persisted im_control entry id the router handed back. */
	readonly controlRecord?: string;
}

export interface ImChatSwitchState {
	readonly current?: ImChatSwitchTarget;
	readonly pending?: ImChatSwitchPending;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseTarget(value: unknown): ImChatSwitchTarget | undefined {
	if (!isRecord(value)) return undefined;
	const workspaceAlias = optionalString(value, "workspaceAlias");
	const agentId = optionalString(value, "agentId");
	const bindingId = optionalString(value, "bindingId");
	const targetKey = optionalString(value, "targetKey");
	if (workspaceAlias === undefined && agentId === undefined && bindingId === undefined && targetKey === undefined) {
		return undefined;
	}
	return {
		...(workspaceAlias === undefined ? {} : { workspaceAlias }),
		...(agentId === undefined ? {} : { agentId }),
		...(bindingId === undefined ? {} : { bindingId }),
		...(targetKey === undefined ? {} : { targetKey }),
	};
}

function parseControlRecord(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const id = optionalString(value, "id");
	if (id !== undefined) return id;
	return JSON.stringify(value);
}

function parsePending(value: unknown): ImChatSwitchPending | undefined {
	if (!isRecord(value)) return undefined;
	const requestId = optionalString(value, "requestId");
	const from = parseTarget(value.from);
	const to = parseTarget(value.to);
	if (requestId === undefined || from === undefined || to === undefined) return undefined;
	const operation = value.operation === "unbind" ? "unbind" : "target";
	const requestedAt = optionalString(value, "requestedAt");
	const controlRecord = parseControlRecord(value.controlRecord);
	return {
		requestId,
		operation,
		from,
		to,
		...(requestedAt === undefined ? {} : { requestedAt }),
		...(controlRecord === undefined ? {} : { controlRecord }),
	};
}

/** `GET /api/im/bindings` → only the identity fields a switch call needs. */
export async function loadImChatBindings(fetcher: GatewayFetch = defaultGatewayFetch): Promise<ImChatBindingRef[]> {
	const payload = await gatewayJson(fetcher, "/api/im/bindings");
	if (!isRecord(payload) || !Array.isArray(payload.bindings)) throw new Error("IM bindings response is malformed");
	const bindings: ImChatBindingRef[] = [];
	for (const entry of payload.bindings) {
		if (!isRecord(entry)) continue;
		const id = optionalString(entry, "id");
		const instanceId = optionalString(entry, "instanceId");
		const chatId = optionalString(entry, "chatId");
		if (id === undefined || instanceId === undefined || chatId === undefined) continue;
		const threadId = optionalString(entry, "threadId");
		const userId = optionalString(entry, "userId");
		bindings.push({
			id,
			instanceId,
			chatId,
			...(threadId === undefined ? {} : { threadId }),
			...(userId === undefined ? {} : { userId }),
		});
	}
	return bindings;
}

function switchUrl(binding: ImChatBindingRef): string {
	const params = new URLSearchParams({ instanceId: binding.instanceId, chatId: binding.chatId });
	if (binding.threadId !== undefined) params.set("threadId", binding.threadId);
	if (binding.userId !== undefined) params.set("userId", binding.userId);
	return `/api/im/switch?${params.toString()}`;
}

/**
 * `GET /api/im/switch` → the router's current target and pending handshake if
 * one is still within its TTL. An unmerged route is an error, not "no pending".
 */
export async function loadImChatSwitch(
	binding: ImChatBindingRef,
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<ImChatSwitchState> {
	const payload = await gatewayJson(fetcher, switchUrl(binding));
	if (!isRecord(payload)) throw new Error("IM switch response is malformed");
	const current = parseTarget(payload.current);
	const pending = parsePending(payload.pending);
	return {
		...(current === undefined ? {} : { current }),
		...(pending === undefined ? {} : { pending }),
	};
}

async function switchAction(
	binding: ImChatBindingRef,
	requestId: string,
	action: "confirm" | "cancel",
	fetcher: GatewayFetch,
): Promise<void> {
	const body = {
		instanceId: binding.instanceId,
		chatId: binding.chatId,
		...(binding.threadId === undefined ? {} : { threadId: binding.threadId }),
		...(binding.userId === undefined ? {} : { userId: binding.userId }),
		requestId,
	};
	const payload = await gatewayJson(fetcher, `/api/im/switch/${action}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!isRecord(payload) || payload.ok !== true) {
		const error = isRecord(payload) && typeof payload.error === "string" ? payload.error : `${action} failed`;
		throw new Error(error);
	}
}

/** Apply the pending workspace change through the IM router; no local apply. */
export async function confirmImChatSwitch(
	binding: ImChatBindingRef,
	requestId: string,
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<void> {
	await switchAction(binding, requestId, "confirm", fetcher);
}

/** Discard the pending workspace change through the IM router. */
export async function cancelImChatSwitch(
	binding: ImChatBindingRef,
	requestId: string,
	fetcher: GatewayFetch = defaultGatewayFetch,
): Promise<void> {
	await switchAction(binding, requestId, "cancel", fetcher);
}
