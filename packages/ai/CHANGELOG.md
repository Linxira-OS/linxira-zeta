## [Unreleased]

## [1.3.1] - 2026-10-19

### Breaking Changes

- `isOfficialCodexApiUrl` moved from `@linxiraos/pi-ai` to `@linxiraos/pi-catalog/wire/codex`, next to `CODEX_BASE_URL`, so the catalog's compat resolver classifies Codex endpoints with the same check ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- Added `nativeJudgmentImageBounds()`: the image bounds a native judge enforces, its wire's transport limits tightened by the catalog's model bounds
- Added Box judgment questions (`BoxQuestion`/`BoxAnswer`, TypeSafe Jev 1.14+ direct or through OpenRouter): each names the request image it searches by `image` index, and comes back as that image's edges as 0–1 fractions; text, OpenAI Decisions, and Workers AI judges reject them

### Fixed

- Fixed Muse Code usage going stale whenever its 5-hour window sits idle: the idle window now reports as unused, and weekly usage carries over from the last active window until its reset ([#16193](https://github.com/can1357/oh-my-pi/pull/16193) by [@eggpeat](https://github.com/eggpeat))
- Fixed DeepSeek tool calls never running when the model writes them as chat-template tokens with `_` in place of `▁`, a missing `｜`, or no per-call close (e.g. `<｜tool_calls_begin｜>…<｜tool_calls_end｜>`): they now run as tool calls, and any that still cannot be parsed are removed from history and reported to the model as a failed call ([#16216](https://github.com/can1357/oh-my-pi/pull/16216) by [@H4vC](https://github.com/H4vC))

## [1.3.0] - 2026-10-18

### Fixed

- Fixed every request failing behind a TLS-inspecting proxy that refuses compressed uploads: a 400/403/415 whose body is not JSON, or the Anthropic API's "request body is not valid JSON" after a proxy drops `Content-Encoding`, now resends the body uncompressed and stops compressing for that host ([#16108](https://github.com/can1357/oh-my-pi/pull/16108) by [@alphastorm](https://github.com/alphastorm))
- Fixed Claude on Google Antigravity failing every turn with "image exceeds 5 MB maximum" once a large image entered the conversation; images are now downscaled to the host's limits before sending, as on the Anthropic API ([#15444](https://github.com/can1357/oh-my-pi/pull/15444) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Codex cybersecurity policy errors incorrectly retrying without Daybreak and disabling it for subsequent requests, while preserving retries without Daybreak when access is rejected ([#15472](https://github.com/can1357/oh-my-pi/pull/15472) by [@taibenvenuti](https://github.com/taibenvenuti))
- Fixed Codex-hosted image generation ignoring the requested `aspect_ratio`/`image_size`, and `3:2`/`2:3` requests sending no size to OpenAI image models ([#15601](https://github.com/can1357/oh-my-pi/pull/15601) by [@chulmin-dev](https://github.com/chulmin-dev))
- Fixed Claude subagents failing to return structured results when `yield` arguments arrived as invalid JSON ([#15605](https://github.com/can1357/oh-my-pi/pull/15605) by [@farnoy](https://github.com/farnoy))
- Fixed turns stopping instead of retrying when a gateway reports its upstream WebSocket closed before `response.completed` ([#15628](https://github.com/can1357/oh-my-pi/pull/15628) by [@nqrwhal](https://github.com/nqrwhal)).
- Fixed Claude on Google Vertex ignoring `cacheRetention: "long"`: prompt caches now get the 1h TTL instead of expiring after 5 minutes, and the `extended-cache-ttl` beta (which Vertex rejects) is never sent there ([#15505](https://github.com/can1357/oh-my-pi/pull/15505) by [@hpost](https://github.com/hpost))
- Fixed Gemini tool continuations failing on OpenAI-compatible gateways that return `reasoning_signature`, including restored sessions ([#15678](https://github.com/can1357/oh-my-pi/pull/15678) by [@Zzz141592653](https://github.com/Zzz141592653))
- Fixed Cursor sessions failing every rebuilt request with `PROVIDER_ERROR` after the server re-sent a tool call: the call is recorded once, and histories that already repeat it replay it once with its latest result ([#15749](https://github.com/can1357/oh-my-pi/issues/15749))
- Fixed Cursor turns cut off mid-stream failing every retry with `PROVIDER_ERROR` until you sent a new message; the retry now starts a fresh Cursor conversation ([#15830](https://github.com/can1357/oh-my-pi/issues/15830))
- Fixed malformed image-generation inputs being forwarded to providers or reported as credential/upstream errors ([#15765](https://github.com/can1357/oh-my-pi/pull/15765) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Fixed broker-backed auth-gateway processes retaining a cache entry for every distinct client session indefinitely under sustained traffic ([#15841](https://github.com/can1357/oh-my-pi/issues/15841)).
- Fixed turns ending on a pinned error when a provider reports "temporarily unavailable" or finishes with an `unknown`, `other` or `unspecified` finish reason: these now retry automatically ([#15424](https://github.com/can1357/oh-my-pi/pull/15424) by [@lockwo](https://github.com/lockwo))
- Fixed parallel tool calls failing with "Tool call arguments are not valid JSON" on some OpenAI-compatible gateways, such as Gemini ([#15682](https://github.com/can1357/oh-my-pi/pull/15682) by [@Zzz141592653](https://github.com/Zzz141592653))
- Fixed Anthropic fallback-credit redemption losing its credit on errors that only mention `400` in their text, such as an overload message ([#15702](https://github.com/can1357/oh-my-pi/pull/15702) by [@H4vC](https://github.com/H4vC))
- Fixed Anthropic fallback-credit redemption sending an extra `fallback-credit-2026-06-01` beta when the refused request used a newer one ([#15702](https://github.com/can1357/oh-my-pi/pull/15702) by [@H4vC](https://github.com/H4vC))
- Fixed Anthropic fallback-credit redemptions failing when the refused turn included unsigned thinking ([#15702](https://github.com/can1357/oh-my-pi/pull/15702) by [@H4vC](https://github.com/H4vC))
- Fixed turns ending without automatic retry when a gateway forwards Go's `use of closed network connection` transport error; it now retries like other dropped connections ([#15385](https://github.com/can1357/oh-my-pi/issues/15385))
- Fixed Codex SSE streams failing with an abort instead of retrying when the first event stalls ([#15542](https://github.com/can1357/oh-my-pi/issues/15542))
- Fixed Codex (ChatGPT subscription) requests with reasoning disabled, such as judges, titles, commit messages, and thinking `off`, leaving effort to the server default; they now send the lowest supported effort, or `none` where the model accepts it ([#15514](https://github.com/can1357/oh-my-pi/issues/15514))
- Fixed a Codex account whose token OpenAI rejects (401/403) continuing to show its last quota as healthy; `omp usage` now drops the stale report and `omp auth-gateway check` reports the credential as failing ([#15439](https://github.com/can1357/oh-my-pi/issues/15439))
- Fixed usage reports being served indefinitely while their provider keeps failing; the last successful report is now shown for at most 24 hours after it was fetched ([#15439](https://github.com/can1357/oh-my-pi/issues/15439))
- Fixed Responses requests 400ing (DeepSeek: "The `reasoning_text` in the thinking mode must be passed back to the API") after a tool call whose arguments were invalid JSON: the call is now replayed with its parse diagnostic instead of being dropped and leaving a trailing `[Orphan tool result]` note ([#15568](https://github.com/can1357/oh-my-pi/issues/15568))
- Fixed DeepSeek on OpenAI-compatible gateways leaving doubled-pipe DSML markup (`</｜｜DSML｜｜parameter>`) in assistant text and reasoning ([#15485](https://github.com/can1357/oh-my-pi/issues/15485))
- Fixed sessions failing every request with `400 … thinking or redacted_thinking blocks in the latest assistant message cannot be modified` after a response fell back to another model mid-turn (e.g. through a gateway that opts into Anthropic server-side fallback); the turn now replays one model's reasoning, and a session already stuck on such a turn recovers by dropping that turn's reasoning and retrying ([#15654](https://github.com/can1357/oh-my-pi/pull/15654) by [@abilliontokens](https://github.com/abilliontokens))
- Fixed `omp auth-gateway`'s Anthropic `/v1/messages` stream misnumbering content blocks after a redacted reasoning block, which misrouted every later delta in index-addressed clients ([#15654](https://github.com/can1357/oh-my-pi/pull/15654) by [@abilliontokens](https://github.com/abilliontokens))
- Fixed error results from non-first-party providers regaining partial output the provider had discarded; an error with empty content now stays empty ([#14516](https://github.com/can1357/oh-my-pi/issues/14516), [#14572](https://github.com/can1357/oh-my-pi/pull/14572) by [@oleg494](https://github.com/oleg494))
- Fixed the auth gateway's `POST /v1/audio/speech` answering 502 for requests the speech adapter rejects (unsupported format, over-long input); they now get 400 `invalid_request_error` ([#14508](https://github.com/can1357/oh-my-pi/pull/14508) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed a single-string tool call with two or more mislabelled string fields silently dispatching whichever field came first in the JSON; such ambiguous calls now fail validation and the model sees its own arguments back ([#14414](https://github.com/can1357/oh-my-pi/pull/14414) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed GLM-5.2 on Ollama Cloud losing its reasoning between turns; Ollama Cloud now keeps assistant thinking in history for models verified to accept it ([#14440](https://github.com/can1357/oh-my-pi/pull/14440) by [@Dante-dan](https://github.com/Dante-dan))
- Fixed GPT Image generation and edits failing on gateways that validate request parameters, such as LiteLLM; `response_format` is no longer sent to GPT Image models ([#14619](https://github.com/can1357/oh-my-pi/pull/14619) by [@jimhester](https://github.com/jimhester))
- Fixed OpenRouter errors such as "Access denied by security policy" dropping the routed upstream's own explanation from `error.metadata.raw` ([#10906](https://github.com/can1357/oh-my-pi/issues/10906), [#14435](https://github.com/can1357/oh-my-pi/pull/14435) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed GitHub Copilot usage reporting an AI-credit allowance as "Premium Requests" in request units; the unit each billing item reports is now honoured ([#13849](https://github.com/can1357/oh-my-pi/issues/13849), [#14501](https://github.com/can1357/oh-my-pi/pull/14501) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed an OpenAI-compatible server's `finish_reason: "repetition"` or `stop_reason: "repetition_detected"` not being treated as a thinking loop, so the degenerate partial reasoning was kept and replayed into the next turn ([#12525](https://github.com/can1357/oh-my-pi/issues/12525), [#14535](https://github.com/can1357/oh-my-pi/pull/14535) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed JSON Schema dereferencing rewriting literal values in `const`, `enum`, `default`, examples, and custom annotations, or treating property names as schema keywords ([#15927](https://github.com/can1357/oh-my-pi/pull/15927) by [@jchanghong023](https://github.com/jchanghong023)).
- Fixed Anthropic requests hanging forever on Bun 1.3 when the upstream accepted the request but never sent headers: aborting the request (including the first-event timeout) now fails it, so the turn retries instead of waiting until the user interrupts it ([#16010](https://github.com/can1357/oh-my-pi/pull/16010) by [@ca-io-systems](https://github.com/ca-io-systems))
- Fixed the auth gateway's `POST /v1/chat/completions` streams being dropped (`terminated`) after ~255 s without upstream output, e.g. while xAI generates a large tool call's arguments, which arrive only when complete; the stream now sends an SSE `: keepalive` comment every 15 s ([#15940](https://github.com/can1357/oh-my-pi/pull/15940) by [@radkawar](https://github.com/radkawar))
- Fixed Anthropic models with mid-conversation system messages (e.g. Claude Opus 5.5) receiving `@file` mention contents and hidden extension messages as a trailing `system` message instead of ending the request on the user's turn ([#15881](https://github.com/can1357/oh-my-pi/issues/15881))
- Fixed Ollama and Ollama Cloud streaming errors being silently accepted as successful responses ([#16039](https://github.com/can1357/oh-my-pi/pull/16039) by [@mottopanikeiku](https://github.com/mottopanikeiku))
- Fixed the hermes in-band scanner exposing a truncated tool name for streaming tool calls: `toolStart` now waits for the complete JSON name, so a stream that splits or stops mid-name never reports a partial tool name ([#16064](https://github.com/can1357/oh-my-pi/pull/16064) by [@adi-IL](https://github.com/adi-IL))
- Fixed `keys.peek()` rotating through stored accounts on each call; it now returns the first account whose token has not expired, every time, so model discovery keeps reading one account's cached catalog ([#16061](https://github.com/can1357/oh-my-pi/pull/16061) by [@gchai](https://github.com/gchai))
- Fixed local JSON Schema references with URI-percent-encoded, JSON Pointer-escaped, or empty definition names resolving incorrectly during dereferencing, strict conversion, and value validation ([#15926](https://github.com/can1357/oh-my-pi/pull/15926) by [@jchanghong023](https://github.com/jchanghong023)).
- Fixed network failures showing a generic "Connection error."; offline, connection-refused, and TLS-verification failures now name the host and the cause ([#16036](https://github.com/can1357/oh-my-pi/pull/16036) by [@jorgoose](https://github.com/jorgoose))
- Fixed Jev image limits rejecting inputs for unrelated native judges and redundant TypeSafe image judgments when only detail changes ([#16002](https://github.com/can1357/oh-my-pi/pull/16002) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Fixed SIGTERM interrupting an in-flight OAuth token rotation before its replacement refresh token was saved ([#15845](https://github.com/can1357/oh-my-pi/issues/15845)).
- Fixed sessions getting stuck on HTTP 400 after replaying tool names unsupported by the target provider, including invented `proc://*` calls and Google tool names sent to Bedrock ([#15839](https://github.com/can1357/oh-my-pi/issues/15839))

### Breaking Changes

- `resolveGatewayApiKey` and `buildGatewayApiKeyResolver` (`@oh-my-pi/pi-ai/auth-gateway`) take the request's route options (`{ storage, client? }`) instead of an `AuthStorage`, their resolver callback receives the resolved credential, and `resolveGatewayAccount` takes that credential ([#15900](https://github.com/can1357/oh-my-pi/pull/15900) by [@alphastorm](https://github.com/alphastorm))
- `PI_CODEX_ZSTD` is replaced by `PI_REQUEST_COMPRESSION`; set `PI_REQUEST_COMPRESSION=0` to send Codex (and every other) request body uncompressed ([#16086](https://github.com/can1357/oh-my-pi/pull/16086) by [@H4vC](https://github.com/H4vC))

### Added

- Added support for `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` on the `anthropic` provider: when set, requests omit pre-release fields (`context_management`, beta tool fields such as `strict` and `defer_loading`, task budgets, structured-output format, `thinking.block_binding`, and Anthropic server compaction) along with their beta headers, so `ANTHROPIC_BASE_URL` gateways that reject them keep working ([#15458](https://github.com/can1357/oh-my-pi/pull/15458) by [@H4vC](https://github.com/H4vC))
- Added `withoutUnverifiedThinking` utility to filter reasoning capability from models when no effort is requested
- Added `reachesOfficialEndpoint(model)`: whether a request to the model reaches the official endpoint its compat was built for, following `ANTHROPIC_BASE_URL` and Foundry's `FOUNDRY_BASE_URL` reroutes of first-party Anthropic models ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added `AssistantMessage.elidedOutputTokens`, the visible output tokens a history rewrite (shake) has removed from the turn, which `usage.output` still counts ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Exported `shouldDropTruncatedThinkingOnlyAssistant` from `providers/transform-messages`, `isColdReplayableResponsesTurn` from `providers/openai-shared` and the new `openAIResponsesReplaysNativeHistory` from `providers/openai-responses`, so local token estimates can follow which turns replay drops and whether a session replays native history ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))
- Added image support for native OpenAI Decisions and Workers AI judgments, prompted vision chat, and auth-gateway System One requests; images exceeding a judgment API's documented caps (e.g. Clef's 4 images, 4 MiB each) are rejected locally ([#15471](https://github.com/can1357/oh-my-pi/pull/15471) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- `isSurvivingAssistant` in `providers/transform-messages`: whether an assistant turn reaches a replay, malformed tool calls dropped first, so callers outside `transformMessages` pick the same latest turn ([#15791](https://github.com/can1357/oh-my-pi/pull/15791) by [@will-bogusz](https://github.com/will-bogusz))
- Added scoped clients to `startAuthGateway` (`clients`, `setClients`): each client bearer is limited to its own models and OAuth accounts, with no fallback to other accounts or API keys, and request log lines name the client and the credential a request started on ([#5098](https://github.com/can1357/oh-my-pi/issues/5098), [#15900](https://github.com/can1357/oh-my-pi/pull/15900) by [@alphastorm](https://github.com/alphastorm))
- Added experimental native image judgments for TypeSafe Jev's `jev-latest`, `jev-preview`, `jev-1.13.0`, and `jev-1.14.0`, plus OpenRouter's `typesafe/jev-1.13`, `typesafe/jev-1.14`, and `~typesafe/jev-latest` models; images outside Jev's documented size bounds fall through to a vision chat judge instead of failing ([#15887](https://github.com/can1357/oh-my-pi/pull/15887) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy))
- Added `ThinkingContent.narration`, set on Anthropic and Bedrock thinking blocks whose signature marks them as between-tool narration, and `presentNarrationAsAnswer(message)` to show those blocks as reply text while replay keeps them as signed thinking
- Added `keys.peek(provider, { includeExpired: true })` to name the stored account behind an expired OAuth token for reads that never send it, such as keying an offline model-cache lookup ([#16061](https://github.com/can1357/oh-my-pi/pull/16061) by [@gchai](https://github.com/gchai))
- Added `prewarmModelConnection(model)` (`providers/connection-prewarm`), which opens the model's API connection ahead of a request using the same transport and TLS settings so the request reuses it instead of paying the connection handshake ([#16086](https://github.com/can1357/oh-my-pi/pull/16086) by [@H4vC](https://github.com/H4vC))

### Changed

- Anthropic requests to the official API now gzip the request body, so long conversations reach the model sooner on slow uplinks; set `PI_REQUEST_COMPRESSION=0` to disable it ([#16044](https://github.com/can1357/oh-my-pi/pull/16044) by [@H4vC](https://github.com/H4vC))
- GitHub Copilot requests (chat completions, Responses, and Claude messages) now send zstd-compressed bodies, cutting upload size by roughly 60–75% on long conversations; set `PI_REQUEST_COMPRESSION=0` to disable it ([#16086](https://github.com/can1357/oh-my-pi/pull/16086) by [@H4vC](https://github.com/H4vC))
- A rejected request-body encoding now only disables compression for that host, and only after the uncompressed resend succeeds, so a genuine 400 no longer turns compression off ([#16086](https://github.com/can1357/oh-my-pi/pull/16086) by [@H4vC](https://github.com/H4vC))
- Connection warm-up now covers every catalog provider, not only the official Anthropic API: it re-warms the origin a model's requests actually reach (Copilot plan hosts, `MOONSHOT_BASE_URL`, regional hosts), throttled per host; custom providers, built-in provider ids routed to a gateway, local hosts, and Anthropic gateways are never probed ([#16086](https://github.com/can1357/oh-my-pi/pull/16086) by [@H4vC](https://github.com/H4vC))

### Removed

- Removed the `toolNamespacesInfo` stream option; Codex requests no longer send `tool_namespaces_info` turn metadata, and `code_mode_tool_names`/`tool_namespaces_info` are no longer reserved client metadata keys.

## [1.2.0] - 2026-10-12

- 版本线推进至 1.2.0；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。

### Fixed

- Fixed Antigravity chat and image requests sending an outdated client version when the model list came from cache, which could make newer models such as Claude Opus 5.5 unavailable.
- When a DeepSeek model writes a broken DSML tool call (for example with the opening `<｜DSML｜tool_calls>` and `<｜DSML｜invoke>` tags missing), its closing tags are now kept in the streamed text instead of being dropped. This lets the agent remove exactly the broken call while keeping any text after it ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

Older entries are archived in [packages/ai/CHANGELOG.md@a20cc0d04b64](https://github.com/can1357/oh-my-pi/blob/a20cc0d04b64f4a68fcc559cbd258743d984c50e/packages/ai/CHANGELOG.md).
