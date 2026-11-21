"use client";

/**
 * Read-only child transcript for the Agent Hub.
 *
 * Ported from OMP Studio (MIT) `conversation/SubagentConversationPane.tsx`.
 * Studio attached a full composer here (queued messages, `agent.send` steer);
 * Zeta's gateway exposes the child transcript read-only, so this pane renders
 * the page tail, offers "load more" while the byte cursor advances, and
 * carries no send affordance. Rows reuse Studio's `.hub-tr-msg` markup, which
 * `agent-hub.css` already styles.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../primitives/icons";
import { MarkdownText } from "../deck/MarkdownText";
import { createSubagentConversationEngine, type SubagentConversationSnapshot } from "./subagentConversationEngine";

export function SubagentConversationPane({
	sessionId,
	agentId,
	refreshing,
}: {
	sessionId: string | null;
	agentId: string | null;
	/** Bumped by the roster when the child reported new activity; re-reads the tail. */
	refreshing?: number;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const engine = useMemo(
		() => createSubagentConversationEngine({ sessionId, agentId }),
		[sessionId, agentId],
	);
	const snapshot: SubagentConversationSnapshot = useSyncExternalStore(
		listener => engine.subscribe(listener),
		() => engine.getSnapshot(),
		() => engine.getSnapshot(),
	);
	useEffect(() => {
		engine.start();
		return () => engine.dispose();
	}, [engine]);
	useEffect(() => {
		if (refreshing === undefined || refreshing === 0) return;
		void engine.reload();
	}, [engine, refreshing]);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
	}, [snapshot.rows.length]);

	return (
		<div className="subagent-convo">
			<div className="sa-inspect-scroll" ref={scrollerRef} tabIndex={-1} aria-label={zh ? "子 Agent 对话" : "Subagent transcript"}>
				<div className="sa-inspect-doc" role="log" aria-live="off">
					{snapshot.status === "error" && snapshot.error !== undefined ? (
						<div className="convo-notice error" role="alert">
							{snapshot.error}
						</div>
					) : null}
					{snapshot.status === "loading" && snapshot.rows.length === 0 ? (
						<div className="empty" style={{ paddingTop: 48 }}>
							<span className="spinner" aria-hidden="true" />
							<p>{zh ? "正在读取子 Agent 对话…" : "Reading the subagent transcript…"}</p>
						</div>
					) : null}
					{snapshot.status === "ready" && snapshot.rows.length === 0 ? (
						<div className="empty" style={{ paddingTop: 48 }}>
							<p>{zh ? "这个子 Agent 还没有对话记录。" : "This subagent has no transcript yet."}</p>
						</div>
					) : null}
					<div className="hub-transcript">
						{snapshot.rows.map(row => (
							<div key={row.id} className={`hub-tr-msg ${row.role}`}>
								<div className="tr-head">
									<span className="tr-role">{row.role}</span>
									{row.ts > 0 ? <span>{new Date(row.ts).toLocaleTimeString()}</span> : null}
								</div>
								<div className="tr-body">
									{row.role === "assistant" ? <MarkdownText text={row.text} /> : row.text}
								</div>
							</div>
						))}
					</div>
					{snapshot.status === "ready" && !snapshot.atEnd ? (
						<div className="convo-load-earlier">
							<button
								type="button"
								className="btn small outline"
								disabled={snapshot.loadingMore}
								onClick={() => void engine.loadMore()}
							>
								<Icon name="chevron-d" extra="sm" />
								{snapshot.loadingMore ? (zh ? "正在读取…" : "Loading…") : zh ? "加载更早消息" : "Load earlier messages"}
							</button>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
