# 0026. Session-scoped agent-authored plugins and a versioned page host

- **Status:** Proposed
- **Date:** 2026-11-12
- **Deciders:** Zeta maintainers (REQ-055)
- **Links:** [agent-authored-plugins design](../agent-authored-plugins.md),
  [plugins runtime docs](../../docs/plugins.md),
  [writing a plugin](../../docs/writing-a-plugin.md),
  [page bridge implementation](../../web-app/src/studio/plugins/bridge.ts)

> Draft ID: integration assigns the final sequential ADR number and index row.
> This file deliberately is not linked from `document/adr/README.md` until then.

## Context

Zeta loads plugins from installed packages and `settings.extensions`; both are
user-installed state and are fixed at session start. An agent that wants to
extend its session (a small read-only tool, a command, a page for its own
data) currently has only two bad options: write product source, or mutate the
user's global plugin configuration. Neither is acceptable: the first bypasses
review, the second persists an agent decision as user intent.

Pages have the same gap from the other direction. The gateway serves plugin
packages and the Studio renderer embeds plugin HTML in an iframe, but there is
no versioned host contract. A page that wants context, a notification, or a
tool result either guesses at `fetch('/api/*')` (read-only data) or needs its own
HTTP server, which the product forbids.

The product invariants that constrain the answer:

- YOLO is the default approval mode. No plugin layer may add a second approval
  mode, a sandbox claim, or a ban list.
- User-visible configuration is Zeta-owned; agent-created state must not write
  repository source or global settings.
- Foreign project sources need explicit user consent. That consent service is
  owned by the REQ-054 work; this feature must consume it, not duplicate it.
- Tool exposure is profile- and session-scoped. A newly loaded tool cannot
  widen its own session's allowlist.
- The TUI has no arbitrary layout surface. TSP slots/pages/actions are the
  extension points; this ADR does not add a second renderer.

`document/agent-authored-plugins.md` established the desired lifecycle and the
two page layers. This ADR records the implementation boundary that the code now
enforces.

## Decision

### Development plugins

1. A dev plugin lives only under
   `<agentDir>/plugins-dev/<session-id>/<name>/`. Path segments are validated;
   every read and write resolves inside that session root after `realpath`, and
   a name, manifest entry, or relative import that escapes through a junction or
   symlink is rejected. Links are unlinked, never followed, during removal.
2. The `plugin_manager` tool exposes `scaffold`, `validate`, `load_dev`,
   `reload`, `list_dev`, and `discard`. It does not expose `promote` or
   `export`. Dev actions require an interactive main session; print, RPC,
   headless, and subagent sessions refuse. A dev package must declare at least
   one `extensions` entry; `tools`/`hooks` are installed-plugin providers and
   are rejected by validation instead of being silently ignored by `load_dev`.
3. `load_dev` imports the extension entry, binds it with the live session's
   `ExtensionRuntime`, and appends it through the existing `ExtensionRunner`.
   The SDK's late-tool subscriber therefore registers/activates the tools under
   the profile admission policy exactly like a startup extension. The
   lifecycle does not maintain a second tool registry.
4. Reload imports and validates the replacement before removing the previous
   extension's runner registration and tools. A failure leaves the previous
   registrations live. Removal drops the old object from load order and the
   suspended set, so repeated reloads do not accumulate suspended extensions.
   A runtime-owned `turn_end` hook compares a bounded content fingerprint and
   reloads changed plugins; a `session_shutdown` hook expires old session
   directories.
5. Dev plugins may not shadow a tool that another extension or the runtime
   already registered. Removal cannot restore an overwritten built-in, so the
   collision is refused before anything joins.
6. Promotion and export are user CLI actions (`zetacode plugin promote|export`).
   Promotion validates, copies through a staging directory, and lands in
   `~/.zeta/agent/plugins/<name>` — the dropped-in root a later session reads —
   and reports that a restart is required. The tool surface has no path to it.
