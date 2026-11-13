# Maintenance, Ownership, and Security Protocol

This is the authoritative internal protocol for deciding **where a defect belongs**,
**who owns a surface**, and **where a security report goes**. It is an internal
document under `document/`, never packaged, and never a substitute for the
runtime docs under `docs/`.

## 1. Documentation path rule

| Tree | Audience | Packaged? | What belongs there |
| --- | --- | --- | --- |
| `docs/` | Users, operators, extension authors | **Yes** — served at `zeta://docs` | New subcommands, flags, tools, config keys, internal URL surfaces, extension APIs |
| `document/` | Maintainers and contributors | **No** | Architecture, ADRs, roadmap, merge/release procedure, ownership, maintenance protocol |

A feature is not documented by a CHANGELOG entry or a code comment alone. If it
adds or changes a user-visible command, flag, tool, config key, or internal URL,
the runtime docs under `docs/` MUST be updated. If it changes how maintainers
build or ship the product, the internal record belongs under `document/`.

Examples:

- `docs/channels.md` — runtime channel behavior for users, shipped with the product.
- `docs/zeta-serve-web.md` — the `zetacode serve` surface, shipped at `zeta://docs`.
- `document/upstream-sync.md` — internal merge ledger; never packaged.
- `document/architecture-layers.md` — internal ownership/layering contract.
- `document/maintenance-ownership.md` — this protocol; internal only.

Moving content between the trees requires cleaning every cross-reference. A
released CHANGELOG entry is immutable.

## 2. Issue routing

Route by **reproduction boundary**, not by which code path happens to be nearest.
The upstream URLs named here are the only upstream issue destinations this
protocol authorizes.

| Class | Where it goes | Sync/consumption rule |
| --- | --- | --- |
| **OMP runtime/tool/model/TUI defect** that reproduces without the Zeta overlay | <https://github.com/can1357/oh-my-pi/issues> | Follow the upstream report. Zeta consumes a fix only through the next **named official release tag**; never merge upstream `main` or a branch, and never cherry-pick a partial diff. |
| **Upstream bot updates** | Upstream release notes/issues for the affected upstream project | Treat bot updates as upstream input. A fix enters Zeta only through a named official release tag; no branch merge. |
| **OMP Studio renderer/host-contract defect** that reproduces without the Zeta fork | <https://github.com/the-snowpear/omp-studio/issues> | Zeta syncs only a **named release tag**. There is no `0.2.0` branch merge: `0.2.0` is currently untagged, so a branch is not a sync source. |
| **TermIDE upstream defect** (terminal, editor, LSP, DAP) | <https://github.com/termide/termide/issues> | Zeta-specific deviations and branding stay **Zeta-owned**; see `termide/VENDOR.md`. The vendored fork is maintained here, not pushed upstream. |
| **OMP Web** | **No upstream issue**, **no sync** | Frozen. `web-ui/` is not a product surface and receives no features or fixes. Work Studio (`web-app/`) supersedes it. |
| **Pi / Pi Web** | Upstream project issue only for a clearly reproducible upstream defect | Pi and Pi Web are **semantic port sources**, never raw merge sources. Zeta-specific adaptation belongs here. |
| **External app issue** | Upstream destination only when there is a clear upstream reproduction | Zeta-specific integration, configuration, and usage differences are ours; do not ask the external project to own them. |
| **Zeta-owned defect or feature request** | This repository's issue tracker | Includes Work Studio (`web-app/`), server/Studio host (`packages/coding-agent/src/server/studio-host/`, `web-gateway/`, `studio-web-app.ts`), IM (`packages/channels/` + `packages/coding-agent/src/channels/`), CLI/TUI product behavior, `zetaide` deviations/editor payload, `desktop/`, `android/`, plugins, and docs/document. Do not route our product behavior or usage differences upstream. |
| **Security vulnerability** | **Private advisory only** — see §4 | Never a public issue or pull request. |

### 2.1 Upstream defect test

A defect is upstream-shaped only when a maintainer can reproduce it **without
Zeta's overlay** on the upstream project, or the upstream project already
acknowledges the same behavior. "It happens in a file that came from upstream"
is not enough: Zeta's wiring, branding, defaults, configuration, and usage can
turn an upstream component into a Zeta-owned behavior.

### 2.2 Release-tag discipline

