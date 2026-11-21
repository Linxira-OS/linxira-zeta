"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { GitBranchesView } from "./GitBranchesView";
import { loadBranches, switchBranch, type BranchListState } from "./git-branches-model";
import "./GitBranches.css";

export interface GitBranchesPanelProps {
	/**
	 * Workspace whose branches are listed — the shell's active cwd, i.e. the
	 * selected session's directory or the pending draft workspace. null renders
	 * the panel's empty state.
	 */
	cwd: string | null;
	/** Fired after a checkout lands, so the shell can refresh what the switch invalidated. */
	onSwitched?: (branch: string) => void;
}

/**
 * Right-dock branch view (rail entry `git`): the workspace's local branches,
 * the current one flagged, and an explicit switch behind a confirmation.
 *
 * Refresh strategy is action-driven, not polled: the list is read when the
 * panel mounts, when the workspace changes, after a successful switch and on
 * the header's refresh button. A poll would only add churn — branches change
 * when a human or a tool changes them, and the two paths that matter here (this
 * panel and the draft composer's branch chip) both refetch on their own action.
 *
 * Nothing is ever checked out automatically: `switchBranch` runs only from the
 * confirmation's primary button, and the gateway answers `409` for a dirty tree
 * instead of half-applying a switch.
 */
export function GitBranchesPanel({ cwd, onSwitched }: GitBranchesPanelProps) {
	const { t } = useI18n();
	const [state, setState] = useState<BranchListState>(cwd ? { kind: "loading" } : { kind: "empty" });
	const [busyBranch, setBusyBranch] = useState<string | null>(null);
	const [confirmBranch, setConfirmBranch] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	/** Latest-wins guard: a workspace change must never paint the previous list. */
	const sequenceRef = useRef(0);

	const reload = useCallback(async () => {
		const sequence = sequenceRef.current + 1;
		sequenceRef.current = sequence;
		if (!cwd) {
			setState({ kind: "empty" });
			return;
		}
		const next = await loadBranches(cwd);
		if (sequence === sequenceRef.current) setState(next);
	}, [cwd]);

	useEffect(() => {
		// A new workspace invalidates the pending confirmation and the last failure.
		setConfirmBranch(null);
		setError(null);
		setState(cwd ? { kind: "loading" } : { kind: "empty" });
		void reload();
	}, [cwd, reload]);

	const requestSwitch = useCallback((branch: string) => {
		setError(null);
		setConfirmBranch(branch);
	}, []);

	const confirmSwitch = useCallback(async () => {
		const branch = confirmBranch;
		if (!cwd || !branch) return;
		setBusyBranch(branch);
		setError(null);
		const result = await switchBranch(cwd, branch);
		setBusyBranch(null);
		setConfirmBranch(null);
		if (result.ok) {
			onSwitched?.(result.branch);
			await reload();
			return;
		}
		setError(
			result.kind === "dirty"
				? result.files === null
					? t("git-branches.dirty-generic")
					: t("git-branches.dirty", { files: result.files })
				: result.kind === "rejected"
					? t("git-branches.switch-failed", { error: result.message })
					: t("git-branches.request-failed"),
		);
	}, [confirmBranch, cwd, onSwitched, reload, t]);

	return (
		<GitBranchesView
			cwd={cwd}
			state={state}
			busyBranch={busyBranch}
			confirmBranch={confirmBranch}
			error={error}
			onRequestSwitch={requestSwitch}
			onConfirmSwitch={() => void confirmSwitch()}
			onCancelSwitch={() => setConfirmBranch(null)}
			onRefresh={() => void reload()}
		/>
	);
}