7. Declared dev pages are validated statically but the page host lists only
   installed/promoted packages. Dev pages are promotion-preview only; REQ-055
   does not add a live dev-page/TSP contract.

### Page host

1. A plugin page is declared by `plugin.json` `ui.panels` with `kind: "html"`
   and a package-relative `entry`. The gateway `GET /api/plugin-pages` lists
   only declared pages; `GET /api/plugin-assets/<plugin>/<path>` serves the
   package file with containment and an extension allowlist. Asset URLs carry
   `?cwd=<project>` so an iframe navigation can resolve project-scoped plugin
   roots without the Studio header.
2. The Studio renderer mounts `/plugins/view/<plugin>/<entry>` in a sandboxed
   same-origin iframe. A page gets no Node, no arbitrary HTTP server, and no
   second renderer.
3. The page-facing API is injected as `window.__zetaPage`, protocol v1
   (`__zetaPage: 1`, `v: 1`), with `ready`, `callTool`, `getContext`,
   `subscribe`, `notify`, and `resize`; the host answers `init`, `context`,
   `result`, and `error`. The host validates `event.source`, `event.origin`,
   version, request id, and every payload before acting.
4. `callTool` takes a tool name and arguments, and fails closed unless the tool
   is active in the selected live session, is registered by the page's own
   plugin (realpath containment of its provenance), and passes the same
   profile/disabled-tool checks as any other tool. It executes through the
   existing tool wrapper, so approval and `tool_call` semantics are unchanged.
5. HTTP `/api/*` remains the read-only data plane. Writes go through
   `callTool`.

The internal injected global uses the `__zeta*` brand rule. The design sketch's
`window.zeta` name is not shipped; `document/agent-authored-plugins.md` §4 is
the intent, this ADR and the runtime docs are the shipped spelling.

## Consequences

- An agent can extend its own session without repository or global-settings
  writes, and the user can promote the result deliberately. Nothing an agent
  creates is persisted as user intent.
- Dev plugins add no new approval model. They inherit YOLO and the session's
  existing tool policy; the security boundary is path containment plus the
  admission service, not a claimed sandbox.
- Reload is module re-import into the same process. Stateful module globals do
  not survive a reload; a broken edit keeps the old module live, which is the
  intended fail-safe.
- Page capability is deliberately small. A page that needs rich routing, a
  database, or an independent process is not supported; it must use a tool and
  the host's data plane.
- Promotion copies the tree as authored, including any `node_modules`. The
  user is responsible for dependencies; promotion does not run a package
  manager.
- Cleanup is age-based and best effort. A session directory another process
  owns stays for a later pass.

## Alternatives

- **Write product source / mutate `settings.extensions`.** Rejected: bypasses
  review and persists an agent choice as user state.
- **Per-plugin approval or sandbox.** Rejected: violates YOLO default and would
  claim an isolation boundary the process cannot provide.
- **A separate dev plugin registry or tool registry.** Rejected: splits
  activation and admission from the session's real registries, so newly loaded
  tools could bypass the profile allowlist.
- **HTTP JSON-RPC for pages.** Rejected: a page would need an endpoint and
  origin model; postMessage through the host keeps one renderer and one auth
  boundary.
- **Auto-discover every `.html` in the package.** Deferred/rejected for the
  product host: the manifest declares intent and the host can validate
  containment. The frozen `web-ui` scan remains a snapshot, not a second
  product path.

## Open points

- The final sequential ADR ID and index row are assigned at integration.
- The page bridge's `subscribe` currently accepts only a host-projected event
  scope; a future plugin-declared read-only event projection needs its own
  contract and is not implied by this ADR.

## Links

- [document/agent-authored-plugins.md](../agent-authored-plugins.md)
- [docs/plugins.md](../../docs/plugins.md)
- [docs/writing-a-plugin.md](../../docs/writing-a-plugin.md)
- [document/plugin-system.md](../plugin-system.md)
