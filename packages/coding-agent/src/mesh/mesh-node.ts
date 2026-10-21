/**
 * MeshNode — one process's presence on the machine-local agent mesh.
 *
 * Responsibilities: own the loopback endpoint, publish/refresh the directory
 * record, resolve workspace-qualified addresses, deliver to live peers over
 * the socket (awaiting an ack), and queue to offline peers' mailboxes with a
 * `wake`. Receiving is symmetric: envelopes for local agents are handed to
 * `deliver`, and mailbox backlog is injected on start and on wake.
 *
 * This class never imports `IrcBus`, the registry, or any session type; the
 * host supplies `localAgents()` and `deliver()`. That keeps the mesh usable
 * from tests and from `serve` without a cycle, and keeps single-process
 * behavior entirely outside this module.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Snowflake, logger } from "@linxiraos/pi-utils";
import { isDefaultWorkspace } from "../default-workspace";
import { MeshDirectory, isPidAlive } from "./directory";
import { type GearParty, type MeshGears, evaluateGearCall, gearAllows, readWorkspaceGears } from "./gears";
import {
	type ParsedAddress,
	formatMeshAddress,
	parseMeshAddress,
	serializedSize,
	tryParseMeshAddress,
} from "./envelope";
import { MeshMailbox } from "./mailbox";
import { type MeshPaths, ensureMeshDirs, isSafeWorkspaceId, meshPaths, meshPathsAt, workspaceIdFor } from "./paths";
import {
	listenMeshEndpoint,
	readMeshToken,
	sendMeshEnvelope,
	writeMeshToken,
	type MeshTransportServer,
} from "./transport";
import {
	MESH_ACK_TIMEOUT_MS,
	MESH_HEARTBEAT_MS,
	MESH_MAILBOX_RETENTION_MS,
	MESH_MAX_ENVELOPE_BYTES,
	MESH_PROTOCOL_VERSION,
	MESH_STALE_MS,
	MESH_WAIT_TTL_MS,
	type MeshAgentEntry,
	type MeshAgentInfo,
	type MeshAgentRole,
	type MeshAgentStatus,
	type MeshDirectoryRecord,
	type MeshEnvelope,
	type MeshSendOutcome,
	type MeshSendResult,
	MeshAddressAmbiguousError,
	MeshAddressUnknownError,
	MeshEndpointBusyError,
	MeshError,
} from "./types";

/** One agent owned by this process, as the host sees it right now. */
export interface MeshLocalAgent {
	id: string;
	role?: MeshAgentRole;
	status: MeshAgentStatus;
}

/** Result of handing one envelope to the local delivery path. */
export interface MeshDeliverResult {
	outcome: MeshSendOutcome;
	error?: string;
}

export interface MeshNodeOptions {
	/** Absolute workspace root; the workspace id is derived from it. */
	workspaceRoot: string;
	/** Explicit workspace id override (defaults to `sha1(realpath(root))[:12]`). */
	workspaceId?: string;
	/** Explicit alias override (defaults to the web-config alias for this root, else the directory name). */
	workspaceAlias?: string;
	/** Config root; the mesh plane defaults to its `run/` and `mailboxes/`. */
	configRoot?: string;
	/** Explicit mesh plane root (overrides `configRoot` and `ZETA_MESH_ROOT`). */
	meshRoot?: string;
	role?: MeshAgentRole;
	/** Live view of the agents this process owns. */
	localAgents: () => MeshLocalAgent[];
	/** Deliver one envelope to a local agent (waking/reviving it as the host sees fit). */
	deliver: (envelope: MeshEnvelope, localAgentId: string) => Promise<MeshDeliverResult>;
	/** Workspace alias → absolute path, for alias addressing of peers. */
	workspaceAliases?: () => { alias: string; path: string }[];
	now?: () => number;
	heartbeatMs?: number;
	staleMs?: number;
	ackTimeoutMs?: number;
	injectOnStart?: boolean;
	mailboxRetentionMs?: number;
	/** Clock/pid seams for tests. */
	pidAlive?: (pid: number) => boolean;
	/**
	 * This workspace's messaging gears. Defaults to reading the workspace's
	 * project settings; tests and embedders may inject a provider.
	 */
	gears?: () => MeshGears | Promise<MeshGears>;
}

