/**
 * Browser bootstrap for the standalone Team/Rooms surface.
 *
 * Pairing follows the Host contract: a `#zeta-pair=<code>` fragment is read,
 * removed from the URL, and exchanged for the device-bound cookie via
 * `POST /api/v1/pair`; the CSRF token comes back in the response and later
 * from `GET /api/v1/bootstrap`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { authFetch, createStepUpFetch, createStudioWebClient } from "./client";
import type { WebSocketLike } from "./browser-transport";

const PAIR_FRAGMENT_KEY = "zeta-pair";
const LEGACY_FRAGMENT_KEY = "zeta-token";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root is missing from index.html");

/** Read one fragment parameter and remove the whole fragment from the URL. */
function takeFragment(key: string): string | null {
	const hash = window.location.hash.replace(/^#/u, "");
	if (hash === "") return null;
	const value = new URLSearchParams(hash).get(key)?.trim() ?? "";
	if (window.location.hash !== "") {
		window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
	}
	return value === "" ? null : value;
}

const pairCode = takeFragment(PAIR_FRAGMENT_KEY);
// A legacy token grants nothing here; consume it so it cannot linger in a
// screenshot or synced tab.
takeFragment(LEGACY_FRAGMENT_KEY);

const client = createStudioWebClient({
	baseUrl: window.location.origin,
	supportsContexts: true,
	fetcher: createStepUpFetch(authFetch),
	webSocketFactory: (url: string) => new WebSocket(url) as unknown as WebSocketLike,
});

function Root() {
	return (
		<StrictMode>
			<App client={client} pairCode={pairCode} />
		</StrictMode>
	);
}

createRoot(rootElement).render(<Root />);
