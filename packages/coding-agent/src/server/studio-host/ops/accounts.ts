import type { AgentSession } from "../../../session/agent-session";
import { validateAgentAccountPools } from "../../../config/account-pools";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, unavailable } from "../errors.js";
import type { ExtensionLinkListInput, ExtensionLinkOperation } from "../protocol/contracts/extension-links.js";
import type { SearchCredentialsOperation } from "../protocol/contracts/search-credentials.js";
import type { StudioHostContext } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import { ACCOUNT_ID_PATTERN, studioAccountStatusService } from "../services/account-status-service.js";
import { activateStudioExtensionLink, listStudioExtensionLinks } from "../services/extension-links-service.js";
import { StudioSearchCredentialsService } from "../services/search-credentials-service.js";
import { snapshotFor } from "./session.js";

const MAX_ID_LENGTH = 512;

function exactFields(input: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Expected an account operation");
	const row = input as Record<string, unknown>;
	if (Object.keys(row).some(key => !fields.includes(key))) throw invalid("Unknown account operation field");
	return row;
}

function identifier(value: unknown, field: string): string {
	if (typeof value !== "string" || !value || value.length > MAX_ID_LENGTH || value.includes("\0"))
		throw invalid(`Invalid ${field}`);
	return value;
}

interface LiveAccountSession {
	readonly session: AgentSession;
	readonly sessionId: string;
	assertCurrent(): void;
}

/**
 * The caller's selected native session, without attaching or starting one.
 * Every mutation/read is fenced against both the authenticated owner socket
 * and the exact live native session after its awaited work.
 */
function liveAccountSession(context: StudioHostContext, sessionId?: string): LiveAccountSession {
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now())
		throw unavailable("Accounts require a live authenticated conversation");
	const selection = currentStudioSelection();
	if (!selection || selection.closed || !selection.sessionId)
		throw unavailable("Accounts require a live authenticated conversation");
	if (sessionId !== undefined && sessionId !== selection.sessionId)
		throw unavailable("The account target session changed");
	const id = selection.sessionId;
	const session = getRpcSession(id)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== id)
		throw unavailable("The account session is not resident in this conversation");
	const assertCurrent = () => {
		if (
			!owner.isLive() ||
			owner.expiresAt <= Date.now() ||
			selection.closed ||
			selection.sessionId !== id ||
			session.isDisposed ||
			session.sessionId !== id ||
			getRpcSession(id)?.getSession() !== session
		)
			throw unavailable("The account session changed");
	};
	return { session, sessionId: id, assertCurrent };
}

function statusFields(input: unknown): { refresh: boolean | undefined } {
	const row = exactFields(input, ["refresh"]);
	if (row.refresh !== undefined && typeof row.refresh !== "boolean") throw invalid("Account refresh must be boolean");
	return { refresh: row.refresh as boolean | undefined };
}

async function status(input: unknown, details: boolean, context: StudioHostContext) {
	const { refresh } = statusFields(input);
	const live = liveAccountSession(context);
	live.assertCurrent();
	const result = await studioAccountStatusService(live.session).get(refresh ?? false, details);
	live.assertCurrent();
	const snapshot = await snapshotFor(live.sessionId);
	live.assertCurrent();
	return { snapshot, result };
}

type SearchListOperation = Extract<SearchCredentialsOperation, { kind: "search.credentials.list" }>;
type SearchSetOperation = Extract<SearchCredentialsOperation, { kind: "search.credentials.set" }>;
type SearchRemoveOperation = Extract<SearchCredentialsOperation, { kind: "search.credentials.remove" }>;

function searchListOperation(input: unknown): SearchListOperation {
	const row = exactFields(input, ["sessionId", "providers"]);
	const sessionId = identifier(row.sessionId, "credential session");
	if (!Array.isArray(row.providers) || row.providers.length > 64) throw invalid("Invalid credential providers");
	const providers = (row.providers as unknown[]).map(provider => identifier(provider, "credential provider"));
	return { kind: "search.credentials.list", sessionId, providers };
}

function searchSetOperation(input: unknown): SearchSetOperation {
	const row = exactFields(input, ["sessionId", "provider", "apiKey"]);
	const sessionId = identifier(row.sessionId, "credential session");
	const provider = identifier(row.provider, "credential provider");
	if (typeof row.apiKey !== "string" || row.apiKey.length > 16_384 || row.apiKey.includes("\0"))
		throw invalid("Invalid credential key");
	return { kind: "search.credentials.set", sessionId, provider, apiKey: row.apiKey };
}

function searchRemoveOperation(input: unknown): SearchRemoveOperation {
	const row = exactFields(input, ["sessionId", "provider", "credentialId"]);
	const sessionId = identifier(row.sessionId, "credential session");
	const provider = identifier(row.provider, "credential provider");
	if (typeof row.credentialId !== "number" || !Number.isSafeInteger(row.credentialId))
		throw invalid("Select a stored credential to remove");
	return { kind: "search.credentials.remove", sessionId, provider, credentialId: row.credentialId };
}

function extensionTargetFields(input: unknown, activate: boolean): Record<string, unknown> {
	return exactFields(
		input,
		activate ? ["sessionId", "sourceSessionId", "agentId", "url"] : ["sessionId", "sourceSessionId", "agentId"],
	);
}

