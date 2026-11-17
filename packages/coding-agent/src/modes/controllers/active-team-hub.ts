import { ActiveTeamHubOverlayComponent } from "@linxiraos/pi-tui/overlays/active-team-hub";
import type { OverlayHandle, TUI } from "@linxiraos/pi-tui";
import { AgentRegistry, type AgentRegistryApi } from "../../registry/agent-registry";
import { createActiveTeamHubSource } from "../../vibe/team-hub-data";

export interface ActiveTeamHubHost {
	readonly ui: TUI;
	readonly session: {
		getTeamModeState(): { enabled: boolean } | undefined;
		getAgentId(): string | null | undefined;
	};
	readonly sessionManager: { getSessionId(): string; getSessionFile(): string | undefined };
	readonly agentRegistry?: AgentRegistryApi;
	readonly focusedAgentId: string | undefined;
	focusAgentSession(id: string): Promise<void>;
	showWarning(message: string): void;
}
interface OpenHub {
	readonly scope: string;
	readonly hub: ActiveTeamHubOverlayComponent;
	readonly handle: OverlayHandle;
	close(): void;
}
const openHubs = new WeakMap<TUI, OpenHub>();

/** Shared-file integration is one call. Does not touch the /resume picker or its return watcher. */
export function showActiveTeamHub(host: ActiveTeamHubHost): void {
	if (!host.session.getTeamModeState()?.enabled) {
		host.showWarning("Enter /team before opening /team hub.");
		return;
	}
	const owner = {
		ownerId: host.session.getAgentId() ?? "Main",
		parentSessionId: host.sessionManager.getSessionId(),
		parentSessionFile: host.sessionManager.getSessionFile() ?? null,
	};
	const scope = `${owner.ownerId}\0${owner.parentSessionId}\0${owner.parentSessionFile ?? ""}`;
	const previous = openHubs.get(host.ui);
	if (previous?.scope === scope) {
		if (!host.focusedAgentId) {
			previous.handle.setHidden(false);
			host.ui.setFocus(previous.hub);
		}
		return;
	}
	previous?.close();
	const registry = host.agentRegistry ?? AgentRegistry.global();
	const source = createActiveTeamHubSource(owner);
	let disposed = false;
	let returnTimer: NodeJS.Timeout | undefined;
	let finishObservation: (() => void) | undefined;
	const hub = new ActiveTeamHubOverlayComponent({
		source,
		ui: host.ui,
		requestRender: () => host.ui.requestRender(),
		onDone: () => close(),
		observeAgent: async agent => {
			const current = (await source.load()).agents.find(row => row.id === agent.id);
			if (disposed) return;
			if (!current?.canObserve || current.registryGeneration !== agent.registryGeneration)
				throw new Error(`Agent ${agent.label} left this Team source scope.`);
			const ref = registry.get(agent.id);
			if (!ref || ref.generation !== agent.registryGeneration || (!ref.session && !ref.sessionFile)) {
				throw new Error(`Agent ${agent.label} is no longer available.`);
			}
			await host.focusAgentSession(agent.id);
			if (disposed) return;
			if (host.focusedAgentId !== agent.id) throw new Error(`Agent ${agent.label} did not take over the view.`);
			overlay.setHidden(true);
			const { promise, resolve } = Promise.withResolvers<void>();
			finishObservation = resolve;
			const watch = () => {
				if (disposed) {
					resolve();
					return;
				}
				if (host.focusedAgentId !== undefined) {
					returnTimer = setTimeout(watch, 200);
					returnTimer.unref?.();
					return;
				}
				finishObservation = undefined;
				overlay.setHidden(false);
				host.ui.setFocus(hub);
				host.ui.requestRender();
				resolve();
			};
			returnTimer = setTimeout(watch, 200);
			returnTimer.unref?.();
			await promise;
		},
	});
	const close = () => {
		if (disposed) return;
		disposed = true;
		clearTimeout(returnTimer);
		finishObservation?.();
		hub.dispose();
		overlay.hide();
		openHubs.delete(host.ui);
		host.ui.requestRender();
	};
	const overlay = host.ui.showOverlay(hub, {
		anchor: "top-left",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
		fullscreen: true,
	});
	openHubs.set(host.ui, { scope, hub, handle: overlay, close });
}

export function closeActiveTeamHub(ui: TUI): void {
	openHubs.get(ui)?.close();
}
