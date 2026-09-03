# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01
## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra 支持，空补全重试重构（withReplaySafeStreamRetry）。

## [1.1.3] - 2026-08-25
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
- Fixed Gemini thought summaries occasionally leaking a raw `` ```thinking `` / `` ``````thinking `` fence delimiter into the reasoning block, so it no longer shows up as fence spam in the thinking display or persisted transcripts ([#8719](https://github.com/can1357/oh-my-pi/issues/8719)).
- Fixed the OpenCode Go login prompting for an "OpenCode Zen API key": the shared login flow now names the provider you selected, so connecting OpenCode Go asks for an OpenCode Go key (the `opencode.ai/auth` console is still shared, as documented upstream) ([#8738](https://github.com/can1357/oh-my-pi/issues/8738)).
- Fixed Anthropic-compatible endpoints with strict prompt validation (e.g. Z.AI GLM `api.z.ai/api/anthropic`, which rejects the whole request with `400 code 1213 "The prompt parameter was not received normally"`) failing sessions once a tool returned empty output on a vision-capable model: empty successful `tool_result` blocks now encode as `content: ""` instead of `content: []`, which both the official API and strict compatible endpoints accept.
- Fixed `retry.usageReservePct` (Reserve Margin) ignoring Claude Fable/Mythos weekly tier usage until it hit 100%, so a Fable model kept serving turns past the configured reserve; reserve health now honors the mapped tier row while credential-wide hard blocks still require confirmed exhaustion ([#8773](https://github.com/can1357/oh-my-pi/issues/8773)).
- Fixed `cursor-agent` streams stalling with "Provider stream stalled while waiting for the next event" when Cursor asked the client to approve a hosted WebFetch / web search (reproduced on `cursor-grok-4.6-xhigh` after "I'll fetch the page…"). Those `interaction_query` frames — including the newer WebFetch field 9 this proto did not name — were dropped, so the server waited forever and the idle watchdog aborted a live connection. Permission queries are now answered; hosted search/fetch is approved, unnamed permission fields get an `approved` reply on the same field number, and prompts this client cannot serve are rejected so the turn can continue.

### Fixed

- Fixed thinking effort selections being ignored for local Qwen 3.8+ models on llama.cpp and vLLM: the Qwen chat-completions dialects only toggled `enable_thinking`, so the chat template always reasoned at its `xhigh` default no matter which level was selected. The encoder now routes the requested effort onto the template's `reasoning_effort` kwarg (`chat_template_kwargs` for both Qwen dialects, plus the top-level field newer llama.cpp builds map natively).
- Fixed OpenAI Completions, Amazon Bedrock, and Cursor providers ignoring `onPayload` replacement payloads. The hook now transforms the actual request body sent upstream on these providers, matching the Anthropic/Gemini/OpenAI Responses replacement contract. `devin-agent` still does not fire the hook (its payload is a protobuf object).
- Fixed Codex requests failing outright when the signed-in ChatGPT account is not entitled to the requested model; the exact model denial is now classified as an account-policy error so credential rotation can reach an entitled sibling account
- Fixed Perplexity email-OTP login after its verification response renamed the encrypted session token from `token` to `challenge_token`.
- Cloud Code Assist Gemini 3.6/3.7 Flash requests at `minimal` now send `thinkingLevel: LOW` on the aliased `-low` SKU instead of `MINIMAL`, which the API rejects with HTTP 400.
- Answer Cursor `interaction_query` permission gates (hosted web search, Exa, unnamed field-9 WebFetch) so the Run RPC continues instead of sitting silent until the 300s idle watchdog.
- Fixed provider tool calls arriving with flattened array argument paths (e.g. Gemini's `questions[0].id`) being stripped and rejected by argument validation; well-formed flattened paths are now rebuilt into the nested arrays the tool schema expects ([#8886](https://github.com/can1357/oh-my-pi/issues/8886)).
- Fixed opencode-go (Console Go) rejecting Responses turns with `400 No tool output found for tool call …` (naming a random call of the batch on each retry) when a model streamed a trailing text/thinking block after its tool calls: `buildResponsesInput` emitted that block as an assistant `message` item wedged between the `function_call` batch and its `function_call_output` items. Such interleaved messages are now hoisted ahead of their call batch (canonical `message(s) → calls → outputs`), which the strict gateway validator accepts; content is unchanged ([#8789](https://github.com/can1357/oh-my-pi/issues/8789)).
- Fixed the OpenAI-wire transport sleeping on a LiteLLM concurrency-admission 429 (`rate_limit_type: max_parallel_requests`, `Retry-After: 60`) and retrying it up to 6 times (~300s) before session recovery saw the error. Because a 60s hint equals the transport's `maxDelayMs` cap, `fetchWithRetry` kept sleeping and retrying; the request now surfaces on the first attempt so `TurnRecovery`'s concurrency backoff/model fallback runs promptly. Genuine RPM/quota 429s (no such marker) still honor `Retry-After` ([#8854](https://github.com/can1357/oh-my-pi/issues/8854)).
- Fixed OAuth login (Codex `localhost:1455`, and any `localhost` callback flow) failing on hosts with IPv6 disabled at the kernel (`ipv6.disable=1`). The `::1` companion listener added in #8081 fails there with Bun's generic "Is port X in use?" message (oven-sh/bun#7187), which the in-use check misread as a real collision — tearing down the healthy IPv4 listener and surfacing a bogus "port 1455 is in use" error. The dual-bind path now detects the missing IPv6 loopback up front and serves IPv4 alone ([#8814](https://github.com/can1357/oh-my-pi/issues/8814)).