OMP and OMP Studio fixes arrive as complete release-tag integrations, never as
branch merges or partial diffs. The exact candidate tag and SHA are recorded in
`document/upstream-sync.md`; release baselines live in
`document/upstream-baselines.md`. Follow those records rather than inferring
"latest" from a branch or issue thread.

## 3. Ownership

Role names below are **responsibility areas**, not GitHub usernames. Do not infer
a person from a role.

| Surface | Representative paths | Upstream origin | Owner | Routing note |
| --- | --- | --- | --- | --- |
| Core runtime, CLI, TUI | `packages/coding-agent/src/` (excluding `server/` and `channels/`), `packages/agent`, `packages/ai`, `packages/tui`, `packages/catalog`, `packages/stats`, `packages/natives`, `packages/utils`, `packages/wire` | OMP runtime tree; Zeta deltas on top | **Zeta core maintainers** | Upstream defect → OMP issue; Zeta behavior/default/identity → our issue. |
| Server, Studio host, HTTP gateway, Work Studio | `packages/coding-agent/src/server/` (`zeta-server.ts`, `studio-host/`, `web-gateway/`, `studio-web-app.ts`), `web-app/` | Work Studio renderer forked from OMP Studio; host and gateway are Zeta-owned | **Zeta server maintainers** | Renderer/host-contract defect with a clean upstream repro → OMP Studio issue; Zeta host, `/api/v1/*`, Work Studio integration, or fork behavior → our issue. |
| IM / channels | `packages/channels/`, `packages/coding-agent/src/channels/` | Zeta-originated channel runtime; no upstream owner for our transport/config behavior | **Zeta IM maintainers** | Delivery, routing, credentials, allowlists, instance isolation, and IM UI are ours. Security goes private (§4). |
| IDE / TermIDE / editor | `termide/`, `editor/`, `zetaide` branding and deviation code | TermIDE vendored fork | **Zeta IDE maintainers** | Terminal/editor/LSP/DAP upstream defect → TermIDE issue; Zeta deviations and branding remain ours; deviations are logged in `termide/VENDOR.md`. |
| Desktop, Android, paused lines | `desktop/` (paused Electron), `android/`, `main/` (paused Rust workbench, AGPL-3.0-only) | Zeta-originated | **Zeta core maintainers** | No new product work while paused; do not route paused-line behavior upstream. |
| Plugins | `plugins/official/`, `plugins/community/`, plugin host contracts | Zeta registry and first-party plugin surface; individual third-party plugins keep their own origin | **Zeta core maintainers** | First-party plugin behavior is ours; a third-party plugin's own defect goes to that project only with a clear repro. |
| Documentation | `docs/` (runtime, packaged), `document/` (internal, never packaged) | Zeta | **Zeta core maintainers** | Use the path rule in §1; do not turn internal process into user docs or vice versa. |

`web-ui/` is a frozen OMP Web snapshot. It has **no Zeta owner**, receives no
fixes, and is not a support surface.

`zetaide` and coding-agent additions made because of Zeta usage differences are
maintained by **Zeta**, not upstream. Upstream should not be asked to own our
product behavior or our usage differences.

## 4. Security channel

Never open a public issue or pull request for a vulnerability. Use the private
GitHub security advisory flow:

<https://github.com/Linxira-OS/linxira-zeta/security/advisories/new>

Include:

- affected Zeta version and platform;
- the affected command, tool, endpoint, or surface;
- a minimal reproduction or proof of concept;
- relevant logs with secrets, tokens, personal data, pairing codes, and TOTP
  secrets removed.

Do **not** put secrets, pairing codes, TOTP secrets, live tokens, or
credential-bearing screenshots into issues, logs, chat, or pull requests.

### 4.1 IM and server findings are private-first

IM and server security findings **MUST** go through the private advisory. This
includes, at minimum:

- token or credential leakage (logs, errors, URLs, telemetry, screenshots);
- webhook signature verification failures or forgery;
- allowlist or authorization bypass;
- cross-chat, cross-session, cross-instance, or cross-workspace routing;
- unauthenticated command execution;
- remote token, pairing, or TOTP bypass;
- SSRF or transport/origin exposure.

The owning roles are **Zeta server maintainers** and **Zeta IM maintainers**.
Public issue text may name the affected area only after coordinated disclosure;
it must not contain exploit detail or secrets.

### 4.2 Upstream security

If the defect is upstream, use the upstream project's **private security
channel**, not a public issue. When the issue affects Zeta, open our advisory in
parallel and coordinate with upstream. Do not disclose before coordination.

