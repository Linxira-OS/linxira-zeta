/**
 * SessionHoverCard — portal preview card shown on sidebar row hover
 * (P2 interaction port). Heavy metadata lives here, never in the row.
 * Timing: 500ms open delay, grace period while moving across rows, card
 * stays alive while the pointer is over it.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";

interface SessionHoverCardProps {
	session: SessionInfo | null;
	/** Anchor row rectangle (recomputed per hover). */
	anchorRect: DOMRect | null;
	branch: string | null;
	selected: boolean;
	running: boolean;
}

const OPEN_DELAY = 500;

function relativeTime(ts: number | undefined, now: number): string {
	if (!ts) return "—";
	const diff = Math.max(0, now - ts);
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "now";
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h`;
	const day = Math.floor(hr / 24);
	if (day < 30) return `${day}d`;
	return new Date(ts).toLocaleDateString();
}

export function SessionHoverCard({ session, anchorRect, branch, selected, running }: SessionHoverCardProps) {
	const [visible, setVisible] = useState(false);
	const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
	const overCard = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!session || !anchorRect) {
			setVisible(false);
			return;
		}
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (overCard.current) return;
			const vw = window.innerWidth;
			const x = Math.max(6, Math.min(anchorRect.right + 8, vw - 300));
			setPos({ x, y: Math.max(6, Math.min(anchorRect.top, window.innerHeight - 220)) });
			setVisible(true);
		}, OPEN_DELAY);
		return () => {
			if (timer.current) clearTimeout(timer.current);
		};
	}, [session, anchorRect]);

	if (!session || typeof document === "undefined") return null;

	const card = (
		<div
			role="tooltip"
			onMouseEnter={() => {
				overCard.current = true;
			}}
			onMouseLeave={() => {
				overCard.current = false;
				setVisible(false);
			}}
			style={{
				position: "fixed",
				left: pos?.x ?? -9999,
				top: pos?.y ?? -9999,
				visibility: visible ? "visible" : "hidden",
				zIndex: 280,
				width: 280,
				background: "var(--bg-elevated, var(--bg))",
				border: "1px solid var(--border)",
				borderRadius: 8,
				boxShadow: "var(--surface-shadow, 0 6px 20px rgba(0,0,0,0.18))",
				padding: "8px 10px",
				fontSize: 11,
				display: "flex",
				flexDirection: "column",
				gap: 5,
				pointerEvents: visible ? "auto" : "none",
			}}
		>
			<div
				style={{
					fontWeight: 600,
					fontSize: 12,
					color: "var(--text)",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{session.name ?? session.firstMessage ?? session.id}
			</div>
			<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
				{running && <Badge label="running" tone="accent" />}
				{selected && <Badge label="selected" tone="muted" />}
				<Badge label={session.cwd === session.projectRoot ? "project" : "worktree"} tone="muted" />
			</div>
			<Row k="id" v={session.id} mono />
			<Row k="project" v={session.projectRoot ?? session.cwd} mono />
			{branch && <Row k="branch" v={branch} />}
			<Row k="updated" v={relativeTime(Date.parse(session.modified), Date.now())} />
		</div>
	);

	return createPortal(card, document.body);
}

function Badge({ label, tone }: { label: string; tone: "accent" | "muted" }) {
	return (
		<span
			style={{
				fontSize: 9.5,
				lineHeight: "14px",
				padding: "0 6px",
				borderRadius: 999,
				border: `1px solid ${tone === "accent" ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border)"}`,
				color: tone === "accent" ? "var(--accent)" : "var(--text-muted)",
			}}
		>
			{label}
		</span>
	);
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
	return (
		<div style={{ display: "flex", gap: 6, minWidth: 0 }}>
			<span style={{ color: "var(--text-dim)", flexShrink: 0, width: 52 }}>{k}</span>
			<span
				style={{
					color: "var(--text-muted)",
					fontFamily: mono ? "var(--font-mono)" : undefined,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					direction: "rtl",
					textAlign: "left",
				}}
			>
				{v}
			</span>
		</div>
	);
}
