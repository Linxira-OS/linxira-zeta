import { useMemo, useState } from "react";
import { getRecentRequests } from "../api";
import { t } from "../i18n";
import {
	formatCompact,
	formatDurationMs,
	formatErrorRate,
	formatEstimatedCost,
	formatFolder,
	formatInteger,
	formatMessageCost,
	formatRelativeTime,
	formatTimestamp,
} from "../data/formatters";
import { useQuery } from "../data/query";
import { rangeMeta } from "../data/range";
import { type RequestStatus, requestStatus, summarizeRequests } from "../data/view-models";
import { REQUEST_STATUS } from "../ui/RequestDrawer";
import type { MessageStats, TimeRange } from "../types";
import {
	Card,
	type Column,
	Dot,
	EmptyState,
	LabelCell,
	PageHeader,
	QueryView,
	SearchInput,
	Segmented,
	Skeleton,
	Stat,
	StatGrid,
	Table,
	TableSkeleton,
} from "../ui";

export interface RequestsRouteProps {
	active: boolean;
	range: TimeRange;
	onRequestClick: (id: number) => void;
}

/** How many of the newest requests to load; "Load more" steps through these. */
const LOAD_STEPS = [500, 2_000, 10_000] as const;

type StatusFilter = "all" | RequestStatus;

export function RequestsRoute({ active, range, onRequestClick }: RequestsRouteProps) {
	const [step, setStep] = useState(0);
	const limit = LOAD_STEPS[step];
	const log = useQuery(["requests-log", limit], ({ signal }) => getRecentRequests(limit, signal), { enabled: active });
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<StatusFilter>("all");
	const meta = rangeMeta(range);

	const view = useMemo(() => {
		const rows = log.data ?? [];
		const cutoff = meta.spanMs === null ? null : Date.now() - meta.spanMs;
		const inRange = cutoff === null ? rows : rows.filter(row => row.timestamp >= cutoff);
		// The loaded window covers the whole range when the server ran out of rows
		// or the oldest loaded row is already older than the range start. Stale
		// rows belong to a smaller limit that is being replaced.
		const complete = !log.stale && (rows.length < limit || (cutoff !== null && inRange.length < rows.length));
		const counts: Record<StatusFilter, number> = { all: inRange.length, ok: 0, aborted: 0, failed: 0 };
		for (const row of inRange) counts[requestStatus(row)]++;
		return { loaded: rows.length, inRange, complete, counts, summary: summarizeRequests(inRange) };
	}, [log.data, log.stale, limit, meta.spanMs]);

	const filtered = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return view.inRange.filter(
			row =>
				(status === "all" || requestStatus(row) === status) &&
				(needle === "" ||
					row.model.toLowerCase().includes(needle) ||
					row.provider.toLowerCase().includes(needle) ||
					row.folder.toLowerCase().includes(needle)),
		);
	}, [view.inRange, search, status]);

	const { summary, counts, complete } = view;
	const nextStep = step + 1 < LOAD_STEPS.length ? LOAD_STEPS[step + 1] : null;
	const loadMore =
		nextStep !== null ? (
			<button
				type="button"
				className="btn"
				data-size="sm"
				disabled={log.refreshing}
				onClick={() => setStep(step + 1)}
			>
				{log.refreshing && log.stale
					? t("requests.loading")
					: t("requests.load-latest", { count: formatInteger(nextStep) })}
			</button>
		) : undefined;

	const statusOptions = (["all", "ok", "aborted", "failed"] as const).map(value => ({
		value,
		label: (
			<>
				{value === "all" ? t("requests.status-all") : REQUEST_STATUS[value].label}{" "}
				<span className="dim num">{formatCompact(counts[value])}</span>
			</>
		),
	}));

	return (
		<div className="page">
			<PageHeader
				title={t("common.requests")}
				description={t("requests.description", { window: t(meta.windowKey) })}
			/>

			<QueryView query={log} skeleton={<Skeleton height={96} style={{ borderRadius: 12 }} />}>
				{() => (
					<div data-stale={log.stale}>
						<StatGrid min={160}>
							<Stat
								label={t("common.requests")}
								value={formatInteger(summary.requests)}
								hint={
									summary.oldest === null
										? t("requests.none-in-window", { window: t(meta.windowKey) })
										: t("requests.since", { time: formatRelativeTime(summary.oldest) })
								}
							/>
							<Stat
								label={t("common.failed")}
								value={formatInteger(summary.failed)}
								hint={t("requests.failed-hint", {
									rate: summary.requests > 0 ? formatErrorRate(summary.failed / summary.requests) : "–",
									count: formatInteger(summary.aborted),
								})}
							/>
							<Stat
								label={t("common.tokens")}
								title={t("requests.tokens-hint")}
								value={formatCompact(summary.tokens)}
							/>
							<Stat
								label={t("requests.api-equivalent-cost")}
								title={t("requests.cost-hint")}
								value={formatEstimatedCost(summary.cost, summary.unpriced)}
								hint={
									summary.unpriced > 0
										? t("requests.unpriced-n", { count: formatInteger(summary.unpriced) })
										: undefined
								}
							/>
							<Stat
								label={t("requests.median-duration")}
								value={formatDurationMs(summary.medianDuration)}
								hint={t("requests.p95", { value: formatDurationMs(summary.p95Duration) })}
							/>
							<Stat
								label={t("requests.median-ttft")}
								title={t("requests.ttft-hint")}
								value={formatDurationMs(summary.medianTtft)}
							/>
						</StatGrid>
					</div>
				)}
			</QueryView>

			<Card
				index={1}
				title={t("requests.log-title")}
				description={
					log.data === null
						? t("requests.log-loading")
						: complete
							? t("requests.log-count-in-window", {
									shown: formatInteger(filtered.length),
									total: formatInteger(summary.requests),
									window: t(meta.windowKey),
								})
							: t("requests.log-count-latest", {
									shown: formatInteger(filtered.length),
									total: formatInteger(summary.requests),
								})
				}
				actions={
					<>
						<SearchInput value={search} onChange={setSearch} placeholder={t("requests.search-placeholder")} />
						<Segmented
							size="sm"
							aria-label={t("requests.status")}
							options={statusOptions}
							value={status}
							onChange={setStatus}
						/>
					</>
				}
				flush
				stale={log.stale}
				footer={
					log.data !== null && !complete ? (
						<>
							<span>
								{t("requests.footer", {
									count: formatInteger(view.loaded),
									time: summary.oldest === null ? "–" : formatTimestamp(summary.oldest),
									window: t(meta.windowKey),
								})}
							</span>
							{loadMore}
						</>
					) : undefined
				}
			>
				<QueryView query={log} skeleton={<TableSkeleton rows={12} />}>
					{() => (
						<Table
							rows={filtered}
							rowKey={row => row.id ?? `${row.sessionFile}:${row.entryId}`}
							onRowClick={row => row.id !== undefined && onRequestClick(row.id)}
							columns={REQUEST_COLUMNS}
							initialSort={{ key: "time", dir: "desc" }}
							limit={100}
							dense
							empty={
								<EmptyState
									title={
										summary.requests === 0
											? t("requests.empty-in-window", { window: t(meta.windowKey) })
											: t("requests.empty-no-match")
									}
									hint={summary.requests === 0 ? undefined : t("requests.empty-no-match-hint")}
								/>
							}
						/>
					)}
				</QueryView>
			</Card>
		</div>
	);
}

