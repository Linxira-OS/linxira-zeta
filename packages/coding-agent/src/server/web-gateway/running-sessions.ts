/**
 * Web Gateway — running-session registry.
 *
 * Holds the currently executing agent sessions (by persistent web session id)
 * and notifies subscribers on changes. W1 only reads it; the agent RPC batch
 * (W2) populates it and wires the SSE stream.
 */

const runningIds = new Set<string>();
const subscribers = new Set<(ids: string[]) => void>();

function notify(): void {
	const ids = getRunningSessionIds();
	for (const fn of subscribers) fn(ids);
}

export function getRunningSessionIds(): string[] {
	return [...runningIds];
}

export function addRunningSession(sessionId: string): void {
	if (!runningIds.has(sessionId)) {
		runningIds.add(sessionId);
		notify();
	}
}

export function removeRunningSession(sessionId: string): void {
	if (runningIds.delete(sessionId)) notify();
}

export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
	subscribers.add(listener);
	return () => {
		subscribers.delete(listener);
	};
}

/** Hook installed by the serve runtime so the gateway can dispose a deleted
 *  bot session's live AgentSession (the router owns the runtime handle). */
type BotSessionDispose = (id: string) => Promise<unknown> | unknown;
let botSessionDispose: BotSessionDispose | null = null;

export function setBotSessionDispose(fn: BotSessionDispose | null): void {
	botSessionDispose = fn;
}

/** Fire the runtime-side dispose for a bot session deleted via the web UI. */
export async function notifyBotSessionDeleted(id: string): Promise<void> {
	await botSessionDispose?.(id);
}
