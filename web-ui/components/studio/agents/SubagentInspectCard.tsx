"use client";

/**
 * Child-agent inspect card.
 *
 * Ported from OMP Studio (MIT) `conversation/SubagentInspectCard.tsx`. Studio's
 * card carried a composer (steer / follow-up) and a "btw" pane; Zeta's subagent
 * surface is read-only, so the card keeps the head (status, metrics, identity),
 * the transcript and the published output, and offers no send affordance.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../primitives/icons";
import { MarkdownText } from "../deck/MarkdownText";
import { activityPill, fmtAge, fmtCost, fmtDur, hubWord, statusDot } from "./presentation";
import { SubagentConversationPane } from "./SubagentConversationPane";
import { SubagentMetrics } from "./SubagentMetrics";
import { subagentDurationMs } from "./SubagentMetrics";
import { fmtNum } from "./presentation";
import { fetchOutput, type OutputResponse } from "./gateway";
import type { HubAgent } from "./types";

/** Matches `.sa-inspect.is-leave`; a little slack keeps the last frame mounted. */
const SA_INSPECT_LEAVE_MS = 260;

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SubagentInspectCard({
	agent,
	sessionId,
	refreshing,
	onClose,
}: {
	readonly agent: HubAgent;
	readonly sessionId: string | null;
	readonly refreshing?: number | undefined;
	readonly onClose: () => void;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const titleId = useId();
	const cardRef = useRef<HTMLDivElement | null>(null);
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const leavingRef = useRef(false);
	const leaveTimerRef = useRef<number | undefined>(undefined);
	const [leaving, setLeaving] = useState(false);
	const [tab, setTab] = useState<"transcript" | "output">("transcript");
	const [output, setOutput] = useState<OutputResponse | null>(null);
	const [outputError, setOutputError] = useState("");
	const [now, setNow] = useState(() => Date.now());
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	const requestClose = useCallback((after?: () => void) => {
		if (leavingRef.current) return;
		leavingRef.current = true;
		const finish = () => {
			leaveTimerRef.current = undefined;
			after?.();
			onCloseRef.current();
		};
		if (prefersReducedMotion()) {
			finish();
			return;
		}
		setLeaving(true);
		leaveTimerRef.current = window.setTimeout(finish, SA_INSPECT_LEAVE_MS + 24);
	}, []);

	useEffect(
		() => () => {
			if (leaveTimerRef.current !== undefined) window.clearTimeout(leaveTimerRef.current);
		},
		[],
	);

	useEffect(() => {
		closeRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			requestClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [requestClose]);

	// A running child's duration ticks; a stopped one stays frozen.
	useEffect(() => {
		if (!agent.hasLiveSession) return;
		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [agent.hasLiveSession]);

	useEffect(() => {
		if (tab !== "output" || !sessionId) return;
		let current = true;
		setOutputError("");
		void fetchOutput(sessionId, agent.id)
			.then(result => {
				if (current) setOutput(result);
			})
			.catch((cause: unknown) => {
				if (current) setOutputError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			current = false;
		};
	}, [tab, sessionId, agent.id, refreshing]);

	const pill = activityPill(agent, zh);
	const durationMs = subagentDurationMs(
		{
			status: agent.status,
			...(agent.startedAt === undefined ? {} : { startedAt: new Date(agent.startedAt).toISOString() }),
			updatedAt: new Date(agent.lastActivity).toISOString(),
			...(agent.metrics === undefined
				? {}
				: {
						usage: {
							tokens: agent.metrics.tokens,
							requests: agent.metrics.requests,
							tools: agent.metrics.tools,
							cost: agent.metrics.cost,
							durationMs: agent.metrics.durationMs ?? 0,
						},
					}),
		},
		now,
	);

	return (
		<div
			ref={cardRef}
			className={`sa-inspect${leaving ? " is-leave" : ""}`}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<div className="sa-inspect-head">
				<span className={`hub-sd ${pill.cls}${agent.status === "running" ? " pulse" : ""}`} aria-hidden="true" />
				<span className="sa-inspect-title-wrap">
					<h2 className="sa-inspect-title" id={titleId}>
						{agent.name}
					</h2>
					<span className="hub-status-line">
						<span className={`dot ${statusDot(agent.status)}`} />
						{hubWord(agent.status, zh)} · {durationMs === undefined ? "—" : fmtDur(durationMs)} ·{" "}
						{zh ? "最近活动" : "last active"} {fmtAge(agent.lastActivity, now, zh)}
					</span>
				</span>
				<SubagentMetrics
					{...(agent.metrics === undefined
						? {}
						: {
								tokens: fmtNum(agent.metrics.tokens),
								tools: agent.metrics.tools,
								requests: agent.metrics.requests,
								cost: fmtCost(agent.metrics.cost),
							})}
				/>
				<button
					ref={closeRef}
					type="button"
					className="icon-btn small"
					aria-label={zh ? "关闭" : "Close"}
					onClick={() => requestClose()}
				>
					<Icon name="x" extra="sm" />
				</button>
			</div>
			<div className="hub-detail-tabs">
				<div className="tabs" role="tablist" aria-label={zh ? "子 Agent 详情" : "Subagent detail"}>
					<button
						type="button"
						role="tab"
						className={tab === "transcript" ? "active" : undefined}
						aria-selected={tab === "transcript"}
						onClick={() => setTab("transcript")}
					>
						{zh ? "对话记录" : "Transcript"}
					</button>
					<button
						type="button"
						role="tab"
						className={tab === "output" ? "active" : undefined}
						aria-selected={tab === "output"}
						onClick={() => setTab("output")}
					>
						{zh ? "输出" : "Output"}
					</button>
				</div>
			</div>
			{tab === "transcript" ? (
				<SubagentConversationPane
					sessionId={sessionId}
					agentId={agent.id}
					{...(refreshing === undefined ? {} : { refreshing })}
				/>
			) : (
				<div className="sa-inspect-scroll">
					<div className="sa-inspect-doc">
						{outputError ? (
							<div className="convo-notice error" role="alert">
								{outputError}
							</div>
						) : null}
						{output === null && !outputError ? (
							<div className="empty" style={{ paddingTop: 32 }}>
								<span className="spinner" aria-hidden="true" />
								<p>{zh ? "正在读取输出…" : "Reading the output…"}</p>
							</div>
						) : null}
						{output !== null && output.published ? (
							<div className="hub-transcript">
								<div className="hub-tr-msg assistant">
									<div className="tr-head">
										<span className="tr-role">{zh ? "已发布结果" : "Published result"}</span>
										{output.size === undefined ? null : <span>{output.size} B</span>}
									</div>
									<div className="tr-body">
										<MarkdownText text={output.content ?? ""} />
									</div>
								</div>
							</div>
						) : null}
						{output !== null && !output.published ? (
							<div className="empty" style={{ paddingTop: 32 }}>
								<p>{output.message ?? (zh ? "还没有发布的输出。" : "No published output yet.")}</p>
							</div>
						) : null}
					</div>
				</div>
			)}
			<div className="hub-ro-banner" style={{ margin: 0 }}>
				<Icon name="lock" extra="sm" />
				{zh
					? "子 Agent 在这条通道上是只读的；发送消息需要网关的 steer 路由。"
					: "This subagent is read-only on this surface: sending messages needs a gateway steer route."}
			</div>
		</div>
	);
}
