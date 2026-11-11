# 0002. Four data-store boundaries: Zeta state and three external stores

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner for the boundary model; LKB owners for the external contract
- **Links:** [Team database today](../../docs/team.md), [architecture layers](../architecture-layers.md)

## Context

Zeta already keeps operational state locally: the Team database at
`~/.zeta/data/zeta.db` is documented in [docs/team.md](../../docs/team.md) with
its own schema version, and sessions, teams, rooms, agents, mesh inboxes, and
plugin stores are Zeta-owned runtime state.

Separately, users and organizations bring knowledge bases and databases that
Zeta does not own:

- an LKB **personal standardized instance**, owned by the user;
- an LKB **enterprise instance**, owned by the organization;
- any **other external database** a user chooses to connect (BYO).

The failure this ADR prevents is ownership confusion: Zeta treating an external
store as its own schema, running migrations or storage for it, or presenting an
organization's database as "Zeta's enterprise database". The LKB integration
contract and internals belong to LKB; this ADR only fixes Zeta's side of the
boundary and does not define LKB schema, storage, authz, or audit behavior.

## Decision

Recognize four boundaries. They are distinct stores with distinct owners, not
four modes of one Zeta database.

1. **Zeta local operational DB — Zeta-owned.** Holds only Zeta runtime state
   (sessions, teams, rooms, agent registry, mesh inboxes, plugin state). Zeta owns
   its schema, migrations, and storage. It is never the user's business database,
   and external business data is not copied into it as an authoritative store.
2. **LKB personal standardized instance — user-owned.** The LKB repository owns
   schema, storage, authorization, and audit. Zeta connects as a client, assists
   with maintenance, and retrieves context. Zeta does not own or migrate the
   schema and does not keep a second authoritative copy.
3. **LKB enterprise instance — organization-owned.** The organization owns the
   instance and its access policy; the external repository that ships the
   enterprise component owns its schema and storage. Zeta acts as a user or
   organization member and has no schema ownership, migration, or storage
   responsibility. Admin-level operations happen only with an explicit grant
   from the organization; the default is least privilege. Zeta is not the
   enterprise database owner or operator.
4. **Any user's own external DB — BYO, user-owned.** The user supplies the
   connection and credentials. Zeta connects within the granted scope. The user
   owns the schema and data; Zeta does not migrate or store it as its own.

Cross-boundary rules:

- Each external store is the source of truth for its data. Any Zeta cache is
  transient, marked with provenance, and never dual-written as authority.
- The LKB cross-repository integration contract belongs to LKB. Zeta implements a
  client/member against the published contract and does not invent internals or
  claim administrative ownership.
- Credentials are per boundary. Operational DB credentials are never reused for
  an external store, and admin grants are explicit and auditable.
- The agent operational DB stays separate from every user or organization
  business database; a connector may read/write externally only through its
  granted scope.

### Open points

This ADR is **Proposed** because the following are not settled in this repository:

- the LKB connection contract and version Zeta targets;
- how the personal standardized instance is deployed and discovered;
- the enterprise grant flow (who grants admin, how it is audited, how it is revoked);
- read/write scope and offline/cache behavior per connector;
- whether any existing local business data needs a migration path, and who owns it.

It becomes **Accepted** when LKB publishes the contract and Zeta has a reviewed
adapter boundary plus a security review of credential handling.

## Consequences

- Zeta can integrate external knowledge bases without claiming schema ownership
  or becoming an enterprise database vendor.
- Connectors need explicit capability and permission models; "just open the
  database file" is not a supported integration.
- Operational data and business data have separate backup, migration, and audit
  stories, which avoids silently taking responsibility for user data.
- Until the open points close, product surfaces must describe external stores as
  user- or organization-owned and keep the feature behind an explicit connection.

## Alternatives

- **One Zeta-owned database for everything.** Rejected: it takes ownership of
  data Zeta does not own and collapses the authz/audit boundaries.
- **Zeta hosts and operates the enterprise database.** Rejected as out of scope:
  the organization owns that instance.
- **Share a SQLite file directly with an external system.** Rejected: it bypasses
  the owner's authorization and audit layer.
- **Treat a read-only mirror as the source of truth.** Rejected: mirrors may be
  caches, but they cannot become the authority.
- **Call LKB "Zeta's enterprise database".** Rejected: wrong ownership; LKB is an
  external system with its own contract.

## Links

- [Team database today](../../docs/team.md)
- [Architecture layers](../architecture-layers.md)
- [0003](0003-team-core-vs-pi-messenger.md) — an example of keeping two stores separate
- LKB repository contract: external to this repository; no URL is recorded here yet.
