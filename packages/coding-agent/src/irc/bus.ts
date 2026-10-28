/**
 * IrcBus - Process-global mailbox bus for agent-to-agent messaging.
 *
 * Replaces the old auto-reply model: a `send` never blocks on the recipient
 * generating anything. Delivery resolves the recipient via the global
 * AgentRegistry — parked and killed agents are revived through the
 * AgentLifecycleManager, idle agents are woken with a real turn, and busy
 * agents receive the message as a non-interrupting aside at the next step
 * boundary (see AgentSession.deliverIrcMessage).
 */

import { type IrcDeliveryReceipt, type IrcMessage } from "@linxiraos/pi-tui/tools/irc";
import { logger, Snowflake } from "@linxiraos/pi-utils";
import * as path from "node:path";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry, isMainAgentAlias, MAIN_AGENT_ID, type AgentRef } from "../registry/agent-registry";
import { getMeshNode } from "../mesh/global";
import { formatMeshAddress, tryParseMeshAddress } from "../mesh/envelope";
import { evaluateGearCall, gearsFromSettings, type GearParty } from "../mesh/gears";
import type { MeshNode } from "../mesh/mesh-node";
import { isDefaultWorkspace } from "../default-workspace";
import type { CustomMessage } from "../session/messages";

interface IrcWaiter {
	from?: string;
	resolve: (msg: IrcMessage) => void;
	cancel: () => void;
}

/** When a send went out: wall-clock `ts`, and `seq` to order sends within one millisecond. */
interface SendMark {
	ts: number;
	seq: number;
}

/** Mailbox cap per agent; oldest messages are dropped beyond it. */
const MAILBOX_CAP = 100;

/**
 * Raised when a peer's `await` window closes because that peer stopped rather
 * than because the wait timed out — distinct from a normal timeout so callers
 * can report the real cause.
 */
export class IrcAwaitTargetStopped extends Error {
	constructor(target: string) {
		super(`Awaited peer "${target}" stopped without replying.`);
		this.name = "IrcAwaitTargetStopped";
	}
}

export class IrcBus {
	static #global: IrcBus | undefined;

	static global(): IrcBus {
		if (!IrcBus.#global) {
			IrcBus.#global = new IrcBus();
		}
		return IrcBus.#global;
	}

	/** Reset the global bus. Test-only. */
	static resetGlobalForTests(): void {
		IrcBus.#global = undefined;
	}

	/**
	 * Count a settled job of agent `from` owned by `to` as `from`'s reply to
	 * `to`: the job delivers that agent's outcome, so it answers what `to`
	 * asked it before now (see {@link unansweredSends}). With no bus yet no
	 * message was ever sent, so there is nothing to answer.
	 */
	static recordReply(from: string, to: string): void {
		const bus = IrcBus.#global;
		if (bus) bus.#recordReply(from, to);
	}

	readonly #registry: AgentRegistry;
	readonly #lifecycle: () => AgentLifecycleManager;
	readonly #mailboxes = new Map<string, IrcMessage[]>();
	readonly #waiters = new Map<string, IrcWaiter[]>();
	/** The latest successful send per `from` → `to`; see {@link sentSince}. */
	readonly #lastSent = new Map<string, Map<string, SendMark>>();
	/** The latest direct (non-broadcast) send per `from` → `to`; see {@link unansweredSends}. */
	readonly #lastDirect = new Map<string, Map<string, SendMark>>();
	/** The latest job-carried reply per agent → owner; see {@link IrcBus.recordReply}. */
	readonly #lastJobReply = new Map<string, Map<string, SendMark>>();
	/** Last {@link SendMark.seq} handed out, taken when a send starts. */
	#sendSeq = 0;

	constructor(registry: AgentRegistry = AgentRegistry.global(), lifecycle?: AgentLifecycleManager) {
		this.#registry = registry;
		// Lazy: the lifecycle global self-constructs against the global registry,
		// so only touch it when a parked recipient actually needs reviving.
		this.#lifecycle = () => lifecycle ?? AgentLifecycleManager.global();
	}

