Control the Zeta IM relay: workspaces, default-space sessions, reply language, and model.

Call this ONLY when the user asks — in any language (e.g. "把语言改成英文", "用 web 仓库干活", "新建一个会话叫 test", "列出所有模型", "切到会话 2") — to do one of:

- `list_workspaces` / `list_sessions` / `status` — listing or current state
- `use_session` / `new_session` / `rename_session` / `delete_session`
- `set_language` (`zh`|`en`) / `list_models` / `set_model`
- `route_team_room` (`body`, `messageId`, optional `sourceEntryId`, optional `room: team|mains`) — explicitly forward one IM message into your active Team. Only its main owner may call this. Select the authentic inbound message id from this source transcript; provide its entry id if several instances share that id. Platform, instance, chat and sender attribution come from the stored inbound entry, never tool arguments. This does not change normal IM routing.

Listings print `{n}` numbers and `[name]` names; pass those back verbatim in follow-up calls.

- For ordinary task messages, do NOT call this tool — answer normally.
- Ambiguous request: call `list_workspaces` / `list_sessions` / `list_models` first, then ask the user which `{n}` they mean (a clarifying reply, never a guess).
- Never fabricate names/ids/models; never delete the `relay` session.
- Relay the returned text to the user; it is the final answer.
- Web/desktop mode only.
