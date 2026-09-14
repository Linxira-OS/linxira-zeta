# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12
## [18.1.20] - 2026-09-13

### Fixed

- Fixed DeepSeek V4.1 Flash dropping image attachments on hosts without their own carve-out, so the natively multimodal model is no longer treated as text-only ([#11992](https://github.com/can1357/oh-my-pi/pull/11992) by [@infernix](https://github.com/infernix)).
- LiteLLM model groups keep the image input their deployment declares, instead of having attachments replaced with the "model does not support vision" placeholder ([#11982](https://github.com/can1357/oh-my-pi/issues/11982), [#11985](https://github.com/can1357/oh-my-pi/pull/11985) by [@lz37](https://github.com/lz37)).
- Fixed OpenCode Zen/Go Muse Spark models failing every tool-call turn with a 400 "reasoning encrypted_content was not issued to this caller" error: the gateways proxy the Responses lane to Meta but can't round-trip encrypted reasoning, so those SKUs no longer request or replay it ([#11928](https://github.com/can1357/oh-my-pi/issues/11928)).

## [18.1.19] - 2026-09-12

### Added

- Added Charm Hyper as a built-in provider with API-key login, live model discovery, and per-model pricing, effort ladders, and limits read straight from its catalog ([#11656](https://github.com/can1357/oh-my-pi/pull/11656) by [@oldschoola](https://github.com/oldschoola)).

### Fixed

- `anthropic/claude-fable-5-1` cache reads now cost Anthropic's published $0.25/MTok instead of $1.00, so session cost and usage reports no longer overstate cache-read spend by 4x ([#11862](https://github.com/can1357/oh-my-pi/pull/11862) by [@camjac251](https://github.com/camjac251)).

## [18.1.18] - 2026-09-11

### Added

- `supports-server-compaction` compat axis (`compat.supportsServerCompaction`): whether a model line accepts Anthropic server-side compaction (`compact-2026-01-12`). Class rules enable it for Opus 4.6+, Sonnet 4.6+, and Fable/Mythos 5 on every Anthropic-messages host; the default is `false`.

### Fixed

- OpenCode Go's DeepSeek Flash lanes (`deepseek-flash`, `deepseek-v4.1-flash`) now declare image input. The gateway serves them with vision despite the IDs carrying no vision suffix, so the class-wide `strip-image-input` rule was dropping attachments the endpoint reads; the modality is declared too, since live discovery seeds these lanes text-only ([#11774](https://github.com/can1357/oh-my-pi/pull/11774) by [@STRML](https://github.com/STRML)).
- Amazon Bedrock OpenAI models, plus unclassified profiles such as opaque application-inference-profile ARNs, now carry the compatibility policy required to preserve image-bearing tool results ([#11681](https://github.com/can1357/oh-my-pi/issues/11681)).
- DeepSeek V4.1 Flash requests now honor the documented 384K output maximum instead of being capped at 64K ([#11769](https://github.com/can1357/oh-my-pi/issues/11769)).
- Fixed the first-party `deepseek-flash` alias missing the V4.1 Flash wire contract: it now sends `max_tokens` with `reasoning_content` and replays reasoning and assistant content on tool calls with no tool choice ([#11799](https://github.com/can1357/oh-my-pi/pull/11799) by [@brit](https://github.com/brit)).

## [18.1.17] - 2026-09-10

### Added

- Added DeepSeek V4.1 Flash on OpenRouter with image input and low/high/max reasoning levels ([#11592](https://github.com/can1357/oh-my-pi/pull/11592) by [@mazzanfar](https://github.com/mazzanfar)).
- Added DeepSeek cost estimates that follow published peak/off-peak rates.
- Added dated, announced price changes to the catalog, so rates switch on their effective date (e.g. DeepSeek Pro moving to Flash rates).
- Added Command Code as a built-in provider with API-key login, live model discovery, per-model pricing, native OpenAI/Anthropic-compatible routing, cache-aware token usage, and TTFT metrics ([#11391](https://github.com/can1357/oh-my-pi/pull/11391) by [@CherkaSSH](https://github.com/CherkaSSH)).

### Fixed

- Fixed Command Code models outside the verified effort registry offering unsupported reasoning effort controls, and bundled the live Command Code catalog so fresh installs resolve the default model without waiting for discovery ([#11595](https://github.com/can1357/oh-my-pi/pull/11595) by [@H4vC](https://github.com/H4vC)).
- Fixed the bundled `deepseek-flash` row shipping without context limits: it now carries its documented 1M context / 384K output so offline context accounting enforces the real window.

## [18.1.16] - 2026-09-09

- 随 1.1.14 版本线发布:bazel 构建面(crates/*/BUILD.bazel)版本号纳入一致性检查,CI 原生构建与桌面冒烟守卫修复。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:compat 规则/模型目录刷新(Kimi K2.7-code 家族识别、moonshot 原生端点匹配等)。

## [1.1.11] - 2026-09-08

### Added

- Added Muse Code as a provider with Muse Spark models and live account-scoped discovery; subscriptions resolve a compact edit-prompt variant, cutting recurring per-request tool bytes without touching other providers. Added Meta's `max` reasoning effort tier to Muse Spark 1.3 (standard) on the Meta Model API and Muse Code.

### Fixed

- GPT-6 Astra keeps its documented 1.05M-token window with `/extended-context` on or off; Codex Astra defaults to 272K, clamps explicit context-window overrides to the server-honored ceiling, uses the documented 922K input cap inside the 1.05M total, and bills long-context requests at the documented 2x input / 1.5x output tier above 272K input (Codex subscription route exempt with free cache writes).
- Fixed GitHub Copilot enterprise-only model ids inheriting another provider's wire routing (e.g. `gpt-5.6-sol-fast` pinning every request to the `-none` sibling id regardless of thinking level).
- Extended-context catalog rebuilds resolve each model's maximum window once per process.

## [1.1.10] - 2026-09-07

### Added

- Muse Code provider baseline from the v18.1.12 sync: provider registration, Spark models, live discovery, `max` reasoning tier.

### Fixed

- Fixed OpenCode Go/Zen live model discovery missing `x-opencode-session` attribution: discovery requests carry the stable install id so requests flagged as `Bun fetch` get the required session header.
- Fixed GPT-6 Astra requests through GitHub Copilot failing with an unsupported endpoint error.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline; retired pi-hashline catalog entry removed from the version-line catalogs.

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 DeepInfra / Yolo-Auto 提供商标识。

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
- Bundled model metadata is prebuilt during generation, reducing catalog startup work.

### Fixed

- Fixed tool-call turn failures for `opencode-go/muse-spark-1.2` and related variants by ensuring API transport pins apply to live discovery and automatically inferring response routes for gateway-first OpenCode models ([#8957](https://github.com/can1357/oh-my-pi/issues/8957)).
