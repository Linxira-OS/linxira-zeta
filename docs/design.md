# Design bridge (OpenDesign)

Zeta's design capability is an **opt-in workspace bridge** to a locally installed OpenDesign instance. It is not a zetawork panel, not a web UI, and not a global MCP registration.

The bridge has one model-facing tool, `design`, and one workspace switch, `.zeta/design.yml`. A workspace without the switch keeps the normal Zeta tool surface: no design tool, no OpenDesign MCP child, no `od` subprocess.

## Goals

- Let an agent use OpenDesign's project/artifact/run model from a normal Zeta session.
- Keep the common case simple: other repositories must not pay for an unused integration.
- Keep the model surface small: **one tool**, not OpenDesign's 22 raw MCP tools.
- Keep MCP as MCP and the CLI as a CLI: the bridge adapts both; it does not turn one into the other.
- Make installation and daemon state explicit instead of failing deep inside a design run.
- Leave a path for web UI and zetawork without coupling them to the TUI implementation.

## Non-goals

- Embedding OpenDesign's React UI or its artifact card.
- Registering OpenDesign's MCP server in `~/.zeta/agent/mcp.json` or any user-level config.
- Starting, installing, or upgrading OpenDesign automatically.
- Replacing OpenDesign's own daemon, agent, design systems, or export pipeline.
- Making design a prerequisite for zetawork basics or for ordinary coding sessions.
- Distributing OpenDesign's bundled design systems, plugins, or assets.

## Architecture

```text
Zeta session
  │
  ├─ .zeta/design.yml ── workspace switch (default: absent = off)
  │
  ├─ design tool ── status ── CLI/daemon/MCP probes
  │                ├─ mcp ──── stdio MCP ── OpenDesign daemon
  │                ├─ cli ──── od argv ───── OpenDesign daemon
  │                └─ open ─── OS browser ── preview URL
  │
  └─ /design ───── enable / disable / status
```

Code layout:

| File                                         | Responsibility                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/coding-agent/src/design/config.ts` | Read/write `.zeta/design.yml`, validate, fail closed                                       |
| `design/transport.ts`                        | Resolve CLI, cache one MCP connection per workspace, run argv                              |
| `design/status.ts`                           | Independent CLI/daemon/MCP probes and status levels                                        |
| `design/tool.ts`                             | The single `design` custom tool                                                            |
| `design/command.ts`                          | `/design` command                                                                          |
| `sdk.ts`                                     | Registers `design` only when the workspace marker is enabled and the tool filter allows it |

The bridge deliberately does **not** touch `mcp.enableProjectConfig`, MCP discovery, or the global tool registry's MCP path. It manages its own MCP connection.

## Workspace switch

```yaml
# <workspace>/.zeta/design.yml
enabled: true
cli:
   command: od
mcp:
   command: od
   args:
      - mcp
