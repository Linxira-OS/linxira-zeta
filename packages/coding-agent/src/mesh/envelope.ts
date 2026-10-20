/**
 * Envelope validation and address parsing.
 *
 * Addresses are `<workspace>/<agent>`; a bare `<agent>` is in-process only.
 * Validation is intentionally strict on everything that could escape a path
 * or corrupt framing, and generous on the agent id itself (task ids may carry
 * dots, colons, or spaces).
 */

import { isSafeAddressSegment, isSafeWorkspaceId } from "./paths";
import {
	MESH_MAX_ENVELOPE_BYTES,
	MESH_PROTOCOL_VERSION,
	type MeshEnvelope,
	type MeshEnvelopeKind,
	MeshProtocolError,
} from "./types";

const ENVELOPE_KINDS: Record<MeshEnvelopeKind, true> = { message: true, wake: true, ack: true };

export interface ParsedAddress {
	/** Workspace selector as written (id, alias, or directory name); absent for local ids. */
	workspace?: string;
	agent: string;
}

/** Strip an `agent://` scheme and a trailing JSON-path, then split `<ws>/<agent>`. */
export function parseMeshAddress(raw: string): ParsedAddress {
	let value = raw.trim();
	if (value.startsWith("agent://")) value = value.slice("agent://".length);
	if (value.endsWith("/")) value = value.slice(0, -1);
	const slash = value.indexOf("/");
	if (slash === -1) {
		if (!isSafeAddressSegment(value)) throw new MeshProtocolError(`Invalid agent id "${raw}".`);
		return { agent: value };
	}
	const workspace = value.slice(0, slash);
	const agent = value.slice(slash + 1);
	if (!isSafeWorkspaceId(workspace)) {
		throw new MeshProtocolError(`Invalid workspace id "${workspace}" in "${raw}".`);
	}
	if (!isSafeAddressSegment(agent) || agent.includes("/")) {
		throw new MeshProtocolError(`Invalid agent id "${agent}" in "${raw}".`);
	}
	return { workspace, agent };
}

/** `true` when `raw` is a workspace-qualified address (contains exactly one `/`). */
export function isWorkspaceAddress(raw: string): boolean {
	try {
		return parseMeshAddress(raw).workspace !== undefined;
	} catch {
		return false;
	}
}

/** `<workspaceId>/<agentId>`, with the scheme stripped. */
export function formatMeshAddress(workspaceId: string, agentId: string): string {
	return `${workspaceId}/${agentId}`;
}

/** TypeError-free version of {@link parseMeshAddress}. */
export function tryParseMeshAddress(raw: string): ParsedAddress | undefined {
	try {
		return parseMeshAddress(raw);
	} catch {
		return undefined;
	}
}

/** Thrown when an envelope is structurally invalid, oversized, or the wrong version. */
export function validateEnvelope(value: unknown): MeshEnvelope {
	if (value === null || typeof value !== "object") throw new MeshProtocolError("Envelope must be an object.");
	const raw = value as Record<string, unknown>;
	if (raw.v !== MESH_PROTOCOL_VERSION) {
		throw new MeshProtocolError(`Unsupported mesh protocol version ${String(raw.v)}.`);
	}
	if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 128) {
		throw new MeshProtocolError("Envelope id is invalid.");
	}
	if (typeof raw.from !== "string" || !isAddressLike(raw.from)) {
		throw new MeshProtocolError("Envelope from address is invalid.");
	}
	if (typeof raw.to !== "string" || !isAddressLike(raw.to)) {
		throw new MeshProtocolError("Envelope to address is invalid.");
	}
	if (typeof raw.kind !== "string" || ENVELOPE_KINDS[raw.kind as MeshEnvelopeKind] !== true) {
		throw new MeshProtocolError(`Envelope kind "${String(raw.kind)}" is invalid.`);
	}
	if (typeof raw.body !== "string") throw new MeshProtocolError("Envelope body must be a string.");
	if (typeof raw.sentAt !== "number" || !Number.isFinite(raw.sentAt)) {
		throw new MeshProtocolError("Envelope sentAt must be a finite number.");
	}
	if (raw.replyTo !== undefined && (typeof raw.replyTo !== "string" || raw.replyTo.length > 128)) {
		throw new MeshProtocolError("Envelope replyTo is invalid.");
	}
	const envelope: MeshEnvelope = {
		v: MESH_PROTOCOL_VERSION,
		id: raw.id,
		from: raw.from,
		to: raw.to,
		kind: raw.kind as MeshEnvelopeKind,
		body: raw.body,
		sentAt: raw.sentAt,
	};
	if (raw.replyTo !== undefined) envelope.replyTo = raw.replyTo as string;
	if (serializedSize(envelope) > MESH_MAX_ENVELOPE_BYTES) {
		throw new MeshProtocolError(`Envelope exceeds the ${MESH_MAX_ENVELOPE_BYTES} byte limit.`);
	}
	return envelope;
}

/** One address is `<agent>` or `<workspace>/<agent>`. */
function isAddressLike(value: string): boolean {
	const parts = value.split("/");
	if (parts.length === 1) return isSafeAddressSegment(parts[0]!);
	if (parts.length !== 2) return false;
	return isSafeWorkspaceId(parts[0]!) && isSafeAddressSegment(parts[1]!);
}

/** Serialized byte length of one envelope (the limit applies to the wire frame). */
export function serializedSize(envelope: MeshEnvelope): number {
	return Buffer.byteLength(JSON.stringify(envelope), "utf8");
}
