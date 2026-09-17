"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PathLabel } from "./PathLabel";

export interface DraftProject {
	cwd: string;
	label: string;
	lastActivity: number;
}

export interface DraftWorktree {
	path: string;
	branch?: string;
	isMain?: boolean;
}

interface BranchInfo {
	name: string;
	current: boolean;
}

interface NewSessionDialogProps {
	open: boolean;
	projects: DraftProject[];
	initialProject?: string | null;
	onClose: () => void;
	onCreate: (cwd: string) => void;
	onBrowse: () => void;
}

/**
 * Create-session flow (draft target): pick the project, then the worktree and
 * branch inside it. Replaces the old always-visible path picker — a workspace
 * is only chosen when a conversation is created (zcode/openchamber pattern).
 */
export function NewSessionDialog({
	open,
	projects,
	initialProject,
	onClose,
	onCreate,
	onBrowse,
}: NewSessionDialogProps) {
	const [project, setProject] = useState<string | null>(initialProject ?? null);
	const [projectFilter, setProjectFilter] = useState("");
	const [worktrees, setWorktrees] = useState<DraftWorktree[] | null>(null);
	const [worktree, setWorktree] = useState<string | null>(null);
	const [branches, setBranches] = useState<BranchInfo[] | null>(null);
	const [branch, setBranch] = useState<string | null>(null);
	const [branchBusy, setBranchBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Reset on open, seeding from the requested project.
	useEffect(() => {
		if (!open) return;
		setProject(initialProject ?? null);
		setProjectFilter("");
		setWorktree(null);
		setBranch(null);
		setBranches(null);
		setError(null);
		// Focus the list for keyboard users.
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [open, initialProject]);

	// If no project was pre-seeded, start from the most recent one so the
	// dialog is never dead on arrival.
	useEffect(() => {
		if (open && !project && projects.length > 0) setProject(projects[0].cwd);
	}, [open, project, projects]);

	const visibleProjects = useMemo(() => {
		const q = projectFilter.trim().toLowerCase();
		return q ? projects.filter((p) => p.cwd.toLowerCase().includes(q)) : projects;
	}, [projects, projectFilter]);

	// Worktrees of the chosen project.
	useEffect(() => {
		if (!open || !project) {
			setWorktrees(null);
			setWorktree(null);
			return;
		}
		let cancelled = false;
		fetch(`/api/worktrees?cwd=${encodeURIComponent(project)}`)
			.then((r) => r.json())
			.then(
				(
					d: {
						projectRoot?: string;
						isGit?: boolean;
						worktrees?: DraftWorktree[];
						error?: string;
					},
				) => {
					if (cancelled) return;
					if (d.error || !d.worktrees || d.worktrees.length === 0) {
						// Non-git or bare directory: the project path itself is the target.
						setWorktrees([]);
						setWorktree(project);
						return;
					}
					setWorktrees(d.worktrees);
					const main = d.worktrees.find((w) => w.isMain) ?? d.worktrees[0];
					setWorktree(main?.path ?? project);
				},
			)
			.catch(() => {
				if (!cancelled) {
					setWorktrees([]);
					setWorktree(project);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, project]);

	// Branches of the chosen worktree (gateway /api/git/branches). Absent or
	// non-git → branch selector hides and creation stays worktree-scoped.
	useEffect(() => {
		if (!open || !worktree) {
			setBranches(null);
			return;
		}
		let cancelled = false;
		fetch(`/api/git/branches?cwd=${encodeURIComponent(worktree)}`)
			.then((r) => r.json())
			.then((d: { isGitRepository?: boolean; current?: string; branches?: BranchInfo[] }) => {
				if (cancelled) return;
				if (d.isGitRepository && d.branches && d.branches.length > 0) {
					setBranches(d.branches);
					setBranch(d.current ?? d.branches[0]?.name ?? null);
				} else {
					setBranches([]);
					setBranch(null);
				}
			})
			.catch(() => {
				if (!cancelled) setBranches([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, worktree]);

	if (!open) return null;

	const create = () => {
		const target = worktree ?? project;
		if (!target) return;
		if (branch && branches && worktree && worktree !== branch) {
			// Checkout the chosen branch in the target worktree before spawning.
			// A dirty tree rejects with 409 — surfaced inline, creation stays open.
			setBranchBusy(true);
			fetch("/api/git/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd: worktree, branch }),
			})
				.then(async (r) => {
					setBranchBusy(false);
					if (r.status === 409) {
						setError(`Worktree has uncommitted changes — commit or stash first.`);
						return;
					}
					if (!r.ok) {
						setError(`Checkout failed (${r.status}).`);
						return;
					}
					onCreate(target);
				})
				.catch(() => {
					setBranchBusy(false);
					setError("Checkout request failed.");
				});
			return;
		}
		onCreate(target);
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="New session"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 90,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "color-mix(in srgb, var(--bg) 55%, transparent)",
				backdropFilter: "blur(2px)",
			}}
		>
			<div
				style={{
					width: 420,
					maxWidth: "calc(100vw - 32px)",
					maxHeight: "min(70vh, 560px)",
					display: "flex",
					flexDirection: "column",
					background: "var(--bg)",
					border: "1px solid var(--border)",
					borderRadius: 10,
					boxShadow: "var(--surface-shadow)",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "10px 12px",
						borderBottom: "1px solid var(--border)",
						fontSize: 12.5,
						fontWeight: 600,
						color: "var(--text)",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					New session
					<button
						aria-label="Close"
						onClick={onClose}
						style={{
							background: "none",
							border: "none",
							color: "var(--text-dim)",
							cursor: "pointer",
							fontSize: 14,
							lineHeight: 1,
							padding: 2,
						}}
					>
						✕
					</button>
				</div>

				{/* Project */}
				<div style={{ padding: "10px 12px 4px", fontSize: 11, color: "var(--text-muted)" }}>
					Project
				</div>
				<div style={{ padding: "0 12px" }}>
					<input
						ref={inputRef}
						value={projectFilter}
						onChange={(e) => setProjectFilter(e.target.value)}
						placeholder="Filter projects…"
						style={{
							width: "100%",
							boxSizing: "border-box",
							padding: "6px 8px",
							fontSize: 12,
							background: "var(--bg-subtle)",
							border: "1px solid var(--border)",
							borderRadius: 6,
							color: "var(--text)",
							outline: "none",
						}}
					/>
				</div>
				<div style={{ margin: "6px 12px 0", maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 7 }}>
					{visibleProjects.map((p) => {
						const active = p.cwd === project;
						return (
							<button
								key={p.cwd}
								onClick={() => {
									setProject(p.cwd);
									setError(null);
								}}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 7,
									width: "100%",
									padding: "6px 9px",
									background: active ? "var(--bg-selected)" : "var(--bg)",
									border: "none",
									borderBottom: "1px solid var(--border)",
									color: active ? "var(--text)" : "var(--text-muted)",
									cursor: "pointer",
									fontSize: 12,
									textAlign: "left",
								}}
								title={p.cwd}
							>
								<span style={{ width: 10, flexShrink: 0, color: "var(--accent)" }}>
									{active ? "✓" : ""}
								</span>
								<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{p.label}
								</span>
								<PathLabel text={p.cwd} style={{ fontSize: 10, color: "var(--text-dim)", maxWidth: 150 }} />
							</button>
						);
					})}
					{visibleProjects.length === 0 && (
						<div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>No matching projects</div>
					)}
				</div>
				<button
					onClick={onBrowse}
					style={{
						margin: "6px 12px 0",
						alignSelf: "flex-start",
						background: "none",
						border: "none",
						color: "var(--accent)",
						cursor: "pointer",
						fontSize: 11.5,
						padding: 0,
					}}
				>
					Browse folder (IDE style)…
				</button>

				{/* Worktree + branch */}
				<div style={{ padding: "10px 12px 4px", fontSize: 11, color: "var(--text-muted)" }}>Worktree</div>
				<div style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 6 }}>
					{worktrees === null ? (
						<div style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading…</div>
					) : worktrees.length === 0 ? (
						<div style={{ fontSize: 11, color: "var(--text-dim)" }}>Not a git repository — session runs in the project directory.</div>
					) : (
						worktrees.map((w) => {
							const active = w.path === worktree;
							return (
								<button
									key={w.path}
									onClick={() => setWorktree(w.path)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 7,
										padding: "5px 8px",
										background: active ? "var(--bg-selected)" : "var(--bg-subtle)",
										border: "1px solid " + (active ? "var(--interactive-border-focus)" : "var(--border)"),
										borderRadius: 6,
										color: "var(--text)",
										cursor: "pointer",
										fontSize: 11.5,
										textAlign: "left",
									}}
									title={w.path}
								>
									<span style={{ color: w.isMain ? "var(--text-dim)" : "var(--accent)" }}>⑂</span>
									<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
										{w.branch ?? w.path}
									</span>
									{w.isMain && (
										<span style={{ fontSize: 10, color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 4px" }}>
											main
										</span>
									)}
								</button>
							);
						})
					)}
				</div>

				{branches !== null && branches.length > 1 && (
					<>
						<div style={{ padding: "10px 12px 4px", fontSize: 11, color: "var(--text-muted)" }}>Branch</div>
						<div style={{ padding: "0 12px", display: "flex", flexWrap: "wrap", gap: 5 }}>
							{branches.map((b) => {
								const active = b.name === branch;
								return (
									<button
										key={b.name}
										onClick={() => setBranch(b.name)}
										style={{
											padding: "3px 8px",
											fontSize: 11,
											borderRadius: 999,
											background: active ? "var(--bg-selected)" : "var(--bg-subtle)",
											border: "1px solid " + (active ? "var(--interactive-border-focus)" : "var(--border)"),
											color: active ? "var(--text)" : "var(--text-muted)",
											cursor: "pointer",
										}}
									>
										{b.current ? "● " : ""}
										{b.name}
									</button>
								);
							})}
						</div>
					</>
				)}

				{error && (
					<div style={{ margin: "8px 12px 0", padding: "6px 8px", fontSize: 11, borderRadius: 6, background: "color-mix(in srgb, var(--status-error) 12%, transparent)", color: "var(--status-error)" }}>
						{error}
					</div>
				)}

				<div style={{ marginTop: "auto", padding: "10px 12px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)" }}>
					<button
						onClick={onClose}
						style={{
							padding: "6px 12px",
							fontSize: 12,
							background: "none",
							border: "1px solid var(--border)",
							borderRadius: 6,
							color: "var(--text-muted)",
							cursor: "pointer",
						}}
					>
						Cancel
					</button>
					<button
						onClick={create}
						disabled={!project || branchBusy}
						style={{
							padding: "6px 14px",
							fontSize: 12,
							fontWeight: 600,
							background: "var(--accent)",
							border: "none",
							borderRadius: 6,
							color: "var(--primary-foreground)",
							cursor: project ? "pointer" : "not-allowed",
							opacity: project ? 1 : 0.5,
						}}
					>
						{branchBusy ? "Switching branch…" : "Create"}
					</button>
				</div>
			</div>
		</div>
	);
}
