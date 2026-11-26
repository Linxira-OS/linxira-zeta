import { describe, expect, it } from "bun:test";
import type { BrowserKind } from "@linxiraos/zeta/tools/browser/registry";
import { renderBrowserRelayGuidance } from "@linxiraos/zeta/tools/browser/prelude-definition";

const kind = (value: Record<string, unknown>): BrowserKind => value as unknown as BrowserKind;

describe("browser relay guidance", () => {
	it("names the built-in WebKit browser for app auto", () => {
		const text = renderBrowserRelayGuidance({
			mode: "default",
			fallback: kind({ kind: "webkit", path: "/opt/abkit/ABHost" }),
		});
		expect(text).toContain('Pass `app: "auto"` for zeta\'s built-in WebKit browser instead.');
		expect(text).not.toContain("throwaway managed browser");
	});

	it("names the Tern pane's native browser surface", () => {
		const text = renderBrowserRelayGuidance({
			mode: "default",
			fallback: kind({ kind: "tern", socketPath: "\0tern-test", pane: "main" }),
		});
		expect(text).toContain("this Tern pane's native browser surface");
	});

	it("keeps relay-only guidance when no fallback exists", () => {
		expect(renderBrowserRelayGuidance({ mode: "only" })).toContain("There is no other browser");
		expect(renderBrowserRelayGuidance(undefined)).toBeUndefined();
	});
});
