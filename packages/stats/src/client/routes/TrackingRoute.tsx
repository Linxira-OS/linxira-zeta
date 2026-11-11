import { useState } from "react";
import { getTrackingProjects, getTrackingSnapshot } from "../api";
import { t } from "../i18n";
import { formatInteger, formatRelativeTime, formatTimestamp } from "../data/formatters";
import { useQuery } from "../data/query";
import type { TrackingSnapshotState, TrackingStatusValue } from "../types";
import {
	Badge,
	Card,
	EmptyState,
	KeyValues,
	PageHeader,
	QueryView,
	Skeleton,
	TableSkeleton,
	type Tone,
} from "../ui";
import "./tracking.css";

export interface TrackingRouteProps {
	active: boolean;
}

const STATE_KEY = {
	missing: "tracking.missing",
	partial: "tracking.partial",
	corrupt: "tracking.corrupt",
	error: "tracking.error",
} as const;

function stateTone(state: TrackingSnapshotState): Tone {
	if (state === "present") return "ok";
	if (state === "partial") return "warn";
	if (state === "corrupt" || state === "error") return "bad";
	return "neutral";
}

function StateBadge({ state, truncated }: { state: TrackingSnapshotState; truncated?: boolean }) {
	if (state === "present" && !truncated) return null;
	return (
		<Badge tone={stateTone(state)}>
			{state === "present" ? t("tracking.truncated") : t(STATE_KEY[state])}
		</Badge>
	);
}

function statusItems(status: TrackingStatusValue) {
	return [
		{ key: "phase", label: t("tracking.phase"), value: status.phase || t("tracking.none") },
		{ key: "progress", label: t("tracking.progress"), value: status.progress || t("tracking.none") },
		...(status.stage ? [{ key: "stage", label: t("tracking.stage"), value: status.stage }] : []),
		{
			key: "blockers",
			label: t("tracking.blockers"),
			value: status.blockers.length ? status.blockers.join("; ") : t("tracking.none"),
		},
		{
			key: "decisions",
			label: t("tracking.decisions"),
			value: status.decisions.length ? status.decisions.join("; ") : t("tracking.none"),
		},
		{ key: "updated", label: t("tracking.last-updated"), value: status.lastUpdated || t("tracking.none") },
		...(status.lastSessionId
			? [{ key: "session", label: t("tracking.last-session"), value: <span className="mono">{status.lastSessionId}</span> }]
			: []),
		...(status.phases?.length
			? [
					{
						key: "phases",
						label: t("tracking.phases"),
						value: status.phases.map(phase => `${phase.name} · ${phase.status}`).join("; "),
					},
				]
			: []),
	];
}

function errorLine(error: string | null) {
	if (!error) return null;
	return <p className="tracking-error">{error}</p>;
}

/**
 * Read-only Tracking page: one project from the stats registry at a time, with
 * the same files the agent's `tracking_update` tool writes. Missing/corrupt
 * inputs render as those states rather than as an empty or healthy project.
 */
