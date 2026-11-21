# Zeta Web — Build & Test Notes

`web-ui/` is the Zeta Web package (`@linxiraos/zeta-web`). It keeps its own
package manager state: dependencies install from its own `package-lock.json`,
and it must NOT be added to the repository root Bun workspace or have its
lockfiles refreshed from root commands.

Requires Node.js >= 22.19.0 (see `engines` in `package.json`).

## Install

```bash
cd web-ui
npm ci
```

## Develop

```bash
npm run dev      # dev server on http://127.0.0.1:30141
```

Do not run `next build` / `npm run build` during development: it writes to
`.next/` and breaks a running dev server. Builds belong to release work.

## Checks

```bash
node_modules/.bin/tsc --noEmit   # typecheck
npm run lint                     # eslint
npm test                         # node --test suite (components/ + lib/)
```

All three must pass before merging any change.

## Build

```bash
npm run build
```

The desktop shell embeds this build via
`desktop/scripts/prepare-runtime.mjs` (`NEXT_OUTPUT_STANDALONE=1`); never copy
a stale `.next/` output into the desktop bundle by hand.
