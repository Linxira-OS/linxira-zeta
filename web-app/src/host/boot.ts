/**
 * Host boot: Zeta mounts the unmodified Studio renderer.
 *
 * Studio's `mountRenderer(element, client)` takes the client from its host, so
 * this file is the whole browser-side integration: read the pairing fragment,
 * exchange it for a device-bound session, hand the client over.
 *
 * Remote flow (this is what makes a phone work):
 * 1. the QR link is `https://host/#zeta-pair=<one-time code>`;
 * 2. the code is read here and the fragment is removed before any other script
 *    runs, so it never reaches the address bar history or a referrer;
 * 3. `POST /api/v1/pair { code }` sets the `HttpOnly` `studio_session` cookie;
 * 4. the client bootstraps with that cookie — no token ever enters page JS.
 *
 * There is no legacy `#zeta-token` path: the machine token is not accepted in a
 * URL any more. An old link opens the app unpaired; the operator re-scans a QR
 * from Settings → 身份与设备.
 */
import { mountRenderer } from "../studio/main";
import { StudioClientImpl } from "@linxiraos/studio-client";
import { BrowserWebClientTransport, type WebSocketLike } from "@linxiraos/studio-transport-web";
import { authFetch } from "./authFetch";
import { createStepUpFetch } from "../studio/settings/AuthStepUpBoundary";

const PAIR_FRAGMENT_KEY = "zeta-pair";
const LEGACY_FRAGMENT_KEY = "zeta-token";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

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
// Consume a legacy fragment too: it must not linger in a screenshot or a
// synced tab, and it grants nothing here (the machine token is no longer a
// browser bootstrap credential).
takeFragment(LEGACY_FRAGMENT_KEY);

// The vendored client forwards every contract operation to the Studio host's
// /api/v1 surface. Same-origin fetch carries the session cookie; the event
// socket does the same automatically.
// Every renderer request goes through the step-up wrapper: a 403
// `totp_required` opens one prompt and replays that request once, so chat and
// device actions can finish without a detour through Settings.
const transport = new BrowserWebClientTransport({
	baseUrl: window.location.origin,
	fetcher: createStepUpFetch(authFetch),
	webSocketFactory: (url: string) => new WebSocket(url) as unknown as WebSocketLike,
});

async function boot(): Promise<void> {
	if (pairCode !== null) {
		try {
			await transport.pair(pairCode);
		} catch {
			// A used/expired code is expected (60 s, single use). The app still
			// mounts: the settings pane explains how to print a fresh code, and an
			// already valid cookie keeps working.
		}
	}
	mountRenderer(root as HTMLElement, new StudioClientImpl(transport));
}

void boot();
