import { getAgentDir } from "@linxiraos/pi-utils";
import type { AgentSession } from "../../../session/agent-session";
import { TimeTravelService } from "./time-travel-service.js";
import { assertSessionWorktreeStartResolved } from "./session-worktrees-runtime.js";

const services = new Map<string, TimeTravelService>();
export function studioTimeTravelService(): TimeTravelService {
	const profile = getAgentDir();
	let service = services.get(profile);
	if (!service) {
		service = new TimeTravelService(profile);
		services.set(profile, service);
	}
	return service;
}

/** Native lifetime, independent of authenticated renderer connection lifetime. */
export class StudioTimeTravelBoundary {
	#tail: Promise<void> = Promise.resolve();
	#open: { sessionId: string; leafId: string | null } | undefined;
	#disposed = false;
	constructor(
		readonly session: AgentSession,
		readonly service: TimeTravelService,
	) {}
	capture(phase: "before" | "after"): Promise<void> {
		const sessionId = this.session.sessionId;
		const leafId = this.session.sessionManager.getLeafId();
		const workspace = this.session.sessionManager.getCwd();
		const next = this.#tail.then(async () => {
			if (this.#disposed || this.session.isDisposed || this.session.sessionId !== sessionId) return;
			if (phase === "after" && this.#open?.sessionId !== sessionId) return;
			if (phase === "before" && this.#open?.sessionId === sessionId && this.#open.leafId === leafId) return;
			await this.session.sessionManager.flush();
			if (phase === "before" && this.#open?.sessionId === sessionId)
				await this.service.capture({ workspace, sessionId, leafId, phase: "after" });
			this.#open = phase === "before" ? { sessionId, leafId } : undefined;
			await this.service.capture({ workspace, sessionId, leafId, phase });
		});
		this.#tail = next.catch(error =>
			this.session.emitNotice(
				"warning",
				`Time Travel: ${error instanceof Error ? error.message : String(error)}`,
				"time-travel",
			),
		);
		return this.#tail;
	}
	reset(): void {
		this.#open = undefined;
	}
	dispose(): void {
		this.#disposed = true;
		this.#open = undefined;
	}
}

const boundaries = new WeakMap<AgentSession, StudioTimeTravelBoundary>();
export function attachStudioTimeTravel(session: AgentSession): void {
	if (boundaries.has(session)) return;
	const boundary = new StudioTimeTravelBoundary(session, studioTimeTravelService());
	boundaries.set(session, boundary);
	session.setBeforeNextUserTurn(async () => {
		await assertSessionWorktreeStartResolved(session);
		await boundary.capture("before");
	});
	session.setAfterUserTurn(() => boundary.capture("after"));
	const detachChange = session.registerSessionChangeCallback(() => boundary.reset());
	session.addDisposer(() => {
		boundary.dispose();
		detachChange();
		session.setBeforeNextUserTurn(undefined);
		session.setAfterUserTurn(undefined);
	});
}
