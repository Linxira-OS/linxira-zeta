/**
 * The three external page entries share one bundle, so the path selects the
 * surface. `/zeta-pages/*` is the mounted rewrite; `/pages/*` is the ADR-0101
 * stable alias if a host mounts the same bundle there.
 */
export type PageRoute = "team" | "rooms" | "im";

export function pageRouteFromPath(pathname: string): PageRoute {
	const withoutMount =
		pathname === "/zeta-pages" || pathname.startsWith("/zeta-pages/")
			? pathname.slice("/zeta-pages".length)
			: pathname === "/pages" || pathname.startsWith("/pages/")
				? pathname.slice("/pages".length)
				: pathname;
	const normalized = withoutMount.replace(/\/+$/u, "") || "/";
	if (normalized === "/rooms") return "rooms";
	if (normalized === "/im") return "im";
	return "team";
}

/** The URL to push for `route`, keeping the mount the page was opened under. */
export function pagePathFor(route: PageRoute, pathname: string): string {
	const prefix =
		pathname === "/pages" || pathname.startsWith("/pages/")
			? "/pages"
			: pathname === "/zeta-pages" || pathname.startsWith("/zeta-pages/")
				? "/zeta-pages"
				: "";
	if (prefix !== "") return `${prefix}/${route}`;
	if (route === "rooms") return "/rooms";
	if (route === "im") return "/zeta-pages/im";
	return "/team";
}
