/**
 * `zetacode pages` — open the scoped external pages hosted by a registered
 * local `zetacode serve`.
 *
 * The URL comes from `identity.pages` when the running serve advertises it;
 * older serves without that field get the ADR-0101 path built from their
 * probed origin. No page is served by this command itself.
 */
import { ZETA_WEB_PORT } from "@linxiraos/pi-utils";
import { discoverServeInstance } from "../server/serve-registry";
import type { ServeIdentity } from "../server/web-gateway/identity";
import { openPath } from "../utils/open";

export const PAGE_NAMES = ["team", "rooms", "im", "models"] as const;
export type PageName = (typeof PAGE_NAMES)[number];

export function isPageName(value: string): value is PageName {
	return (PAGE_NAMES as readonly string[]).includes(value);
}

/** Resolve one page URL from a serve identity, or undefined when it has none. */
export function pageUrlFromIdentity(identity: ServeIdentity, name: PageName): string | undefined {
	const advertised = identity.pages?.[name as "team" | "rooms" | "im"];
	if (advertised) return advertised;
	if (!identity.webUrl) return undefined;
	return `${identity.webUrl.replace(/\/+$/, "")}/pages/${name}/`;
}

export interface OpenPageResult {
	url: string;
	opened: boolean;
}

/**
 * Discover the registered local serve, resolve `name`, and optionally hand it
 * to the system browser. A missing serve or page is an error, never a guessed
 * remote URL.
 */
export async function openServePage(
	name: PageName,
	options: { open?: boolean; baseUrl?: string; registryFile?: string } = {},
): Promise<OpenPageResult> {
	const discovery = await discoverServeInstance({
		targetUrl: options.baseUrl ?? `http://127.0.0.1:${ZETA_WEB_PORT}`,
		...(options.registryFile ? { registryFile: options.registryFile } : {}),
	});
	if (!discovery.identity) throw new Error("Start zetacode serve, then retry / 请先启动 zetacode serve 后重试");
	const url = pageUrlFromIdentity(discovery.identity, name);
	if (!url) throw new Error(`This serve does not advertise the ${name} page`);
	if (options.open !== false) openPath(url);
	return { url, opened: options.open !== false };
}
