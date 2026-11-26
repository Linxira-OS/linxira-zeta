import { prompt } from "@linxiraos/pi-utils";
import type { Settings } from "../../config/settings";
import type { HostEvalPreludeDefinition } from "../../eval/preludes";
import relayGuidance from "../../prompts/system/browser-relay.md" with { type: "text" };
import userSessionGuidance from "../../prompts/system/browser-user-session.md" with { type: "text" };
import x11Guidance from "../../prompts/system/browser-x11.md" with { type: "text" };
import browserCoreDescription from "../../prompts/tools/browser-core.md" with { type: "text" };
import browserDescription from "../../prompts/tools/browser.md" with { type: "text" };
import type { ToolSession } from "../../sdk";
import { redactUrlForLog } from "../../utils/redact-url";
// @ts-expect-error Bun imports this JavaScript source as text instead of evaluating its module shape.
import browserJavascript from "./prelude.js" with { type: "text" };
import browserPython from "./prelude.py" with { type: "text" };
import type { BrowserKind } from "./registry";
import { isLoopbackRelayUrl } from "./relay/kind";
import { cfgBrowserCdpUrl, cfgBrowserEnabled, cfgBrowserRelayUrl } from "./settings";

/**
 * The browser eval documentation. Its Linux X11 notes follow the browser's host: they reach agents on Linux, and
 * elsewhere when a configured browser (`browser.cdpUrl`, `browser.relayUrl`) is on another machine, which may be Linux.
 */
export function browserDocumentation(settings: Settings, platform: NodeJS.Platform = process.platform): string {
	return prompt.render(browserDescription, { x11Guidance: browserX11Guidance(settings, platform) });
}

function browserX11Guidance(settings: Settings, platform: NodeJS.Platform = process.platform): string | undefined {
	const remoteBrowser = [cfgBrowserCdpUrl.get(settings), cfgBrowserRelayUrl.get(settings)].some(
		url => typeof url === "string" && url.trim() !== "" && !isLoopbackRelayUrl(url.trim()),
	);
	return platform === "linux" || remoteBrowser ? x11Guidance.trim() : undefined;
}

/**
 * What the relay guidance tells the model: `only` when the relay is the session's only browser
 * (`PI_BROWSER_RELAY=only`), `default` when an open without `app` goes to the relay and `app: "auto"` to `fallback`.
 */
export type BrowserRelayGuidance = { mode: "only" } | { mode: "default"; fallback: BrowserKind };

/** Render the relay guidance for one resolved fallback; pure so its wording is testable. */
export function renderBrowserRelayGuidance(guidance: BrowserRelayGuidance | undefined): string | undefined {
	if (!guidance) return undefined;
	const fallback = guidance.mode === "default" ? guidance.fallback : undefined;
	return prompt.render(relayGuidance, {
		only: guidance.mode === "only",
		// The block reaches the model provider: never echo userinfo or token params.
		cdpUrl: fallback?.kind === "connected" ? redactUrlForLog(fallback.cdpUrl) : undefined,
		tern: fallback?.kind === "tern",
		webkit: fallback?.kind === "webkit",
		cmux: fallback?.kind === "cmux",
	});
}

/** Build the browser eval facade after an eval runtime first requests preludes. */
export function createBrowserPreludeDefinition(
	session: ToolSession,
	host: Pick<HostEvalPreludeDefinition, "invoke" | "status"> & {
		/** Relay guidance to render; unset while an open without `app` stays out of the user's Chrome. */
		relay?: BrowserRelayGuidance;
	},
): HostEvalPreludeDefinition {
	return {
		name: "browser",
		// Read per use: the definition is built once per session, while the browser settings it follows can change.
		get documentation() {
			return browserDocumentation(session.settings);
		},
		firstCallDocumentation: browserCoreDescription,
		get guidance() {
			const relay = renderBrowserRelayGuidance(host.relay);
			return prompt.render(userSessionGuidance, { relay, x11: browserX11Guidance(session.settings) }).trim();
		},
		javascript: browserJavascript,
		python: browserPython,
		exports: ["browser"],
		approval: "exec",
		enabled: () => cfgBrowserEnabled.get(session.settings),
		invoke: host.invoke,
		status: host.status,
	};
}
