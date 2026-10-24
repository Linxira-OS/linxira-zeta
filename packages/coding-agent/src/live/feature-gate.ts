/**
 * Product gate for `/live` and `Ctrl+L`.
 *
 * The shipped transport is Codex-specific end to end: the signaling URL, the
 * `gpt-live-1-codex` model, the `openai-codex` OAuth provider and the
 * Frameless Bidi data-channel protocol. A provider-agnostic realtime layer
 * (OpenAI Realtime, Alibaba Qwen-Omni, …) must replace it before the feature
 * can ship; until then the command and keybinding stay dark.
 *
 * Kept dependency-free: both the slash-command registry and InteractiveMode
 * import it during module initialization, so importing `live/settings.ts`
 * (which registers a config key) here would create a registry cycle.
 */
export const LIVE_FEATURE_ENABLED = false;

/** Shown when a hidden live entry point is invoked. */
export const LIVE_DISABLED_MESSAGE =
	"Live voice is temporarily disabled: the current implementation only supports OpenAI Codex realtime. A provider-agnostic version is in progress.";
