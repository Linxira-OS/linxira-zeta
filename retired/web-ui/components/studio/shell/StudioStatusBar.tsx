"use client";

/**
 * StudioStatusBar — the always-visible footer.
 *
 * It reports only what the shell actually knows: which project/workspace is
 * selected, how many conversations the gateway listed, how many are running,
 * and the last transport error. No token or cost numbers: those come from
 * `/api/usage` and belong to the Usage pane, not to chrome that would then need
 * its own polling loop.
 */

import { useI18n } from "@/hooks/useI18n";
import type { StudioProjectSummary, StudioRoute, StudioWorkspaceSummary } from "../adapters/types";

interface Props {
	project: StudioProjectSummary | null;
	workspace: StudioWorkspaceSummary | null;
	sessions: number;
	running: number;
	error: string | null;
	route: StudioRoute;
}

export function StudioStatusBar({ project, workspace, sessions, running, error, route }: Props) {
	const { t } = useI18n();
	return (
		<footer className="statusbar" role="status" aria-live="polite">
			<span className="st-item" title={project?.path ?? undefined}>
				{project?.displayName ?? t("projects.none")}
			</span>
			{workspace ? (
				<span className="st-item" title={workspace.path}>
					{workspace.branch ?? workspace.displayName}
				</span>
			) : null}
			<span className="st-item">
				{sessions} {t("studio.status.sessions")}
			</span>
			{running > 0 ? <span className="st-item is-live">{running} {t("studio.status.running")}</span> : null}
			<span className="st-spacer" />
			{error ? (
				<span className="st-item is-error" title={error}>
					{error}
				</span>
			) : null}
			<span className="st-item muted">{t(`studio.route.${route}`)}</span>
		</footer>
	);
}
