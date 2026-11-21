"use client";

import { useI18n } from "@/hooks/useI18n";
import type { BranchListState, GitBranch } from "./git-branches-model";

export interface GitBranchesViewProps {
	/** Workspace the list belongs to (shown in the header, named in confirmations). */
	cwd: string | null;
	state: BranchListState;
	/** Branch currently being checked out, if any — rows freeze meanwhile. */
	busyBranch: string | null;
	/** Branch awaiting confirmation; null while no switch is pending. */
	confirmBranch: string | null;
	/** Localized failure of the last switch attempt; null when it went through. */
	error: string | null;
	/** Ask for confirmation (also openable from the keyboard via the row button). */
	onRequestSwitch: (branch: string) => void;
	onConfirmSwitch: () => void;
	onCancelSwitch: () => void;
	onRefresh: () => void;
}

/** Row glyph for a branch that is not checked out. */
const BRANCH_GLYPH = (
	<svg
		width="11"
		height="11"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<line x1="6" y1="3" x2="6" y2="15" />
		<circle cx="18" cy="6" r="3" />
		<circle cx="6" cy="18" r="3" />
		<path d="M18 9a9 9 0 0 1-9 9" />
	</svg>
);

/** Row glyph for the checked-out branch. */
const CHECK_GLYPH = (
	<svg
		width="11"
		height="11"
		viewBox="0 0 12 12"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<polyline points="2 6.5 4.5 9 10 3" />
	</svg>
);

/**
 * Pure view of the branch list — no fetching, no effects, no stylesheet import,
 * so the SSR tests render it directly from a fixture.
 *
 * Three readings share one screen: the header names the workspace the list
 * belongs to (the dock panel is workspace-scoped, never repo-global), the rows
 * are the local branches with exactly one flagged current, and a pending switch
 * shows its confirmation in place of the list so the action and its wording
 * cannot drift apart.
 */
export function GitBranchesView({
	cwd,
	state,
	busyBranch,
	confirmBranch,
	error,
	onRequestSwitch,
	onConfirmSwitch,
	onCancelSwitch,
	onRefresh,
}: GitBranchesViewProps) {
	const { t } = useI18n();
	const busy = busyBranch !== null;

	return (
		<section className="git-branches" aria-label={t("git-branches.aria")}>
			<header className="git-branches__header">
				<span className="git-branches__workspace" title={cwd ?? undefined}>
					<span className="git-branches__workspace-name">{cwd ?? t("git-branches.no-workspace")}</span>
				</span>
				<span className="git-branches__spacer" />
				{state.kind === "ready" && (
					<span className="git-branches__count">{t("git-branches.count", { count: state.branches.length })}</span>
				)}
				<button
					type="button"
					className="git-branches__icon-button"
					onClick={onRefresh}
					disabled={busy || !cwd}
					title={t("git-branches.refresh")}
					aria-label={t("git-branches.refresh")}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
						<path d="M3 3v5h5" />
					</svg>
				</button>
			</header>

			{error && (
				<p className="git-branches__error" role="alert">
					{error}
				</p>
			)}

			{state.kind === "empty" && <p className="git-branches__empty">{t("git-branches.no-workspace")}</p>}
			{state.kind === "loading" && <p className="git-branches__empty">{t("git-branches.loading")}</p>}
			{state.kind === "failed" && (
				<p className="git-branches__empty">{t("git-branches.load-error", { error: state.message })}</p>
			)}
			{state.kind === "not-a-repo" && <p className="git-branches__empty">{t("git-branches.not-a-repo")}</p>}

			{state.kind === "ready" && confirmBranch !== null && (
				<div className="git-branches__confirm" role="alertdialog" aria-label={t("git-branches.confirm-title", { branch: confirmBranch })}>
					<p className="git-branches__confirm-title">
						{t("git-branches.confirm-title", { branch: confirmBranch })}
					</p>
					<p className="git-branches__confirm-body">{t("git-branches.confirm-body")}</p>
					<div className="git-branches__confirm-actions">
						<button
							type="button"
							className="git-branches__button git-branches__button--primary"
							onClick={onConfirmSwitch}
							disabled={busy}
						>
							{busy ? t("git-branches.switching") : t("git-branches.confirm-yes")}
						</button>
						<button
							type="button"
							className="git-branches__button"
							onClick={onCancelSwitch}
							disabled={busy}
						>
							{t("cancel")}
						</button>
					</div>
				</div>
			)}

			{state.kind === "ready" && (
				<>
					{state.current === null && <p className="git-branches__detached">{t("git-branches.detached")}</p>}
					<ul className="git-branches__list">
						{state.branches.map(branch => (
							<BranchRow
								key={branch.name}
								branch={branch}
								busy={busy}
								busyBranch={busyBranch}
								onSelect={onRequestSwitch}
							/>
						))}
					</ul>
				</>
			)}
		</section>
	);
}

function BranchRow({
	branch,
	busy,
	busyBranch,
	onSelect,
}: {
	branch: GitBranch;
	busy: boolean;
	busyBranch: string | null;
	onSelect: (branch: string) => void;
}) {
	const { t } = useI18n();
	const switching = busyBranch === branch.name;
	return (
		<li className={branch.current ? "git-branches__row git-branches__row--current" : "git-branches__row"}>
			<button
				type="button"
				className="git-branches__row-button"
				aria-current={branch.current ? "true" : undefined}
				disabled={branch.current || busy}
				title={branch.current ? t("git-branches.current-title") : t("git-branches.switch", { branch: branch.name })}
				onClick={() => onSelect(branch.name)}
			>
				<span className="git-branches__row-glyph" aria-hidden="true">
					{branch.current ? CHECK_GLYPH : BRANCH_GLYPH}
				</span>
				<span className="git-branches__name">{branch.name}</span>
				{branch.current && <span className="git-branches__badge">{t("git-branches.current-badge")}</span>}
				{switching && <span className="git-branches__badge">{t("git-branches.switching")}</span>}
			</button>
		</li>
	);
}
