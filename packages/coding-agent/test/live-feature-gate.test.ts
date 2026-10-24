/**
 * The only `/live` transport is Codex Frameless Bidi (hardcoded signaling URL,
 * model, OAuth provider). Keep both the slash command and the Ctrl+L path dark
 * until a provider-agnostic layer exists; an already-running call stays
 * stoppable through InteractiveMode.handleLiveCommand.
 */
import { expect, test } from "bun:test";
import { Settings } from "../src/config/settings";
import { LIVE_DISABLED_MESSAGE, LIVE_FEATURE_ENABLED } from "../src/live/feature-gate";
import { BUILTIN_SLASH_COMMANDS_INTERNAL } from "../src/slash-commands/builtin-registry";

test("live voice is gated off with an actionable explanation", () => {
	expect(LIVE_FEATURE_ENABLED).toBe(false);
	const live = BUILTIN_SLASH_COMMANDS_INTERNAL.find(command => command.name === "live");
	expect(live).toBeDefined();
	expect(live?.enabled?.(Settings.isolated())).toBe(false);
	expect(live?.disabledMessage).toBe(LIVE_DISABLED_MESSAGE);
	expect(LIVE_DISABLED_MESSAGE).toContain("OpenAI Codex");
});
