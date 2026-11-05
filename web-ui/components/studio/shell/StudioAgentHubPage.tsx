"use client";

/**
 * StudioAgentHubPage — the subagent roster of the active session.
 *
 * The gateway exposes subagents read-only (`/api/agent/:id/subagents`,
 * `/subagents/events`, `/subagents/:subId/transcript|output`). Steering or
 * cancelling a child has no route, so this page does not offer those buttons:
 * a disabled control that cannot work is worse than its absence. The roster
 * refreshes from the SSE stream when one is available, otherwise on demand.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { StudioPage } from "./StudioPageHost";

interface SubagentProgress {
	lastIntent?: string;
	currentTool?: string;
	toolCount?: number;
	requests?: number;
	tokens?: number;
	durationMs?: number;
}

interface SubagentRosterEntry {
	id: string;
	displayName: string;
	kind: "sub" | "advisor";
	parentId: string | null;
	depth: number;
	agent?: string;
	status: "running" | "idle" | "parked" | "aborted";
	taskStatus?: "pending" | "running" | "completed" | "failed" | "aborted";
	description?: string;
	task?: string;
	lastActivity: number;
	progress?: SubagentProgress;
	persisted: boolean;
}

interface RosterResponse {
	subagents: SubagentRosterEntry[];
	maxConcurrency: number;
	generatedAt: number;
}

interface TranscriptResponse {
	entries: unknown[];
	messages: unknown[];
}

export function StudioAgentHubPage({ sessionId, title }: { sessionId: string | null; title: string }) {
	const { t } = useI18n();
	const [roster, setRoster] = useState<RosterResponse | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async () => {
		if (!sessionId) {
			setRoster(null);
			return;
		}
		setLoading(true);
		try {
			const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/subagents`, { cache: "no-store" });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? `subagents: HTTP ${res.status}`);
			}
			setRoster((await res.json()) as RosterResponse);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		void load();
	}, [load]);

	const openTranscript = useCallback(
		async (subagentId: string) => {
			if (!sessionId) return;
			setSelected(subagentId);
			setTranscript(null);
			try {
				const res = await fetch(
					`/api/agent/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}/transcript`,
					{ cache: "no-store" },
				);
				if (!res.ok) throw new Error(`transcript: HTTP ${res.status}`);
				setTranscript((await res.json()) as TranscriptResponse);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[sessionId],
	);

	const entries = useMemo(() => roster?.subagents ?? [], [roster]);
	const tree = useMemo(() => {
		const byParent = new Map<string | null, SubagentRosterEntry[]>();
		for (const entry of entries) {
			const list = byParent.get(entry.parentId);
			if (list) list.push(entry);
			else byParent.set(entry.parentId, [entry]);
		}
		return byParent;
	}, [entries]);

	const renderRow = (entry: SubagentRosterEntry, depth: number): React.ReactNode => {
		const children = tree.get(entry.id) ?? [];
		return (
			<li key={entry.id}>
				<button
					type="button"
					className={`agent-row${selected === entry.id ? " is-active" : ""}`}
					style={{ paddingInlineStart: `${12 + depth * 16}px` }}
					onClick={() => void openTranscript(entry.id)}
				>
					<span className={`dot dot-${entry.taskStatus ?? entry.status}`} aria-hidden />
					<span className="agent-name">{entry.displayName}</span>
					{entry.agent ? <span className="chip">{entry.agent}</span> : null}
					<span className="muted small">
						{entry.progress?.tokens !== undefined ? `${entry.progress.tokens} tok` : ""}
						{entry.progress?.currentTool ? ` · ${entry.progress.currentTool}` : ""}
					</span>
				</button>
				{children.length > 0 ? <ul className="agent-tree">{children.map(child => renderRow(child, depth + 1))}</ul> : null}
			</li>
		);
	};

	if (!sessionId) {
		return (
			<StudioPage title={title}>
				<div className="empty">
					<p className="muted">{t("studio.agents.needsSession")}</p>
				</div>
			</StudioPage>
		);
	}

	return (
		<StudioPage
			title={title}
			subtitle={sessionId}
			actions={
				<button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
					{t("studio.action.refresh")}
				</button>
			}
		>
			{error ? (
				<div className="banner red" role="alert">
					{error}
				</div>
			) : null}

			<div className="agents-grid">
				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.agents.roster")}</h2>
						{roster ? <span className="muted small">{t("studio.agents.max", { count: roster.maxConcurrency })}</span> : null}
					</header>
					{entries.length === 0 ? (
						<p className="muted small">{t("studio.agents.empty")}</p>
					) : (
						<ul className="agent-tree">{(tree.get(null) ?? []).map(entry => renderRow(entry, 0))}</ul>
					)}
				</section>

				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.agents.transcript")}</h2>
					</header>
					{!selected ? (
						<p className="muted small">{t("studio.agents.pick")}</p>
					) : !transcript ? (
						<p className="muted small">{t("studio.sidebar.loading")}</p>
					) : transcript.messages.length === 0 ? (
						<p className="muted small">{t("studio.agents.noMessages")}</p>
					) : (
						<ol className="agent-transcript">
							{transcript.messages.map((message, index) => (
								<li key={index} className="agent-message">
									<pre className="agent-message-body">{summarizeMessage(message)}</pre>
								</li>
							))}
						</ol>
					)}
				</section>
			</div>
		</StudioPage>
	);
}

/** Child transcripts are raw runtime messages; show their text, never raw JSON. */
function summarizeMessage(message: unknown): string {
	if (typeof message === "string") return message;
	if (typeof message !== "object" || message === null) return String(message);
	const record = message as { role?: unknown; content?: unknown; text?: unknown };
	if (typeof record.text === "string") return record.text;
	const content = record.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map(part => {
				if (typeof part === "string") return part;
				if (typeof part === "object" && part !== null && "text" in part) {
					const text = (part as { text?: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return typeof record.role === "string" ? `[${record.role}]` : "";
}