export function TrackingRoute({ active }: TrackingRouteProps) {
	const folders = useQuery(["tracking-projects"], ({ signal }) => getTrackingProjects(signal), { enabled: active });
	const projects = folders.data?.projects ?? [];
	const [selected, setSelected] = useState<string | null>(null);
	const project = selected !== null && projects.includes(selected) ? selected : (projects[0] ?? null);
	const snapshot = useQuery(
		["tracking", project],
		({ signal }) => getTrackingSnapshot(project ?? "", signal),
		{ enabled: active && project !== null },
	);

	return (
		<div className="page">
			<PageHeader title={t("tracking.title")} description={t("tracking.description")} />
			<Card index={0}>
				<div className="tracking-toolbar">
					<label className="tracking-project">
						<span className="section-label">{t("tracking.project")}</span>
						{folders.data === null ? (
							<Skeleton width={280} height={30} />
						) : (
							<select
								className="tracking-select"
								value={project ?? ""}
								aria-label={t("tracking.project")}
								onChange={event => setSelected(event.target.value)}
								disabled={projects.length === 0}
							>
								{projects.length === 0 && <option value="">{t("tracking.no-projects")}</option>}
								{projects.map(folder => (
									<option key={folder} value={folder}>
										{folder}
									</option>
								))}
							</select>
						)}
					</label>
					<p className="tracking-note">{t("tracking.read-only")}</p>
				</div>
			</Card>

			{folders.data !== null && projects.length === 0 ? (
				<Card index={1}>
					<EmptyState title={t("tracking.no-projects")} hint={t("tracking.no-projects-hint")} />
				</Card>
			) : (
				<QueryView
					query={snapshot}
					skeleton={<TableSkeleton rows={5} />}
					isEmpty={data => !data.exists}
					empty={
						<EmptyState
							title={t("tracking.no-documents")}
							hint={`${t("tracking.no-documents-hint")}\n${snapshot.data?.trackingDir ?? ""}`}
						/>
					}
				>
					{data => (
						<div className="grid grid-main-side">
							<Card index={1} title={t("tracking.status")} flush>
								<div className="tracking-panel">
									<div className="row tracking-meta">
										<span className="mono dim">{data.trackingDir}</span>
										<span className="row">
											{data.updatedAt && (
												<span className="dim" title={formatTimestamp(Date.parse(data.updatedAt))}>
													{t("tracking.updated")}:{" "}
													{formatRelativeTime(Date.parse(data.updatedAt))}
												</span>
											)}
											<StateBadge state={data.status.state} truncated={data.status.truncated} />
										</span>
									</div>
									{data.status.value ? (
										<KeyValues items={statusItems(data.status.value)} />
									) : (
										<EmptyState
											title={
												data.status.state === "missing"
													? t("tracking.status-missing")
													: data.status.state === "corrupt"
														? t("tracking.status-corrupt")
														: t("tracking.status-error")
											}
										/>
									)}
									{errorLine(data.status.error)}
								</div>
							</Card>

							<Card index={2} title={t("tracking.index")} flush>
								<div className="tracking-panel">
									<div className="row tracking-meta">
										<span className="dim">{t("tracking.index")}</span>
										<StateBadge state={data.index.state} truncated={data.index.truncated} />
									</div>
									{data.index.content !== null ? (
										<pre className="tracking-doc">{data.index.content || t("tracking.document-empty")}</pre>
									) : (
										<EmptyState title={t("tracking.index-missing")} />
									)}
									{errorLine(data.index.error)}
								</div>
							</Card>

							<Card index={3} title={t("tracking.actions")} flush>
								<div className="tracking-panel">
									<div className="row tracking-meta">
										<span className="dim">
											{t("tracking.actions")} · {formatInteger(data.actions.rows.length)}
										</span>
										<StateBadge state={data.actions.state} truncated={data.actions.truncated} />
									</div>
									{data.actions.invalidRows > 0 && (
										<p className="tracking-error">
											{t("tracking.invalid-rows", { count: formatInteger(data.actions.invalidRows) })}
										</p>
									)}
									{data.actions.rows.length === 0 ? (
										<EmptyState
											title={
												data.actions.state === "missing"
													? t("tracking.actions-missing")
													: t("tracking.actions-empty")
											}
										/>
									) : (
										<ul className="tracking-list">
											{[...data.actions.rows].reverse().map((row, index) => (
												<li className="tracking-list-row" key={`${row.timestamp}:${row.action}:${index}`}>
													<span className="mono dim">{row.timestamp || "—"}</span>
													<span>{row.action}</span>
													{row.detail !== undefined && <span className="muted">{row.detail}</span>}
												</li>
											))}
										</ul>
									)}
									{errorLine(data.actions.error)}
								</div>
							</Card>

							<Card index={4} title={t("tracking.sessions")} flush>
								<div className="tracking-panel">
									<div className="row tracking-meta">
										<span className="dim">
											{t("tracking.sessions")} · {formatInteger(data.sessions.length)}
										</span>
										<StateBadge state={data.sessionsState} />
									</div>
									{data.sessions.length === 0 ? (
										<EmptyState
											title={
												data.sessionsState === "missing"
													? t("tracking.sessions-missing")
													: t("tracking.sessions-empty")
											}
										/>
									) : (
										<div className="stack">
											{data.sessions.map(session => (
												<details className="tracking-session" key={session.name}>
													<summary className="row">
														<span className="mono">{session.name}</span>
														<StateBadge state={session.state} truncated={session.truncated} />
													</summary>
													{session.content !== null ? (
														<pre className="tracking-doc">
															{session.content || t("tracking.document-empty")}
														</pre>
													) : (
														<EmptyState title={t("tracking.sessions-empty")} />
													)}
													{errorLine(session.error)}
												</details>
											))}
										</div>
									)}
								</div>
							</Card>
						</div>
					)}
				</QueryView>
			)}
		</div>
	);
}
