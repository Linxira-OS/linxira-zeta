Proactive push to the remote IM channel (WeChat/Feishu/Telegram) that the user talks to through `zeta serve`.

Call this when the remote user asked for a progress update, a task finished and
needs their attention, or something requires manual confirmation. Decide what is
worth pushing — NOT every tool output is forwarded. Working-tool output
(read/write/bash/…) is never sent automatically; only what you explicitly send
with this tool reaches the user.

- `text` is the message body. Keep it concise and self-contained.
- `to` defaults to the session-bound peer (the user who sent the last message).
- `channel` defaults to the session-bound channel. Only set it when you must
  reach a user on a different channel than the one they messaged through.
- Only available in web/desktop mode. In a plain CLI session this tool is
  rejected, so guard calls with the result's `isError` flag.
