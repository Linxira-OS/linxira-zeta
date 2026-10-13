"use client";

/**
 * Shared "which sessions are running" signal for the whole app.
 *
 * Before tabs this lived inside SessionSidebar (a 2.5s poll of
 * `/api/agent/running`). The session tab strip needs the same signal for its
 * running dot, and a second poll would double the request rate for no new
 * information — so the poll moved here and both surfaces read one context. The
 * gateway exposes a `/api/agent/running/events` SSE endpoint, but nothing
 * consumes it today; switching the poll to that stream is a separate change.
 *
 * The poll pauses while the page is hidden and aborts its in-flight request on
 * the way out, so a backgrounded tab costs nothing.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export const RUNNING_SESSIONS_POLL_MS = 2500;

export interface RunningSessionsState {
	runningSessionIds: ReadonlySet<string>;
	/**
	 * Adopt a session-list snapshot. Only honoured until the first successful
	 * poll lands: after that the poll is authoritative and a slow list fetch
	 * must not resurrect a stale running set.
	 */
	seedFromList(sessionIds: readonly string[]): void;
}

const RunningSessionsContext = createContext<RunningSessionsState | null>(null);

/** Owns the poll. Mount once, high in the tree (`RunningSessionsProvider`). */
export function useRunningSessionsPoll(): RunningSessionsState {
	const [runningSessionIds, setRunningSessionIds] = useState<ReadonlySet<string>>(() => new Set<string>());
	const pollAuthoritativeRef = useRef(false);

	useEffect(() => {
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let controller: AbortController | null = null;

		const clearTimer = () => {
			clearTimeout(timer);
			timer = undefined;
		};

		const schedule = () => {
			clearTimer();
			if (stopped || document.visibilityState !== "visible") return;
			timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
		};

		const poll = async () => {
			if (stopped || document.visibilityState !== "visible") return;
			const current = new AbortController();
			controller?.abort();
			controller = current;
			try {
				const res = await fetch("/api/agent/running", { cache: "no-store", signal: current.signal });
				if (!res.ok) return;
				const data = (await res.json()) as { runningSessionIds?: string[] };
				if (stopped || controller !== current) return;
				pollAuthoritativeRef.current = true;
				setRunningSessionIds(new Set(data.runningSessionIds ?? []));
			} catch {
				// Keep the last known state; the next visible-tab poll retries.
			} finally {
				if (controller === current) controller = null;
				schedule();
			}
		};

		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void poll();
				return;
			}
			clearTimer();
			controller?.abort();
			controller = null;
		};

		void poll();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			stopped = true;
			clearTimer();
			controller?.abort();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	const seedFromList = useCallback((sessionIds: readonly string[]) => {
		if (pollAuthoritativeRef.current) return;
		setRunningSessionIds(new Set(sessionIds));
	}, []);

	return { runningSessionIds, seedFromList };
}

export function RunningSessionsProvider({ children }: { children: ReactNode }) {
	const value = useRunningSessionsPoll();
	return <RunningSessionsContext.Provider value={value}>{children}</RunningSessionsContext.Provider>;
}

/** Read the shared running set (session tab strip, sidebar). */
export function useRunningSessionIds(): RunningSessionsState {
	const value = useContext(RunningSessionsContext);
	if (!value) throw new Error("useRunningSessionIds requires <RunningSessionsProvider>");
	return value;
}