/** Bounded receipt cache so a late retry cannot deliver the same id twice. */
const SEEN_CAP = 1024;

/** Alias registered in web-config for this workspace root, if any. */
async function aliasForRoot(
	aliases: (() => { alias: string; path: string }[]) | undefined,
	canonicalRoot: string,
): Promise<string | undefined> {
	for (const entry of aliases?.() ?? []) {
		const resolved = await fs.realpath(entry.path).catch(() => path.resolve(entry.path));
		if (resolved === canonicalRoot) return entry.alias;
	}
	return undefined;
}

export class MeshNode {
	readonly workspaceId: string;
	readonly workspaceAlias: string;
	readonly workspaceRoot: string;
	readonly endpoint: string;
	readonly paths: MeshPaths;

	readonly #options: MeshNodeOptions;
	readonly #directory: MeshDirectory;
	readonly #mailbox: MeshMailbox;
	readonly #now: () => number;
	readonly #heartbeatMs: number;
	readonly #ackTimeoutMs: number;
	readonly #retentionMs: number;
	readonly #pidAlive: (pid: number) => boolean;
	readonly #waits = new Map<string, { agentId: string; on: string; since: number }>();
	readonly #seen = new Set<string>();
	readonly #seenOrder: string[] = [];
	readonly #drains = new Map<string, Promise<void>>();
	#server: MeshTransportServer | null = null;
	#heartbeat: NodeJS.Timeout | null = null;
	#token = "";
	#stopped = false;