```

Rules:

- Missing file means disabled. Invalid YAML or invalid types fail closed and report the parse problem.
- `enabled: false` keeps the file so CLI/MCP paths can be reused when re-enabled.
- `cli.command` and `mcp.command` may be absolute paths when `od` is not on `PATH`.
- Do not put credentials in this file. OpenDesign owns daemon/auth configuration.
- There is no user-level equivalent; a global switch would contaminate unrelated repositories.

`/design enable` and `/design disable` write only this file. Disabling also closes the cached MCP child for that workspace and reconciles the current session's tools.

## Session lifecycle

1. **Session startup**: the SDK asks `isDesignEnabled(cwd)` while building settings-gated custom tools. If false, `design` is not registered.
2. **Enable**: `/design enable` writes the marker, calls `session.reconcileBuiltinTools()`, then probes status. The tool becomes available without restarting the session.
3. **First MCP call**: `design(mcp)` lazily starts `od mcp` and caches the connection by workspace.
4. **Brief state**: OpenDesign's `collect_brief` / `confirm_brief` share a draft store inside the MCP process, so the bridge keeps the connection alive instead of reconnecting per call.
5. **Disable**: the marker is disabled, the workspace's MCP connection is closed, and the tool is removed from the active set.
6. **Shutdown/switch**: cached connections are closed. A dead transport is replaced on the next call.

Status probes use an ephemeral MCP connection and disconnect it immediately; they do not populate the workspace cache.

## Model surface

| Action   | Transport    | Purpose                                                                          |
| -------- | ------------ | -------------------------------------------------------------------------------- |
| `status` | local probes | Report CLI, daemon, MCP, and the first blocking layer                            |
| `mcp`    | MCP stdio    | Projects, files, artifacts, briefs, runs, resources                              |
| `cli`    | `od` argv    | Media generation, export, brand, design systems, Figma, lint, templates, library |
| `open`   | OS browser   | Open an `http`/`https` preview URL                                               |

The tool is discoverable only in an enabled workspace and asks for `write` approval. It is not a generic shell: `cli` takes an argv array, rejects an unknown top-level command, and never interpolates a command string.

MCP is used for stateful design operations. CLI is used where OpenDesign exposes capabilities only through shell commands, especially binary export and media generation. Neither path duplicates the other's implementation; both talk to the same daemon.

## Status model

The status result separates layers instead of collapsing them into one boolean:

| Level          | Meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `disabled`     | No enabled workspace marker                                 |
| `error`        | Marker exists but cannot be parsed/validated                |
| `cli-missing`  | `cli.command` is not executable and not on `PATH`           |
| `daemon-down`  | CLI exists, but `od version --json` cannot reach the daemon |
| `mcp-degraded` | Daemon is reachable, but the MCP handshake/tool list fails  |
| `ready`        | CLI, daemon, and MCP all respond                            |

`/design status` and `design(status)` report the same state. Missing installation is reported, never auto-installed. `od doctor --json` is available as a deeper manual check, but the bridge does not run plugin/design-library audits on every status call.

## Failure behavior

- Invalid marker: tool is not registered; `/design` reports the parse error.
- Missing CLI: status stops at `cli-missing`; MCP is not attempted.
- Daemon down: status stops at `daemon-down`; MCP is skipped because tool calls would fail.
- MCP failure: status reports `mcp-degraded`; daemon-backed CLI commands may still work.
- MCP child dies: the next `mcp` action reconnects once through the cache path; tool calls do not silently retry writes.
- CLI non-zero exit: the result is returned as an error with the command and exit code, not swallowed.

## Security boundaries

- The tool requests `write` approval and runs no shell.
- `open` accepts only `http` and `https`.
- The bridge writes only `.zeta/design.yml`; OpenDesign writes its own project files.
- The marker is workspace-local and contains no secrets.
- MCP output is adapted to normal text/image/resource content; raw MCP tool schemas are not registered globally.
- Disabling does not delete design projects or files.

## Extension points

Future work should extend the bridge without widening the default surface:

1. **New action**: add a typed action to `design/tool.ts` and keep provider specifics in `transport.ts`; do not expose 22 raw MCP tools.
2. **New CLI capability**: add the top-level command to `CLI_COMMANDS` and document it in `docs/tools/design.md`; keep argv arrays.
3. **Background runs**: add progress/updates for `start_run` and `get_run`, with a TUI widget; the MCP connection cache already preserves run state on the daemon side.
4. **Preview images**: return generated PNGs as tool result images (the TUI already renders `details.images`/image content), while keeping the browser URL as the full interactive surface.
5. **Web UI**: add a gateway endpoint in `packages/coding-agent/src/server/web-gateway/` that calls the same design service. `web-ui/` and `desktop/` still access it over HTTP; they must not import `packages/*`.
6. **zetawork**: call the gateway over HTTP/SSE. Do not embed OpenDesign's React UI or link Rust against its frontend.
7. **Second backend**: introduce a provider field only when a second design engine exists; do not add an abstraction layer now.
8. **Design systems/brand**: keep them in OpenDesign's CLI/MCP until a concrete Zeta-managed workflow is needed.

## Open questions

- Whether a future `design` run should expose a long-lived background widget in the TUI or remain a polling action.
- Whether preview thumbnails should be generated by OpenDesign's export path or captured by the browser.
- Whether zetawork needs a design panel before the web UI does.
- Which bundled OpenDesign assets, if any, Zeta may redistribute; this requires a separate license/provenance audit.

## Related docs

- [design tool](./tools/design.md): exact model-facing actions and CLI allowlist.
- [settings](./settings.md): why this is not a settings-registry key.
- [MCP configuration](./mcp-config.md): why the bridge does not write `.zeta/mcp.json`.
- The internal `document/roadmap.md` tracks remaining zetawork and web UI work.
