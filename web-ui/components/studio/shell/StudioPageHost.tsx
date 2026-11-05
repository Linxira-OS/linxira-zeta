"use client";

/**
 * StudioPageHost — Studio's non-workbench route switch.
 *
 * The route union is Studio's (`App.tsx` → `type Route`) and each case mounts a
 * ported Studio page bound to the Zeta gateway. A Studio route with no Zeta
 * backend (`diagnostics`, `media`, `evaluation`, `statistics`) is absent from
 * `STUDIO_ROUTES`, so the sidebar never offers it — it is not a placeholder.
 *
 * Git and worktrees are workbench panels in Studio, not routes; `GitPage` is
 * mounted from the workbench panel slot, not here.
 */

import type { StudioProjectSummary, StudioRoute } from "../adapters/types";
import { AgentHubPage } from "../agents/AgentHub";
import { HistoryPage, ModelsPage, SettingsPage, SkillsPage, UsagePage } from "../pages";

interface Props {
	route: Exclude<StudioRoute, "workbench">;
	cwd: string | null;
	sessionId: string | null;
	projects: readonly StudioProjectSummary[];
	onRegisterProject(path: string): void;
	onNavigate(route: StudioRoute): void;
}

export function StudioPageHost(props: Props) {
	switch (props.route) {
		case "home":
			return <UsagePage />;
		case "history":
			return <HistoryPage cwd={props.cwd} />;
		case "capabilities":
			return <SkillsPage cwd={props.cwd} onNavigate={props.onNavigate} />;
		case "model-config":
			return <ModelsPage />;
		case "agent-hub":
			return <AgentHubPage sessionId={props.sessionId} />;
		case "settings":
			return <SettingsPage cwd={props.cwd} onNavigateHome={() => props.onNavigate("workbench")} />;
		default:
			return null;
	}
}
