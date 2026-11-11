# ADR-0011: Studio workspace identity and selection

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta owner (REQ-001–004 / Work Studio report A0–A4)
- **Links:** [Studio surfaces](../../docs/studio-surfaces.md), [Host workspace operations](../../packages/coding-agent/src/server/studio-host/ops/workspace.ts), [Host history operations](../../packages/coding-agent/src/server/studio-host/ops/usage.ts)

## Context

The Host marks its coordinator/default workspace as `active`. Opening another
folder records an open preference and does not change that meaning. The renderer
used this flag for its current project, so a history session and its header, Git
panel, and Explorer could describe different directories. An empty default
workspace disappeared because the public inventory required a timestamp.
History entries omitted the cwd-derived identity that the Host already knows.

## Decision

- Keep `active` and `activeWorkspaceId` as Host default/runtime facts.
- Add `defaultWorkspaceId` to the workspace inventory, independent of whether a
  visible inventory row exists. Keep undated rows with `lastOpenedAt: null`;
  unknown dates sort after known dates and are not fabricated.
- Add optional `workspaceId` and basename-only `workspaceName` to history rows
  and recent-thread projections. IDs use the existing canonical cwd hash;
  absolute cwd/session paths stay in the Host.
- Renderer project selection belongs to the viewed session or an explicit folder
  selection. Inventory refreshes update names without replacing that identity.
  Cold history navigation uses the entry's workspace, not the default workspace.
- `session.create` carries a mandatory `workspaceId`; the Host resolves that id
  through the hidden-inclusive gateway inventory to the canonical cwd and never
  falls back to the process/default cwd. Opening a folder records a preference;
  it does not claim the Host runtime moved.
- Workspace ids stay canonical cwd hashes from the real gateway rows. A basename
  is display metadata only; a cold history row with no workspace identity stays
  honestly unlabeled rather than borrowing the current project.
- Hidden folders remain resolvable for an already open session and for file/Git
  operations addressed by their opaque id; hiding is visibility metadata, not an
  ownership boundary.
- Bound-device ownership reuses the same canonical identity for both a session
  id and a real cwd; hidden rows resolve, and an unattributable resource denies.
- Git reads and branch state are scoped to the viewed workspace id; switching
  projects drops stale repository/branch/diff state instead of showing A under B.
- Recent chats resolve the project per row. Older Hosts without workspace facts
  omit the project label rather than copying the current project's name.
- Long names remain intact in data and DOM text; CSS constrains them and tooltips
  expose their full value.
- Composer dictation is hidden unless the Host advertises the channel, a complete
  local microphone transport exists, and STT is enabled/available. Unsupported
  surfaces do not poll dictation. Full audio transport is a separate change.

The integration owner lands this file and its index entry together; this draft
keeps the reserved ADR-0011 number.

## Consequences

The optional history fields are additive for older renderers/Hosts. The nullable
workspace date requires consumers to handle unknown dates. A hidden workspace
may still identify a currently viewed session without becoming visible in the
project inventory. The default workspace no longer disappears when empty.

There is one renderer selection shared by the header, sidebar, context strip,
Git/branch views, and workspace actions. Inventory ordering and the Host's runtime
cwd remain separate facts. No state migration or user-data rewrite is required.

## Alternatives

- Reinterpreting `active` as the latest click would falsely claim that the Host
  runtime moved and would change existing consumers' contract.
- Inventing an epoch date preserves a required string but misrepresents unknown
  open history.
- Truncating names on the Host loses search, copy, and accessibility information.
- Leaving a disabled microphone control suggests a usable feature where neither
  its Host operation nor its desktop audio transport is present.

## Links

- [Workspace read-model contracts](../../packages/coding-agent/src/server/studio-host/contract/read-models.ts)
- [Runtime behavior](../../docs/studio-surfaces.md)