const REQUEST_COLUMNS: readonly Column<MessageStats>[] = [
	{
		key: "model",
		header: t("common.model"),
		sort: row => row.model,
		render: row => <LabelCell primary={<span className="mono">{row.model}</span>} secondary={row.provider} />,
	},
	{
		key: "time",
		header: t("requests.when"),
		sort: row => row.timestamp,
		render: row => (
			<span className="muted" title={formatTimestamp(row.timestamp)}>
				{formatRelativeTime(row.timestamp)}
			</span>
		),
	},
	{
		key: "project",
		header: t("common.project"),
		sort: row => row.folder,
		render: row => (
			<span className="mono muted truncate" title={row.folder} style={{ display: "block", maxWidth: 180 }}>
				{formatFolder(row.folder)}
			</span>
		),
	},
	{
		key: "input",
		header: t("common.input"),
		title: t("requests.uncached-input"),
		align: "right",
		sort: row => row.usage.input,
		render: row => <span className="num">{formatCompact(row.usage.input)}</span>,
	},
	{
		key: "cache",
		header: t("common.cache-read"),
		title: t("requests.cache-read-title"),
		align: "right",
		sort: row => row.usage.cacheRead,
		render: row => (
			<span className="num" title={t("requests.cache-write", { count: formatInteger(row.usage.cacheWrite) })}>
				{formatCompact(row.usage.cacheRead)}
			</span>
		),
	},
	{
		key: "output",
		header: t("common.output"),
		align: "right",
		sort: row => row.usage.output,
		render: row => <span className="num">{formatCompact(row.usage.output)}</span>,
	},
	{
		key: "cost",
		header: t("common.cost"),
		title: t("requests.cost-estimate"),
		align: "right",
		sort: row => row.usage.cost.total,
		render: row => <span className="num">{formatMessageCost(row, 4)}</span>,
	},
	{
		key: "duration",
		header: t("common.duration"),
		align: "right",
		sort: row => row.duration ?? -1,
		render: row => <span className="num">{formatDurationMs(row.duration)}</span>,
	},
	{
		key: "ttft",
		header: t("requests.ttft"),
		title: t("requests.ttft-hint"),
		align: "right",
		sort: row => row.ttft ?? -1,
		render: row => <span className="num muted">{formatDurationMs(row.ttft)}</span>,
	},
	{
		key: "status",
		header: t("requests.status"),
		sort: row => requestStatus(row),
		render: row => {
			const status = REQUEST_STATUS[requestStatus(row)];
			return (
				<span title={row.errorMessage ?? undefined}>
					<LabelCell
						lead={<Dot tone={status.tone} />}
						primary={status.label}
						secondary={<span className="mono">{row.stopReason}</span>}
					/>
				</span>
			);
		},
	},
];