## 5. Decision tree

1. **Does it reproduce upstream without the Zeta overlay?**
   - **Yes, non-security** → upstream issue (OMP, OMP Studio, TermIDE, or the
     relevant upstream project), then consume the fix through a named release tag.
   - **Yes, security** → upstream private security channel; open our private
     advisory in parallel when Zeta is affected; no public issue.
2. **No — is it Zeta-only behavior, integration, branding, configuration, or usage?**
   - **Non-security** → our issue tracker, with the owning role from §3.
   - **Security** → our private advisory; notify the Zeta server/IM maintainers
     as applicable.
3. **Uncertain?**
   - Ask the Zeta maintainers privately first. Do not post exploit detail, a
     guessed upstream blame, or a public issue while the boundary is unresolved.

## 6. Module and path usage

Keep this table an index, not a second architecture document. The deeper
contracts are linked rather than duplicated here.

| Path | Use | Deeper reference |
| --- | --- | --- |
| `packages/coding-agent/src/server/zeta-server.ts` | Unified `Bun.serve` dispatch: `/api/stats/*` to stats, `/api/*` to the Web Gateway, Studio static/API, channel runtime, default workspace, mesh wiring. | `document/architecture-layers.md` |
| `packages/coding-agent/src/server/studio-host/ops/` | One file per Studio domain family: `session`, `operator`, `models`, `agents`, `rooms`, `team`, `dictation`, `git`, `skills`, `plugin-host`, `plan`, `workspace`, `files`, `usage`, `settings`, `runtime`. `team` composes `team-db.ts`, `team-projection.ts`, and `team-workspace.ts`; `rooms.ts` is the room family. | `document/agents/surface/code-locations.md` |
| `packages/coding-agent/src/server/studio-host/contract/` | Read models and closed operation/command contracts shared by the host and Work Studio client. | `packages/coding-agent/src/server/studio-host/contract/operations.ts` |
| `packages/coding-agent/src/server/web-gateway/` | REST/SSE/WS adapter over the host, one resource module per surface (`agents`, `sessions`, `files`, `git`, `channels`, `team`, `terminal`, `rpc-ws`, …), plus auth/origin/scope/pairing guards. | `docs/zeta-serve-web.md`, `docs/web-ui/api.md` |
| `packages/coding-agent/src/server/studio-web-app.ts` | Serves the Work Studio build at the same origin, with the renderer CSP and the no-build placeholder. | `document/agents/surface/web-app-performance.md` |
| `packages/channels/src/` | Channel adapters and shared transport pieces: Discord, Feishu, OneBot, Telegram, WeChat, socket/auth/attachments/reply correlation. | `docs/channels.md` |
| `packages/coding-agent/src/channels/` | Channel host/router/config: session and workspace routing, IM config/control, instance lock, plan approval/image, session host, status/admin views. | `docs/channels.md`, `document/architecture-layers.md` |
| `web-app/` | Work Studio renderer: sessions, panes, approvals, Agent Hub, Team/Rooms pages, settings, diagnostics. | `docs/zeta-serve-web.md`, `document/agents/surface/web-app-performance.md` |
| `termide/`, `editor/` | Vendored terminal IDE and the editor payload face. | `termide/VENDOR.md` |
| `desktop/`, `android/`, `main/` | Paused or experimental product lines; not current release surfaces. | `document/release.md` |
| `plugins/` | Official and community plugin registry; first-party plugin host contract. | `docs/plugins.md`, `document/plugin-system.md` |
| `docs/` | Packaged runtime documentation, read at `zeta://docs`. | `docs/zeta-features.md` |
| `document/` | Internal engineering and process docs, never packaged. | `document/AGENTS` index and `AGENTS.md` |

## 7. Related records

- `document/upstream-sync.md` — the authoritative merge ledger and tag/SHA history.
- `document/upstream-baselines.md` — release-tag baselines; owned by the sync/release workers.
- `document/architecture-layers.md` — core/host/front-end/HTTP dependency direction.
- `document/agents/surface/code-locations.md` — where code belongs.
- `document/agents/surface/packages.md` — package and bin inventory.
- `docs/zeta-serve-web.md` — the Work Studio runtime surface.
- `docs/channels.md` — channel runtime behavior.
- `termide/VENDOR.md` — the TermIDE fork deviation ledger.
- `.github/SECURITY.md` — the public-facing security policy.
- `CONTRIBUTING.md` — contribution and report-routing rules.
