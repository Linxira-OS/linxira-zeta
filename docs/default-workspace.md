# Default workspace

`~/.zeta/workspace` is the **default workspace**: the landing point for every
conversation that has no repository selected and for IM bot conversations
(WeChat / Feishu / Telegram). It is a real directory and, from the first
`zeta serve`, a real Git repository. `ZETA_DEFAULT_WORKSPACE` overrides the
location for non-standard installs and smoke runs against a temp config root.

## Landing rules

| Source | Landing point | Route |
| --- | --- | --- |
| No repository selected (gateway default chat — the deferred Web UI would be one client — or a new chat without a project) | default workspace | `relay` |
| IM bot chat (no `@workspace use` / binding, no channel `workspaceRoot`) | default workspace | `relay` |
| Explicit repository selection (`@workspace use <alias>`, `@workspace bind <alias>`, or the GUI project picker) | that repository | `direct` |

`@workspace use` is a runtime override for the current chat only; `@workspace
bind` persists it. `@workspace relay` / `*main` returns the chat to the
default workspace. An unknown alias is reported with the available aliases and
never guessed — the chat stays on relay.

`@status` prints the resolved landing point, `direct`/`relay`, whether the
persona is active, the workspace's memory backend (project layer), and the
relay report policy.

## In the GUI

The desktop shell (`zetawork`) lists everything as **project → workspace →
conversation**. Conversations are gateway sessions, read from
`GET /api/sessions`; a workspace owns the sessions whose `cwd` is inside its
root, and the deepest matching root wins when workspaces nest.

The default workspace is the **默认项目** pinned at the top of the left column:

- the project is system-owned — it has no `~/.zeta/projects.json` row, and it
  cannot be renamed, removed, or given a second workspace;
- its one workspace is the 默认工作区 over `~/.zeta/workspace`;
- every conversation under it is pinned above the scrolling project list and
  stays visible while that list scrolls. Pinned conversations cannot be
  archived or hidden; they open and are created like any other;
- creating a conversation there is the gateway's `ensure_session` with the
  default workspace as `cwd`, so no project has to be registered first.

The default project is seeded last in the state vector (so the launch
selection stays the shell's own directory); the column's pinned block is what
puts it first on screen.

## Initialisation

On `zeta serve` startup the default workspace is created if missing, then:

1. `git init` (skipped when `.git` already exists),
2. `.zeta/settings.json` with `{"memory": {"backend": "mnemopi"}}`,
3. the official `AGENTS.md`,
4. `PERSONA.md`,
5. one initial commit (`Initialize default workspace`) containing exactly
   those managed files.

Every step is additive. Existing files are never overwritten, a second startup
writes nothing and commits nothing, and a user-edited `AGENTS.md` survives
untouched (its edit simply stays uncommitted until the user commits it).

## Persona

`PERSONA.md` is read only for sessions whose cwd is the default workspace.
It is appended as its own system-prompt block **after** the rendered prompt,
which contains the global `personality` block — so the persona may override
the global communication style. A missing or empty file leaves the prompt
unchanged, and no other repository ever receives the block (even if that
repository has its own `PERSONA.md`).

## Memory

`memory.backend` is a layered key. The default workspace opts into `mnemopi`
through its project layer; the user layer stays `off`, so other repositories
remain `off` until they opt in themselves. Storage is keyed by the project cwd
(`memories/<encoded cwd>`), so the default workspace's lessons never appear in
another repository.

To enable memory for a single repository, edit that repository's project layer
directly — the settings panel still writes only the user layer:

```json
// <repo>/.zeta/settings.json
{ "memory": { "backend": "mnemopi" } }
```

`@status` shows `记忆: off` until that file exists. See
[Memory](./memory.md#project-scoped-memory) for the layered lookup order.