	/**
	 * Fire-and-forget delivery. Never blocks on the recipient generating
	 * anything: the receipt reports how the message reached the recipient
	 * (waiter/aside = "injected", idle wake = "woken", park revival =
	 * "revived"), not what they did with it.
	 *
	 * Mailbox semantics: a successfully delivered message never lingers in
	 * the recipient's mailbox — injection/wake puts the full body into their
	 * context, so buffering it too would double-deliver via a later
	 * `wait`/`inbox` and inflate unread counts. Only a failed live hand-off
	 * is buffered for the recipient to drain later.
	 *
	 * `opts.suppressRelay` skips the display-only main-UI relay for this leg.
	 * Set by broadcast fan-out when the same broadcast also targets the main
	 * agent directly: the main agent then already sees the body as its own
	 * incoming card, so relaying the sibling legs would duplicate it.
	 */
	/**
	 * `opts.expectsReply` marks sends whose caller is blocked on an answer
	 * (`send await:true`). It is forwarded to the recipient session so a
	 * mid-turn recipient that cannot reach a step boundary can generate an
	 * ephemeral auto-reply instead of stranding the sender until timeout.
	 *
	 * `opts.suppressRelay` skips the display-only main-UI relay for this leg.
	 */
	async send(
		msg: Omit<IrcMessage, "id" | "ts">,
		opts?: { expectsReply?: boolean; suppressRelay?: boolean },
	): Promise<IrcDeliveryReceipt> {
		const message: IrcMessage = { ...msg, id: Snowflake.next(), ts: Date.now() };
		// Taken before delivery: a reply sent while this message is still being
		// delivered must still order after it.
		const mark: SendMark = { ts: message.ts, seq: ++this.#sendSeq };
		const receipt = await this.#deliver(message, opts);
		if (receipt.outcome !== "failed") {
			this.#record(this.#lastSent, message.from, message.to, mark);
			if (!message.broadcast && !message.wakeRelay) this.#record(this.#lastDirect, message.from, message.to, mark);
		}
		return receipt;
	}

	#record(table: Map<string, Map<string, SendMark>>, from: string, to: string, mark: SendMark): void {
		let sent = table.get(from);
		if (!sent) {
			sent = new Map();
			table.set(from, sent);
		}
		// Deliveries can settle out of order; keep the latest send.
		if ((sent.get(to)?.seq ?? 0) < mark.seq) sent.set(to, mark);
	}

