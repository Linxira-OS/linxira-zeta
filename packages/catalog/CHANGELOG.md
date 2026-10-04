# Changelog

## [Unreleased]

## [1.1.26] - 2026-10-03
## [18.6.0] - 2026-10-03

### Fixed

- Fixed DeepSeek V4 model IDs and the V4.1 Flash alias lacking version information in model identity and dashboards ([#14194](https://github.com/can1357/oh-my-pi/issues/14194)).
- Fixed Antigravity models such as Claude Opus 5.5 and Sonnet 5.5 disappearing after `omp models refresh`. When the update check failed, omp reported an outdated Antigravity client version (2.8.0), so the server left the newer models out of the list. The fallback version is now 2.19.1.
- DSML tool calls from DeepSeek models are now parsed on every host. This includes local servers (llama.cpp, LM Studio, vLLM), custom providers from `models.yml`, and gateways that weren't on the old list of supported hosts. Before, a complete `<｜DSML｜tool_calls>` envelope from these hosts showed up as plain text and the tool never ran ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

## [18.5.1] - 2026-10-03

### Added

- Added support for listing models from Codex-compatible gateways through openaiCodexModelManagerOptions.baseUrl, with discovery caches isolated per endpoint.
- Exposed the max reasoning-effort tier for Muse Spark 1.3 contributor models on Meta and Muse Code providers.

### Changed

- Added full configurable reasoning-effort ladders for ClinePass DeepSeek V4.1 Flash Free and Muse Spark 1.3 Contributor Free models.
- Recognize bare and provider-qualified k3 and k3-256k selectors as Kimi K3, enabling K3-specific catalog policies and replace-edit fallback behavior while preserving explicit edit-mode overrides.
- Updated Fireworks model pricing to use Fireworks-specific rates, correcting missing and inaccurate costs for supported models.
- Updated Fireworks fast-model listings to replace retired models with glm-5.3-fast and kimi-k3-fast; GLM-5.3 Fast now exposes low, high, and max reasoning levels on Fireworks, Baseten, and Vercel AI Gateway.

### Fixed

- Fixed image input for OpenAI models used through custom Amazon Bedrock Converse providers when images are read through tools.
- Fixed local Ollama thinking models continuing to reason when thinking was disabled, reducing delays such as slow session-title generation.
- Fixed reasoning-level availability for OpenCode Go models so unsupported levels are no longer offered and reasoning can be disabled where supported.
- Fixed Anthropic-compatible Claude Opus 5.5 sessions failing after tool use or system-prompt changes.
- Fixed Cursor Grok 4.5 and 4.6 model selectors and overrides intermittently resolving to inconsistent model IDs.
- Fixed Google Antigravity Gemini 3.1 Flash Image being recognized as an image-capable model for image roles and fallback chains.
- Fixed GitHub Copilot base models reporting an incorrect long-context window when a separate -1m model is available.
- Fixed newer OpenAI and Anthropic model families being incorrectly marked as accepting sampling parameters when accessed through compatible providers such as Amazon Bedrock, Google, Devin, or OpenRouter; explicit compatibility overrides continue to take precedence.

## [18.5.0] - 2026-10-03

### Added

- Added `closeModelCache()` (`@oh-my-pi/pi-catalog/model-cache`) to release the shared default `models.db` handle so an agent directory can be deleted on Windows; the next cache access reopens it

## [18.4.11] - 2026-10-02

- 版本线推进至 1.1.26；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
