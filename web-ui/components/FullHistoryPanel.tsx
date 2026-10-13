"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface Props {
	/** Session whose full transcript is rendered. */
	sessionId: string;
	/** Session title, used for the frame's accessible name. */
	sessionName: string | null;
}

/**
 * Full-history window (dock tool "history").
 *
 * The gateway's `/api/sessions/<id>/export` document is the only renderer that
 * shows the *complete* transcript — every entry, including the blocks the live
 * chat drops once the context is compacted. Instead of handing that URL to the
 * host (which the desktop shell resolves with `shell.openExternal`, throwing
 * the user into the system browser) we load it here and mount it in the dock.
 *
 * Isolation: the fetched document is an untrusted-text sink (it embeds raw
 * session content), so it is rendered through `<iframe srcdoc>` with
 * `sandbox="allow-scripts"` and *without* `allow-same-origin`. The frame gets
 * an opaque origin: its scripts cannot touch the app's DOM, storage, or
 * cookies, and it cannot navigate the top-level window. `allow-scripts` is what
 * keeps the export's own controls working (entry tree, search, filters, theme
 * select, copy buttons); `allow="clipboard-write"` keeps the primary clipboard
 * path alive (the export also has an `execCommand` fallback).
 */
export function FullHistoryPanel({ sessionId, sessionName }: Props) {
	const { t } = useI18n();
	const [html, setHtml] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [nonce, setNonce] = useState(0);

	const reload = useCallback(() => setNonce(n => n + 1), []);

	useEffect(() => {
		const controller = new AbortController();
		let cancelled = false;
		setLoading(true);
		setError(null);
		void (async () => {
			try {
				const res = await fetch(
					`/api/sessions/${encodeURIComponent(sessionId)}/export?inline=1`,
					{ cache: "no-store", signal: controller.signal },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const document = await res.text();
				if (cancelled) return;
				setHtml(document);
				setLoading(false);
			} catch (err) {
				if (cancelled || controller.signal.aborted) return;
				setHtml(null);
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [sessionId, nonce]);

	if (loading) {
		return (
			<div
				style={{
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "var(--zeta-alias-text-dim)",
					fontSize: 12,
				}}
			>
				{t("full-history-loading")}
			</div>
		);
	}

	if (error !== null || html === null) {
		return (
			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: 10,
					padding: 16,
					textAlign: "center",
				}}
			>
				<div style={{ color: "var(--zeta-alias-text)", fontSize: 12.5 }}>{t("full-history-load-failed")}</div>
				<div style={{ color: "var(--zeta-alias-text-dim)", fontSize: 11, wordBreak: "break-word" }}>{error}</div>
				<button
					onClick={reload}
					style={{
						padding: "5px 12px",
						background: "var(--zeta-alias-bg-panel)",
						border: "1px solid var(--zeta-alias-border)",
						borderRadius: 6,
						color: "var(--zeta-alias-text)",
						fontSize: 12,
						cursor: "pointer",
					}}
				>
					{t("full-history-retry")}
				</button>
			</div>
		);
	}

	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "flex-end",
					flexShrink: 0,
					borderBottom: "1px solid var(--zeta-alias-border)",
				}}
			>
				<button
					onClick={reload}
					title={t("refresh")}
					aria-label={t("refresh")}
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 28,
						height: 28,
						marginRight: 4,
						background: "none",
						border: "none",
						borderRadius: 4,
						color: "var(--zeta-alias-text-dim)",
						cursor: "pointer",
					}}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<polyline points="23 4 23 10 17 10" />
						<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
					</svg>
				</button>
			</div>
			<FullHistoryFrame html={html} title={sessionName ?? t("full-history")} />
		</div>
	);
}

/**
 * The isolated rendering surface for the exported transcript.
 *
 * `srcdoc` + `sandbox="allow-scripts"` (deliberately *without*
 * `allow-same-origin`) pins the document to an opaque origin, so no session
 * text — however it is escaped upstream — can script the app's DOM, storage,
 * or cookies, and the frame cannot navigate the top-level window.
 * `allow-scripts` keeps the export's own controls working; the clipboard
 * permission keeps its copy buttons working.
 *
 * Exported for the render test in `FullHistoryPanel.test.mjs`, which mounts it
 * directly (a static render of the panel never leaves its fetching state).
 */
export function FullHistoryFrame({ html, title }: { html: string; title: string }) {
	return (
		<iframe
			data-testid="full-history-frame"
			title={title}
			srcDoc={html}
			sandbox="allow-scripts"
			allow="clipboard-write"
			style={{
				flex: 1,
				width: "100%",
				minHeight: 0,
				border: "none",
				background: "var(--zeta-alias-bg)",
			}}
		/>
	);
}
