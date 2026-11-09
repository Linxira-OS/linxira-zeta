/**
 * Standalone Team Hub launch: `zetacode` in a Team root or PM workspace.
 *
 * The Hub owns the terminal for its lifetime and closes back to the shell. No
 * coding session is constructed, so no Team-root transcript, AGENTS.md, or
 * model request exists behind it.
 */

import { runStandaloneTui } from "@linxiraos/pi-tui/apps/standalone-picker";
import { TeamHubOverlayComponent } from "@linxiraos/pi-tui/overlays/team-hub";
import type { TeamEntry } from "./entry";
import { createTeamHubDataSource } from "./hub-data";

/**
 * Run the Hub until Esc. `entry.teamRoot` / `entry.teamId` must be present;
 * the caller checks {@link isTeamHubEntry}.
 */
export async function runTeamHubEntry(entry: TeamEntry): Promise<void> {
	if (!entry.teamRoot || !entry.teamId) {
		throw new Error("Team Hub entry resolved without a team root or team id");
	}
	const source = createTeamHubDataSource({
		teamRoot: entry.teamRoot,
		teamId: entry.teamId,
		teamName: entry.teamName,
	});
	await runStandaloneTui<void>(
		({ ui, finish }) => {
			const hub = new TeamHubOverlayComponent({
				source,
				ui,
				initialPmId: entry.pmId,
				onDone: () => finish(undefined),
				requestRender: () => ui.requestRender(),
			});
			return hub;
		},
		{
			overlay: {
				anchor: "top-left",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
				fullscreen: true,
			},
		},
	);
}
