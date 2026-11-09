"use client";

/**
 * HistoryPage — active and archived conversations of the selected workspace.
 *
 * Reads `GET /api/sessions` and `GET /api/sessions/archived`; mutations go
 * through `lib/session-api` (`archiveSession` / `unarchiveSession` /
 * `deleteSession`), which the gateway already answers.
 *
 * Studio's other history panes are absent because their operations have no
 * gateway route: native archive search/recaps/prompts (`archive.*`), resume
 * scope (`worktrees.session.resume.*`), session portability (`session.
 * portability.*`) and the generated-title card metadata.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/studio/i18n";
import { hostErrorMessage } from "@/components/studio/primitives/hostError";
import { Icon } from "@/components/studio/primitives/icons";
import { isImSession, sessionLocationLabel } from "@/lib/session-origin";
import type { SessionInfo } from "@/lib/types";
import {
	archiveSession,
	deleteSession,
	fetchArchivedSessions,
	fetchSessions,
	unarchiveSession,
} from "@/lib/session-api";
import { PageBanner, PageEmpty, PageFrame } from "./page-frame";

type Scope = "active" | "archived";

function formatWhen(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function HistoryPage({
	cwd,
	title,
	onOpen,
}: {
	cwd: string | null;
	title?: string;
	onOpen?: (sessionId: string) => void;
}) {
	const { t } = useI18n();
	const [scope, setScope] = useState<Scope>("active");
	const [rows, setRows] = useState<SessionInfo[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	/** IM/bot/relay conversations are hidden from history unless asked for. */
	const [includeIm, setIncludeIm] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const list = scope === "archived" ? await fetchArchivedSessions() : (await fetchSessions()).sessions;
			setRows(list);
			setError(null);
		} catch (cause) {
			setError(hostErrorMessage(cause, t("studio.history.loadError")));
		}
	}, [scope, t]);

	useEffect(() => {
		void load();
	}, [load]);

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return rows
			.filter(row => (cwd ? row.cwd === cwd || row.projectRoot === cwd : true))
			.filter(row => includeIm || !isImSession(row))
			.filter(row =>
				needle
					? `${row.name ?? ""} ${row.firstMessage ?? ""} ${row.cwd}`.toLowerCase().includes(needle)
					: true,
			)
			.sort((a, b) => (a.modified < b.modified ? 1 : -1));
	}, [rows, cwd, query, includeIm]);

	const current = visible.find(row => row.id === selected) ?? visible[0];

	const mutate = useCallback(
		async (label: string, action: () => Promise<void>) => {
			setBusy(label);
			try {
				await action();
				await load();
				setError(null);
			} catch (cause) {
				setError(hostErrorMessage(cause, t("studio.history.actionError")));
			} finally {
				setBusy(null);
			}
		},
		[load, t],
	);

	return (
		<PageFrame title={title ?? t("studio.route.history")} subtitle={cwd}>
			{error ? <PageBanner className="banner red">{error}</PageBanner> : null}
			<div className="native-archive">
				<div className="archive-toolbar">
					<label>
						<select
							className="select"
							value={scope}
							onChange={event => {
								setScope(event.target.value as Scope);
								setSelected(null);
							}}
						>
							<option value="active">{t("studio.history.scopeActive")}</option>
							<option value="archived">{t("studio.history.scopeArchived")}</option>
						</select>
					</label>
					<input
						className="archive-search"
						type="search"
						value={query}
						placeholder={t("studio.history.search")}
						onChange={event => setQuery(event.target.value)}
					/>
					<label className="small muted">
						<input
							type="checkbox"
							checked={includeIm}
							onChange={event => setIncludeIm(event.target.checked)}
						/>{" "}
						{t("studio.history.includeIm")}
					</label>
					<span className="spacer" />
					<button type="button" className="icon-btn small" aria-label={t("studio.action.refresh")} onClick={() => void load()}>
						<Icon name="refresh" extra="sm" />
					</button>
				</div>

				{visible.length === 0 ? (
					<PageEmpty>
						{scope === "archived" ? t("studio.history.emptyArchived") : t("studio.history.empty")}
					</PageEmpty>
				) : (
					<div className="archive-columns">
						<div className="archive-results" role="listbox" aria-label={t("studio.history.list")}>
							{visible.map(row => (
								<button
									key={row.id}
									type="button"
									role="option"
									aria-selected={current?.id === row.id}
									className={`archive-session${current?.id === row.id ? " selected" : ""}`}
									onClick={() => setSelected(row.id)}
									onDoubleClick={() => onOpen?.(row.id)}
								>
									<strong>{row.name || row.firstMessage || t("studio.history.untitled")}</strong>
									<span className="archive-meta">
										{formatWhen(row.modified)} · {row.messageCount} {t("studio.history.messages")}
									</span>
									{/* IM rows show an alias/channel; only personal rows show a path. */}
									<span className="archive-excerpt ellipsis">
										{isImSession(row) ? sessionLocationLabel(row, t) : row.cwd}
									</span>
								</button>
							))}
						</div>

						{current ? (
							<div className="archive-detail">
								<h3>{current.name || current.firstMessage || t("studio.history.untitled")}</h3>
								<dl>
									<dt>{t("studio.history.id")}</dt>
									<dd className="mono">{current.id}</dd>
									<dt>{t("studio.history.cwd")}</dt>
									<dd className="mono">{current.archivedFrom ?? current.cwd}</dd>
									<dt>{t("studio.history.created")}</dt>
									<dd>{formatWhen(current.created)}</dd>
									<dt>{t("studio.history.modified")}</dt>
									<dd>{formatWhen(current.modified)}</dd>
									<dt>{t("studio.history.messages")}</dt>
									<dd>{current.messageCount}</dd>
								</dl>
								<div className="page-actions">
									{onOpen ? (
										<button type="button" className="btn small primary" onClick={() => onOpen(current.id)}>
											{t("studio.history.open")}
										</button>
									) : null}
									{scope === "archived" ? (
										<button
											type="button"
											className="btn small outline"
											disabled={busy !== null}
											onClick={() => void mutate("unarchive", () => unarchiveSession(current.id))}
										>
											{t("studio.history.unarchive")}
										</button>
									) : (
										<button
											type="button"
											className="btn small outline"
											disabled={busy !== null}
											onClick={() => void mutate("archive", () => archiveSession(current.id))}
										>
											{t("studio.history.archive")}
										</button>
									)}
									<button
										type="button"
										className="btn small danger"
										disabled={busy !== null}
										onClick={() => {
											if (!window.confirm(t("studio.history.confirmDelete"))) return;
											void mutate("delete", async () => {
												await deleteSession(current.id);
												setSelected(null);
											});
										}}
									>
										{t("studio.action.delete")}
									</button>
								</div>
							</div>
						) : null}
					</div>
				)}
			</div>
		</PageFrame>
	);
}
