# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
- Added Command Code usage limits (5-hour, weekly, and credit balance) to /usage and the status line ([#13666](https://github.com/can1357/oh-my-pi/pull/13666) by [@riicodespretty](https://github.com/riicodespretty))

### Changed

- Reduced per-token CPU and allocations while streaming: the leaked-thinking scanner used for OpenAI-compatible and custom endpoints no longer allocates per character, chat-completions and Bedrock look up a delta's content block in constant time, Google, Gemini CLI, Codex, and chat-completions streams skip raw SSE line capture unless an `onSseEvent` listener is attached, and event streams drain backlogs without `Array#shift` ([#13650](https://github.com/can1357/oh-my-pi/pull/13650) by [@H4vC](https://github.com/H4vC)).
