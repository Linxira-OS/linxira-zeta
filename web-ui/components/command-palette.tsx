"use client";

import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { fetchSessions } from "@/lib/session-api";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";

/**
 * Global command palette (Ctrl+K). Two groups:
 *  - actions: passed in by the shell (open settings, model manager, docks…)
 *  - sessions: fetched on open, filtered by the palette query
 */
export function CommandPalette({
	open,
	onOpenChange,
	onSelectSession,
	actions,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectSession: (sessionId: string) => void;
	actions: Array<{ id: string; label: string; run: () => void; keywords?: string }>;
}) {
	const { t } = useI18n();
	const [sessions, setSessions] = useState<SessionInfo[]>([]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		fetchSessions()
			.then(list => {
				if (!cancelled) setSessions(Array.isArray(list) ? list : []);
			})
			.catch(() => {
				if (!cancelled) setSessions([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const runAndClose = (run: () => void) => () => {
		onOpenChange(false);
		run();
	};

	const actionItems = useMemo(() => actions, [actions]);

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label={t("palette.placeholder")}
			className="command-palette"
			style={
				{
					position: "fixed",
					inset: 0,
					zIndex: 600,
					display: open ? "flex" : "none",
					alignItems: "flex-start",
					justifyContent: "center",
					paddingTop: "12vh",
					background: "color-mix(in srgb, var(--bg) 55%, transparent)",
				} as React.CSSProperties
			}
		>
			<div
				style={{
					width: "min(560px, calc(100vw - 48px))",
					maxHeight: "min(480px, 70vh)",
					display: "flex",
					flexDirection: "column",
					background: "var(--bg-panel)",
					border: "1px solid var(--border)",
					borderRadius: 12,
					boxShadow: "0 18px 48px var(--surface-shadow)",
					overflow: "hidden",
				}}
				onClick={e => e.stopPropagation()}
			>
				<Command.Input
					autoFocus
					placeholder={t("palette.placeholder")}
					style={{
						margin: 10,
						padding: "8px 12px",
						background: "var(--bg)",
						border: "1px solid var(--border)",
						borderRadius: 9,
						color: "var(--text)",
						fontSize: 13,
						outline: "none",
					}}
				/>
				<Command.List
					style={{
						flex: 1,
						overflowY: "auto",
						padding: "0 6px 8px",
					}}
				>
					<Command.Empty
						style={{
							padding: "16px 12px",
							fontSize: 12,
							color: "var(--text-muted)",
							textAlign: "center",
						}}
					>
						{t("palette.no-results")}
					</Command.Empty>

					{actionItems.length > 0 && (
						<Command.Group heading={t("palette.actions")} style={{ paddingBottom: 4 }}>
							{actionItems.map(action => (
								<Command.Item
									key={action.id}
									keywords={action.keywords ? [action.keywords] : undefined}
									onSelect={runAndClose(action.run)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 8,
										padding: "8px 10px",
										borderRadius: 8,
										fontSize: 12.5,
										color: "var(--text)",
										cursor: "pointer",
									}}
								>
									{action.label}
								</Command.Item>
							))}
						</Command.Group>
					)}

					{sessions.length > 0 && (
						<Command.Group heading={t("palette.sessions")} style={{ paddingBottom: 4 }}>
							{sessions.map(session => (
								<Command.Item
									key={session.id}
									value={`${session.name ?? ""} ${session.firstMessage ?? ""} ${session.cwd ?? ""}`}
									onSelect={runAndClose(() => onSelectSession(session.id))}
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "flex-start",
										gap: 2,
										padding: "8px 10px",
										borderRadius: 8,
										fontSize: 12.5,
										color: "var(--text)",
										cursor: "pointer",
									}}
								>
									<span
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
											maxWidth: "100%",
										}}
									>
										{session.name || session.firstMessage || session.id}
									</span>
									{session.cwd && (
										<span
											style={{
												fontSize: 11,
												color: "var(--text-dim)",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
												maxWidth: "100%",
											}}
										>
											{session.cwd}
										</span>
									)}
								</Command.Item>
							))}
						</Command.Group>
					)}
				</Command.List>
				{/*
					Hint bar keeps the shortcut discoverable; pointer-events none so it
					never steals focus from the input.
				*/}
				<div
					style={{
						padding: "6px 12px",
						borderTop: "1px solid var(--border)",
						fontSize: 11,
						color: "var(--text-dim)",
						pointerEvents: "none",
					}}
				>
					{t("palette.hint")}
				</div>
			</div>
		</Command.Dialog>
	);
}

export type CommandPaletteAction = { id: string; label: string; run: () => void; keywords?: string };
