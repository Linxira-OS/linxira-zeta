# Changelog

## [Unreleased]

## [1.1.4] - 2026-08-26
## [18.0.5] - 2026-08-25

### Added

- Added built-in DeepInfra provider support (`deepinfra`, `DEEPINFRA_API_KEY`) with live model discovery, including chat models, context windows, pricing, cache-read pricing, vision input, and reasoning-effort capabilities.
- Added built-in Yolo-Auto provider support with the flat-rate `deepseek-flash-v4` model and live model discovery.

### Fixed

- Fixed the Synthetic provider’s default model to use `hf:zai-org/GLM-5.2` instead of the retired `hf:zai-org/GLM-5.1`.

## [18.0.4] - 2026-08-24

### Fixed

- Fixed default reasoning effort for `cursor/cursor-grok-4.5` and `cursor/cursor-grok-4.6` so requests without an explicit effort setting default to `-medium` instead of `-low`, preventing rate limit rejections on Cursor's Start plan ([#9478](https://github.com/can1357/oh-my-pi/issues/9478)).
- Fixed aliased OpenCode Zen Ox Alpha models exposing incorrect effort levels, ensuring the gateway's native `low`, `high`, and `max` tiers are correctly mapped and reachable ([#9349](https://github.com/can1357/oh-my-pi/issues/9349)).
- Fixed missing rate card tier for public xAI and SuperGrok models with prompt lengths exceeding 200K tokens ([#9512](https://github.com/can1357/oh-my-pi/issues/9512)).

## [18.0.2] - 2026-08-23

### Fixed

- Fixed OpenRouter auxiliary requests (e.g. session-title generation) failing with `400 Reasoning is mandatory for this endpoint and cannot be disabled` on mandatory-reasoning models such as `stealth/ox-alpha`. Live discovery now honors the endpoint's `reasoning.mandatory` flag, clamping thinking-off to the lowest supported effort instead of sending `reasoning: { enabled: false }` ([#9415](https://github.com/can1357/oh-my-pi/issues/9415)).

## [18.0.1] - 2026-08-23

### Added

- Fixed `google-gemini-cli` model refresh returning only bundled models for Gemini Code Assist Standard accounts, whose credential is not authorized for the Antigravity `fetchAvailableModels` endpoint (HTTP 403). Discovery now falls back to the account's own `retrieveUserQuota` list on Cloud Code Assist, surfacing models such as `gemini-3.5-flash` ([#9315](https://github.com/can1357/oh-my-pi/issues/9315)).
- Added Amazon Bedrock guardrail metadata to model definitions for Converse requests.

### Fixed

- Fixed `opencode-go/ox-alpha-free` sending `reasoning_effort: "xhigh"` for the top thinking tier, which the OpenCode Go gateway rejects; the model now uses the gateway's wire-exact `low`/`high`/`max` ladder with mandatory thinking so `--thinking max` reaches the real max tier ([#9349](https://github.com/can1357/oh-my-pi/issues/9349)).
- Fixed Venice-hosted Qwen models (e.g. `venice/qwen3-6-35b-a3b`) failing with `400 Invalid request parameters`. Reasoning levels now use the accepted OpenAI-style `reasoning_effort` field, while Thinking Off sends Venice's explicit `venice_parameters.disable_thinking` flag ([#9345](https://github.com/can1357/oh-my-pi/issues/9345)).
- Fixed gateway-first OpenCode Zen and Go models missing context, output, image, and reasoning metadata by enriching live discovery from the current stencil catalog ([#9272](https://github.com/can1357/oh-my-pi/issues/9272)).
- Fixed `opencode-go/deepseek-v4-flash` exposing the generic `minimal`/`low`/`medium`/`high`/`xhigh` thinking ladder instead of DeepSeek V4's real `low`/`high`/`max` tiers. The model is pinned to the Responses transport (the Go gateway serves it only at `/responses`), which the DeepSeek effort branch did not admit, so it fell through to the default ladder; the branch now covers the `openai-responses` transport like every other host ([#9134](https://github.com/can1357/oh-my-pi/issues/9134)).
- Fixed protobuf map decoding corrupting entries when a key is `__proto__`, which dropped that argument and replayed spurious numeric arguments ([#9394](https://github.com/can1357/oh-my-pi/issues/9394)).

## [18.0.0] - 2026-08-22

### Added

- Added model capability metadata for reversible private-use glyph tokenization on Claude-compatible models, so provider request handling can apply the compatibility layer without inferring from transport details.

## [17.4.2] - 2026-08-21

### Added

- Added identification of provider-side image fetchers (OpenAI, Anthropic, xAI, Google), so a server hosting images by URL can attribute an inbound fetch to the vendor that issued it.

### Fixed

- Fixed Cursor model discovery showing separate picker rows for pure effort-suffixed models beyond GPT-5.6 by collapsing each standard and Fast lane into one reasoning-effort model ([#9237](https://github.com/can1357/oh-my-pi/issues/9237)).

## [17.4.1] - 2026-08-21

### Added

- Added helper functions and constants for reading enterprise ChatGPT workspace data-residency regions from Codex OAuth access tokens and forwarding the residency header to Codex backend endpoints.

### Changed

- 同步 1.1.4 发布线（与 1.1.3 无功能差异）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

### Changed

- 同步上游 OMP v18.0.3 / v18.0.4（内部运行时与构建改进，无独立用户可见变更）。

## [1.0.1] - 2026-08-14

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
