"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextUsageEnvelope, ContextUsageReport } from "./types";

export interface ContextReportState {
	report: ContextUsageReport | null;
	/** True until the first response for the current session resolves. */
	loading: boolean;
	/** Message from the latest failed attempt; cleared by a successful one. */
	error: string | null;
}

export interface UseContextReportOptions {
	/** Agent session to report on; null renders the panel's empty state. */
	sessionId: string | null;
	/** Poll cadence in ms while the document is visible. */
	pollMs?: number;
	/** Gate polling (e.g. the dock panel is a background tab). */
	enabled?: boolean;
}

export interface UseContextReportResult extends ContextReportState {
	/** Force an immediate refetch (also used when live usage ticks). */
	refresh: () => void;
}

/**
 * Fetches `GET /api/agent/<id>/context` for the panel.
 *
 * The gateway owns the accounting, so this hook only schedules reads: an
 * immediate fetch per session, a poll while the document is visible, and a
 * catch-up fetch when the window comes back to the foreground. Stale responses
 * are dropped by sequence number, so a session switch can never paint the
 * previous session's numbers.
 */
export function useContextReport({
	sessionId,
	pollMs = 2_500,
	enabled = true,
}: UseContextReportOptions): UseContextReportResult {
	const [state, setState] = useState<ContextReportState>({ report: null, loading: false, error: null });
	const sequenceRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);

	const refresh = useCallback(() => {
		if (!sessionId || !enabled) return;
		const sequence = sequenceRef.current + 1;
		sequenceRef.current = sequence;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		setState(previous => ({ ...previous, loading: previous.report === null }));
		fetch(`/api/agent/${encodeURIComponent(sessionId)}/context`, {
			signal: controller.signal,
			headers: { accept: "application/json" },
		})
			.then(async response => {
				const body = (await response.json().catch(() => ({}))) as Partial<ContextUsageEnvelope> & { error?: string };
				if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
				return body as ContextUsageEnvelope;
			})
			.then(envelope => {
				if (sequenceRef.current !== sequence) return;
				setState({ report: envelope.running ? envelope.context : null, loading: false, error: null });
			})
			.catch(error => {
				if (controller.signal.aborted || sequenceRef.current !== sequence) return;
				setState(previous => ({ ...previous, loading: false, error: String(error) }));
			});
	}, [enabled, sessionId]);

	// A session switch resets the panel instead of showing the old session's
	// numbers while the first request is in flight.
	useEffect(() => {
		sequenceRef.current += 1;
		abortRef.current?.abort();
		abortRef.current = null;
		setState({ report: null, loading: false, error: null });
		if (!sessionId || !enabled) return;
		refresh();
	}, [enabled, sessionId, refresh]);

	useEffect(() => {
		if (!sessionId || !enabled || pollMs <= 0) return;
		const trigger = (): void => {
			if (document.visibilityState === "visible") refresh();
		};
		const interval = setInterval(trigger, pollMs);
		document.addEventListener("visibilitychange", trigger);
		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", trigger);
		};
	}, [enabled, pollMs, refresh, sessionId]);

	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);

	return { ...state, refresh };
}
