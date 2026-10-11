# time

> Get the current exact date-time — local wall clock, UTC, and epoch milliseconds — on demand.

## Source
- Entry: `packages/coding-agent/src/tools/time.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/time.md`
- Toggle command: `packages/coding-agent/src/slash-commands/builtin-zeta.ts` (`/tool time on|off`)

## Input and availability
`time` takes an optional `timezone` (IANA name such as `Asia/Shanghai`; omitted uses the machine's local zone). It is a dynamic tool: registered as a built-in but absent from the toolset until enabled with `/tool time on` (persisted as the `time` entry of the `session.dynamicTools` setting) and removed again by `/tool time off`. While enabled, every user-attributed message is stamped with a trailing `[发送时间: YYYY-MM-DD HH:mm:ss ±HH:MM]` line, and each toggle injects a one-line system notice naming the tool, its capability, and the current mode.

## Behavior
- Returns three lines: local time (`YYYY-MM-DD (Weekday) HH:mm:ss ±HH:MM Zone Name`), UTC in the same format, and `Epoch: <milliseconds> ms (ISO ...)`.
- Wall-clock fields come from `Intl.DateTimeFormat`; the UTC offset is derived from the rendered wall clock itself, so it is exact at the queried instant (including DST boundaries).
- An invalid `timezone` throws a tool error that also reports how many IANA zones this runtime supports (`Intl.supportedValuesOf("timeZone")`).
- No new dependencies; the tool is read-approved (`approval: "read"`).
