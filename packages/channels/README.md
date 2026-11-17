# @linxiraos/pi-channels

IM channel adapters for Zeta: WeChat (ClawBot / iLink), Feishu / Lark,
Telegram, Discord (official Bot API), and QQ over a user-supplied OneBot v11
bridge, plus the `ChannelHost` coordinator bridge, session router, workspace
router, IM control, plan-approval, and plan-image helpers.

The channel runtime is embedded in `zeta serve`; the CLI never imports this
package directly (no channel listeners exist outside a `ZetaServer`).

## Inbound guarantees

- `channels.allowedPeers` (when non-empty) plus the per-platform lists for
  Discord (`allowedChannels`/`allowedUsers`) and QQ
  (`allowedGroups`/`allowedUsers`) are checked before routing: an unauthorized
  peer is refused explicitly and never reaches the command router, a
  workspace/direct session, a bot session, or the relay. Discord and QQ are
  deny-by-default: an enabled channel with an empty list does not start.
- Messages are deduped per channel by platform message id. The seen ids live
  in `<agent dir>/run/channels-seen.json`, so a retried update after a restart
  or reconnect is dropped instead of answered twice. Platforms that expose no
  message id (some WeChat payloads) skip dedupe rather than guessing.
- Replies are correlated with the delivered message via the session's IRC
  wake-turn observer (`ReplyCorrelator`): a turn answers the chat whose
  message it was started for, and Studio/attach turns on the same session
  never consume an IM reply slot.

## Feishu / Lark inbound media

Text, image, and file events reach the same inbound session route. Image and
file resources are fetched with the bot's SDK client and streamed into the
instance's `channels-inbox/<instance>/<message-id>` directory. The shared
attachment byte cap is 100 MiB; a failed or oversized download reaches the
agent as an unavailable attachment, without a partial file or a fabricated
download URL. Missing resource keys and disabled storage are also explicit
attachment failures. Other Feishu message types are rejected with a warning.
This does not add outbound file support or change secret storage (ADR-0030).
The additive authenticated-source API is proposed in
[ADR-0065](../../document/adr/0065-feishu-bounded-inbound-resources.md).
