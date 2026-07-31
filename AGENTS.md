# Zeta Development Rules

## Project Goal

Zeta = pi engine base + oh-my-pi features as pi extensions. omp is frozen as a
"design source" (reference in `temp/`, never an upstream dependency). The pi
codebase is the runtime and extension API; zeta packages implement omp-style
features on top of the pi Extension API.

## Workspace Layout

- `packages/zeta-extensions/` — pi extensions implementing omp features (loop,
  goals, later: plan/vibe, tools, TUI additions).
- `temp/` — frozen reference clones (pi, oh-my-pi, pi-web, omp-web). Never
  tracked by git, never imported by released code. Only used for design
  reference and diffing.
- `docs/` — architecture decisions and porting notes.
- `scripts/` — dev tooling (extension install/link scripts).

## Extension Loading Model

- pi loads extensions from `~/.pi/agent/extensions/` and `.pi/extensions/`.
  Each entry is a single `.ts` file or a directory with `index.ts`.
- An extension file exports a factory: `factory(api: ExtensionAPI): ExtensionInstance`.
- `packages/zeta-extensions/index.ts` is the zeta extension entry. Symlink the
  package directory into `~/.pi/agent/extensions/` for local dev (see
  `scripts/install.ps1`).
- Type-only imports from `@earendil-works/pi-coding-agent` are erased at
  runtime; pi provides the module at load time (virtual module in binaries,
  real package in source runs).

## Code Style

- Erasable TypeScript only: no `enum`, `namespace`, parameter properties,
  `import =`/`export =`. This is required because pi executes extension
  source directly (Node type stripping / Bun).
- Top-level imports only; no inline `await import()`.
- No `any` unless necessary. No comments unless they carry porting context
  (e.g. "port of omp ...").
- Match omp's ported code structure so upstream diffs stay easy to review.

## Porting Rules

- When porting an omp feature, keep the file name and export names where
  possible so `diff temp/oh-my-pi/...` remains readable.
- Replace `@oh-my-pi/pi-*` imports with pi equivalents or local implementations.
- Never copy omp code that depends on its rewritten coding-agent core; only
  port surface features that map onto the pi extension API.

## Verification

- Run `npm run check` (tsc --noEmit) in `packages/zeta-extensions` after code
  changes. Fix all errors before committing.
- Manual smoke test: install extension link, launch pi in a tmux shell, run
  `/loop` and `/goal` commands.

## Git

- Never commit to `temp/`; it is ignored.
- Only stage explicit paths; never `git add -A` / `git add .`.
- Commit message format: `feat|fix|docs(extensions): <message>`.
- Never commit unless the user asks.

## Upstream Updates

- To refresh design reference: `git fetch` in `temp/oh-my-pi`, diff against
  the ported files, cherry-pick behavior changes into zeta manually.
- omp is never merged into zeta; pi is never vendored into zeta.
