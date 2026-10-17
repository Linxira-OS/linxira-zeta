# LSP configuration in ZETA

This guide explains how to configure language servers for the ZETA coding agent.

Source of truth in code:

- Server config type: `packages/coding-agent/src/lsp/types.ts` (`ServerConfig`)
- Config loader: `packages/coding-agent/src/lsp/config.ts`
- Built-in server definitions: `lsp/servers.json` (canonical; generated into
  `packages/coding-agent/src/lsp/servers.generated.ts` and
  `termide/crates/config/src/lsp_servers_generated.rs`)

## Auto-detection

ZETA starts from the built-in server definitions, applies config overrides, then keeps enabled servers that meet both conditions:

1. The project directory contains at least one of the server's `rootMarkers`.
2. At least one command in the server's candidate chain is available — checked in
   project-local bin directories first (e.g., `node_modules/.bin/`,
   `.venv/bin/`), then `$PATH`. Without a `candidates` list, `command` is the
   only candidate.

No configuration is required for common setups. The built-in server list covers most popular languages; see [`lsp/servers.json`](../lsp/servers.json) for the full set.

## Config file locations

ZETA merges LSP config from multiple sources, lowest to highest precedence:

| Precedence | Location                                                                                                     |
| ---------: | ------------------------------------------------------------------------------------------------------------ |
|     Lowest | `~/.zeta/lsp.json` (shared user override, also read by termide)                                              |
|            | `~/lsp.json`, `~/.lsp.json`, `~/lsp.yaml`, `~/.lsp.yaml`, `~/lsp.yml`, `~/.lsp.yml`                          |
|            | Plugin LSP configs (marketplace / `--plugin-dir` roots)                                                      |
|            | User config dirs: active native agent directory, then `~/.claude/lsp.*`, `~/.codex/lsp.*`, `~/.gemini/lsp.*` |
|            | Cwd config dirs: `<cwd>/.zeta/lsp.*`, `<cwd>/.claude/lsp.*`, `<cwd>/.codex/lsp.*`, `<cwd>/.gemini/lsp.*`      |
|    Highest | Cwd root: `<cwd>/lsp.*` and `<cwd>/.lsp.*`                                                                   |

Within each config-directory row, directories are listed highest to lowest priority. Each location accepts `.json`, `.yaml`, and `.yml`, including hidden variants. When multiple variants coexist in one location, precedence from highest to lowest is `lsp.json`, `.lsp.json`, `lsp.yaml`, `.lsp.yaml`, `lsp.yml`, `.lsp.yml`. All readable variants are merged; this is not a first-file-only search.

`~/.zeta/lsp.json` is shared with termide: it uses the same `servers` schema and
keys servers by name, and termide expands a server key to the language ids that
entry serves (it also accepts its own language ids there). Precedence inside
termide is `lsp/servers.json` < `~/.zeta/lsp.json` < `[lsp.servers.<lang>]` in
`config.toml`.

Merging is shallow per server: a higher-precedence server object overrides only its top-level fields, but object-valued fields such as `settings`, `initOptions`, `capabilities`, and `workspaceReadyTimings` replace the lower value as a whole rather than deep-merging it. Servers absent from override files remain at built-in defaults.

The native user config directory follows `PI_CONFIG_DIR` and active profiles; `~/.zeta/agent/lsp.json` is the default-profile spelling. This shared config lookup does not use `ZETA_CODING_AGENT_DIR` as an arbitrary replacement base. Claude's user directory honors `CLAUDE_CONFIG_DIR`. Foreign user sources (Claude, Codex, Gemini) are opt-in through the enabled-provider configuration; setting `CLAUDE_CONFIG_DIR` also opts Claude in unless explicitly disabled. Project and cwd sources do not walk ancestors and are not subject to that user-source opt-in.

**Recommended locations:**

- User-wide preferences → active native agent directory's `lsp.json`
- Project-specific overrides → `<cwd>/.zeta/lsp.json`

