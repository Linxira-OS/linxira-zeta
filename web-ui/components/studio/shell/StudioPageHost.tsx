"use client";

/**
 * StudioPageHost — routes a non-workbench Studio page.
 *
 * Each page is a real surface over the gateway, never a mock: a page whose data
 * has no endpoint is absent from `STUDIO_ROUTES` rather than rendered empty.
 * The shared `StudioPage` frame supplies the Studio page chrome (title row +
 * scroll body) so pages only render their own content.
 */

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { StudioProjectSummary, StudioRoute } from "../adapters/types";
import { StudioGitPage } from "./StudioGitPage";
import { StudioUsagePage } from "./StudioUsagePage";
import { StudioSkillsPage } from "./StudioSkillsPage";
import { StudioModelsPage } from "./StudioModelsPage";
import { AgentHubPage } from "../agents/AgentHub";
import { StudioSettingsPage } from "./StudioSettingsPage";

interface Props {
	route: Exclude<StudioRoute, "workbench">;
	cwd: string | null;
	sessionId: string | null;
	projects: readonly StudioProjectSummary[];
	onRegisterProject(path: string): void;
	onNavigate(route: StudioRoute): void;
}

/** Page frame: title row + independently scrolling body. */
export function StudioPage({
	title,
	subtitle,
	actions,
	children,
}: {
	title: string;
	subtitle?: string | null;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="page">
			<header className="page-head">
				<div className="page-head-text">
					<h1 className="page-title">{title}</h1>
					{subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
				</div>
				{actions ? <div className="page-actions">{actions}</div> : null}
			</header>
			<div className="page-body">{children}</div>
		</section>
	);
}

export function StudioPageHost(props: Props) {
	const { t } = useI18n();
	const title = t(`studio.route.${props.route}`);
	switch (props.route) {
		case "git":
			return <StudioGitPage cwd={props.cwd} title={title} />;
		case "usage":
			return <StudioUsagePage title={title} />;
		case "skills":
			return <StudioSkillsPage cwd={props.cwd} title={title} />;
		case "models":
			return <StudioModelsPage title={title} />;
		case "agents":
			return <AgentHubPage sessionId={props.sessionId} title={title} />;
		case "settings":
			return <StudioSettingsPage cwd={props.cwd} onNavigateHome={() => props.onNavigate("workbench")} />;
		default:
			return null;
	}
}
