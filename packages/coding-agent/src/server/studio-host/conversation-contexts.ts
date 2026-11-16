import { randomBytes } from "node:crypto";
import type { StudioSelection } from "./selection.js";

export interface ConversationContext extends StudioSelection {
	readonly id: string;
	readonly owner: string;
	readonly expiresAt: number;
}

/** Context lifetime follows the existing authenticated browser session. */
export class ConversationContexts {
	readonly #contexts = new Map<string, ConversationContext>();
	readonly #timers = new Map<string, NodeJS.Timeout>();
	constructor(readonly onClose: (id: string, owner: string) => void) {}

	create(owner: string, expiresAt: number, workspaceId: string, sessionId?: string): ConversationContext {
		let owned = 0;
		for (const context of this.#contexts.values()) if (context.owner === owner) owned++;
		if (owned >= 64) throw new Error("context_limit");
		if (expiresAt <= Date.now()) throw new Error("context_expired");
		const id = randomBytes(24).toString("base64url");
		const context: ConversationContext = { id, owner, expiresAt, workspaceId, closed: false, ...(sessionId === undefined ? {} : { sessionId }) };
		this.#contexts.set(id, context);
		const timer = setTimeout(() => this.close(owner, id), expiresAt - Date.now());
		timer.unref();
		this.#timers.set(id, timer);
		return context;
	}

	get(owner: string, id: string): ConversationContext | undefined {
		const context = this.#contexts.get(id);
		if (context?.owner !== owner) return undefined;
		if (context.expiresAt <= Date.now()) { this.close(owner, id); return undefined; }
		return context;
	}

	peek(id: string): ConversationContext | undefined {
		const context = this.#contexts.get(id);
		return context === undefined ? undefined : this.get(context.owner, id);
	}

	isLive(id: string): boolean {
		const context = this.#contexts.get(id);
		return context !== undefined && this.get(context.owner, id) !== undefined;
	}

	close(owner: string, id: string): boolean {
		const context = this.#contexts.get(id);
		if (context?.owner !== owner) return false;
		context.closed = true;
		this.#contexts.delete(id);
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		this.onClose(id, owner);
		return true;
	}

	closeOwner(owner: string): void {
		for (const context of this.#contexts.values()) if (context.owner === owner) this.close(owner, context.id);
	}
}
