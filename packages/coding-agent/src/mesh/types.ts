/**
 * Shared types for the cross-process agent mesh.
 *
 * The mesh is the machine-local transport behind `agent://` and peer
 * messaging: one loopback endpoint per workspace process, one directory
 * record per live process, and per-agent mailboxes for peers that are not
 * running. Single-process delivery never touches any of this — `IrcBus`
 * keeps its in-memory fast path.
 */

import type { MeshGear } from "./gears";

/** Envelope schema version; a receiver rejects anything else. */
export const MESH_PROTOCOL_VERSION = 1;

/** Hard ceiling for one envelope, measured over the serialized frame. */
export const MESH_MAX_ENVELOPE_BYTES = 1024 * 1024;

/** Directory heartbeat cadence and staleness threshold, in milliseconds. */
export const MESH_HEARTBEAT_MS = 10_000;
export const MESH_STALE_MS = 60_000;

/** How long a `wake`/`message` request waits for its ack. */
export const MESH_ACK_TIMEOUT_MS = 5_000;

/** Poll cadence for the mutual-wait deadlock probe. */
export const MESH_MUTUAL_WAIT_POLL_MS = 50;

/** A wait registration older than this is ignored by the deadlock probe. */
export const MESH_WAIT_TTL_MS = 60_000;

/**
 * How long a wait stays published after the probe answered it.
 *
 * The answer is only useful if the *other* side can observe it. Withdrawing the
 * registration the instant we return makes the outcome one-sided: the faster
 * prober sees the peer, answers, and disappears, so the peer's next poll finds
 * nothing and blocks for its whole timeout. Keeping the registration for one
 * grace window makes both sides answer.
 */
export const MESH_MUTUAL_WAIT_GRACE_MS = 1_000;

/** Offline mailbox retention for workspaces whose process is `gone`. */
export const MESH_MAILBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type MeshEnvelopeKind = "message" | "wake" | "ack";

/** One at-least-once mesh delivery unit; receivers deduplicate by `id`. */
export interface MeshEnvelope {
	v: number;
	id: string;
	/** Sender address, always workspace-qualified across the boundary. */
	from: string;
	/** Recipient address, always workspace-qualified across the boundary. */
	to: string;
	kind: MeshEnvelopeKind;
	body: string;
	sentAt: number;
	replyTo?: string;
}

export type MeshAgentRole = "main" | "sub" | "team-host" | "team-member";

/** Agent status as the mesh advertises it. `gone` is derived, never stored live. */
export type MeshAgentStatus = "running" | "idle" | "parked" | "gone";

/** One agent owned by a process, as published in its directory record. */
export interface MeshAgentEntry {
	id: string;
	role: MeshAgentRole;
	status: MeshAgentStatus;
}

/** A local agent currently blocked in `wait` for `on`. */
export interface MeshWaitEntry {
	/** Workspace-qualified address of the waiting agent. */
	agentId: string;
	/** Workspace-qualified address it is waiting on. */
	on: string;
	since: number;
}

/**
 * Directory record for one live mesh process.
 *
 * `agents` and `waits` are additive extensions to the contract's base fields:
 * `@agent list` needs per-agent role/status, and the S6 deadlock probe needs
 * a cross-process view of who is waiting on whom. Both are optional so older
 * readers keep working.
 */
export interface MeshDirectoryRecord {
	/** Primary address owned by this process (`<workspaceId>/main`). */
	id: string;
	workspaceId: string;
	workspaceAlias?: string;
	workspaceRoot: string;
	pid: number;
	endpoint: string;
	role: MeshAgentRole;
	status: MeshAgentStatus;
	updatedAt: number;
	agents?: MeshAgentEntry[];
	waits?: MeshWaitEntry[];
	/** Inbound call gear this workspace advertises (mirrors its project setting). */
	inboundGear?: MeshGear;
	/** Outbound call gear this workspace advertises (mirrors its project setting). */
	outboundGear?: MeshGear;
}

/** One enumerated directory entry, with staleness resolved. */
export interface MeshDirectoryEntry {
	record: MeshDirectoryRecord;
	state: "live" | "gone";
}

/** Send outcome; `queued` is the offline (parked/gone) path. */
export type MeshSendOutcome = "injected" | "woken" | "revived" | "queued" | "failed";

export interface MeshSendResult {
	to: string;
	outcome: MeshSendOutcome;
	error?: string;
}

/** Addressable agent surfaced by `@agent list` and mesh resolution. */
export interface MeshAgentInfo {
	/** Cross-process address (`<workspaceId>/<agentId>`); local entries stay bare. */
	address: string;
	id: string;
	role: MeshAgentRole;
	status: MeshAgentStatus;
	workspaceId?: string;
	workspaceAlias?: string;
	workspaceRoot?: string;
	local: boolean;
}

/** Base class so callers can distinguish mesh failures from transport errors. */
export class MeshError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/** A workspace selector matched more than one registered workspace. */
export class MeshAddressAmbiguousError extends MeshError {
	readonly selector: string;
	readonly candidates: string[];

	constructor(selector: string, candidates: string[]) {
		super(`"${selector}" is ambiguous — it matches ${candidates.join(", ")}. Use a workspace-qualified id.`);
		this.selector = selector;
		this.candidates = candidates;
	}
}

/** Nothing matched the selector; `candidates` is the nearest useful list. */
export class MeshAddressUnknownError extends MeshError {
	readonly selector: string;
	readonly candidates: string[];

	constructor(selector: string, candidates: string[] = []) {
		super(
			candidates.length > 0
				? `Unknown workspace or agent "${selector}". Available: ${candidates.join(", ")}.`
				: `Unknown workspace or agent "${selector}".`,
		);
		this.selector = selector;
		this.candidates = candidates;
	}
}

/** A frame was malformed, oversized, or used an unknown protocol version. */
export class MeshProtocolError extends MeshError {}

/** The endpoint exists but belongs to another live process. */
export class MeshEndpointBusyError extends MeshError {
	readonly pid?: number;

	constructor(workspaceId: string, pid?: number) {
		super(
			pid === undefined
				? `Mesh endpoint for workspace ${workspaceId} is already in use.`
				: `Mesh endpoint for workspace ${workspaceId} is owned by pid ${pid}.`,
		);
		this.pid = pid;
	}
}
