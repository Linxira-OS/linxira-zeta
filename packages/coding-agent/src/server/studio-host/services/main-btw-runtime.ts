import type { ImageContent } from "@linxiraos/pi-ai";
import type { AgentSession } from "../../../session/agent-session.js";
import { cfgBtwInject } from "../../../modes/settings.js";
import { StudioOpError } from "../errors.js";
import type { BtwHistoryTurn, BtwTopicSummary } from "../protocol/contracts/runtime-upgrade.js";
import { StudioBtwService, StudioBtwError, type StudioBtwSnapshot } from "./btw-service.js";

export interface StudioMainBtwOptions {
	/** Test seam; production reads the native `btw.inject` feature setting. */
	injectEnabled?: () => boolean;
	/** Test seam; production admits the text to the native main-session prompt queue. */
	sendInjection?: (text: string, sessionId: string) => Promise<void>;
}

/**
 * Resolve on admission, not at the end of the model turn; later provider errors
 * never resend the prompt. A stale session identity refuses before prompting.
 */
async function sendStudioBtwInjection(session: AgentSession, text: string, sessionId: string): Promise<void> {
	if (session.hasPendingDeferredExtensions) await session.loadDeferredExtensions();
	if (session.sessionManager.getSessionId() !== sessionId)
		throw new StudioBtwError("INTERACTION_STALE", "The main session changed before injection");
	const admission = Promise.withResolvers<void>();
	let admitted = false;
	void session
		.prompt(text, {
			expandPromptTemplates: false,
			runCommands: false,
			streamingBehavior: "steer",
			throwOnDrop: true,
			onPromptAdmitted: () => {
				admitted = true;
				admission.resolve();
			},
		})
		.then(
			() => {
				if (!admitted)
					admission.reject(new StudioBtwError("COMMAND_BLOCKED", "The main session did not admit the injection"));
			},
			error => {
				if (!admitted) admission.reject(error);
			},
		);
	await admission.promise;
}

export type StudioBtwBranchResult =
	| { branched: true; newSessionId: string; newLeafId: string | null }
	| { branched: false; reason: "cancelled" };

/**
 * One presentation-neutral main BTW runtime per native `AgentSession`.
 *
 * The reviewed {@link StudioBtwService} owns the single BTW slot, native
 * history persistence, branch authorization and coalesced snapshots. This
 * wrapper adds the main-session injection admission, native image-path
 * resolution and the operation-authority hooks the Studio host needs before a
 * provider turn or a session branch. It never attaches, revives or starts a
 * session.
 */
export class StudioMainBtwRuntime {
	readonly service: StudioBtwService;
	#injectTail: Promise<unknown> = Promise.resolve();
	#injectGuard: (() => void) | undefined;

	constructor(
		readonly session: AgentSession,
		options: StudioMainBtwOptions = {},
	) {
		const send = options.sendInjection ?? ((text, sessionId) => sendStudioBtwInjection(session, text, sessionId));
		this.service = new StudioBtwService(session, {
			injectEnabled: options.injectEnabled ?? (() => cfgBtwInject.get(session.settings)),
			sendInjection: (text, sessionId) => {
				this.#injectGuard?.();
				return send(text, sessionId);
			},
		});
	}

	ask(
		question: string,
		images?: ImageContent[],
		assertActive?: () => void,
	): { ephemeralId: string; branchToken: string; status: "running" } {
		return this.service.ask(question, images, undefined, assertActive);
	}

	followUp(
		topicId: string,
		question: string,
		images?: ImageContent[],
		assertActive?: () => void,
	): Promise<{ ephemeralId: string; status: "running" }> {
		return this.service.followUp(topicId, question, images, assertActive);
	}

	historyList(): Promise<{ sessionId: string; topics: BtwTopicSummary[] }> {
		return this.service.historyList();
	}

	historyRead(topicId: string): Promise<{ sessionId: string; topicId: string; turns: BtwHistoryTurn[] }> {
		return this.service.historyRead(topicId);
	}

	abort(ephemeralId: string): { aborted: true } {
		return this.service.abort(ephemeralId);
	}

	/**
	 * Native branch promotion. `flush` settles history first so the completed
	 * assistant message and leaf are durable; the caller's authority is checked
	 * immediately before handing the branch to the native session.
	 */
	async branch(branchToken: string, assertActive?: () => void): Promise<StudioBtwBranchResult> {
		await this.service.flush();
		assertActive?.();
		return this.service.branchCurrent(branchToken);
	}

	/** Adopt a completed answer into the main conversation via native prompt admission. */
	inject(injectId: string, assertActive?: () => void): Promise<{ sent: true }> {
		const run = this.#injectTail.then(async () => {
			this.#injectGuard = assertActive;
			try {
				return await this.service.inject(injectId);
			} finally {
				this.#injectGuard = undefined;
			}
		});
		this.#injectTail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	get(ephemeralId: string): StudioBtwSnapshot {
		return this.service.get(ephemeralId);
	}

	onChange(listener: (snapshot: StudioBtwSnapshot) => void): () => void {
		return this.service.onChange(listener);
	}

	dispose(): void {
		this.service.dispose();
	}
}

const runtimes = new WeakMap<AgentSession, StudioMainBtwRuntime>();

/** The main BTW slot for this exact native session; never starts one. */
export function mainBtwRuntime(session: AgentSession): StudioMainBtwRuntime {
	const existing = runtimes.get(session);
	if (existing) return existing;
	const runtime = new StudioMainBtwRuntime(session);
	runtimes.set(session, runtime);
	const dispose = () => {
		if (runtimes.get(session) !== runtime) return;
		runtimes.delete(session);
		runtime.dispose();
	};
	const unregister = session.registerSessionChangeCallback(dispose);
	session.addDisposer(() => {
		unregister();
		dispose();
	});
	return runtime;
}