	#recordReply(from: string, to: string): void {
		this.#record(this.#lastJobReply, from, to, { ts: Date.now(), seq: ++this.#sendSeq });
	}

	/**
	 * Whether `from` successfully sent `to` anything at or after `sinceTs`.
	 * The wake-turn relay uses it to skip agents that already answered their
	 * waker themselves.
	 */
	sentSince(from: string, to: string, sinceTs: number): boolean {
		const sent = this.#lastSent.get(from)?.get(to);
		return sent !== undefined && sent.ts >= sinceTs;
	}

	/**
	 * Agents `from` messaged directly at or after `sinceTs` that have sent
	 * nothing back since, nor settled a job `from` owns, with when the latest
	 * of those messages went out: the replies a `wait` can block for. "Since"
	 * is by send order, not timestamp, so an answer to an earlier question
	 * never settles a later one sent within the same millisecond.
	 */
	unansweredSends(from: string, sinceTs: number): Array<{ to: string; sentAt: number }> {
		const sends = this.#lastDirect.get(from);
		if (!sends) return [];
		const unanswered: Array<{ to: string; sentAt: number }> = [];
		for (const [to, sent] of sends) {
			if (sent.ts < sinceTs) continue;
			const answered = [this.#lastSent, this.#lastJobReply].some(
				replies => (replies.get(to)?.get(from)?.seq ?? 0) > sent.seq,
			);
			if (!answered) unanswered.push({ to, sentAt: sent.ts });
		}
		return unanswered;
	}

	async #deliver(
		message: IrcMessage,
		opts?: { expectsReply?: boolean; suppressRelay?: boolean },
	): Promise<IrcDeliveryReceipt> {
		// Cross-process addressing is opt-in by shape: an unprefixed id is
		// resolved in this process exactly as before, and with no mesh node
		// installed (CLI, single-process hosts) nothing here changes.
		const mesh = getMeshNode();
		// `agent://<id>` is accepted anywhere agent ids are; strip the scheme
		// before the local lookup so a scheme-prefixed local id still resolves.
		const requestedRaw = message.to.startsWith("agent://") ? message.to.slice("agent://".length) : message.to;
		// A workspace-qualified target can name another workspace hosted by this
		// same process (`serve` runs sessions for several roots). Resolve it
		// locally first: it is not remote, so it must not fall through to an
		// offline mailbox. This is separate from the mesh's own-workspace strip.
		let requested = requestedRaw;
		const parsedRequested = tryParseMeshAddress(requestedRaw);
		if (parsedRequested?.workspace) {
			const local = this.#localWorkspaceRef(parsedRequested.workspace, parsedRequested.agent);
			if (local) requested = local.id;
		}
		// `main` names the main agent of the caller's own workspace — not a
		// same-named root of another workspace, and not a silent self-delivery
		// when the caller is that main. Resolve locally first; a workspace whose
		// main lives in another process is addressed through the mesh by id.
		if (isMainAgentAlias(requestedRaw)) {
			const caller = this.#registry.get(message.from);
			const main = this.#registry.workspaceMain(caller?.workspaceId);
			if (main) {
				requested = main.id;
			} else if (mesh) {
				const address = formatMeshAddress(caller?.workspaceId ?? mesh.workspaceId, "main");
				// Routing back into this process would re-enter this same alias,
				// find no live main, and bounce through the mailbox drain queue
				// forever. A local workspace with no live main is a local failure.
				if (mesh.stripLocalAddress(address) === undefined) {
					return await this.#sendOverMesh(mesh, message, address);
				}
			}
		}
		const localTarget = mesh?.stripLocalAddress(requested);
		const target = localTarget ?? requested;
		const ref = this.#registry.get(target);
		const senderRef = this.#registry.get(message.from);
		const subagentError = this.#subagentSendError(senderRef, ref, requested);
		if (subagentError) return { to: target, outcome: "failed", error: subagentError };
		if (!ref) {
			if (mesh && localTarget === undefined && mesh.isCrossProcessAddress(requested)) {
				return await this.#sendOverMesh(mesh, message, requested);
			}
			return {
				to: message.to,
				outcome: "failed",
				error: `Unknown agent "${requested}" — check the subagent roster or read history:// for known peers.`,
			};
		}
		if (target === message.from) {
			return { to: target, outcome: "failed", error: "Cannot send a message to yourself." };
		}
		// Advisor refs are observability-only transcripts, never messageable peers.
		if (ref.kind === "advisor") {
			return {
				to: target,
				outcome: "failed",
				error: `Agent "${target}" is a read-only advisor transcript and cannot be messaged.`,
			};
		}

		// A `parked` or killed (`aborted`) recipient always needs the lifecycle to
		// revive it from its transcript — this is read from *this* bus's registry,
		// so it holds for any registry. The mid-park / adopted checks below query
		// the lifecycle's own state, which only describes the registry it manages:
		// consult them only when the lifecycle owns this bus's registry, otherwise
		// a custom-registry bus (fallen back to the global manager) would gate a
		// live recipient on unrelated global park state. Main/non-adopted live
		// peers skip the gate, and pending waiters still win without a session.
		const lifecycle = this.#lifecycle();
		const lifecycleOwnsRegistry = lifecycle.manages(this.#registry);
		const needsLifecycleGate =
			ref.status === "parked" ||
			ref.status === "aborted" ||
			(lifecycleOwnsRegistry && (lifecycle.isParking(target) || lifecycle.has(target)));

		const priorSession = ref.session;
		let revived = false;
		if (needsLifecycleGate) {
			try {
				const liveSession = await lifecycle.ensureLive(target);
				// Revival = we did not keep the same live instance (parked start, or
				// park completed and a fresh session was rebuilt).
				revived = !priorSession || liveSession !== priorSession;
			} catch (error) {
				// Not revivable / released / revive failed. Do not buffer: a permanent
				// failure must not inflate unread counts or pretend delivery is pending.
				return {
					to: target,
					outcome: "failed",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}

		const gearError = await this.#gearError(senderRef, this.#registry.get(target) ?? ref, target);
		if (gearError) return { to: target, outcome: "failed", error: gearError };

		// An address qualified with this workspace is delivered under the local
		// id so the recipient sees the same id it uses in-process.
		const deliveryMessage = target === message.to ? message : { ...message, to: target };

		// A pending `wait` from the recipient consumes the message directly —
		// it is returned from their irc tool call and never hits the inbox or
		// the session injection path.
		const waiter = this.#takeMatchingWaiter(target, message.from);
		if (waiter) {
			waiter.resolve(deliveryMessage);
			if (!opts?.suppressRelay) this.#relayToMainUi(deliveryMessage);
			return { to: target, outcome: revived ? "revived" : "injected" };
		}

		const session = this.#registry.get(target)?.session;
		if (!session) {
			return { to: target, outcome: "failed", error: `Agent "${target}" has no live session.` };
		}

		try {
			const delivery = await session.deliverIrcMessage(deliveryMessage);
			if (!opts?.suppressRelay) this.#relayToMainUi(deliveryMessage);
			return { to: target, outcome: revived ? "revived" : delivery };
		} catch (error) {
			// Live hand-off failed (e.g. recipient disposed mid-shutdown): buffer
			// the message so a later `wait`/`inbox` from the recipient can still
			// pick it up. The receipt stays "failed" — the recipient has not
			// seen it.
			this.#enqueue(deliveryMessage);
			return {
				to: target,
				outcome: "failed",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * The main agent that spawned `ref`: walk nested `parentId` links to the
	 * root, which is the only agent a subagent may message.
	 */
	#spawningMainId(ref: AgentRef): string | undefined {
		const seen = new Set<string>();
		let current = ref;
		while (current.parentId !== undefined && !seen.has(current.parentId)) {
			seen.add(current.parentId);
			const parent = this.#registry.get(current.parentId);
			if (!parent) return current.parentId;
			current = parent;
		}
		return current.kind === "main" && current.parentId === undefined ? current.id : undefined;
	}

	/** Hard rule 1: a subagent may only message the main agent that spawned it. */
	#subagentSendError(
		sender: AgentRef | undefined,
		targetRef: AgentRef | undefined,
		requested: string,
	): string | undefined {
		if (!sender || sender.kind !== "sub" || sender.parentId === undefined) return undefined;
		const mainId = this.#spawningMainId(sender);
		if (mainId === undefined) {
			return `Subagent "${sender.id}" has no resolvable spawning main agent, so it may not message "${requested}".`;
		}
		const sameWorkspace =
			sender.workspaceId === undefined ||
			targetRef?.workspaceId === undefined ||
			sender.workspaceId === targetRef.workspaceId;
		// Upstream v18.13 peer messaging (18.13.0 #16583) lets a subagent reach any
		// peer in its own workspace; only cross-workspace addressing stays behind
		// Zeta's mesh isolation rule.
		if (sameWorkspace) return undefined;
		return (
			`Subagent "${sender.id}" may only message its spawning main agent "${mainId}"; ` +
			`sending to "${requested}" is not allowed.`
		);
	}

	/** A ref for `workspace`/`agentId` when that workspace is hosted by this process. */
	#localWorkspaceRef(workspace: string, agentId: string): AgentRef | undefined {
		const ref = this.#registry.get(agentId);
		if (!ref?.workspaceId) return undefined;
		if (ref.workspaceId === workspace) return ref;
		const cwd = ref.session?.settings?.getCwd();
		if (cwd && path.basename(cwd) === workspace) return ref;
		return undefined;
	}

	/**
	 * Gear failure for a local main→main call. A source without a project layer
	 * (an extension-provided session, a test fake) has no gears, so the
	 * historical in-process behavior is preserved.
	 */
	async #gearError(
		sender: AgentRef | undefined,
		target: AgentRef | undefined,
		targetId: string,
	): Promise<string | undefined> {
		if (!sender || !target || sender.kind !== "main" || target.kind !== "main") return undefined;
		if (!sender.workspaceId || !target.workspaceId) return undefined;
		const senderGears = gearsFromSettings(sender.session?.settings);
		const targetGears = gearsFromSettings(target.session?.settings);
		if (!senderGears || !targetGears) return undefined;
		const senderParty: GearParty = {
			workspaceId: sender.workspaceId,
			isDefaultWorkspace: isDefaultWorkspace(sender.session?.settings?.getCwd()),
			role: "main",
			address: sender.id,
		};
		const targetParty: GearParty = {
			workspaceId: target.workspaceId,
			isDefaultWorkspace: isDefaultWorkspace(target.session?.settings?.getCwd()),
			role: "main",
			address: targetId,
		};
		const decision = evaluateGearCall({
			sender: senderParty,
			target: targetParty,
			senderOutbound: senderGears.outbound,
			targetInbound: targetGears.inbound,
		});
		return decision.allowed ? undefined : decision.error;
	}

	/** Send one message through the mesh and normalize the receipt. */
	async #sendOverMesh(mesh: MeshNode, message: IrcMessage, to: string): Promise<IrcDeliveryReceipt> {
		const result = await mesh.send({
			from: message.from,
			to,
			body: message.body,
			...(message.replyTo !== undefined && { replyTo: message.replyTo }),
		});
		return result.outcome === "failed"
			? { to, outcome: "failed", error: result.error }
			: { to, outcome: result.outcome };
	}

	/**
	 * Block until a message for `agentId` (optionally from `filter.from`)
	 * arrives; consume + return it. Null on timeout (`timeoutMs <= 0` waits
	 * forever). Rejects when `signal` aborts. By default, already-buffered
	 * mail satisfies the wait before parking a future waiter; callers that
	 * need a strictly future reply can disable that drain.
	 */
	async wait(
		agentId: string,
		filter: { from?: string },
		timeoutMs: number,
		signal?: AbortSignal,
		options?: {
			drainPending?: boolean;
			liveness?: { registry: AgentRegistry; senderId: string };
		},
	): Promise<IrcMessage | null> {
		if (signal?.aborted) {
			throw signal.reason instanceof Error ? signal.reason : new Error("IRC wait aborted");
		}

		if (options?.drainPending !== false) {
			// Already-pending mail satisfies the wait without parking a waiter.
			const pending = this.#takeFromMailbox(agentId, filter.from);
			if (pending) return pending;
		}

		const { promise, resolve, reject } = Promise.withResolvers<IrcMessage | null>();
		let timer: NodeJS.Timeout | undefined;
		let onAbort: (() => void) | undefined;
		let unsubscribeLiveness: (() => void) | undefined;

		const liveness = options?.liveness;
		const livenessReason = filter.from
			? `IRC wait aborted: agent "${filter.from}" is not running`
			: "IRC wait aborted: no running peers remain";

		const settle = (
			outcome: { kind: "message"; msg: IrcMessage } | { kind: "timeout" } | { kind: "abort"; error: Error },
		): void => {
			cleanup();
			if (outcome.kind === "message") {
				resolve(outcome.msg);
			} else if (outcome.kind === "timeout") {
				resolve(null);
			} else {
				reject(outcome.error);
			}
		};

		const cleanup = (): void => {
			this.#removeWaiter(agentId, waiter);
			clearTimeout(timer);
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
			unsubscribeLiveness?.();
		};

		const waiter: IrcWaiter = {
			from: filter.from,
			resolve: msg => settle({ kind: "message", msg }),
			cancel: () => cleanup(),
		};

		if (signal) {
			onAbort = () =>
				settle({
					kind: "abort",
					error: signal.reason instanceof Error ? signal.reason : new Error("IRC wait aborted"),
				});
			signal.addEventListener("abort", onAbort, { once: true });
		}
		if (timeoutMs > 0) {
			timer = setTimeout(() => settle({ kind: "timeout" }), timeoutMs);
			timer.unref?.();
		}

		let waiters = this.#waiters.get(agentId);
		if (!waiters) {
			waiters = [];
			this.#waiters.set(agentId, waiters);
		}
		waiters.push(waiter);

		if (liveness) {
			const { registry, senderId } = liveness;
			const hasRunningSender = (from?: string): boolean =>
				registry.listVisibleTo(senderId).some(ref => registry.isRunning(ref) && (!from || ref.id === from));
			const check = filter.from ? () => hasRunningSender(filter.from) : () => hasRunningSender();
			unsubscribeLiveness = registry.onChange(() => {
				if (!check()) {
					settle({ kind: "abort", error: new Error(livenessReason) });
				}
			});
			if (!check()) {
				settle({ kind: "abort", error: new Error(livenessReason) });
			}
		}

		return promise;
	}

	/**
	 * Consume the OLDEST pending message for `agentId` (optionally restricted
	 * to `from`), leaving the rest of the mailbox intact. This is the exact
	 * atomic step `wait` performs on entry, exposed for callers that must not
	 * block without draining the entire backlog.
	 */
	/**
	 * Drain (or peek at) an agent's mailbox. `peek` leaves the messages in place
	 * so a later `inbox` still returns them.
	 */
	inbox(agentId: string, opts?: { peek?: boolean }): IrcMessage[] {
		const mailbox = this.#mailboxes.get(agentId);
		if (!mailbox || mailbox.length === 0) return [];
		if (opts?.peek) return [...mailbox];
		this.#mailboxes.delete(agentId);
		return mailbox;
	}

	take(agentId: string, from?: string): IrcMessage | undefined {
		return this.#takeFromMailbox(agentId, from);
	}

	/** Unread count for the local Agent Hub overlay. */
	unreadCount(agentId: string): number {
		return this.#mailboxes.get(agentId)?.length ?? 0;
	}

	#enqueue(message: IrcMessage): void {
		let mailbox = this.#mailboxes.get(message.to);
		if (!mailbox) {
			mailbox = [];
			this.#mailboxes.set(message.to, mailbox);
		}
		mailbox.push(message);
		if (mailbox.length > MAILBOX_CAP) {
			const dropped = mailbox.shift();
			logger.debug("IrcBus: mailbox full, dropped oldest message", {
				agentId: message.to,
				droppedId: dropped?.id,
				droppedFrom: dropped?.from,
			});
		}
	}

	/** Resolve the OLDEST waiter for `agentId` whose from-filter accepts `from`. */
	#takeMatchingWaiter(agentId: string, from: string): IrcWaiter | undefined {
		const waiters = this.#waiters.get(agentId);
		if (!waiters) return undefined;
		const index = waiters.findIndex(waiter => !waiter.from || waiter.from === from);
		if (index === -1) return undefined;
		const [waiter] = waiters.splice(index, 1);
		if (waiters.length === 0) this.#waiters.delete(agentId);
		return waiter;
	}

	#removeWaiter(agentId: string, waiter: IrcWaiter): void {
		const waiters = this.#waiters.get(agentId);
		if (!waiters) return;
		const index = waiters.indexOf(waiter);
		if (index !== -1) waiters.splice(index, 1);
		if (waiters.length === 0) this.#waiters.delete(agentId);
	}

	#takeFromMailbox(agentId: string, from?: string): IrcMessage | undefined {
		const mailbox = this.#mailboxes.get(agentId);
		if (!mailbox) return undefined;
		const index = from ? mailbox.findIndex(msg => msg.from === from) : 0;
		if (index === -1 || mailbox.length === 0) return undefined;
		const [message] = mailbox.splice(index, 1);
		if (mailbox.length === 0) this.#mailboxes.delete(agentId);
		return message;
	}

	/**
	 * Surface agent↔agent traffic as a display-only card on the main session
	 * UI. Skipped when the main agent is either endpoint: as recipient its
	 * own `deliverIrcMessage` (or `wait` tool result) already shows the
	 * message, and as sender the irc send tool call already rendered the
	 * outbound body — relaying it again would duplicate it in the transcript.
	 */
	#relayToMainUi(message: IrcMessage): void {
		if (message.to === MAIN_AGENT_ID || message.from === MAIN_AGENT_ID) return;
		const mainSession = this.#registry.get(MAIN_AGENT_ID)?.session;
		if (!mainSession) return;
		const record: CustomMessage = {
			role: "custom",
			customType: "irc:relay",
			content: `[IRC \`${message.from}\` → \`${message.to}\`]\n\n${message.body}`,
			display: true,
			details: { from: message.from, to: message.to, body: message.body },
			attribution: "agent",
			timestamp: message.ts,
		};
		try {
			mainSession.emitIrcRelayObservation(record);
		} catch (error) {
			// Display-only forwarding must never affect delivery semantics.
			logger.debug("IrcBus: main UI relay failed", { to: message.to, error: String(error) });
		}
	}
}