function extensionListTarget(input: unknown): ExtensionLinkListInput {
	const row = extensionTargetFields(input, false);
	const sessionId = identifier(row.sessionId, "extension link session");
	const sourceSessionId =
		row.sourceSessionId === undefined ? undefined : identifier(row.sourceSessionId, "extension link source session");
	const agentId = row.agentId === undefined ? undefined : identifier(row.agentId, "extension link agent");
	return { sessionId, ...(sourceSessionId ? { sourceSessionId } : {}), ...(agentId ? { agentId } : {}) };
}

function extensionActivateOperation(input: unknown): ExtensionLinkOperation {
	const row = extensionTargetFields(input, true);
	const sessionId = identifier(row.sessionId, "extension link session");
	const sourceSessionId =
		row.sourceSessionId === undefined ? undefined : identifier(row.sourceSessionId, "extension link source session");
	const agentId = row.agentId === undefined ? undefined : identifier(row.agentId, "extension link agent");
	if (typeof row.url !== "string" || !row.url || row.url.length > 16_384 || row.url.includes("\0"))
		throw invalid("Invalid extension link");
	return {
		kind: "extensions.links.activate",
		sessionId,
		...(sourceSessionId ? { sourceSessionId } : {}),
		...(agentId ? { agentId } : {}),
		url: row.url,
	};
}

function accountPoolSession(input: unknown): string {
	const row = exactFields(input, ["sessionId"]);
	return identifier(row.sessionId, "account pool session");
}

function accountPoolSet(input: unknown): {
	sessionId: string;
	agent: string;
	pools: Readonly<Record<string, readonly string[]>> | null;
} {
	const row = exactFields(input, ["sessionId", "agent", "pools"]);
	const sessionId = identifier(row.sessionId, "account pool session");
	const agent = identifier(row.agent, "account pool agent");
	if (!Object.hasOwn(row, "pools")) throw invalid("Account pools are required");
	let validated: Record<string, Readonly<Record<string, readonly string[]>> | null>;
	try {
		// The same validator cfgTaskAgentAccountPools.setEntry applies to its entry.
		validated = validateAgentAccountPools(Object.assign(Object.create(null), { [agent]: row.pools }));
	} catch (error) {
		throw invalid(error instanceof Error ? error.message : "Invalid account pools");
	}
	return { sessionId, agent, pools: validated[agent] ?? null };
}

export const accountsOps = {
	id: "accounts",
	queries: {
		"extensions.links.list": async (input: unknown, context: StudioHostContext): Promise<{ schemes: string[] }> => {
			const target = extensionListTarget(input);
			const live = liveAccountSession(context, target.sessionId);
			live.assertCurrent();
			const result = listStudioExtensionLinks(live.session, target);
			live.assertCurrent();
			return result;
		},
	},
	commands: {
		"accounts.status": (input: unknown, context: StudioHostContext) => status(input, false, context),
		"accounts.status.details": (input: unknown, context: StudioHostContext) => status(input, true, context),
		"accounts.logout": async (input: unknown, context: StudioHostContext) => {
			const row = exactFields(input, ["sessionId", "accountId"]);
			const sessionId = identifier(row.sessionId, "account session");
			if (typeof row.accountId !== "string" || !ACCOUNT_ID_PATTERN.test(row.accountId))
				throw invalid("Invalid account identity");
			const live = liveAccountSession(context, sessionId);
			live.assertCurrent();
			const result = await studioAccountStatusService(live.session).logout(sessionId, row.accountId);
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"accounts.pool.options": async (input: unknown, context: StudioHostContext) => {
			const sessionId = accountPoolSession(input);
			const live = liveAccountSession(context, sessionId);
			live.assertCurrent();
			const result = studioAccountStatusService(live.session).poolOptions();
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"accounts.pool.get": async (input: unknown, context: StudioHostContext) => {
			const sessionId = accountPoolSession(input);
			const live = liveAccountSession(context, sessionId);
			live.assertCurrent();
			const result = studioAccountStatusService(live.session).poolGet();
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"accounts.pool.set": async (input: unknown, context: StudioHostContext) => {
			const { sessionId, agent, pools } = accountPoolSet(input);
			const live = liveAccountSession(context, sessionId);
			live.assertCurrent();
			const result = await studioAccountStatusService(live.session).poolSet(agent, pools);
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"search.credentials.list": async (input: unknown, context: StudioHostContext) => {
			const operation = searchListOperation(input);
			const live = liveAccountSession(context, operation.sessionId);
			live.assertCurrent();
			const result = await new StudioSearchCredentialsService(live.session).execute(operation, live.assertCurrent);
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"search.credentials.set": async (input: unknown, context: StudioHostContext) => {
			const operation = searchSetOperation(input);
			const live = liveAccountSession(context, operation.sessionId);
			live.assertCurrent();
			const result = await new StudioSearchCredentialsService(live.session).execute(operation, live.assertCurrent);
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"search.credentials.remove": async (input: unknown, context: StudioHostContext) => {
			const operation = searchRemoveOperation(input);
			const live = liveAccountSession(context, operation.sessionId);
			live.assertCurrent();
			const result = await new StudioSearchCredentialsService(live.session).execute(operation, live.assertCurrent);
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
		"extensions.links.activate": async (input: unknown, context: StudioHostContext) => {
			const operation = extensionActivateOperation(input);
			const live = liveAccountSession(context, operation.sessionId);
			live.assertCurrent();
			const result = await activateStudioExtensionLink(live.session, operation);
			live.assertCurrent();
			const snapshot = await snapshotFor(live.sessionId);
			live.assertCurrent();
			return { snapshot, result };
		},
	},
} as const;

export type AccountsOps = typeof accountsOps;
