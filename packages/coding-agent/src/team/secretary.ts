/**
 * PM-owned persistent Secretary runtime.
 *
 * A Secretary is a real keep-alive task-executor subagent, not a main agent and
 * not a folder: its database owner is the PM (`agents.pm_id`), its durable
 * transcript is the child session file, and its only runtime identity is the
 * registry id `secretary-<pm-id>`.
 *
 * The Team database stores the durable reference. A live process finds the
 * Secretary through AgentRegistry; a parked one is re-registered from
 * `agents.session_file` and revived through AgentLifecycleManager.ensureLive,
 * which uses the process-wide persisted-subagent reviver.
 */

import type { AgentDefinition } from "../task/types";
import { getBundledAgent } from "../task/agents";
import type { StructuredSubagentRequest, StructuredSubagentResult } from "../task/structured-subagent";
import { runStructuredSubagent } from "../task/structured-subagent";
import { runSubagentFollowUpTurn } from "../task/executor";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { AgentRef, AgentRegistryApi } from "../registry/agent-registry";
import type { ToolSession } from "../tools";
import { type AgentRecord, type AgentState, resolveTeamDbPath, TeamDb } from "./db";
import type { LeadWorkspace } from "./lead";
import { TeamError } from "./errors";

export const SECRETARY_AGENT_NAME = "secretary";
export const SECRETARY_ROLE = "secretary" as const;
export const SECRETARY_LABEL = "Secretary";

/** Stable runtime id for a PM's single Secretary. `/` and `:` stay out of registry ids. */
export function secretaryAgentId(pmId: string): string {
	const safe = pmId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return `secretary-${safe}`.slice(0, 48);
}

function secretaryDefinition(): AgentDefinition {
	const definition = getBundledAgent(SECRETARY_AGENT_NAME);
	if (!definition) throw new TeamError("The bundled secretary agent is unavailable in this build.");
	return definition;
}

function agentState(ref: AgentRef | undefined): AgentState {
	if (!ref) return "unknown";
	if (ref.status === "idle") return "idle";
	if (ref.status === "parked") return "parked";
	if (ref.status === "aborted") return "dead";
	return "unknown";
}

export interface SecretaryView {
	record: AgentRecord;
	live: AgentRef | undefined;
	created?: boolean;
	output?: string;
}

function registryFor(session: ToolSession): AgentRegistryApi {
	return session.agentRegistry ?? AgentRegistry.global();
}

function persistRuntimeReference(dbPath: string, agentId: string, ref: AgentRef | undefined): AgentRecord | null {
	const db = new TeamDb(dbPath);
	try {
		const patch: { state?: AgentState; sessionId?: string | null; sessionFile?: string | null } = {
			state: agentState(ref),
		};
		const sessionId = ref?.session?.sessionManager.getSessionId();
		if (sessionId) patch.sessionId = sessionId;
		if (ref?.sessionFile) patch.sessionFile = ref.sessionFile;
		db.updateAgent(agentId, patch);
		return db.getAgentById(agentId);
	} finally {
		db.close();
	}
}

function existingSecretary(teamId: string, pmId: string, dbPath: string): AgentRecord | null {
	const db = new TeamDb(dbPath);
	try {
		return db.getAgentForPm(teamId, pmId, SECRETARY_ROLE);
	} finally {
		db.close();
	}
}

function findOrRegisterLive(session: ToolSession, record: AgentRecord): AgentRef | undefined {
	const registry = registryFor(session);
	const existing = registry.get(record.id);
	if (existing) {
		if (existing.kind !== "sub" || existing.parentId !== (session.getAgentId?.() ?? MAIN_AGENT_ID)) {
			throw new TeamError(
				`Secretary id "${record.id}" is already owned by another agent; refusing to attach a second owner.`,
			);
		}
		if (record.sessionFile && existing.sessionFile && existing.sessionFile !== record.sessionFile) {
			throw new TeamError(
				`Secretary id "${record.id}" points at a different transcript than the Team database record.`,
			);
		}
		return existing;
	}
	if (!record.sessionFile) return undefined;
	return registry.register({
		id: record.id,
		displayName: SECRETARY_LABEL,
		kind: "sub",
		parentId: session.getAgentId?.() ?? MAIN_AGENT_ID,
		session: null,
		sessionFile: record.sessionFile,
		status: "parked",
	});
}

