"use client";

/**
 * Agent Hub — the subagent roster of the active session.
 *
 * Ported from OMP Studio (MIT) `AgentHub.tsx`. Studio's hub spanned roster,
 * jobs, services, IRC and a writable child composer; Zeta's gateway publishes
 * only `/api/agent/:id/subagents*`, so this page keeps the roster half that the
 * endpoints can answer:
 *
 *   - the main banner (parent conversation, connection state, updated clock)
 *   - flat / by-parent views, status counts, search
 *   - per-agent detail: status line, model, usage, lineage, artifacts
 *   - transcript / published output, read-only, behind the inspect card
 *
 * Job widgets, service panes, the IRC channel and every write action (spawn,
 * steer, cancel, revive, release) are absent because no gateway route backs
 * them — see the module report for the endpoints each would need.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioAgentSnapshot } from "@/lib/studio-protocol/protocol";
import { useI18n } from "../i18n";
import { Icon } from "../primitives/icons";
import { StudioPage } from "../shell/StudioPageHost";
import {
	activityPill,
	countByStatus,
	fmtAge,
	fmtClock,
	fmtCost,
	fmtDur,
	fmtHM,
	fmtNum,
	hubWord,
	linearSeq,
	sparkLevel,
	STATUS_DOT,
	treeGroups,
} from "./presentation";
import { SubagentInspectCard } from "./SubagentInspectCard";
import { subagentDurationMs } from "./SubagentMetrics";
import type { HubAgent, HubTab, HubView } from "./types";
import { useSubagentRoster } from "./useSubagentRoster";

function toHubAgent(agent: StudioAgentSnapshot, children: string[]): HubAgent {
	const usage = agent.usage;
	const started = agent.startedAt === undefined ? undefined : Date.parse(agent.startedAt);
	const updated = Date.parse(agent.updatedAt);
	return {
		id: agent.agentId,
		name: agent.displayName,
		kind: agent.kind === "advisor" ? "advisor" : "sub",
		...(agent.parentAgentId === undefined ? {} : { parentId: agent.parentAgentId }),
		status: agent.status,
		rawStatus: agent.status,
		task: agent.assignment ?? agent.summary ?? "—",
		...(agent.stage === undefined ? {} : { stage: agent.stage }),
		...(agent.completionPercent === undefined ? {} : { completionPercent: agent.completionPercent }),
		...(agent.modelRole === undefined ? {} : { modelRole: agent.modelRole }),
		...(agent.resolvedModel === undefined ? {} : { resolvedModel: agent.resolvedModel }),
		...(agent.modelIsFallback === true && agent.resolvedModel !== undefined
			? { fallback: agent.resolvedModel }
			: {}),
		readOnly: agent.kind === "advisor" || agent.readOnly === true,
		unread: agent.unreadCount,
		...(agent.outputPath === undefined ? {} : { outputPath: agent.outputPath }),
		...(agent.patchPath === undefined ? {} : { patchPath: agent.patchPath }),
		...(agent.branchName === undefined ? {} : { branchName: agent.branchName }),
		...(agent.nestedPatchPaths === undefined ? {} : { nestedPatchPaths: [...agent.nestedPatchPaths] }),
		...(agent.isolated === undefined ? {} : { isolated: agent.isolated }),
		...(started === undefined || !Number.isFinite(started) ? {} : { startedAt: started }),
		lastActivity: Number.isFinite(updated) ? updated : Date.now(),
		hasLiveSession: agent.hasLiveSession,
		hasTranscript: agent.hasTranscript,
		children,
		generation: Number(agent.generation),
		...(usage === undefined
			? {}
			: {
					metrics: {
						tokens: usage.tokens,
						requests: usage.requests,
						tools: usage.tools,
						cost: usage.cost,
						durationMs: usage.durationMs,
						...(usage.contextTokens === undefined ? {} : { contextTokens: usage.contextTokens }),
						...(usage.contextWindow === undefined ? {} : { contextWindow: usage.contextWindow }),
					},
				}),
	};
}

function StatusDot({ status }: { status: HubAgent["status"] }) {
	return (
		<span
			className={`hub-sd ${status}${status === "running" ? " pulse" : ""}`}
			aria-hidden="true"
		/>
	);
}

function FlagChips({ agent, kids }: { agent: HubAgent; kids?: number }) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	return (
		<>
			{agent.unread > 0 ? (
				<span className="hub-unread" data-tip={`${agent.unread} ${zh ? "未读" : "unread"}`}>
					<Icon name="message" extra="sm" />
					{agent.unread}
				</span>
			) : null}
			{agent.readOnly ? <span className="hub-ro-tag">read-only</span> : null}
			{kids ? (
				<span className="hub-ro-tag" data-tip={zh ? "子 Agent" : "Child agents"}>
					↳ {kids} {zh ? "子" : "kids"}
				</span>
			) : null}
		</>
	);
}

function Spark({ tokens }: { tokens: number }) {
	const hot = sparkLevel(tokens);
	return (
		<svg className="hc-spark" width="13" height="8" viewBox="0 0 13 8" aria-hidden="true">
			{[1, 2, 3].map(index => (
				<rect
					key={index}
					className={`hb-bar${index <= hot ? " hot" : ""}`}
					x={(index - 1) * 5}
					y={8 - index * 2}
					width="3"
					height={index * 2}
					rx="1"
				/>
			))}
		</svg>
	);
}

function ArtChips({ agent }: { agent: HubAgent }) {
	const chips = [agent.outputPath ? "out" : null, agent.patchPath ? "patch" : null, agent.branchName ? "branch" : null].filter(
		(chip): chip is string => Boolean(chip),
	);
	if (!chips.length) return null;
	return (
		<span className="hc-art">
			{chips.map(chip => (
				<span className="hub-art" key={chip}>
					{chip}
				</span>
			))}
		</span>
	);
}

function ModelLine({ agent }: { agent: HubAgent }) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	if (agent.fallback) {
		return (
			<span className="hub-model hub-fallback">
				{zh ? "回退模型" : "Fallback"} → {agent.fallback}
			</span>
		);
	}
	if (agent.resolvedModel) return <span className="hub-model">{agent.resolvedModel}</span>;
	return null;
}

function AgentStage({ agent }: { agent: HubAgent }) {
	if (!agent.stage && agent.completionPercent === undefined) return null;
	return (
		<span className="hub-agent-stage">
			{agent.completionPercent === undefined ? null : (
				<span className="hub-num">
					<b>{Math.round(agent.completionPercent)}%</b>
				</span>
			)}
			{agent.stage ? (
				<span className="ellipsis" title={agent.stage}>
					{agent.stage}
				</span>
			) : null}
		</span>
	);
}

function AgentCard({
	agent,
	selected,
	kids,
	now,
	onSelect,
}: {
	agent: HubAgent;
	selected: boolean;
	kids: number;
	now: number;
	onSelect: (id: string) => void;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const pill = activityPill(agent, zh);
	const metrics = agent.metrics;
	const durationMs = agent.metrics === undefined ? undefined : agent.metrics.durationMs;
	return (
		<button
			className={`hub-card${selected ? " sel" : ""}`}
			type="button"
			role="option"
			aria-selected={selected}
			data-hub-id={agent.id}
			onClick={() => onSelect(agent.id)}
		>
			<span className="hc-main">
				<span className="hc-top">
					<span className={`hub-act ${pill.cls}`}>{pill.label}</span>
					<span className="hc-name">
						<StatusDot status={agent.status} />
						<span>{agent.name}</span>
					</span>
					{agent.unread > 0 || agent.readOnly || kids > 0 ? (
						<span className="hc-flags">
							<FlagChips agent={agent} kids={kids} />
						</span>
					) : null}
				</span>
				<span className="hc-task">{agent.task}</span>
				<AgentStage agent={agent} />
				<span className="hc-foot">
					{agent.modelRole ? <span className="hub-role">{agent.modelRole}</span> : null}
					<ModelLine agent={agent} />
					<ArtChips agent={agent} />
				</span>
			</span>
			<span className="hc-side">
				{agent.startedAt ? (
					<span className="hc-start" data-tip={`${zh ? "已运行" : "Ran for"} ${fmtDur(durationMs ?? 0)}`}>
						<Icon name="clock" extra="sm" />
						{fmtHM(agent.startedAt)}
					</span>
				) : null}
				{metrics ? (
					<span className="hc-tokens">
						<b>{fmtNum(metrics.tokens)}</b>
						<i>tok</i>
						<Spark tokens={metrics.tokens} />
					</span>
				) : null}
				{metrics ? (
					<span className="hc-pace">
						<span className="hub-num">
							<i>req</i>
							<b>{metrics.requests}</b>
						</span>
						<span className="hub-num">
							<i>tools</i>
							<b>{metrics.tools}</b>
						</span>
					</span>
				) : null}
				<span className="hc-cost">{metrics ? fmtCost(metrics.cost) : "usage —"}</span>
			</span>
		</button>
	);
}

function AgentNode({
	agent,
	selected,
	now,
	onSelect,
}: {
	agent: HubAgent;
	selected: boolean;
	now: number;
	onSelect: (id: string) => void;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const pill = activityPill(agent, zh);
	return (
		<button
			className={`hub-node st-${agent.status}${selected ? " sel" : ""}`}
			type="button"
			role="option"
			aria-selected={selected}
			data-hub-id={agent.id}
			onClick={() => onSelect(agent.id)}
		>
			<span className="hn-top">
				<span className={`hub-act ${pill.cls}`}>{pill.label}</span>
				<span className="hn-name">
					<StatusDot status={agent.status} />
					<span>{agent.name}</span>
				</span>
				{agent.unread > 0 || agent.readOnly ? (
					<span className="hn-flags">
						<FlagChips agent={agent} />
					</span>
				) : null}
				{agent.metrics ? <span className="hn-cost">{fmtCost(agent.metrics.cost)}</span> : null}
			</span>
			<span className="hn-task">{agent.task}</span>
			<AgentStage agent={agent} />
			<span className="hn-foot">
				{agent.modelRole ? <span className="hub-role">{agent.modelRole}</span> : null}
				<span className="mono">
					{agent.fallback
						? `${zh ? "回退模型" : "Fallback"} → ${agent.fallback}`
						: (agent.resolvedModel ?? "")}
				</span>
				<span>{fmtAge(agent.lastActivity, now, zh)}</span>
				<span className="hn-art">
					<ArtChips agent={agent} />
				</span>
			</span>
		</button>
	);
}

function TreeGroup({
	head,
	kids,
	selected,
	now,
	onSelect,
}: {
	head: HubAgent;
	kids: HubAgent[];
	selected: string | null;
	now: number;
	onSelect: (id: string) => void;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const pill = activityPill(head, zh);
	const cost = [head, ...kids].reduce((sum, agent) => sum + (agent.metrics?.cost ?? 0), 0);
	return (
		<div className="hub-tgroup">
			<button
				className={`hub-tg-head${selected === head.id ? " sel" : ""}`}
				type="button"
				role="option"
				aria-selected={selected === head.id}
				data-hub-id={head.id}
				onClick={() => onSelect(head.id)}
			>
				<span className="tg-ic">
					<Icon name="bot" extra="sm" />
				</span>
				<span className={`hub-act ${pill.cls}`}>{pill.label}</span>
				<span className="tg-name">
					<StatusDot status={head.status} />
					<span>{head.name}</span>
				</span>
				<span className="tg-task">{head.task}</span>
				<span className="tg-right">
					<FlagChips agent={head} kids={kids.length} />
					<span className="tg-cost">{fmtCost(cost)}</span>
					<span className="tg-caret">
						<Icon name="chevron-d" extra="sm" />
					</span>
				</span>
			</button>
			<div className="hub-tchildren">
				<span className="hub-trail" aria-hidden="true" />
				<div className="hub-tleaves">
					{kids.map(kid => (
						<AgentNode
							key={kid.id}
							agent={kid}
							selected={selected === kid.id}
							now={now}
							onSelect={onSelect}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function Kv({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
	const { resolvedLanguage } = useI18n();
	return (
		<div className="kv">
			<div className="k">{hubWord(label, resolvedLanguage === "zh")}</div>
			<div className={`v${mono ? " mono" : ""}`}>{children}</div>
		</div>
	);
}

export function AgentHubPage({ sessionId, title }: { sessionId: string | null; title?: string }) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const roster = useSubagentRoster(sessionId);
	const [view, setView] = useState<HubView>("flat");
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [tab, setTab] = useState<HubTab>("overview");
	const [inspect, setInspect] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, []);

	const mapped = useMemo(() => {
		const childrenByParent = new Map<string, string[]>();
		for (const agent of roster.agents) {
			const parent = agent.parentAgentId;
			if (parent === undefined) continue;
			const list = childrenByParent.get(parent) ?? [];
			list.push(agent.agentId);
			childrenByParent.set(parent, list);
		}
		const rows = roster.agents.map(agent => toHubAgent(agent, childrenByParent.get(agent.agentId) ?? []));
		rows.sort((a, b) => b.lastActivity - a.lastActivity);
		return rows;
	}, [roster.agents]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return mapped;
		return mapped.filter(agent =>
			[agent.name, agent.task, agent.resolvedModel ?? "", agent.modelRole ?? ""]
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [mapped, query]);

	const counts = useMemo(() => countByStatus(filtered), [filtered]);
	const usage = useMemo(() => {
		const totals = mapped.reduce(
			(acc, agent) => {
				if (!agent.metrics) return acc;
				return {
					tokens: acc.tokens + agent.metrics.tokens,
					requests: acc.requests + agent.metrics.requests,
					tools: acc.tools + agent.metrics.tools,
					cost: acc.cost + agent.metrics.cost,
				};
			},
			{ tokens: 0, requests: 0, tools: 0, cost: 0 },
		);
		return `${fmtNum(totals.tokens)} tok · ${totals.requests} req · ${totals.tools} tools · ${fmtCost(totals.cost)}`;
	}, [mapped]);

	const selectedAgent = mapped.find(agent => agent.id === selected) ?? null;
	const inspectAgent = mapped.find(agent => agent.id === inspect) ?? null;
	const rows = linearSeq(filtered, view);
	const countsLine = (["running", "idle", "parked", "aborted"] as const)
		.filter(key => counts[key])
		.map(key => `${counts[key]} ${hubWord(key, zh)}`)
		.join(" · ");

	const select = (id: string) => {
		setSelected(id);
		setTab("overview");
	};

	return (
		<StudioPage
			title={title ?? (zh ? "代理" : "Agents")}
			subtitle={
				sessionId === null
					? zh
						? "先选择一个会话：子 Agent 属于某一次对话。"
						: "Pick a session first: subagents belong to one conversation."
					: zh
						? `${mapped.length} 个子 Agent`
						: `${mapped.length} subagents`
			}
		>
			<div className="hub-page" id="hubRoot">
				{roster.error ? (
					<div className="hub-notice err" role="alert">
						<Icon name="alert" extra="sm" />
						<span>{roster.error}</span>
					</div>
				) : null}
				<div className="hub-main">
					<span className="hm-ic">
						<Icon name="message" />
					</span>
					<div className="hm-main">
						<div className="hm-title">
							{zh ? "主对话" : "Main conversation"}
							<span className="chip blue xs">{zh ? "会话" : "Session"}</span>
						</div>
						<div className="hm-sub">
							<span className="hm-task ellipsis">{sessionId ?? "—"}</span>
							<span className="hm-meta mono">
								{roster.loading ? (zh ? "同步中…" : "Syncing…") : `${mapped.length} ${zh ? "个子代理" : "subagents"}`}
							</span>
							<span className="hm-meta mono hm-conn">
								<span className="hm-dot on" />
								{zh ? "更新于" : "Updated"} {fmtClock(now)}
							</span>
						</div>
					</div>
				</div>
				<div className="hub-roster-head">
					<div className="seg" role="group" aria-label={zh ? "列表视图" : "Roster view"}>
						<button type="button" className={view === "flat" ? "active" : undefined} onClick={() => setView("flat")}>
							{zh ? "平铺" : "Flat"}
						</button>
						<button type="button" className={view === "tree" ? "active" : undefined} onClick={() => setView("tree")}>
							{zh ? "按父代理" : "By parent"}
						</button>
					</div>
					<div className="hub-status-counts">{countsLine ? <span className="sc-item">{countsLine}</span> : null}</div>
					<span className="spacer" />
					<input
						className="input hub-search"
						type="search"
						placeholder={zh ? "搜索名称 / 任务 / 模型…" : "Search name / task / model…"}
						aria-label={zh ? "搜索 Agent" : "Search agents"}
						value={query}
						onChange={event => setQuery(event.target.value)}
					/>
				</div>
				{filtered.length ? (
					<div className="hub-usage">
						<span>{usage}</span>
						<span className="spacer" />
						<button className="btn small outline" type="button" onClick={roster.reload}>
							<Icon name="refresh" extra="sm" />
							{zh ? "刷新" : "Refresh"}
						</button>
					</div>
				) : null}
				<div className="hub-cols">
					<div
						className={`hub-list${view === "tree" ? " tree" : ""}`}
						id="hubList"
						ref={listRef}
						role="listbox"
						aria-label={zh ? "子 Agent 列表" : "Subagent list"}
					>
						{rows.length === 0 ? (
							<div className="hub-empty-list">
								<Icon name="bot" />
								<b>{zh ? "没有子 Agent" : "No subagents"}</b>
								<span>
									{roster.loading
										? zh
											? "正在读取…"
											: "Reading the roster…"
										: zh
											? "这次对话还没有派生子 Agent。"
											: "This conversation has not spawned a subagent yet."}
								</span>
							</div>
						) : view === "tree" ? (
							(() => {
								const tree = treeGroups(rows);
								return (
									<>
										{tree.groups.map(group => (
											<TreeGroup
												key={group.head.id}
												head={group.head}
												kids={group.kids}
												selected={selected}
												now={now}
												onSelect={select}
											/>
										))}
										{tree.orphans.map(agent => (
											<AgentCard
												key={agent.id}
												agent={agent}
												selected={selected === agent.id}
												kids={agent.children.length}
												now={now}
												onSelect={select}
											/>
										))}
									</>
								);
							})()
						) : (
							rows.map(agent => (
								<AgentCard
									key={agent.id}
									agent={agent}
									selected={selected === agent.id}
									kids={agent.children.length}
									now={now}
									onSelect={select}
								/>
							))
						)}
					</div>
					{selectedAgent ? (
						<div className="hub-detail open" id="hubDetail">
							<div className="hub-detail-head">
								<div className="hd-title">
									<b>{selectedAgent.name}</b>
									<span className={`chip ${selectedAgent.kind === "advisor" ? "gray" : "purple"} xs`}>
										{selectedAgent.kind === "advisor" ? (zh ? "顾问" : "Advisor") : zh ? "子代理" : "Subagent"}
									</span>
									{selectedAgent.parentId ? (
										<button
											className="hub-child-link tiny"
											type="button"
											onClick={() => select(selectedAgent.parentId!)}
										>
											{zh ? "父代理" : "Parent"}:{" "}
											{mapped.find(agent => agent.id === selectedAgent.parentId)?.name ?? selectedAgent.parentId}
										</button>
									) : null}
									<span className="spacer" />
									<span className={`hub-act ${activityPill(selectedAgent, zh).cls}`}>
										{activityPill(selectedAgent, zh).label}
									</span>
								</div>
								<div className="hd-sub">
									<span className="hub-status-line">
										<span className={`dot ${STATUS_DOT[selectedAgent.status] ?? "gray"}`} />
										{hubWord(selectedAgent.status, zh)} ·{" "}
										{(() => {
											const duration = subagentDurationMs(
												{
													status: selectedAgent.status,
													...(selectedAgent.startedAt === undefined
														? {}
														: { startedAt: new Date(selectedAgent.startedAt).toISOString() }),
													updatedAt: new Date(selectedAgent.lastActivity).toISOString(),
												},
												now,
											);
											return duration === undefined ? "—" : fmtDur(duration);
										})()}{" "}
										· {zh ? "最近活动" : "Last active"} {fmtAge(selectedAgent.lastActivity, now, zh)}
									</span>
									{selectedAgent.modelRole ? <span className="hub-role">{selectedAgent.modelRole}</span> : null}
									<ModelLine agent={selectedAgent} />
								</div>
							</div>
							<details className="small hub-native-details">
								<summary>{zh ? "身份与原始状态" : "Identity and native state"}</summary>
								<p className="mono">
									{selectedAgent.id} · {selectedAgent.rawStatus ?? selectedAgent.status} · {selectedAgent.kind}
								</p>
							</details>
							<div className="hub-detail-actions">
								<button
									className="btn small primary"
									type="button"
									disabled={!selectedAgent.hasTranscript}
									title={selectedAgent.hasTranscript ? undefined : zh ? "没有可读的对话记录" : "No transcript to read"}
									onClick={() => setInspect(selectedAgent.id)}
								>
									<Icon name="external" extra="sm" />
									{zh ? "打开对话" : "Open transcript"}
								</button>
							</div>
							<div className="hub-detail-tabs">
								<div className="tabs" role="tablist" aria-label={zh ? "Agent 详情" : "Agent detail"}>
									{(
										[
											["overview", zh ? "概览" : "Overview"],
											["transcript", zh ? "对话记录" : "Transcript"],
											["output", zh ? "输出" : "Output"],
										] as const
									).map(([id, label]) => (
										<button
											key={id}
											type="button"
											role="tab"
											className={tab === id ? "active" : undefined}
											aria-selected={tab === id}
											onClick={() => setTab(id)}
										>
											{label}
										</button>
									))}
								</div>
							</div>
							<div className="hub-detail-body" id="hubDetailBody">
								{tab === "overview" ? (
									<>
										<div className="hub-sec-title">{hubWord("Task", zh)}</div>
										<div className="hub-kv">
											<Kv label="Assignment">{selectedAgent.task}</Kv>
											{selectedAgent.stage ? <Kv label="Current">{selectedAgent.stage}</Kv> : null}
											<Kv label="Registered" mono>
												{selectedAgent.startedAt ? fmtClock(selectedAgent.startedAt) : "—"}
											</Kv>
										</div>
										<div className="hub-sec-title">{hubWord("Usage", zh)}</div>
										<div className="hub-kv">
											<Kv label="Metrics">
												{selectedAgent.metrics
													? `${fmtNum(selectedAgent.metrics.tokens)} tok · ${selectedAgent.metrics.requests} req · ${selectedAgent.metrics.tools} tools · ${fmtCost(selectedAgent.metrics.cost)}`
													: "—"}
											</Kv>
											{selectedAgent.metrics?.contextWindow === undefined ? null : (
												<Kv label="Context">
													{fmtNum(selectedAgent.metrics.contextTokens ?? 0)} /{" "}
													{fmtNum(selectedAgent.metrics.contextWindow)}
												</Kv>
											)}
											<Kv label="Models">
												<ModelLine agent={selectedAgent} />
												{selectedAgent.resolvedModel === undefined && selectedAgent.fallback === undefined
													? "—"
													: null}
											</Kv>
										</div>
										<div className="hub-sec-title">{hubWord("Lineage", zh)}</div>
										<div className="hub-kv">
											<Kv label="Spawned by" mono>
												{selectedAgent.parentId ?? "main"}
											</Kv>
											<Kv label="Children" mono>
												{selectedAgent.children.length === 0 ? "—" : selectedAgent.children.join(", ")}
											</Kv>
											{selectedAgent.isolated === true ? <Kv label="Isolation">isolated</Kv> : null}
										</div>
										<div className="hub-sec-title">{hubWord("Changes", zh)}</div>
										<div className="hub-kv">
											<Kv label="Output" mono>
												{selectedAgent.outputPath ?? "—"}
											</Kv>
											<Kv label="Patch" mono>
												{selectedAgent.patchPath ?? "—"}
											</Kv>
											<Kv label="Worktree branch" mono>
												{selectedAgent.branchName ?? "—"}
											</Kv>
											{selectedAgent.nestedPatchPaths?.length ? (
												<Kv label="Nested patch" mono>
													{selectedAgent.nestedPatchPaths.join(", ")}
												</Kv>
											) : null}
										</div>
									</>
								) : (
									<div className="hub-ro-banner" style={{ margin: "0 0 var(--sp-12)" }}>
										<Icon name="lock" extra="sm" />
										{zh
											? "对话记录与输出在检查卡中只读打开。"
											: "Transcript and output open read-only in the inspect card."}
									</div>
								)}
								{tab === "overview" ? null : (
									<button
										className="btn small outline"
										type="button"
										disabled={!selectedAgent.hasTranscript}
										onClick={() => setInspect(selectedAgent.id)}
									>
										<Icon name="external" extra="sm" />
										{zh ? "在检查卡中打开" : "Open in inspect card"}
									</button>
								)}
							</div>
						</div>
					) : (
						<div className="hub-detail hub-detail-placeholder">
							<div className="hub-empty-list" style={{ border: "none" }}>
								<Icon name="cursor" />
								<b>{zh ? "未选择 Agent" : "No agent selected"}</b>
								<span>{zh ? "从左侧列表选择一个子 Agent 查看详情。" : "Select a subagent on the left to see its detail."}</span>
							</div>
						</div>
					)}
				</div>
			</div>
			{inspectAgent ? (
				<>
					<div className="sa-inspect-dim" aria-hidden="true" onClick={() => setInspect(null)} />
					<SubagentInspectCard
						agent={inspectAgent}
						sessionId={sessionId}
						refreshing={roster.refreshing}
						onClose={() => setInspect(null)}
					/>
				</>
			) : null}
		</StudioPage>
	);
}