	private constructor(options: MeshNodeOptions, paths: MeshPaths, workspaceId: string, workspaceAlias: string) {
		this.#options = options;
		this.paths = paths;
		this.workspaceId = workspaceId;
		this.workspaceAlias = workspaceAlias;
		this.workspaceRoot = path.resolve(options.workspaceRoot);
		this.endpoint = paths.endpoint(workspaceId);
		this.#now = options.now ?? Date.now;
		this.#heartbeatMs = options.heartbeatMs ?? MESH_HEARTBEAT_MS;
		this.#ackTimeoutMs = options.ackTimeoutMs ?? MESH_ACK_TIMEOUT_MS;
		this.#retentionMs = options.mailboxRetentionMs ?? MESH_MAILBOX_RETENTION_MS;
		this.#pidAlive = options.pidAlive ?? isPidAlive;
		this.#directory = new MeshDirectory({
			paths,
			now: this.#now,
			staleMs: options.staleMs ?? MESH_STALE_MS,
			pidAlive: this.#pidAlive,
		});
		this.#mailbox = new MeshMailbox(paths);
	}

	/** Start the endpoint and publish the directory record. */
	static async start(options: MeshNodeOptions): Promise<MeshNode> {
		const canonicalRoot = await fs
			.realpath(path.resolve(options.workspaceRoot))
			.catch(() => path.resolve(options.workspaceRoot));
		const workspaceId = options.workspaceId ?? workspaceIdFor(canonicalRoot);
		if (!isSafeWorkspaceId(workspaceId)) throw new MeshError(`Invalid workspace id "${workspaceId}".`);
		const paths = options.meshRoot ? meshPathsAt(options.meshRoot) : meshPaths(options.configRoot);
		await ensureMeshDirs(paths);
		const workspaceAlias =
			options.workspaceAlias?.trim() ||
			(await aliasForRoot(options.workspaceAliases, canonicalRoot)) ||
			path.basename(canonicalRoot);
		const node = new MeshNode(options, paths, workspaceId, workspaceAlias);
		await node.#start(canonicalRoot);
		return node;
	}

	/** Current address for a local agent id. */
	addressFor(localAgentId: string): string {
		return formatMeshAddress(this.workspaceId, localAgentId);
	}

	/** `true` when `raw` names a workspace other than this process's. */
	isCrossProcessAddress(raw: string): boolean {
		const parsed = tryParseMeshAddress(raw);
		return parsed?.workspace !== undefined && !this.#isOwnWorkspace(parsed.workspace);
	}

	/** Local agent id when `raw` is qualified with this workspace; otherwise undefined. */
	stripLocalAddress(raw: string): string | undefined {
		const parsed = tryParseMeshAddress(raw);
		if (!parsed?.workspace || !this.#isOwnWorkspace(parsed.workspace)) return undefined;
		return parsed.agent;
	}

	/** Canonical `<workspaceId>/<agentId>` for any accepted address form. */
	async canonicalAddress(raw: string): Promise<string> {
		const parsed = parseMeshAddress(raw);
		if (!parsed.workspace || this.#isOwnWorkspace(parsed.workspace)) {
			return this.addressFor(parsed.agent);
		}
		const workspaceId = await this.#resolveWorkspace(parsed.workspace);
		return formatMeshAddress(workspaceId, parsed.agent);
	}

	/**
	 * Send one message. `running|idle` peers get a direct socket delivery and
	 * an ack; `parked|gone` peers get an atomic mailbox write plus a `wake`,
	 * reported as `queued`.
	 */
	async send(input: { from: string; to: string; body: string; replyTo?: string }): Promise<MeshSendResult> {
		const raw = input.to.trim();
		let parsed: ParsedAddress;
		try {
			parsed = parseMeshAddress(raw);
		} catch (error) {
			return { to: raw, outcome: "failed", error: error instanceof Error ? error.message : String(error) };
		}
		if (!parsed.workspace) {
			return { to: raw, outcome: "failed", error: `"${raw}" is not a workspace-qualified agent address.` };
		}
		if (!input.body.trim()) return { to: raw, outcome: "failed", error: "A non-empty message is required." };

		let targetWorkspaceId: string;
		try {
			targetWorkspaceId = await this.#resolveWorkspace(parsed.workspace);
		} catch (error) {
			return { to: raw, outcome: "failed", error: error instanceof Error ? error.message : String(error) };
		}

		const envelope: MeshEnvelope = {
			v: MESH_PROTOCOL_VERSION,
			id: Snowflake.next(),
			from: this.#qualify(input.from),
			to: formatMeshAddress(targetWorkspaceId, parsed.agent),
			kind: "message",
			body: input.body,
			sentAt: this.#now(),
		};
		if (input.replyTo !== undefined) envelope.replyTo = input.replyTo;
		if (serializedSize(envelope) > MESH_MAX_ENVELOPE_BYTES) {
			return { to: raw, outcome: "failed", error: `Message exceeds the ${MESH_MAX_ENVELOPE_BYTES} byte limit.` };
		}

		if (targetWorkspaceId === this.workspaceId) {
			const sender = this.#localParty(input.from);
			const targetParty = this.#localParty(parsed.agent);
			if (sender?.role === "main" && targetParty?.role === "main") {
				const gears = await this.#gears();
				const denial = await this.#gearDenial(sender, targetParty, gears, gears.inbound);
				if (denial) return { to: raw, outcome: "failed", error: denial };
			}
			return await this.#sendLocal(envelope, parsed.agent, raw);
		}

		const entries = await this.#directory.list();
		const target = entries.find(entry => entry.record.workspaceId === targetWorkspaceId);
		if (target?.state === "live") {
			const agent = target.record.agents?.find(candidate => candidate.id === parsed.agent);
			if (target.record.agents && !agent) {
				return {
					to: raw,
					outcome: "failed",
					error: `Unknown agent "${parsed.agent}" in workspace ${target.record.workspaceAlias ?? targetWorkspaceId}. Available: ${target.record.agents
						.map(candidate => formatMeshAddress(targetWorkspaceId, candidate.id))
						.join(", ")}.`,
				};
			}
			const targetRole = agent?.role ?? target.record.role;
			const denial = await this.#gearDenialForTarget(input.from, {
				workspaceId: targetWorkspaceId,
				isDefaultWorkspace: isDefaultWorkspace(target.record.workspaceRoot),
				role: targetRole,
				address: envelope.to,
			});
			if (denial) return { to: raw, outcome: "failed", error: denial };
			if (agent?.status === "running" || agent?.status === "idle" || agent === undefined) {
				const result = await this.#deliverOverSocket(envelope, target.record);
				if (result) return { to: raw, outcome: result.outcome, ...(result.error && { error: result.error }) };
			}
			// Parked peer or an endpoint that stopped answering: the persistent
			// path is the only one that cannot lose the message.
			await this.#queue(envelope, target.record);
			return { to: raw, outcome: "queued" };
		}

		if (target) {
			const denial = await this.#gearDenialForTarget(input.from, {
				workspaceId: targetWorkspaceId,
				isDefaultWorkspace: isDefaultWorkspace(target.record.workspaceRoot),
				role: target.record.role,
				address: envelope.to,
			});
			if (denial) return { to: raw, outcome: "failed", error: denial };
		}

		await this.#mailbox.enqueue(targetWorkspaceId, parsed.agent, envelope);
		return { to: raw, outcome: "queued" };
	}

	/** Every addressable agent: this process's agents plus every live peer's. */
	async agents(): Promise<MeshAgentInfo[]> {
		const own: MeshAgentInfo[] = this.#localEntries().map(agent => ({
			address: agent.id,
			id: agent.id,
			role: agent.role,
			status: agent.status,
			workspaceId: this.workspaceId,
			workspaceAlias: this.workspaceAlias,
			workspaceRoot: this.workspaceRoot,
			local: true,
		}));
		const remote: MeshAgentInfo[] = [];
		for (const entry of await this.#directory.list()) {
			if (entry.record.workspaceId === this.workspaceId) continue;
			const record = entry.record;
			const agents: MeshAgentEntry[] =
				record.agents && record.agents.length > 0
					? record.agents
					: [
							{
								id: record.id.includes("/") ? record.id.slice(record.id.indexOf("/") + 1) : record.id,
								role: record.role,
								status: record.status,
							},
						];
			for (const agent of agents) {
				remote.push({
					address: formatMeshAddress(record.workspaceId, agent.id),
					id: agent.id,
					role: agent.role,
					status: entry.state === "gone" ? "gone" : agent.status,
					workspaceId: record.workspaceId,
					...(record.workspaceAlias !== undefined && { workspaceAlias: record.workspaceAlias }),
					workspaceRoot: record.workspaceRoot,
					local: false,
				});
			}
		}
		remote.sort((a, b) => a.address.localeCompare(b.address));
		return [...own, ...remote];
	}

	/** Publish that `localAgentId` is blocked waiting for `on`. */
	async beginWait(localAgentId: string, on: string): Promise<void> {
		if (this.#stopped) return;
		this.#waits.set(localAgentId, { agentId: this.addressFor(localAgentId), on, since: this.#now() });
		await this.#writeRecord();
	}

	/** Withdraw a published wait (safe when never registered). */
	async endWait(localAgentId: string, on: string): Promise<void> {
		const current = this.#waits.get(localAgentId);
		if (!current || current.on !== on) return;
		this.#waits.delete(localAgentId);
		if (!this.#stopped) await this.#writeRecord();
	}

	/** True when a live peer is waiting for a message from `localAgentId`. */
	async peerWaitingOn(localAgentId: string, on: string): Promise<boolean> {
		const me = this.addressFor(localAgentId);
		const now = this.#now();
		for (const entry of await this.#directory.list()) {
			if (entry.state !== "live" || entry.record.workspaceId === this.workspaceId) continue;
			const waiting = (entry.record.waits ?? []).some(
				wait => wait.on === me && wait.agentId === on && now - wait.since < MESH_WAIT_TTL_MS,
			);
			if (waiting) return true;
		}
		return false;
	}

	/** Withdraw the endpoint and directory record. Idempotent. */
	async stop(): Promise<void> {
		if (this.#stopped) return;
		this.#stopped = true;
		clearInterval(this.#heartbeat ?? undefined);
		this.#heartbeat = null;
		await this.#server?.close().catch(() => {});
		this.#server = null;
		await this.#directory.remove(this.workspaceId).catch(() => {});
		if (process.platform !== "win32") await fs.rm(this.endpoint, { force: true }).catch(() => {});
		await Promise.allSettled([...this.#drains.values()]);
	}

	async #start(canonicalRoot: string): Promise<void> {
		// Refuse (rather than clobber) an endpoint another live process owns.
		const existing = await this.#directory.read(this.workspaceId);
		if (
			existing &&
			this.#pidAlive(existing.pid) &&
			this.#now() - existing.updatedAt <= (this.#options.staleMs ?? MESH_STALE_MS)
		) {
			throw new MeshEndpointBusyError(this.workspaceId, existing.pid);
		}
		await this.#directory.remove(this.workspaceId).catch(() => {});
		this.#token = await writeMeshToken(this.paths.tokenFile(this.workspaceId));
		try {
			this.#server = await listenMeshEndpoint({
				endpoint: this.endpoint,
				selfAddress: this.addressFor("main"),
				token: this.#token,
				onEnvelope: envelope => this.#handleEnvelope(envelope),
			});
		} catch (error) {
			await fs.rm(this.paths.tokenFile(this.workspaceId), { force: true }).catch(() => {});
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EADDRINUSE" || code === "EPERM") {
				const record = await this.#directory.read(this.workspaceId);
				throw new MeshEndpointBusyError(this.workspaceId, record?.pid);
			}
			throw error;
		}
		await this.#writeRecord();
		this.#heartbeat = setInterval(() => void this.#tick(), this.#heartbeatMs);
		if (this.#options.injectOnStart !== false) {
			await Promise.all(this.#localEntries().map(agent => this.#drainAgent(agent.id, true)));
		}
		await this.#cleanupMailboxes();
	}

	async #tick(): Promise<void> {
		if (this.#stopped) return;
		await this.#writeRecord().catch(error =>
			logger.debug("mesh: heartbeat write failed", { workspaceId: this.workspaceId, error: String(error) }),
		);
		for (const agent of this.#localEntries()) {
			if (agent.status === "running" || agent.status === "idle") await this.#drainAgent(agent.id, false);
		}
		await this.#cleanupMailboxes().catch(() => {});
	}

	async #cleanupMailboxes(): Promise<void> {
		const entries = await this.#directory.list().catch(() => []);
		const live = new Set(entries.filter(entry => entry.state === "live").map(entry => entry.record.workspaceId));
		live.add(this.workspaceId);
		await this.#mailbox.cleanupGone(workspaceId => !live.has(workspaceId), this.#retentionMs, this.#now());
	}

	async #handleEnvelope(envelope: MeshEnvelope): Promise<{ ok: boolean; outcome?: MeshSendOutcome; error?: string }> {
		if (envelope.kind === "ack") return { ok: true };
		const localId = this.stripLocalAddress(envelope.to);
		if (!localId) return { ok: false, error: `"${envelope.to}" is not owned by workspace ${this.workspaceId}.` };
		if (this.#seen.has(envelope.id)) return { ok: true, outcome: "injected" };
		const agent = this.#localAgent(localId);

		if (envelope.kind === "wake") {
			if (!agent) return { ok: false, error: `Unknown agent "${localId}".` };
			await this.#drainAgent(agent.id, true);
			this.#remember(envelope.id);
			return { ok: true, outcome: "queued" };
		}

		if (!agent) {
			return {
				ok: false,
				error: `Unknown agent "${localId}". Available: ${this.#localEntries()
					.map(candidate => candidate.id)
					.join(", ")}.`,
			};
		}
		const inboundDenial = await this.#inboundDenial(envelope, agent);
		if (inboundDenial) return { ok: false, error: inboundDenial };
		if (agent.status === "parked" || agent.status === "gone") {
			await this.#mailbox.enqueue(this.workspaceId, agent.id, envelope);
			await this.#drainAgent(agent.id, true);
			this.#remember(envelope.id);
			return { ok: true, outcome: "queued" };
		}
		const result = await this.#options.deliver(envelope, agent.id);
		if (result.outcome !== "failed") this.#remember(envelope.id);
		return { ok: result.outcome !== "failed", outcome: result.outcome, ...(result.error && { error: result.error }) };
	}

	async #sendLocal(envelope: MeshEnvelope, localId: string, raw: string): Promise<MeshSendResult> {
		const agent = this.#localAgent(localId);
		if (!agent) {
			return {
				to: raw,
				outcome: "failed",
				error: `Unknown agent "${localId}". Available: ${this.#localEntries()
					.map(candidate => candidate.id)
					.join(", ")}.`,
			};
		}
		if (agent.status === "running" || agent.status === "idle") {
			const result = await this.#options.deliver(envelope, agent.id);
			if (result.outcome !== "failed") return { to: raw, outcome: result.outcome };
		}
		await this.#mailbox.enqueue(this.workspaceId, agent.id, envelope);
		await this.#drainAgent(agent.id, true);
		return { to: raw, outcome: "queued" };
	}

	/** Direct socket delivery; undefined means "fall back to the mailbox". */
	async #deliverOverSocket(
		envelope: MeshEnvelope,
		record: MeshDirectoryRecord,
	): Promise<MeshDeliverResult | undefined> {
		const token = await readMeshToken(this.paths.tokenFile(record.workspaceId));
		if (!token) return undefined;
		const result = await sendMeshEnvelope({
			endpoint: record.endpoint,
			token,
			envelope,
			timeoutMs: this.#ackTimeoutMs,
		});
		if (!result.delivered || !result.payload) {
			logger.debug("mesh: direct delivery failed, queueing", {
				to: envelope.to,
				error: result.error,
			});
			return undefined;
		}
		if (!result.payload.ok) {
			return { outcome: "failed", error: result.payload.error ?? "Peer rejected the message." };
		}
		return { outcome: result.payload.outcome ?? "injected" };
	}

	/** Queue offline + best-effort wake for a peer we can still reach. */
	async #queue(envelope: MeshEnvelope, record: MeshDirectoryRecord): Promise<void> {
		const parsed = parseMeshAddress(envelope.to);
		await this.#mailbox.enqueue(record.workspaceId, parsed.agent, envelope);
		const token = await readMeshToken(this.paths.tokenFile(record.workspaceId));
		if (!token) return;
		const wake: MeshEnvelope = {
			v: MESH_PROTOCOL_VERSION,
			id: Snowflake.next(),
			from: envelope.from,
			to: envelope.to,
			kind: "wake",
			body: JSON.stringify({ agent: parsed.agent }),
			sentAt: this.#now(),
			replyTo: envelope.id,
		};
		await sendMeshEnvelope({
			endpoint: record.endpoint,
			token,
			envelope: wake,
			timeoutMs: this.#ackTimeoutMs,
		}).catch(() => {});
	}

	#drainAgent(localId: string, force: boolean): Promise<void> {
		const previous = this.#drains.get(localId) ?? Promise.resolve();
		const next = previous
			.then(() => this.#drainNow(localId, force))
			.catch(error => {
				logger.warn("mesh: mailbox injection failed", { agentId: localId, error: String(error) });
			});
		this.#drains.set(localId, next);
		return next;
	}

	async #drainNow(localId: string, force: boolean): Promise<void> {
		const pending = await this.#mailbox.pending(this.workspaceId, localId);
		const localAgent = this.#localEntries().find(candidate => candidate.id === localId);
		for (const envelope of pending) {
			if (this.#seen.has(envelope.id)) {
				// Already injected through the direct path; a retry that raced the
				// ack must not deliver the same id twice.
				await this.#mailbox.markDelivered(this.workspaceId, localId, envelope);
				continue;
			}
			if (!force) {
				if (!localAgent || (localAgent.status !== "running" && localAgent.status !== "idle")) return;
			}
			if (localAgent) {
				const denial = await this.#inboundDenial(envelope, localAgent);
				if (denial) {
					logger.warn("mesh: dropping mailbox message refused by the inbound gear", {
						workspaceId: this.workspaceId,
						agentId: localId,
						from: envelope.from,
						error: denial,
					});
					await this.#mailbox.markDelivered(this.workspaceId, localId, envelope);
					continue;
				}
			}
			const result = await this.#options.deliver(envelope, localId);
			if (result.outcome === "failed") return;
			this.#remember(envelope.id);
			await this.#mailbox.markDelivered(this.workspaceId, localId, envelope);
		}
	}

	#remember(id: string): void {
		if (this.#seen.has(id)) return;
		this.#seen.add(id);
		this.#seenOrder.push(id);
		if (this.#seenOrder.length > SEEN_CAP) {
			const oldest = this.#seenOrder.shift();
			if (oldest) this.#seen.delete(oldest);
		}
	}

	#localEntries(): MeshAgentEntry[] {
		return this.#options.localAgents().map(agent => ({
			id: agent.id,
			role: agent.role ?? "main",
			status: agent.status,
		}));
	}

	/**
	 * Local agent for an incoming id. `main` is the documented alias for the
	 * workspace's main agent, so it matches `Main` regardless of case; every
	 * other id matches exactly.
	 */
	#localAgent(localId: string): MeshAgentEntry | undefined {
		const entries = this.#localEntries();
		const exact = entries.find(candidate => candidate.id === localId);
		if (exact || localId.toLowerCase() !== "main") return exact;
		return entries.find(candidate => candidate.id.toLowerCase() === "main");
	}

	#aggregateStatus(agents: MeshAgentEntry[]): MeshAgentStatus {
		if (agents.some(agent => agent.status === "running")) return "running";
		if (agents.some(agent => agent.status === "idle")) return "idle";
		return agents.length > 0 ? "parked" : "gone";
	}

	async #writeRecord(): Promise<void> {
		const agents = this.#localEntries();
		const gears = await this.#gears().catch(() => ({ inbound: "closed" as const, outbound: "closed" as const }));
		const record: MeshDirectoryRecord = {
			id: this.addressFor(agents[0]?.id ?? "main"),
			workspaceId: this.workspaceId,
			workspaceAlias: this.workspaceAlias,
			workspaceRoot: this.workspaceRoot,
			pid: process.pid,
			endpoint: this.endpoint,
			role: this.#options.role ?? "main",
			status: this.#aggregateStatus(agents),
			updatedAt: this.#now(),
			agents,
			waits: [...this.#waits.values()],
			inboundGear: gears.inbound,
			outboundGear: gears.outbound,
		};
		await this.#directory.write(record);
	}

	#qualify(from: string): string {
		const parsed = tryParseMeshAddress(from);
		if (parsed?.workspace !== undefined) {
			if (this.#isOwnWorkspace(parsed.workspace)) return this.addressFor(parsed.agent);
			return formatMeshAddress(parsed.workspace, parsed.agent);
		}
		return this.addressFor(parsed?.agent ?? from);
	}

	#isOwnWorkspace(selector: string): boolean {
		return (
			selector === this.workspaceId ||
			selector === this.workspaceAlias ||
			selector === path.basename(this.workspaceRoot)
		);
	}

	/** This process's workspace gears, from injected options or its project settings. */
	async #gears(): Promise<MeshGears> {
		return this.#options.gears ? await this.#options.gears() : await readWorkspaceGears(this.workspaceRoot);
	}

	/** Party for one of this process's local agents, if `raw` names it. */
	#localParty(raw: string): GearParty | undefined {
		const parsed = tryParseMeshAddress(raw);
		if (parsed?.workspace !== undefined && !this.#isOwnWorkspace(parsed.workspace)) return undefined;
		const agent = parsed ? this.#localAgent(parsed.agent) : undefined;
		if (!agent) return undefined;
		return {
			workspaceId: this.workspaceId,
			isDefaultWorkspace: isDefaultWorkspace(this.workspaceRoot),
			role: agent.role,
			address: this.addressFor(agent.id),
		};
	}

	/**
	 * Error when this process's outbound gear or `target`'s inbound gear refuses
	 * the call. `targetInbound` is the target's published gear; when a peer does
	 * not publish one yet, only the outbound direction is checked here and the
	 * receiver applies its own inbound gear.
	 */
	#gearDenial(
		sender: GearParty,
		target: GearParty,
		gears: MeshGears,
		targetInbound: MeshGears["inbound"] | undefined,
	): string | undefined {
		const decision = evaluateGearCall({
			sender,
			target,
			senderOutbound: gears.outbound,
			targetInbound: targetInbound ?? "open",
		});
		return decision.allowed ? undefined : decision.error;
	}

	/** {@link #gearDenial} for a send, reading the target's advertised inbound gear. */
	async #gearDenialForTarget(from: string, target: GearParty): Promise<string | undefined> {
		const sender = this.#localParty(from);
		if (!sender || sender.role !== "main" || target.role !== "main") return undefined;
		const gears = await this.#gears();
		const targetInbound =
			target.workspaceId === this.workspaceId
				? gears.inbound
				: (await this.#directory.read(target.workspaceId))?.inboundGear;
		return this.#gearDenial(sender, target, gears, targetInbound);
	}

	/**
	 * Error when this workspace's inbound gear refuses `envelope.from`. Applied
	 * to direct deliveries and mailbox drains, so an offline message queued
	 * before a gear tightened cannot bypass the current setting.
	 */
	async #inboundDenial(envelope: MeshEnvelope, localAgent: MeshAgentEntry): Promise<string | undefined> {
		if (localAgent.role !== "main" || envelope.kind !== "message") return undefined;
		const from = tryParseMeshAddress(envelope.from);
		if (!from?.workspace || this.#isOwnWorkspace(from.workspace)) return undefined;
		const record = await this.#directory.read(from.workspace);
		const role = record?.agents?.find(candidate => candidate.id === from.agent)?.role ?? record?.role ?? "main";
		const gears = await this.#gears();
		const allowed = gearAllows(gears.inbound, {
			sameWorkspace: false,
			otherRole: role,
			otherIsDefaultWorkspace: record ? isDefaultWorkspace(record.workspaceRoot) : false,
		});
		if (allowed) return undefined;
		return (
			`Workspace ${this.workspaceId}'s inbound messaging gear "${gears.inbound}" refuses calls from ` +
			`${envelope.from} (${role}, workspace ${from.workspace}).`
		);
	}

	/** Resolve a workspace selector to its id; ambiguity is an explicit error. */
	async #resolveWorkspace(selector: string): Promise<string> {
		if (this.#isOwnWorkspace(selector)) return this.workspaceId;
		const candidates = new Map<string, Set<string>>();
		const candidateAliases = new Map<string, string>();
		const add = (key: string | undefined, workspaceId: string): void => {
			if (!key) return;
			const set = candidates.get(key) ?? new Set<string>();
			set.add(workspaceId);
			candidates.set(key, set);
		};
		add(this.workspaceId, this.workspaceId);
		add(this.workspaceAlias, this.workspaceId);
		add(path.basename(this.workspaceRoot), this.workspaceId);
		for (const entry of await this.#directory.list()) {
			const record = entry.record;
			if (record.workspaceAlias && !candidateAliases.has(record.workspaceId)) {
				candidateAliases.set(record.workspaceId, record.workspaceAlias);
			}
			add(record.workspaceId, record.workspaceId);
			add(record.workspaceAlias, record.workspaceId);
			add(path.basename(record.workspaceRoot), record.workspaceId);
		}
		for (const alias of this.#options.workspaceAliases?.() ?? []) {
			const resolved = await fs.realpath(alias.path).catch(() => path.resolve(alias.path));
			const workspaceId = workspaceIdFor(resolved);
			add(alias.alias, workspaceId);
			add(workspaceId, workspaceId);
			add(path.basename(resolved), workspaceId);
		}
		const matches = candidates.get(selector);
		if (matches?.size === 1) return [...matches][0]!;
		if (matches && matches.size > 1) {
			throw new MeshAddressAmbiguousError(
				selector,
				[...matches].map(workspaceId => `${workspaceId} (${candidateAliases.get(workspaceId) ?? "?"})`),
			);
		}
		// An explicit workspace id may name a workspace whose process is offline
		// and that this config root has never registered: queue by id.
		if (/^[0-9a-f]{12}$/.test(selector)) return selector;
		throw new MeshAddressUnknownError(selector, [...new Set([...candidates.keys()])].sort());
	}
}
