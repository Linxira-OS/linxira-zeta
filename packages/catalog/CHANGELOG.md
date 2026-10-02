# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [18.4.4] - 2026-09-29

### Added

- Added `compat.bedrockMessagesApi` for `anthropic-messages` models: detected from a Bedrock `/anthropic` base URL under any provider id, it drops tool `strict`, fits `metadata.user_id` to Bedrock's pattern, and enables on-demand compaction; set it in `models.yml` to opt a proxy or an `ANTHROPIC_BASE_URL` reroute in, or `false` to opt out ([#13311](https://github.com/can1357/oh-my-pi/pull/13311)).
- Added GPT-6.1 Sol pricing for `openai-codex` (`gpt-6.1-sol`, `gpt-6.1-sol-wm`: $2 input, $10 output, $0.10 cached input), so Codex usage shows cost instead of $0 ([#13782](https://github.com/can1357/oh-my-pi/pull/13782) by [@H4vC](https://github.com/H4vC)).
- Added `Model.serviceTiers`, the service tiers a provider advertises for a model; Codex discovery fills it from `service_tiers` (e.g. `priority`, `ultrafast`) ([#13782](https://github.com/can1357/oh-my-pi/pull/13782) by [@H4vC](https://github.com/H4vC)).
- Added the documented 922K input maximum for `openai-codex/gpt-6.1-sol` with extended context on (Codex reports a stale 872K), matching GPT-6 Astra; the default window stays 272K ([#13782](https://github.com/can1357/oh-my-pi/pull/13782) by [@H4vC](https://github.com/H4vC)).

### Fixed

- Fixed `openai-codex/gpt-6.1-sol` not appearing in Codex discovery even on accounts where the Codex CLI lists it: the backend hides it from client version 0.155.1, so Codex requests now report 0.159.0, the current Codex CLI release ([#13782](https://github.com/can1357/oh-my-pi/pull/13782) by [@H4vC](https://github.com/H4vC)).
- Fixed on-demand compaction staying off for Claude models on the `amazon-bedrock` and `bedrock-mantle` providers when they use Bedrock's `/anthropic` routes ([#13311](https://github.com/can1357/oh-my-pi/pull/13311) by [@mustafaabidali](https://github.com/mustafaabidali)).
- Fixed Claude models on Bedrock's `/anthropic` routes resolving `compat.disableStrictTools: false`, although those routes reject the tool `strict` field ([#13311](https://github.com/can1357/oh-my-pi/pull/13311) by [@mustafaabidali](https://github.com/mustafaabidali)).
- Fixed Bedrock's FIPS (`bedrock-runtime-fips`) and AWS PrivateLink (`vpce-….vpce.amazonaws.com`) hostnames, and Mantle's documented `/v1` OpenAI base, not being recognized as Bedrock routes, which left them without native compaction and the `/anthropic` request fixes ([#13311](https://github.com/can1357/oh-my-pi/pull/13311) by [@mustafaabidali](https://github.com/mustafaabidali)).
- Added `supportsBetweenToolsThinking` Anthropic compat flag (`supports-between-tools-thinking` KDL axis), enabled for Claude Sonnet 5.5

## [18.4.3] - 2026-09-28

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
