/**
 * Child-transcript engine for the Agent Hub.
 *
 * Ported from OMP Studio (MIT) `conversation/subagentConversationEngine.ts`,
 * reduced to what Zeta can serve: `GET …/subagents/:id/transcript?fromByte=`
 * is a forward byte cursor over the child's session file, so the engine
 * hydrates a tail page, can *refresh* (load more), and has no live stream of
 * its own — the roster SSE already tells the hub when to refresh.
 *
 * The store keeps the upstream contract the pane relies on: `getSnapshot`,
 * `subscribe`, `start`, `dispose`, `reload`, `getDiagnostics`.
 */

import type { AgentTranscriptMessage } from "@/lib/studio-protocol/protocol";
import { fetchTranscript } from "./gateway";

export type TranscriptStatus = "idle" | "loading" | "ready" | "error";

export interface SubagentConversationSnapshot {
	readonly agentId: string | null;
	readonly rows: readonly AgentTranscriptMessage[];
	readonly status: TranscriptStatus;
	readonly error?: string;
	/** True when the last page carried nothing new. */
	readonly atEnd: boolean;
	readonly loadingMore: boolean;
	/** Byte cursor of the next read. */
	readonly cursor: number;
}

export interface SubagentConversationEngine {
	getSnapshot(): SubagentConversationSnapshot;
	subscribe(listener: () => void): () => void;
	start(): void;
	dispose(): void;
	reload(): Promise<void>;
	/** Read the next page from the last cursor (appends). */
	loadMore(): Promise<void>;
	getDiagnostics(): { disposed: number; rows: number; listeners: number; cursor: number };
}

const EMPTY: SubagentConversationSnapshot = {
	agentId: null,
	rows: [],
	status: "idle",
	atEnd: false,
	loadingMore: false,
	cursor: 0,
};

export function createSubagentConversationEngine(input: {
	readonly sessionId: string | null;
	readonly agentId: string | null;
}): SubagentConversationEngine {
	const listeners = new Set<() => void>();
	let snapshot: SubagentConversationSnapshot = { ...EMPTY, agentId: input.agentId };
	let started = false;
	let disposed = false;
	let token = 0;

	const publish = (next: SubagentConversationSnapshot): void => {
		snapshot = next;
		for (const listener of listeners) listener();
	};

	const read = async (fromByte: number, replace: boolean): Promise<void> => {
		if (disposed) return;
		const sessionId = input.sessionId;
		const agentId = input.agentId;
		if (!sessionId || !agentId) {
			publish({ ...EMPTY, agentId: null });
			return;
		}
		const current = ++token;
		publish({
			...snapshot,
			status: replace ? "loading" : snapshot.status,
			loadingMore: !replace,
			error: undefined,
		});
		try {
			const page = await fetchTranscript(sessionId, agentId, fromByte);
			if (disposed || current !== token) return;
			const nextCursor = page.nextCursor === undefined ? Number(page.cursor) : Number(page.nextCursor);
			const rows = replace ? [...page.messages] : [...snapshot.rows, ...page.messages];
			publish({
				agentId,
				rows,
				status: "ready",
				atEnd: page.eof || page.messages.length === 0,
				loadingMore: false,
				cursor: Number.isFinite(nextCursor) ? nextCursor : 0,
			});
		} catch (cause) {
			if (disposed || current !== token) return;
			publish({
				...snapshot,
				status: "error",
				loadingMore: false,
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	};

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		start() {
			if (started || disposed) return;
			started = true;
			void read(0, true);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			token += 1;
			listeners.clear();
			snapshot = { ...EMPTY };
		},
		reload: () => read(0, true),
		loadMore: () => (snapshot.atEnd ? Promise.resolve() : read(snapshot.cursor, false)),
		getDiagnostics: () => ({
			disposed: disposed ? 1 : 0,
			rows: snapshot.rows.length,
			listeners: listeners.size,
			cursor: snapshot.cursor,
		}),
	};
}
