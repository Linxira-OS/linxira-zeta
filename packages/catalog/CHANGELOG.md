## [Unreleased]

## [1.3.1] - 2026-10-19

### Changed

- Seeded TypeSafe `jev-1.14.0` and OpenRouter `typesafe/jev-1.14`, and made them the `judge` role defaults and TypeSafe's default model; TypeSafe discovery keeps seeded ids its alias-only `/v1/models` listing omits

## [1.3.0] - 2026-10-18

### Fixed

- Anthropic's `request-encoding-rejection` now also matches the API's "request body is not valid JSON" 400, which a gzip body gets when a proxy drops its `Content-Encoding` header ([#16108](https://github.com/can1357/oh-my-pi/pull/16108) by [@alphastorm](https://github.com/alphastorm))
- Fixed custom providers that declare a built-in `providerType` (Azure, GitHub Copilot, OpenCode, ClinePass, DeepSeek, NVIDIA) missing that provider's wire quirks, such as strict Responses pairing and the ClinePass reasoning field: they now follow the same catalog rules as the built-in provider ([#16093](https://github.com/can1357/oh-my-pi/pull/16093) by [@H4vC](https://github.com/H4vC))
- Fixed OpenCode Zen bringing back its retired bundled models after a failed refresh: the retry-backoff write no longer drops the cached snapshot's retention, so the pruned catalog survives the retry window and offline launches. ([#16054](https://github.com/can1357/oh-my-pi/pull/16054) by [@adi-IL](https://github.com/adi-IL))
- Fixed `providers.cacheWarming` never arming for Claude on Google Antigravity: Claude models there now declare Vertex Anthropic's five-minute prompt-cache lifetime; Gemini models stay unwarmed because Google's implicit cache has no fixed lifetime ([#15764](https://github.com/can1357/oh-my-pi/issues/15764), [#16025](https://github.com/can1357/oh-my-pi/pull/16025) by [@harshaygadekar](https://github.com/harshaygadekar))
- Scoped Jev image bounds to the selected models instead of applying them to unrelated native judges ([#16002](https://github.com/can1357/oh-my-pi/pull/16002) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy))
- Fixed Bedrock sessions rejecting replayed tool names over 64 characters after a model switch ([#15839](https://github.com/can1357/oh-my-pi/issues/15839))
- Fixed Command Code's `z-ai/glm-5.3-flash` failing every request with "not available on this endpoint": the catalog routes it to chat completions, the only endpoint Command Code lists for it ([#15922](https://github.com/can1357/oh-my-pi/pull/15922) by [@jasonharrison](https://github.com/jasonharrison))
- Fixed `/handoff` failing with `400 Provider returned error` on OpenRouter's hosted Muse Spark 1.x and Muse Wonder models: requests no longer send a `tool_choice` the upstream Meta backend rejects ([#15910](https://github.com/can1357/oh-my-pi/issues/15910))
- Fixed OpenCode Zen bringing back retired bundled models from an authoritative model cache, and dropping drop-listed models such as `gemini-3.7-flash` when a refresh fails after an upgrade ([#15770](https://github.com/can1357/oh-my-pi/pull/15770) by [@adi-IL](https://github.com/adi-IL))
- Fixed OpenCode Zen Gemini 4 Argon failing with an unsupported protocol; it now uses the native Gemini endpoint ([#15977](https://github.com/can1357/oh-my-pi/issues/15977)).
- Enabled long prompt-cache retention (`ttl: "1h"`) for Claude models on `google-vertex` ([#15505](https://github.com/can1357/oh-my-pi/pull/15505) by [@hpost](https://github.com/hpost))
- Fixed Gemini 4 Argon on Google Vertex and the Gemini API failing every request with "Thinking budget is not supported for this model": Gemini 4 now sends `thinkingLevel` instead of `thinkingBudget`, and Argon offers only the low, medium, and high levels Google accepts ([#15643](https://github.com/can1357/oh-my-pi/pull/15643) by [@kevcube](https://github.com/kevcube))
- Fixed the Antigravity model selector offering roster rows the backend marks disabled (`disabled: true`, e.g. `gemini-4-argon-disabled` on accounts without Argon access), which answered `Cloud Code Assist API error (404): Requested entity was not found.`; discovery now skips them the way it already skips `isInternal` rows ([#15684](https://github.com/can1357/oh-my-pi/pull/15684) by [@CharleoYang](https://github.com/CharleoYang))
- Removed Google Antigravity's Gemini 3.5 Flash and its `gemini-3-flash` alias from the model list; Antigravity retired them and answers every request with a retirement notice instead of a reply ([#15445](https://github.com/can1357/oh-my-pi/pull/15445) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `xai-oauth` Grok 4.20 models (`grok-4.20-0309-reasoning`, `-non-reasoning`, `grok-4.20-multi-agent-0309`) advertising a 2M context window when the SuperGrok API rejects prompts over 1M; auto-compaction and context usage now work from the 1M window ([#15443](https://github.com/can1357/oh-my-pi/pull/15443) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed trailing-dot `localhost.` and `*.local.` custom endpoints losing local-backend compatibility settings ([#15798](https://github.com/can1357/oh-my-pi/issues/15798)).
- Fixed OpenCode Go's `deepseek-flash` alias showing $0, unknown limits, and no reasoning instead of the V4.1 Flash rate card and capabilities ([#15357](https://github.com/can1357/oh-my-pi/issues/15357))
- Fixed OpenCode Go's Gemini 4 Argon Contributor failing with an unsupported protocol and thinking level; it now uses the native Gemini endpoint ([#15722](https://github.com/can1357/oh-my-pi/issues/15722))
- Fixed Devin Claude and GPT-5.6 through GPT-6 models pricing prompt-cache writes at $0; they now use Devin's published rate of 1.25x input, and Adaptive uses its input rate ([#14891](https://github.com/can1357/oh-my-pi/pull/14891) by [@eggpeat](https://github.com/eggpeat)).
- Fixed Devin GPT-5.4 through GPT-6.1, Gemini Pro, and Grok 4.5 through 4.7 models missing the long-context price tiers Devin publishes above 272K and 200K prompt tokens ([#14891](https://github.com/can1357/oh-my-pi/pull/14891) by [@eggpeat](https://github.com/eggpeat)).
- Fixed Devin Fusion pairings ignoring their lead model's rules, including its cache-write rate and long-context tier ([#14891](https://github.com/can1357/oh-my-pi/pull/14891) by [@eggpeat](https://github.com/eggpeat)).
- Fixed Kilo and NanoGPT models showing stale or missing prices (for example Gemini 4 Argon at $4/$20 instead of $2/$10, and many models at $0); prices now come from each gateway's live model list ([#15623](https://github.com/can1357/oh-my-pi/pull/15623) by [@eggpeat](https://github.com/eggpeat))
- Fixed NanoGPT models showing their raw id as the name and no context window (disabling auto-compaction) when the bundled catalog lacked them; names, context windows and output limits now come from NanoGPT's live model list ([#15623](https://github.com/can1357/oh-my-pi/pull/15623) by [@eggpeat](https://github.com/eggpeat))
- Applied `max-image-dimension` and `max-image-payload-bytes` to Google API models, and declared the 5 MiB per-image limit of Claude on Google Antigravity ([#15444](https://github.com/can1357/oh-my-pi/pull/15444) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed local token counts for OpenAI GPT-5 and later models (Codex, OpenAI, Azure, OpenRouter, Copilot and other hosts) reading about 12% low: their text is now counted with o200k_base instead of a bytes/4 estimate ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- Added the `request-encodings`, `request-encoding-rejection`, and `endpoint-hosts` rule axes, `resolveRequestCompression(model, url)`, and `isCatalogEndpointUrl(model, url)`, declaring which providers' own endpoints decode compressed request bodies: official Anthropic API (gzip), Codex backend (zstd), and GitHub Copilot's API hosts (zstd, then gzip); Moonshot's China host counts as its own endpoint ([#16086](https://github.com/can1357/oh-my-pi/pull/16086) by [@H4vC](https://github.com/H4vC))
- Added `keep-bundled-names` catalog attribute to preserve static model display names during discovery
- Updated `openai-codex` provider configuration to prevent model name regressions during live discovery
- Added `local/nemotron-streaming-en-0.6b` for local streaming English dictation ([#15759](https://github.com/can1357/oh-my-pi/pull/15759) by [@daaximus](https://github.com/daaximus)).
- Added SambaNova Cloud (`sambanova`) as a provider: `/login sambanova` with an API key, and the live `/v1/models` roster with its prices, reasoning models, and Gemma 4 image input ([#14986](https://github.com/can1357/oh-my-pi/pull/14986) by [@rjuez00](https://github.com/rjuez00))
- Added Muse Code's subscription-only Muse Wonder Full and Wonder contributor tiers with the `max` effort, recording API-equivalent cost instead of $0: Wonder Full at Muse Wonder's $4 input / $0.20 cached / $20 output per 1M tokens, contributor tiers at the measured $1.60 / $0.08 / $8 ([#15522](https://github.com/can1357/oh-my-pi/pull/15522) by [@eggpeat](https://github.com/eggpeat))
- Added the `classifier-cot-extraction` rule axis, set for Claude, marking models whose classifier refuses earlier reasoning quoted back into their input ([#15436](https://github.com/can1357/oh-my-pi/pull/15436) by [@will-bogusz](https://github.com/will-bogusz))
- Added Gemini 4 Argon pricing on Cursor ($2 input / $0.10 cached / $10 output per 1M tokens) and Google Antigravity, which now uses Google's first-party rate instead of showing $0 ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Added scheduled list-price changes to `cost-patch`, as `cost-fallback` already allowed: a dated `effective-rates` card sets the price from its date, and each request is priced at the card in force when it was made, even on models loaded before the change, on rebuilt models, and on Cursor lanes priced from a sibling's card. A malformed dated card now fails the model build instead of silently keeping the old price. `getEffectiveTokenCost` returns that card for price displays, and `hasRecurringTariff` tells these dated-only schedules apart from peak/off-peak tariffs, which alone show a status-line arrow ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Added the `honors-claude-code-beta-kill-switch` axis (`compat.honorsClaudeCodeBetaKillSwitch`), on for the `anthropic` provider, so a rule or `models.yml` override decides which providers honor `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ([#15458](https://github.com/can1357/oh-my-pi/pull/15458) by [@H4vC](https://github.com/H4vC))
- Added Muse Wonder (`muse-wonder-1.0`) to Meta and Muse Code with its `minimal`–`max` effort ladder and pricing
- Added the `thinking-unverified` rule axis: on hosts whose model list carries no capability metadata (Meta, Muse Code), unrecognized models now offer an opt-in thinking ladder (`ThinkingConfig.unverified`) instead of none
- Added `thinking-unverified` axis for offering reasoning ladders on unclassified model IDs
- Added `Muse Wonder 1.0` model definition to Meta provider
- Added the opt-in `snapcompact-image-reads` axis: snapcompact images a fresh `read` result only for readers whose rule sets it; Claude Opus 5.5 and later opt in ([#14249](https://github.com/can1357/oh-my-pi/pull/14249) by [@will-bogusz](https://github.com/will-bogusz))
- Added the `image-count-budget` rule for how many images one request may carry (Anthropic 90, Codex 200, other hosts unchanged) and the `official-image-count-budget` override that applies only on the official endpoint: Anthropic 600 (100 on 200k-window Claude models), Codex 2,000 ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added a 24 MB inline-image byte budget for the Codex backend, which now counts as its official endpoint at its default URL and at paths under it such as `/codex/responses` ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added `isOfficialCodexApiUrl` to `wire/codex`, moved from pi-ai ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added `verified` to `image-tokenization` rules, marking the Claude 4.7+ high-res tier and the GPT-5.5 to 6.1 and gpt-6-astra rules as matching measured provider billing ([#15442](https://github.com/can1357/oh-my-pi/pull/15442) by [@will-bogusz](https://github.com/will-bogusz))
- Added the `image-max-edge` axis and `resolveImageMaxEdge()` for hosts that shrink images before the model reads them; Cursor's Claude and GPT models and its `default` (Auto) route fit 1024×1024 ([#15448](https://github.com/can1357/oh-my-pi/pull/15448) by [@will-bogusz](https://github.com/will-bogusz))
- Added the `thinking-replay-tokens` axis; Claude lines set it to `output` on every host, since a replayed signed thinking block bills the turn's full reasoning, not the signature's bytes ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Added a KDL opt-in for sibling subagent prompt-cache sharing, enabled for Muse Code's Spark 1.3, Wonder 1.0, and Wonder Full 1.0 variants over the Responses API ([#15467](https://github.com/can1357/oh-my-pi/pull/15467) by [@iliaal](https://github.com/iliaal))

### Changed

- Bundled GPT-5.4 rows on OpenAI, Azure, OpenCode Zen, and Command Code report a 1M context window, the window the coding agent already applied at runtime; GitHub Copilot and Factory Droid keep their own windows ([#16094](https://github.com/can1357/oh-my-pi/pull/16094) by [@H4vC](https://github.com/H4vC))
- Renamed the built-in `google-antigravity` login option to "Google Antigravity (Gemini, Claude, GPT-OSS)" so it is distinguishable from similarly named third-party plugins and no longer implies support stops at Gemini 3 ([#15998](https://github.com/can1357/oh-my-pi/pull/15998) by [@savanne-kham](https://github.com/savanne-kham)).
- GPT Image models (`gpt-image-*`, `chatgpt-image-*`) now classify as their own `gpt-image` family instead of `gpt` or `chatgpt`, so GPT chat-model rules no longer apply to them ([#14619](https://github.com/can1357/oh-my-pi/pull/14619) by [@jimhester](https://github.com/jimhester))
- OpenCode Go requests now go to the current `https://opencode.ai/inference/go/v1` endpoint instead of the legacy `/zen/go` one ([#15722](https://github.com/can1357/oh-my-pi/issues/15722))
- Devin models with a long-context price tier (GPT-5.4 through 5.6 standard lanes, GPT-6 through 6.1, Gemini Pro, and Grok 4.5 through 4.7) now default to a 272K or 200K context window, where that pricing starts; run `/extended-context on` to use the full window at long-context rates ([#14891](https://github.com/can1357/oh-my-pi/pull/14891) by [@eggpeat](https://github.com/eggpeat)).
- Devin SWE-2, SWE-1.7, and GLM-5.2 fallback pricing no longer charges cache writes at the input rate, since Devin publishes no cache-write rate for them ([#14891](https://github.com/can1357/oh-my-pi/pull/14891) by [@eggpeat](https://github.com/eggpeat)).
- Google Antigravity now lists Gemini 4 Argon once, with selectable low, medium, and high thinking levels, instead of a separate entry per thinking tier ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Gemini 4 Argon on Google, Vertex, Google Antigravity, and Cursor moves to Google's $4 input / $0.20 cached / $20 output list price on 2026-12-01 (midnight US Pacific), including requests on models loaded before then, without a catalog update ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Devin SWE-2's promotional fallback price now ends on 2027-01-01 for requests on models loaded before then too ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Raised the default context window for `openai-codex/gpt-6.1-sol` and `gpt-6.1-sol-wm` from 272K to 500K, matching OpenAI's new Codex default; extended context still opens 922K ([#15421](https://github.com/can1357/oh-my-pi/issues/15421))
- Updated model definitions and compatibility rules for provider metadata
- Google Antigravity, xAI and Cursor requests keep up to 60 images, 20 for Claude on Antigravity and Cursor, up from 5; this counts snapcompact frames and live screenshots together ([#15449](https://github.com/can1357/oh-my-pi/pull/15449) by [@will-bogusz](https://github.com/will-bogusz))
- Snapcompact sizes archives at the frame prices measured for Antigravity Gemini (a fixed 1,089 tokens), Grok 4.6 to 4.20, and Claude Sonnet 4.6's standard tier ([#15449](https://github.com/can1357/oh-my-pi/pull/15449) by [@will-bogusz](https://github.com/will-bogusz))

### Removed

- Removed the Codex `toolMode` model field (`code_mode_only`); Codex discovery no longer maps `tool_mode`

### Breaking Changes

- `resolveInlineImageByteBudget(model, officialEndpoint)` and `resolveImageCountBudget(model, officialEndpoint)` take whether the request reaches the official endpoint instead of reading `compat.officialEndpoint`, which misses request-time reroutes such as `ANTHROPIC_BASE_URL`; pass pi-ai's `reachesOfficialEndpoint(model)` ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))

## [1.2.0] - 2026-10-12

- 版本线推进至 1.2.0；本版无独立用户可见变化。

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