/**
 * Spawn the PM's one Secretary. Returns the existing row instead of creating a
 * duplicate; a concurrent insert loses the unique `(pm_id, role)` race and also
 * returns that winner. The first turn runs through the keep-alive executor, so
 * the child stays adopted by the AgentLifecycleManager after it reports.
 */
export async function spawnSecretary(
	session: ToolSession,
	workspace: LeadWorkspace,
	prompt: string,
): Promise<SecretaryView> {
	const dbPath = resolveTeamDbPath();
	const existing = existingSecretary(workspace.teamId, workspace.pmId, dbPath);
	if (existing) {
		const live = findOrRegisterLive(session, existing);
		return { record: persistRuntimeReference(dbPath, existing.id, live) ?? existing, live, created: false };
	}

	const id = secretaryAgentId(workspace.pmId);
	const now = Math.floor(Date.now() / 1000);
	const reserved: AgentRecord = {
		id,
		teamId: workspace.teamId,
		pmId: workspace.pmId,
		role: SECRETARY_ROLE,
		persistence: "persistent",
		parentAgentId: workspace.pmId,
		sessionId: null,
		sessionFile: null,
		state: "starting",
		createdAt: now,
		updatedAt: now,
	};
	const reserveDb = new TeamDb(dbPath);
	try {
		reserveDb.insertAgent(reserved);
	} catch (error) {
		const winner = existingSecretary(workspace.teamId, workspace.pmId, dbPath);
		if (winner) {
			const live = findOrRegisterLive(session, winner);
			return { record: persistRuntimeReference(dbPath, winner.id, live) ?? winner, live, created: false };
		}
		throw error;
	} finally {
		reserveDb.close();
	}

	const request: StructuredSubagentRequest = {
		session,
		invocationKind: "task",
		agent: SECRETARY_AGENT_NAME,
		assignment: prompt,
		structured: false,
		keepAlive: true,
		enableIrc: false,
		enableLsp: false,
		identity: { id, label: SECRETARY_LABEL },
	};
	let result: StructuredSubagentResult;
	try {
		result = await runStructuredSubagent(request);
	} catch (error) {
		const cleanup = new TeamDb(dbPath);
		try {
			cleanup.deleteAgent(id);
		} finally {
			cleanup.close();
		}
		throw error;
	}
	const ref = registryFor(session).get(id);
	const record = persistRuntimeReference(dbPath, id, ref) ?? {
		...reserved,
		sessionFile: ref?.sessionFile ?? null,
		sessionId: ref?.session?.sessionManager.getSessionId() ?? null,
		state: agentState(ref),
		updatedAt: Math.floor(Date.now() / 1000),
	};
	return { record, live: ref, created: true, output: result.result.output };
}

/** Continue the PM's existing Secretary with one monitored, keep-alive turn. */
export async function sendSecretary(
	session: ToolSession,
	workspace: LeadWorkspace,
	message: string,
): Promise<SecretaryView> {
	const dbPath = resolveTeamDbPath();
	const record = existingSecretary(workspace.teamId, workspace.pmId, dbPath);
	if (!record) {
		throw new TeamError("This PM has no Secretary yet. Use `secretary spawn` first.");
	}
	const definition = secretaryDefinition();
	const ref = findOrRegisterLive(session, record);
	if (!ref && !record.sessionFile) {
		throw new TeamError(`Secretary "${record.id}" has no transcript to resume; its durable reference is incomplete.`);
	}
	const result = await runSubagentFollowUpTurn({
		id: record.id,
		agent: definition,
		message,
		structured: false,
		description: SECRETARY_LABEL,
		eventBus: session.eventBus,
		subagentEventBus: session.subagentEventBus,
	});
	const live = registryFor(session).get(record.id);
	const updated = persistRuntimeReference(dbPath, record.id, live) ?? record;
	return { record: updated, live, output: result.output };
}

/** Read the durable Secretary reference without creating or reviving anything. */
export function listSecretary(session: ToolSession, workspace: LeadWorkspace): SecretaryView | null {
	const record = existingSecretary(workspace.teamId, workspace.pmId, resolveTeamDbPath());
	if (!record) return null;
	return { record, live: registryFor(session).get(record.id) };
}
