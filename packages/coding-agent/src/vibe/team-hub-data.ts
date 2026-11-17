import * as path from "node:path";
import type {
	ActiveTeamAgentRow,
	ActiveTeamHubSnapshot,
	ActiveTeamHubSource,
} from "@linxiraos/pi-tui/overlays/active-team-hub";
import { AgentRegistry, type AgentRegistryApi } from "../registry/agent-registry";
import { VibeSessionRegistry, type VibeOwnerScope, type VibeWorkerView } from "./runtime";
import { post, snapshot, type TeamRoomSnapshot } from "./team-rooms";

/** Join durable room membership with actual runtime/registry observations. No TeamDb reads. */
export function projectActiveTeamHub(
	rooms: TeamRoomSnapshot,
	workers: readonly VibeWorkerView[],
	registry: AgentRegistryApi,
): ActiveTeamHubSnapshot {
	const candidate = registry.get(rooms.owner.agentId);
	const currentFile = candidate?.session?.sessionManager.getSessionFile();
	const sourceFile = rooms.ownerScope.parentSessionFile;
	const sameFile = currentFile
		? sourceFile !== null && path.resolve(currentFile) === path.resolve(sourceFile)
		: sourceFile === null;
	const ownerRef =
		sameFile && candidate?.session?.sessionManager.getSessionId() === rooms.ownerScope.parentSessionId
			? candidate
			: undefined;
	const agents: ActiveTeamAgentRow[] = [
		{
			id: rooms.owner.agentId,
			label: ownerRef?.displayName ?? rooms.owner.label,
			kind: "main",
			status: ownerRef?.session
				? ownerRef.status
				: ownerRef?.status === "parked" || ownerRef?.status === "aborted"
					? ownerRef.status
					: "offline",
			...(ownerRef ? { createdAt: ownerRef.createdAt, lastActivityAt: ownerRef.lastActivity } : {}),
			...(ownerRef?.activity ? { activity: ownerRef.activity } : {}),
			...(ownerRef ? { registryGeneration: ownerRef.generation } : {}),
			canObserve: Boolean(ownerRef?.session || ownerRef?.sessionFile),
		},
	];
	const byId = new Map(workers.map(worker => [worker.id, worker]));
	for (const member of rooms.team.members) {
		if (member.role !== "worker") continue;
		const worker = byId.get(member.agentId);
		const candidate = registry.get(member.agentId);
		const ref =
			candidate?.kind === "sub" &&
			candidate.parentId === rooms.ownerScope.ownerId &&
			worker?.sessionFile !== undefined &&
			candidate.sessionFile === worker.sessionFile
				? candidate
				: undefined;
		agents.push({
			id: member.agentId,
			label: ref?.displayName ?? member.label,
			kind: "worker",
			status:
				worker?.state === "dead"
					? "aborted"
					: ref?.session
						? ref.status
						: ref?.status === "parked" || ref?.status === "aborted"
							? ref.status
							: "offline",
			...(worker
				? { createdAt: worker.createdAt, lastActivityAt: worker.lastActivityAt }
				: ref
					? { createdAt: ref.createdAt, lastActivityAt: ref.lastActivity }
					: {}),
			role: worker?.identity.role ?? member.moduleRole,
			generation: worker?.identity.generation ?? member.generation,
			lifecycle: worker?.identity.lifecycle ?? member.lifecycle,
			...(worker?.cli ? { cli: worker.cli } : {}),
			...(worker?.model ? { model: worker.model } : {}),
			...(worker?.turnMessage ? { assignment: worker.turnMessage } : {}),
			...(worker?.queued ? { queued: worker.queued } : {}),
			...(ref?.activity || worker?.currentTool || worker?.lastActivity
				? { activity: ref?.activity ?? worker?.currentTool ?? worker?.lastActivity }
				: {}),
			...(ref ? { registryGeneration: ref.generation } : {}),
			canObserve: Boolean(ref?.session || ref?.sessionFile),
		});
	}
	return {
		teamKey: rooms.teamKey,
		label: rooms.owner.label,
		ownerId: rooms.owner.agentId,
		agents,
		rooms: [rooms.team, rooms.mains].map(room => ({
			id: room.roomId,
			room: room.room,
			name: room.name,
			members: room.members,
			createdAt: room.createdAt,
			updatedAt: room.updatedAt,
			events: room.events.map(event => ({
				seq: event.seq,
				sentAt: event.sentAt,
				senderId: event.senderId,
				senderName: event.senderName,
				body: event.body,
			})),
			lastSeq: room.lastSeq,
		})),
	};
}

/** Captures the source scope once: /resume never retargets this open Hub to another Team. */
export function createActiveTeamHubSource(owner: VibeOwnerScope): ActiveTeamHubSource {
	const source = { ...owner };
	return {
		load: async () =>
			projectActiveTeamHub(
				snapshot(source, { limit: 100 }),
				VibeSessionRegistry.global().view(source),
				AgentRegistry.global(),
			),
		post: (body, room) => post(source, source.ownerId, body, room).then(result => ({ seq: result.event.seq })),
		subscribe: listener => AgentRegistry.global().onChange(listener),
	};
}
