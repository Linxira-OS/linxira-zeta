# 0030. IM credentials use the local web.yml permission boundary

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Main agent implementation decision within authorized REQ-040; existing storage boundary retained
- **Links:** [IM runtime UI](../../docs/im-runtime-ui.md), [channels docs](../../docs/channels.md), [web-config](../../packages/coding-agent/src/config/web-config.ts), [IM gateway](../../packages/coding-agent/src/server/web-gateway/im-instances.ts), REQ-009/REQ-011/REQ-040

## Context

IM instances need bot credentials and reconnect data after restart. They currently
share the local agent web.yml with instance notes, profiles and bindings. Provider
credential storage has a different ownership and lifecycle. Masking an API
response is not encryption at rest.

## Decision

Keep IM credentials and reconnect tokens as plaintext in the local agent web.yml.
Atomic writes and migration backups use POSIX mode 0600. On Windows, access
depends on inherited directory ACLs; do not claim an exclusive per-file ACL or
encryption. Authenticated config/status responses redact credential values and
peer reconnect tokens. Status exposes configured/running facts rather than
plaintext secrets.

Anyone who can read the file, its migration backups, or a copied backup can read
the credentials. Operators should protect the agent directory and backups with
their OS access controls and rotate platform credentials after suspected
disclosure. This is documentation of the existing local-storage boundary, not a
new approval flow or an automatic migration.

Do not add application encryption with a bundled/hard-coded key. Do not
automatically move these credentials into the provider auth vault. A later
storage change requires its own explicit key-management and migration decision.

## Consequences

Local restart remains independent of a vault service or interactive unlock.
Disk readers remain trusted with credentials. Read masking limits routine
API/status disclosure but does not protect local files. Tests cover persisted
credential retention, masked reads, migration, and concurrent writes; Windows
tests must not treat POSIX mode bits as an ACL guarantee.

## Alternatives

- Application-level encryption with a bundled key. Rejected: it would look like
  protection at rest while the key ships beside the data.
- Move credentials into the provider auth vault. Rejected: it would change
  ownership and restart semantics without an approved migration.
- Hide credentials only in API responses. Rejected: that is disclosure control,
  not at-rest protection; the boundary must be documented honestly.

## Links

- [IM runtime UI](../../docs/im-runtime-ui.md)
- [Channels docs](../../docs/channels.md)
- [Web config](../../packages/coding-agent/src/config/web-config.ts)
- [IM gateway](../../packages/coding-agent/src/server/web-gateway/im-instances.ts)
