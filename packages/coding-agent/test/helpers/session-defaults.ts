import type { AgentSession } from "@linxiraos/zeta/session/agent-session";

/** Spread first in a session fake; keep state and behavior overrides on the fake itself. */
export function createSessionDefaults() {
	return {
		setActiveToolsByName: async (_toolNames: string[]) => {},
		getMountedXdevToolNames: () => [],
		getMountedToolCommandNames: () => [],
		waitForIdle: async () => {},
		prepareForHeadlessAdvisorDrain: () => {},
		waitForAdvisorCatchup: async () => true,
		getToolByName: () => undefined,
		getWorkPoolYieldItems: () => [],
		getLastAssistantMessage: () => undefined,
		isRunActive: false,
		wakeSources: undefined,
		waitForRunEnd: async () => {},
		abort: async () => {},
		dispose: async () => {},
		setIrcWakeTurnObserver: () => {},
		holdIrcWakes: () => () => {},
		isParentIrcSteer: () => false,
		isAdvisorActive: () => false,
		subscribeRunState: () => () => {},
		addDisposer: () => {},
	} satisfies Partial<AgentSession>;
}
