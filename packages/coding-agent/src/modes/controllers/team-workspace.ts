import type { OverlayHandle, TUI } from "@linxiraos/pi-tui";
import { TeamWorkspaceOverlayComponent } from "@linxiraos/pi-tui/overlays/team-workspace";
import { createTeamWorkspaceSource } from "../../vibe/team-workspace-data";

export interface TeamWorkspaceHost {
	readonly ui: TUI;
}

interface OpenWorkspace {
	readonly overlay: TeamWorkspaceOverlayComponent;
	readonly handle: OverlayHandle;
	close(): void;
}

const open = new WeakMap<TUI, OpenWorkspace>();

/** One fullscreen Team workspace per TUI; Esc returns to the conversation. */
export function showTeamWorkspace(host: TeamWorkspaceHost): void {
	const previous = open.get(host.ui);
	if (previous) {
		previous.handle.setHidden(false);
		host.ui.setFocus(previous.overlay);
		return;
	}
	const source = createTeamWorkspaceSource();
	const overlay = new TeamWorkspaceOverlayComponent({
		source,
		ui: host.ui,
		requestRender: () => host.ui.requestRender(),
		onDone: () => close(),
	});
	let disposed = false;
	const close = () => {
		if (disposed) return;
		disposed = true;
		overlay.dispose();
		handle.hide();
		open.delete(host.ui);
		host.ui.requestRender();
	};
	const handle = host.ui.showOverlay(overlay, {
		anchor: "top-left",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
		fullscreen: true,
	});
	open.set(host.ui, { overlay, handle, close });
}
