export interface InitialNavigation {
	requestedCwd: string | null;
	sessionId: string | null;
	/** Deep-linked panel to open on load (e.g. `?panel=settings`); null when absent. */
	requestedPanel: string | null;
}

export function getInitialNavigation(searchParams: Pick<URLSearchParams, "get">): InitialNavigation {
	const requestedCwd = searchParams.get("cwd")?.trim() || null;

	return {
		requestedCwd,
		sessionId: requestedCwd ? null : searchParams.get("session"),
		requestedPanel: searchParams.get("panel")?.trim() || null,
	};
}
