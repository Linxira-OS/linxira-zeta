# @linxiraos/pi-channels

IM channel adapters for Zeta: WeChat (ClawBot / iLink), Feishu / Lark, and
Telegram, plus the `ChannelHost` coordinator bridge, session router, workspace
router, IM control, plan-approval, and plan-image helpers.

The channel runtime is embedded in `zeta serve`; the CLI never imports this
package directly (no channel listeners exist outside a `ZetaServer`).
