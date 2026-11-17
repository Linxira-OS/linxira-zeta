# 0065. Feishu inbound image and file resources use the shared bounded inbox

- **Status:** Proposed
- **Date:** 2026-11-14
- **Deciders:** Integration acceptance pending; implementation within the assigned I5 / REQ-040 scope
- **Links:** [Channels reference](../../packages/channels/README.md), [secret storage decision](0030-im-secret-storage.md), REQ-040

## Context

Feishu previously forwarded text and silently ignored image/file messages. The
channel message contract already carries local attachments, sender identity,
message identity, and download errors. Discord and OneBot use the shared
attachment inbox and byte cap; Feishu resources require the bot's authenticated
SDK client instead of a public download URL.

## Decision

Propose handling Feishu image/file events through the existing inbound message
and attachment contracts. `FeishuChannelOptions` accepts an inbox directory and
optional byte cap. The runtime supplies the instance inbox. An optional
`AttachmentSource.open(signal)` callback supplies an authenticated response to
the shared streaming writer without exposing an authenticated URL.

The shared 100 MiB default cap and sanitized per-message storage apply. Failed,
missing, disabled, or oversized resources remain visible as unavailable
attachments; partial files are removed. Text/media retain the event's chat,
sender, and message attribution. Other Feishu message types are explicitly
rejected with a warning. Outbound file capabilities and ADR-0030 credential
storage do not change. The proposal is settled when the integration owner
accepts the additive adapter/storage API.

## Consequences

Media-only messages can reach the existing session route as readable local
paths, and failures no longer disappear silently. Resource bytes are streamed
rather than buffered in memory. Stored media uses the existing inbox lifecycle;
this decision introduces no second database or retention mechanism. An adapter
consumer that omits storage receives an explicit unavailable attachment.

## Alternatives

- Forward the resource key as a URL. Rejected: it is not a downloadable URL.
- Buffer the entire resource and base64-encode it. Rejected: it duplicates a
potentially large allocation before the existing streaming writer.
- Silently discard non-text events. Rejected: it leaves the original gap.

## Links

- [Feishu event handling](../../packages/channels/src/feishu.ts)
- [Attachment storage](../../packages/channels/src/attachments.ts)
- [Behavioral regressions](../../packages/channels/test/feishu.test.ts)
