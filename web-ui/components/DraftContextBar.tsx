"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { fetchSessions } from "@/lib/session-api";
import { FolderIcon } from "./FileIcons";
import { FolderPickerModal } from "./FolderPickerModal";

function basenameLabel(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

interface GitBranchesResponse {
	isGitRepository?: boolean;
	current?: string;
	branches?: { name: string }[];
}

/**
 * Normalized branch data for the draft cwd (gateway /api/git/branches?cwd=).
 * Null when the cwd is not a git repository or exposes no branches — the
 * branch chip hides and the draft stays cwd-scoped.
 */
export async function fetchDraftBranches(cwd: string): Promise<GitBranchesResponse | null> {
	try {
		const d = (await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`).then(r => r.json())) as GitBranchesResponse;
		return d.isGitRepository && d.branches && d.branches.length > 0 ? d : null;
	} catch {
		return null;
	}
}

/** Rect (viewport coords) the workspace picker popover anchors to. */
export interface PickerAnchor {
	top: number;
	left: number;
	width: number;
}

/**
 * Shared workspace picker popover (spec D11): recent projects — the same
 * dedupe-by-projectRoot list the sidebar's recent-projects source derives from
 * /api/sessions — plus "Browse directories…" which flows through the existing
 * FolderPickerModal and POST /api/cwd/validate before the pick is adopted.
 * Rendered as a fixed panel opening UPWARD from the trigger.
 */
export function WorkspacePickerPanel({
	anchor,
	currentCwd,
	onPick,
	onClose,
}: {
	anchor: PickerAnchor;
	currentCwd: string | null;
	onPick: (cwd: string) => void;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const panelRef = useRef<HTMLDivElement | null>(null);
	const [home, setHome] = useState<string | null>(null);
	const [recents, setRecents] = useState<string[]>([]);
	const [browseOpen, setBrowseOpen] = useState(false);
	const [browseError, setBrowseError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void Promise.allSettled([
			fetch("/api/home")
				.then(r => r.json())
				.then((d: { home?: string }) => {
					if (!cancelled && typeof d.home === "string") setHome(d.home);
				}),
			fetchSessions().then(res => {
				if (cancelled) return;
				// Same projectRoot dedupe as the sidebar's recent projects.
				const latestByRoot = new Map<string, string>();
				for (const s of res.sessions ?? []) {
					if (s.temp) continue;
					const root = s.projectRoot ?? s.cwd;
					if (!root) continue;
					const prev = latestByRoot.get(root);
					if (!prev || s.modified > prev) latestByRoot.set(root, s.modified);
				}
				setRecents(
					[...latestByRoot.entries()]
						.sort((a, b) => b[1].localeCompare(a[1]))
						.map(([root]) => root)
						.slice(0, 8),
				);
			}),
		]);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const onMouseDown = (e: MouseEvent) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);

	const commitPickedPath = useCallback(
		(rawPath: string) => {
			// Same validate flow as the shell's initial-cwd resolution: only an
			// existing, readable directory becomes the draft cwd.
			void fetch("/api/cwd/validate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd: rawPath }),
			})
				.then(async r => {
					const data = (await r.json().catch(() => ({}))) as { cwd?: string; error?: string };
					if (!r.ok || !data.cwd) {
						setBrowseError(data.error ?? `HTTP ${r.status}`);
						return;
					}
					onPick(data.cwd);
				})
				.catch((e: unknown) => {
					setBrowseError(e instanceof Error ? e.message : String(e));
				});
		},
		[onPick],
	);

	const normalizedCurrent = currentCwd?.replace(/[\\/]+$/, "") ?? null;
	const items = recents.filter(p => p.replace(/[\\/]+$/, "") !== normalizedCurrent);
	const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;

	return (
		<>
			<div
				ref={panelRef}
				role="dialog"
				aria-label={t("draft-context.select-workspace")}
				style={{
					position: "fixed",
					bottom: viewportHeight - anchor.top + 8,
					left: anchor.left,
					minWidth: Math.max(anchor.width, 260),
					maxWidth: "min(420px, calc(100vw - 24px))",
					zIndex: 500,
					display: "flex",
					flexDirection: "column",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: 10,
					boxShadow: "0 -4px 20px rgba(0,0,0,0.14)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "7px 12px",
						fontSize: 10.5,
						fontWeight: 600,
						letterSpacing: "0.06em",
						textTransform: "uppercase",
						color: "var(--text-dim)",
						borderBottom: "1px solid var(--border)",
					}}
				>
					{t("draft-context.recent-projects")}
				</div>
				<div style={{ maxHeight: 280, overflowY: "auto" }}>
					{normalizedCurrent && (
						<button
							onClick={() => onPick(normalizedCurrent)}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								width: "100%",
								padding: "7px 12px",
								background: "var(--bg-selected)",
								border: "none",
								color: "var(--text)",
								cursor: "pointer",
								fontSize: 12.5,
								textAlign: "left",
								fontWeight: 600,
							}}
						>
							<FolderIcon />
							<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{basenameLabel(normalizedCurrent)}
							</span>
						</button>
					)}
					{items.length === 0 && !normalizedCurrent ? (
						<div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>
							{t("draft-context.no-projects")}
						</div>
					) : (
						items.map(p => (
							<button
								key={p}
								onClick={() => onPick(p)}
								title={p}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 8,
									width: "100%",
									padding: "7px 12px",
									background: "none",
									border: "none",
									color: "var(--text-muted)",
									cursor: "pointer",
									fontSize: 12.5,
									textAlign: "left",
								}}
								onMouseEnter={e => {
									e.currentTarget.style.background = "var(--bg-hover)";
									e.currentTarget.style.color = "var(--text)";
								}}
								onMouseLeave={e => {
									e.currentTarget.style.background = "none";
									e.currentTarget.style.color = "var(--text-muted)";
								}}
							>
								<FolderIcon />
								<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{basenameLabel(p)}
								</span>
							</button>
						))
					)}
				</div>
				{browseError && (
					<div
						role="alert"
						style={{
							padding: "6px 12px",
							fontSize: 11.5,
							color: "var(--status-error)",
							borderTop: "1px solid var(--border)",
							overflowWrap: "anywhere",
						}}
					>
						{browseError}
					</div>
				)}
				<button
					onClick={() => setBrowseOpen(true)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						width: "100%",
						padding: "8px 12px",
						background: "none",
						border: "none",
						borderTop: "1px solid var(--border)",
						color: "var(--accent)",
						cursor: "pointer",
						fontSize: 12.5,
						textAlign: "left",
					}}
					onMouseEnter={e => {
						e.currentTarget.style.background = "var(--bg-hover)";
					}}
					onMouseLeave={e => {
						e.currentTarget.style.background = "none";
					}}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ flexShrink: 0 }}
					>
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
					{t("draft-context.browse")}
				</button>
			</div>
			<FolderPickerModal
				open={browseOpen}
				initialPath={currentCwd ?? home}
				onSelect={path => {
					setBrowseOpen(false);
					onClose();
					commitPickedPath(path);
				}}
				onClose={() => setBrowseOpen(false)}
			/>
		</>
	);
}

const chipButtonStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 6,
	padding: "5px 10px",
	background: "var(--bg-panel)",
	border: "1px solid var(--border)",
	borderRadius: 999,
	color: "var(--text-muted)",
	cursor: "pointer",
	fontSize: 12,
	maxWidth: 320,
	transition: "border-color 0.12s, color 0.12s",
};

/**
 * Draft context bar (spec D11): two chips above the composer card, shared by
 * the empty-state hero and the docked draft state. Hidden once the session is
 * created (first message sent) — the host simply stops rendering it.
 */
export function DraftContextBar({
	cwd,
	onCwdChange,
}: {
	cwd: string | null;
	/** Adopts a new draft cwd (host resets the pending new session). */
	onCwdChange?: (cwd: string) => void;
}) {
	const { t } = useI18n();
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [workspaceAnchor, setWorkspaceAnchor] = useState<PickerAnchor | null>(null);
	const [branchOpen, setBranchOpen] = useState(false);
	const [branchAnchor, setBranchAnchor] = useState<PickerAnchor | null>(null);
	const [branchData, setBranchData] = useState<GitBranchesResponse | null>(null);
	const [checkoutBusy, setCheckoutBusy] = useState(false);
	const [checkoutError, setCheckoutError] = useState<string | null>(null);

	// Branch chip data (gateway /api/git/branches?cwd=, endpoint inherited from
	// the removed creation dialog). Absent or non-git → the chip hides and the draft stays
	// cwd-scoped. Refetched whenever the draft cwd changes.
	useEffect(() => {
		if (!cwd) {
			setBranchData(null);
			return;
		}
		let cancelled = false;
		void fetchDraftBranches(cwd).then(d => {
			if (!cancelled) setBranchData(d);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	// Checkout runs ONLY on an explicit branch switch by the user — never
	// automatically. A dirty tree rejects with 409 and is surfaced inline.
	const switchBranch = (branch: string) => {
		setBranchOpen(false);
		if (!cwd || branch === branchData?.current) return;
		setCheckoutBusy(true);
		setCheckoutError(null);
		fetch("/api/git/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd, branch }),
		})
			.then(async r => {
				setCheckoutBusy(false);
				if (r.status === 409) {
					setCheckoutError(t("draft-context.checkout-conflict"));
					return;
				}
				if (!r.ok) {
					setCheckoutError(t("draft-context.checkout-failed", { status: String(r.status) }));
					return;
				}
				// Refresh branch state after a successful checkout.
				const d = await fetchDraftBranches(cwd);
				setBranchData(d);
			})
			.catch(() => {
				setCheckoutBusy(false);
				setCheckoutError(t("draft-context.checkout-request-failed"));
			});
	};

	const openPopover = (
		setOpen: (updater: (open: boolean) => boolean) => void,
		setAnchor: (a: PickerAnchor | null) => void,
		e: React.MouseEvent,
	) => {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setAnchor({ top: rect.top, left: rect.left, width: rect.width });
		setOpen(v => !v);
	};

	const currentBranch = branchData?.current ?? null;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 8,
				flexWrap: "wrap",
			}}
		>
			{/* Workspace chip */}
			<div style={{ position: "relative" }}>
				<button
					onClick={e => {
						setBranchOpen(false);
						openPopover(setWorkspaceOpen, setWorkspaceAnchor, e);
					}}
					aria-haspopup="dialog"
					aria-expanded={workspaceOpen}
					aria-label={cwd ? t("draft-context.workspace") : t("draft-context.select-workspace")}
					title={cwd ?? t("draft-context.select-workspace")}
					style={chipButtonStyle}
					onMouseEnter={e => {
						e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, var(--border))";
						e.currentTarget.style.color = "var(--text)";
					}}
					onMouseLeave={e => {
						e.currentTarget.style.borderColor = "var(--border)";
						e.currentTarget.style.color = "var(--text-muted)";
					}}
				>
					<FolderIcon />
					<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{cwd ? basenameLabel(cwd) : t("draft-context.select-workspace")}
					</span>
					<svg
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ flexShrink: 0, transform: "rotate(180deg)" }}
					>
						<path d="M2 6.5 L5 3.5 L8 6.5" />
					</svg>
				</button>
				{workspaceOpen && workspaceAnchor && (
					<WorkspacePickerPanel
						anchor={workspaceAnchor}
						currentCwd={cwd}
						onPick={picked => {
							setWorkspaceOpen(false);
							if (onCwdChange && picked.replace(/[\\/]+$/, "") !== cwd?.replace(/[\\/]+$/, "")) onCwdChange(picked);
						}}
						onClose={() => setWorkspaceOpen(false)}
					/>
				)}
			</div>

			{/* Branch chip — only when the draft cwd is a git repository */}
			{branchData && currentBranch && (
				<div style={{ position: "relative" }}>
					<button
						onClick={e => {
							setWorkspaceOpen(false);
							openPopover(setBranchOpen, setBranchAnchor, e);
						}}
						aria-haspopup="dialog"
						aria-expanded={branchOpen}
						title={t("draft-context.branch")}
						disabled={checkoutBusy}
						style={{ ...chipButtonStyle, fontFamily: "var(--font-mono)" }}
						onMouseEnter={e => {
							e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, var(--border))";
							e.currentTarget.style.color = "var(--text)";
						}}
						onMouseLeave={e => {
							e.currentTarget.style.borderColor = "var(--border)";
							e.currentTarget.style.color = "var(--text-muted)";
						}}
					>
						<svg
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ flexShrink: 0 }}
						>
							<line x1="6" y1="3" x2="6" y2="15" />
							<circle cx="18" cy="6" r="3" />
							<circle cx="6" cy="18" r="3" />
							<path d="M18 9a9 9 0 0 1-9 9" />
						</svg>
						<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentBranch}</span>
					</button>
					{branchOpen && branchAnchor && (
						<div
							role="dialog"
							aria-label={t("draft-context.branch")}
							style={{
								position: "fixed",
								bottom: (typeof window !== "undefined" ? window.innerHeight : 800) - branchAnchor.top + 8,
								left: branchAnchor.left,
								minWidth: Math.max(branchAnchor.width, 200),
								zIndex: 500,
								display: "flex",
								flexDirection: "column",
								background: "var(--bg)",
								border: "1px solid var(--border)",
								borderRadius: 10,
								boxShadow: "0 -4px 20px rgba(0,0,0,0.14)",
								overflow: "hidden",
							}}
							onMouseDown={e => {
								if (e.target === e.currentTarget) setBranchOpen(false);
							}}
						>
							<div style={{ maxHeight: 260, overflowY: "auto" }}>
								{(branchData.branches ?? []).map(b => {
									const isActive = b.name === currentBranch;
									return (
										<button
											key={b.name}
											onClick={() => switchBranch(b.name)}
											style={{
												display: "flex",
												alignItems: "center",
												gap: 8,
												width: "100%",
												padding: "7px 12px",
												background: isActive ? "var(--bg-selected)" : "none",
												border: "none",
												color: isActive ? "var(--text)" : "var(--text-muted)",
												cursor: "pointer",
												fontSize: 12,
												fontFamily: "var(--font-mono)",
												textAlign: "left",
												whiteSpace: "nowrap",
											}}
											onMouseEnter={e => {
												if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
											}}
											onMouseLeave={e => {
												if (!isActive) e.currentTarget.style.background = "none";
											}}
										>
											{isActive ? (
												<svg
													width="10"
													height="10"
													viewBox="0 0 10 10"
													fill="none"
													stroke="var(--accent)"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													style={{ flexShrink: 0 }}
												>
													<polyline points="1.5 5 4 7.5 8.5 2.5" />
												</svg>
											) : (
												<span style={{ width: 10, flexShrink: 0 }} />
											)}
											{b.name}
										</button>
									);
								})}
							</div>
						</div>
					)}
				</div>
			)}

			{checkoutError && (
				<div
					role="alert"
					style={{
						flexBasis: "100%",
						textAlign: "center",
						fontSize: 11.5,
						color: "var(--status-error)",
					}}
				>
					{checkoutError}
				</div>
			)}
		</div>
	);
}
