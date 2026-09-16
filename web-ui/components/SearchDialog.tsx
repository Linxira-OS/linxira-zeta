/**
 * SearchDialog — ⌘K aggregated palette (P2 interaction port).
 *
 * One surface, three result groups: new session (always first), sessions
 * (empty query = 30 recent, grouped Today/Yesterday/Prev7d/Prev30d/Earlier;
 * query = title + first-message substring match), and commands. Full
 * keyboard navigation: ↑↓ wrap, Enter runs, Esc closes. 80ms input debounce
 * is unnecessary for client-side filtering but the grouping memo is.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";

export interface SearchCommand {
	key: string;
	label: string;
	run: () => void;
}

interface SearchDialogProps {
	open: boolean;
	sessions: SessionInfo[];
	commands: SearchCommand[];
	onClose: () => void;
	onSelectSession: (s: SessionInfo) => void;
	onNewSession: () => void;
}

interface Row {
	key: string;
	kind: "action" | "session" | "command" | "header";
	label: string;
	hint?: string;
	session?: SessionInfo;
	command?: SearchCommand;
}

const RECENT_LIMIT = 30;

function bucketOf(modified: string): "today" | "yesterday" | "prev7" | "prev30" | "earlier" {
	const t = Date.parse(modified);
	if (!Number.isFinite(t)) return "earlier";
	const startToday = new Date();
	startToday.setHours(0, 0, 0, 0);
	const day = 86_400_000;
	if (t >= startToday.getTime()) return "today";
	if (t >= startToday.getTime() - day) return "yesterday";
	if (t >= startToday.getTime() - 7 * day) return "prev7";
	if (t >= startToday.getTime() - 30 * day) return "prev30";
	return "earlier";
}

const BUCKET_ORDER = ["today", "yesterday", "prev7", "prev30", "earlier"] as const;

export function SearchDialog({ open, sessions, commands, onClose, onSelectSession, onNewSession }: SearchDialogProps) {
	const { t } = useI18n();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (open) {
			setQuery("");
			setActive(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	const rows = useMemo<Row[]>(() => {
		const q = query.trim().toLowerCase();
		const out: Row[] = [{ key: "new", kind: "action", label: t("sidebar.actions.newSession") }];
		if (q) {
			const matches = sessions
				.filter(
					(s) =>
						(s.name ?? "").toLowerCase().includes(q) ||
						(s.firstMessage ?? "").toLowerCase().includes(q) ||
						s.id.toLowerCase().includes(q),
				)
				.slice(0, 20);
			if (matches.length > 0) out.push({ key: "h-sessions", kind: "header", label: t("search.sessions") });
			for (const s of matches) {
				out.push({
					key: `s-${s.id}`,
					kind: "session",
					label: s.name ?? s.firstMessage ?? s.id,
					hint: s.projectRoot ? s.projectRoot.split(/[\\/]/).pop() : undefined,
					session: s,
				});
			}
		} else {
			const recent = [...sessions]
				.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified))
				.slice(0, RECENT_LIMIT);
			const byBucket = new Map<string, SessionInfo[]>();
			for (const s of recent) {
				const b = bucketOf(s.modified);
				const list = byBucket.get(b) ?? [];
				list.push(s);
				byBucket.set(b, list);
			}
			for (const bucket of BUCKET_ORDER) {
				const list = byBucket.get(bucket);
				if (!list || list.length === 0) continue;
				out.push({ key: `h-${bucket}`, kind: "header", label: t(`search.bucket.${bucket}`) });
				for (const s of list) {
					out.push({
						key: `s-${s.id}`,
						kind: "session",
						label: s.name ?? s.firstMessage ?? s.id,
						hint: s.projectRoot ? s.projectRoot.split(/[\\/]/).pop() : undefined,
						session: s,
					});
				}
			}
		}
		if (commands.length > 0) out.push({ key: "h-commands", kind: "header", label: t("search.commands") });
		for (const c of commands) out.push({ key: `c-${c.key}`, kind: "command", label: c.label, command: c });
		return out;
	}, [query, sessions, commands, t]);

	const selectable = rows.filter((r) => r.kind !== "header");
	const activeSelectable = Math.min(active, selectable.length - 1);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const n = selectable.length;
				if (n === 0) return;
				const delta = e.key === "ArrowDown" ? 1 : -1;
				setActive((prev) => (Math.min(prev, n - 1) + delta + n) % n);
			} else if (e.key === "Enter") {
				e.preventDefault();
				const row = selectable[activeSelectable];
				if (!row) return;
				if (row.kind === "action") onNewSession();
				else if (row.kind === "session" && row.session) onSelectSession(row.session);
				else if (row.kind === "command" && row.command) row.command.run();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, selectable, activeSelectable, onClose, onSelectSession, onNewSession]);

	useEffect(() => {
		listRef.current
			?.querySelector<HTMLElement>(`[data-row="${selectable[activeSelectable]?.key}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeSelectable, selectable]);

	if (!open || typeof document === "undefined") return null;

	let selIdx = -1;
	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-label={t("search.placeholder")}
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 320,
				display: "flex",
				justifyContent: "center",
				alignItems: "flex-start",
				paddingTop: "12vh",
				background: "color-mix(in srgb, var(--bg) 55%, transparent)",
				backdropFilter: "blur(2px)",
			}}
		>
			<div
				style={{
					width: 520,
					maxWidth: "calc(100vw - 32px)",
					maxHeight: "60vh",
					display: "flex",
					flexDirection: "column",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: 10,
					boxShadow: "var(--surface-shadow, 0 10px 32px rgba(0,0,0,0.25))",
					overflow: "hidden",
				}}
			>
				<div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-dim)" }}>
						<circle cx="11" cy="11" r="7" />
						<line x1="21" y1="21" x2="16.5" y2="16.5" />
					</svg>
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
						placeholder={t("search.placeholder")}
						style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13 }}
					/>
				</div>
				<div ref={listRef} style={{ overflowY: "auto", flex: 1, padding: 4 }}>
					{rows.map((row) => {
						if (row.kind === "header") {
							return (
								<div
									key={row.key}
									style={{
										padding: "8px 8px 2px",
										fontSize: 10,
										fontWeight: 600,
										letterSpacing: "0.08em",
										textTransform: "uppercase",
										color: "var(--text-dim)",
									}}
								>
									{row.label}
								</div>
							);
						}
						selIdx += 1;
						const isActive = selIdx === activeSelectable;
						return (
							<button
								key={row.key}
								data-row={row.key}
								onMouseMove={() => setActive(selectable.indexOf(row))}
								onClick={() => {
									if (row.kind === "action") onNewSession();
									else if (row.kind === "session" && row.session) onSelectSession(row.session);
									else if (row.kind === "command" && row.command) row.command.run();
									onClose();
								}}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									width: "100%",
									padding: "6px 8px",
									background: isActive ? "var(--bg-selected)" : "none",
									border: "none",
									borderRadius: 6,
									color: row.kind === "action" ? "var(--accent)" : "var(--text)",
									cursor: "pointer",
									fontSize: 12,
									textAlign: "left",
								}}
							>
								<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
									{row.label}
								</span>
								{row.hint && <span style={{ color: "var(--text-dim)", fontSize: 10.5, flexShrink: 0 }}>{row.hint}</span>}
							</button>
						);
					})}
				</div>
			</div>
		</div>,
		document.body,
	);
}