> **Note:** There is no separate configured-server mode: built-in defaults, partial overrides, and new custom servers all pass through the same root-marker/binary/`disabled` filter. A config that only sets `idleTimeoutMs` leaves server selection unchanged.

Config is cached per cwd. After changing LSP files, root markers, or installed binaries, call the `lsp` tool with `action: "reload", file: "*"` (or omit `file`) to reread config and shut down clients whose configuration is no longer current.

## File shape

Both JSON and YAML are accepted. The top-level object can use either a `servers` wrapper key or a flat map directly:

```json
{
  "servers": {
    "server-name": { ... }
  },
  "idleTimeoutMs": 300000
}
```

or (flat, without the `servers` wrapper):

```json
{
  "server-name": { ... },
  "idleTimeoutMs": 300000
}
```

Top-level keys:

- `servers` — map of server name to `ServerConfig` (optional wrapper; flat form is equivalent)
- `idleTimeoutMs` — shut down idle language servers after this many milliseconds; omitted, zero, and negative values leave idle shutdown disabled

Do not mix wrapped and flat server entries: when `servers` is an object, sibling keys other than `idleTimeoutMs` are not treated as servers.

## ServerConfig fields

| Field                   | Type       | Required for a new server | Description                                                                                              |
| ----------------------- | ---------- | ------------------------: | -------------------------------------------------------------------------------------------------------- |
| `command`               | `string`   |                       yes | Binary name (resolved through local bins / PATH) or absolute path                                        |
| `args`                  | `string[]` |                        no | Arguments passed to the binary                                                                           |
| `candidates`            | `object[]` |                        no | Ordered `{ command, args? }` alternatives; the first one that resolves is used (see [Candidate chains](#candidate-chains)) |
| `fileTypes`             | `string[]` |                       yes | Extensions or basenames, for example `[".ts", ".tsx", "Dockerfile"]`; case-insensitive, with or without a leading dot |
| `languageId`            | `string`   |                        no | LSP language id sent in `textDocument/didOpen`; inferred from the file path when omitted                 |
| `rootMarkers`           | `string[]` |                       yes | Files/directories indicating a project root; one-level wildcard patterns such as `*.cabal` are supported |
| `initOptions`           | `object`   |                        no | Sent as `initializationOptions` during the LSP handshake                                                 |
| `settings`              | `object`   |                        no | Pushed via `workspace/didChangeConfiguration`                                                            |
| `disabled`              | `boolean`  |                        no | Set `true` to disable this server                                                                        |
| `warmupTimeoutMs`       | `number`   |                        no | Warmup initialize timeout in milliseconds (default 5000; built-in marksman uses 2000) |
| `isLinter`              | `boolean`  |                        no | Marks a dedicated linter/formatter server: excluded from type-intelligence, but preferred over type-checkers when choosing the `formatOnWrite` formatter |
| `capabilities`          | `object`   |                        no | Opt-in server-specific features; see [Capabilities](#capabilities)                                       |
| `workspaceReadyTimings` | `object`   |                        no | Advanced rust-analyzer workspace-readiness timing overrides; see below                                   |

The required fields may be omitted from an override of a built-in server because they are inherited before validation. A genuinely new server normally needs all three. `resolvedCommand` and `createClient` are runtime-owned fields and must not be configured.

### Candidate chains

A server may list several implementations, in preference order:

```json
{
  "servers": {
    "typescript": {
      "command": "tsgo",
      "args": ["--lsp", "--stdio"],
      "candidates": [
        { "command": "tsgo", "args": ["--lsp", "--stdio"] },
        { "command": "typescript-language-server", "args": ["--stdio"] },
        { "command": "tsc", "args": ["--lsp", "--stdio"] }
      ]
    }
  }
}
```

Selection walks the list and takes the first command that resolves (local bin
directories, then `$PATH`); the status action reports the chosen command. If
none resolves, the server is not started and the reason names every command that
was tried. Setting `command` in an override without `candidates` replaces the
builtin chain, so an explicitly configured command is not shadowed by an
installed first alternative.

The builtin TypeScript family uses `tsgo --lsp --stdio` first (TypeScript 7's
native server), then `typescript-language-server --stdio`, then
`tsc --lsp --stdio`. The Python entry uses `ty server`, then `pyrefly lsp`, then
`pylsp`.

For plugin-compatible definitions, `initializationOptions` is accepted when `initOptions` is not an object. `extensionToLanguage` can supply `fileTypes` from its keys and defaults missing `rootMarkers` to `["."]`; its values do not set per-extension language IDs. Marketplace entries can provide an inline `lspServers` map or a config-file path contained within the plugin root.

### Capabilities

The `capabilities` object enables optional server-specific features that ZETA supports on a per-server basis:

```json
{
  "capabilities": {
    "flycheck": true,
    "ssr": true,
    "expandMacro": true,
    "runnables": true,
    "relatedTests": true
  }
}
```

All fields are boolean and optional. They are currently used by `rust-analyzer`.

### Advanced rust-analyzer readiness timings

`workspaceReadyTimings` tunes rust-analyzer's workspace-ready polling:

```json
{
  "servers": {
    "rust-analyzer": {
      "workspaceReadyTimings": {
        "timeoutMs": 30000,
        "pollMs": 250,
        "settleMs": 2000,
        "statusRequestTimeoutMs": 2000
      }
    }
  }
}
```

All four fields are optional millisecond values. Defaults are `timeoutMs: 5000`, `pollMs: 100`, `settleMs: 2000`, and `statusRequestTimeoutMs: 1000`. This is an advanced tuning surface; normal configurations should use the defaults.

## Common recipes

### Override a built-in server's settings

Partial overrides are merged onto the built-in defaults. You only need to specify the fields you want to change.

```json
{
  "servers": {
    "typescript-language-server": {
      "args": ["--stdio", "--log-level", "4"]
    }
  }
}
```

```yaml
servers:
  gopls:
    settings:
      gopls:
        gofumpt: false
        staticcheck: false
```

### Disable a built-in server

```json
{
  "servers": {
    "eslint": {
      "disabled": true
    }
  }
}
```

### Register a custom server

New native-format servers require non-empty `command`, `fileTypes`, and `rootMarkers`. Invalid new definitions are ignored with a warning; invalid overrides retain the previous server definition. An unreadable file or invalid JSON/YAML is ignored; the loader continues with the remaining sources.

```json
{
  "servers": {
    "my-lsp": {
      "command": "my-lsp-server",
      "args": ["--stdio"],
      "fileTypes": [".xyz"],
      "rootMarkers": [".xyz-project", ".git"]
    }
  }
}
```

### Set a global idle timeout

Shut down language servers that have been inactive for more than five minutes:

```json
{
  "idleTimeoutMs": 300000
}
```

### Disable a server for one project, keep it globally

Place the override in `<project>/.zeta/lsp.json`:

```json
{
  "servers": {
    "pylsp": {
      "disabled": true
    }
  }
}
```

The user-level config in `~/.zeta/agent/lsp.json` is unaffected; pylsp is only suppressed in this project.

## Built-in server list

The following servers ship in `lsp/servers.json` and are eligible for auto-detection:

| Server key                    | Language(s)                   | Binary                            |
| ----------------------------- | ----------------------------- | --------------------------------- |
| `rust-analyzer`               | Rust                          | `rust-analyzer`                   |
| `clangd`                      | C, C++, ObjC, CUDA            | `clangd`                          |
| `zls`                         | Zig                           | `zls`                             |
| `gopls`                       | Go                            | `gopls`                           |
| `typescript`                  | TypeScript, JavaScript        | `tsgo --lsp --stdio`, else `typescript-language-server --stdio`, else `tsc --lsp --stdio` |
| `denols`                      | TypeScript, JavaScript (Deno) | `deno`                            |
| `biome`                       | TS/JS/JSON/CSS (linter)       | `biome`                           |
| `eslint`                      | TS/JS/Vue/Svelte (linter)     | `vscode-eslint-language-server`   |
| `vscode-html-language-server` | HTML                          | `vscode-html-language-server`     |
| `vscode-css-language-server`  | CSS, SCSS, Less               | `vscode-css-language-server`      |
| `vscode-json-language-server` | JSON                          | `vscode-json-language-server`     |
| `tailwindcss`                 | HTML, CSS, TS/JS              | `tailwindcss-language-server`     |
| `svelte`                      | Svelte                        | `svelteserver`                    |
| `vue-language-server`         | Vue                           | `vue-language-server`             |
| `astro`                       | Astro                         | `astro-ls`                        |
| `pyright`                     | Python                        | `pyright-langserver`              |
| `basedpyright`                | Python                        | `basedpyright-langserver`         |
| `pylsp`                       | Python                        | `pylsp`                           |
| `ty`                          | Python                        | `ty`                              |
| `ruff`                        | Python (linter)               | `ruff`                            |
| `jdtls`                       | Java                          | `jdtls`                           |
| `kotlin-lsp`                  | Kotlin                        | `kotlin-lsp`                      |
| `metals`                      | Scala                         | `metals`                          |
| `hls`                         | Haskell                       | `haskell-language-server-wrapper` |
| `ocamllsp`                    | OCaml                         | `ocamllsp`                        |
| `elixirls`                    | Elixir                        | `elixir-ls`                       |
| `expert`                      | Elixir                        | `expert`                          |
| `erlangls`                    | Erlang                        | `erlang_ls`                       |
| `gleam`                       | Gleam                         | `gleam`                           |
| `solargraph`                  | Ruby                          | `solargraph`                      |
| `ruby-lsp`                    | Ruby                          | `ruby-lsp`                        |
| `rubocop`                     | Ruby (linter)                 | `rubocop`                         |
| `bashls`                      | Bash, Zsh                     | `bash-language-server`            |
| `lua-language-server`         | Lua                           | `lua-language-server`             |
| `intelephense`                | PHP                           | `intelephense`                    |
| `phpactor`                    | PHP                           | `phpactor`                        |
| `omnisharp`                   | C#                            | `omnisharp`                       |
| `yamlls`                      | YAML                          | `yaml-language-server`            |
| `terraformls`                 | Terraform                     | `terraform-ls`                    |
| `dockerls`                    | Dockerfile                    | `docker-langserver`               |
| `helm-ls`                     | Helm                          | `helm_ls`                         |
| `nixd`                        | Nix                           | `nixd`                            |
| `nil`                         | Nix                           | `nil`                             |
| `ols`                         | Odin                          | `ols`                             |
| `dartls`                      | Dart                          | `dart`                            |
| `marksman`                    | Markdown                      | `marksman`                        |
| `texlab`                      | LaTeX                         | `texlab`                          |
| `graphql`                     | GraphQL                       | `graphql-lsp`                     |
| `prismals`                    | Prisma                        | `prisma-language-server`          |
| `vimls`                       | Vim script                    | `vim-language-server`             |
| `emmet-language-server`       | HTML, CSS, JSX                | `emmet-language-server`           |
| `sourcekit-lsp`               | Swift                         | `sourcekit-lsp`                   |
| `swiftlint`                   | Swift (linter)                | `swiftlint`                       |
| `tlaplus`                     | TLA+                          | `tlapm_lsp`                       |

The TypeScript entry is one server with a candidate chain, so exactly one TypeScript server runs per project: `tsgo --lsp --stdio` when installed, otherwise `typescript-language-server --stdio`, otherwise `tsc --lsp --stdio`. `tsc --lsp` is only reached when neither of the other two is installed, so an older `tsc` that rejects the flag is never preferred over a working wrapper.
