"use client";

/**
 * Live subagent roster for the Agent Hub.
 *
 * `/api/agent/:id/subagents` is the snapshot; `/subagents/events` pushes roster
 * and progress frames. The hook keeps the last snapshot, refreshes on every
 * frame that carries rows, and polls while a child is still running in case the
 * stream drops (a dropped `fetch` stream is silent, unlike an SSE error event).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioAgentSnapshot } from "@/lib/studio-protocol/protocol";
import { fetchRoster, streamRoster, toAgentSnapshot, type RosterEntry } from "./gateway";

export interface SubagentRosterState {
	agents: StudioAgentSnapshot[];
	loading: boolean;
	error: string;
	/** Bumped whenever a frame reports new activity; the open transcript re-reads on it. */
	refreshing: number;
	reload(): void;
}

const POLL_MS = 5000;

export function useSubagentRoster(sessionId: string | null): SubagentRosterState {
	const [agents, setAgents] = useState<StudioAgentSnapshot[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [refreshing, setRefreshing] = useState(0);
	const generation = useRef(0);

	const load = useCallback(async () => {
		if (!sessionId) {
			setAgents([]);
			setLoading(false);
			return;
		}
		const current = ++generation.current;
		setLoading(true);
		try {
			const rows = await fetchRoster(sessionId);
			if (current !== generation.current) return;
			setAgents(rows);
			setError("");
		} catch (cause) {
			if (current !== generation.current) return;
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (current === generation.current) setLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!sessionId) return;
		const stop = streamRoster(sessionId, frame => {
			const rows = frame.subagents;
			if (Array.isArray(rows)) {
				setAgents(rows.map(entry => toAgentSnapshot(entry as RosterEntry)));
				setRefreshing(value => value + 1);
				return;
			}
			// Progress / status frames carry no full roster: re-read so counts stay exact.
			if (frame.type === "subagent_status" || frame.type === "subagent_progress") {
				setRefreshing(value => value + 1);
			}
		});
		return stop;
	}, [sessionId]);

	useEffect(() => {
		if (!sessionId) return;
		const anyRunning = agents.some(agent => agent.status === "running" || agent.status === "starting");
		if (!anyRunning) return;
		const interval = window.setInterval(() => void load(), POLL_MS);
		return () => window.clearInterval(interval);
	}, [agents, load, sessionId]);

	return { agents, loading, error, refreshing, reload: () => void load() };
}
