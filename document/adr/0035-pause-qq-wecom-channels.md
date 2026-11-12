# 0035. Pause QQ and WeCom channel work; retain OneBot source without a support commitment

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Zeta owner (explicit scope ruling, 2026-11-12)
- **Links:** [roadmap](../roadmap.md), [requirements ledger](../requirements-ledger.md), [channels docs](../../docs/channels.md), [GUI IM channels](../../docs/gui-im-channels.md), [personal account channels](../personal-account-channels.md), [ADR 0034](0034-owner-scope-holds-2026-11-12.md)

## Context

On 2026-11-12 the owner stopped QQ and WeCom channel work as active scope. The
facts behind that pause are:

- **QQ:** the tree contains only a generic OneBot v11 client in
  `packages/channels/src/onebot.ts`. No bridge is bundled, downloaded, or
  auto-installed; bridges are bring-your-own and their licences/account risk
  stay with the user (`docs/channels.md`, `packages/channels/CHANGELOG.md`).
  The third-party OneBot bridge ecosystem is treated as unavailable/blocked for
  this use. The official QQ Bot API (QQ Open Platform) requires a public
  callback plus a fixed egress-IP allowlist, which a personal machine on a
  dynamic IP does not satisfy. The tree has no official QQ Bot API adapter and
  no live bridge validation.
- **WeCom:** the tree has no 企业微信 / WeCom adapter and no webhook or
  group-robot support. `ChannelId`, the runtime channel order, and the
  `web.yml` channel schema contain no WeCom entry. Both WeCom interface
  families (encrypted URL callback and long connection) involve IP, enterprise,
  developer, and user-admission allowlists; practical availability is worse
  than Feishu for this product.
- **Feishu / Lark** is implemented and remains the existing enterprise channel.
- **TIM** is still PLANNED and not implemented; this pause does not change that.
- The existing OneBot source is real, compiled code. A pause must not be
  recorded as "missing", and it must not silently delete working source or
  change its behavior.

## Decision

1. QQ and WeCom channel work is owner-paused as of 2026-11-12. Neither channel
   is a release asset, a supported integration, or a support promise.
2. No official QQ Bot API (QQ Open Platform) adapter is added. No OneBot bridge
   is bundled, downloaded, auto-installed, or live-validated, and QQ login/QR
   and local QQ data stay outside Zeta.
3. The existing OneBot v11 source under `packages/channels/src/onebot.ts` is
   retained with no behavior change. It may remain registered/configurable, but
   documentation must label it owner-paused and unsupported; it is not a
   recommended production channel.
4. WeCom remains without an adapter. No WeCom inbound callback, long
   connection, webhook, group-robot, or outbound implementation is added.
5. Feishu / Lark is the existing enterprise channel. TIM remains PLANNED; this
   ADR does not implement it.
6. Re-entry requires a new explicit owner ruling naming the channel and a new
   ADR superseding this one, plus a fresh availability/security assessment.
   This ADR authorizes no push, PR, tag, release, or main merge.

## Consequences

- Users must not treat QQ or WeCom as supported integrations; release notes and
  docs must not claim either as a shipped or recommended channel.
- The retained OneBot code is a compatibility surface only. It can bit-rot and
  may be removed by a later explicit decision, but this ADR neither deletes it
  nor changes its behavior.
- Feishu carries the enterprise-channel role, including its existing
  credentials and allowlists.
- No bridge licensing, account-risk, callback-exposure, or allowlist obligation
  becomes a product commitment.
- Any future QQ/WeCom work starts from a new decision, not from this pause.

## Alternatives

- **Bundle or auto-install a QQ bridge.** Rejected: bridge availability,
  licensing, and account risk are not controllable, and the owner ruled the
  ecosystem unavailable.
- **Add the official QQ Bot API adapter.** Deferred/rejected for this train:
  the public callback plus fixed egress-IP allowlist does not fit a
  personal/dynamic-IP deployment.
- **Add a WeCom adapter for either interface.** Deferred: both families require
  enterprise/IP/developer/user admission allowlists and are less available than
  the implemented Feishu channel.
- **Delete the OneBot source because it is unsupported.** Rejected: the owner
  asked to pause progress, not to remove existing source or change behavior.
- **Keep claiming QQ as an implemented production channel.** Rejected: code
  existing is not a support or release commitment.

## Links

- [Roadmap: Owner holds (2026-11-12)](../roadmap.md)
- [Requirements ledger: REQ-091](../requirements-ledger.md)
- [Channels status and QQ section](../../docs/channels.md)
- [Work Studio IM channels](../../docs/gui-im-channels.md)
- [Personal-account channel research](../personal-account-channels.md)
- [ADR 0034](0034-owner-scope-holds-2026-11-12.md) — owner-hold convention
