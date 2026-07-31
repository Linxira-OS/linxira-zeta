# Zeta

pi engine base + oh-my-pi features as pi extensions.

- `packages/zeta-extensions/` — pi extensions porting omp surface features
  (`/loop`, `/goal`, later plan/vibe, tools, TUI additions).
- `temp/` — frozen reference clones of pi / oh-my-pi / pi-web / omp-web for
  design reference only (git-ignored, never an upstream dependency).
- `docs/` — architecture decisions and porting notes.

## Layout

```
zeta/
├── packages/zeta-extensions/   pi extension package (index.ts entry)
├── scripts/                    dev tooling (extension link/install)
├── docs/                       architecture decisions
└── temp/                       frozen reference clones (git-ignored)
```

## Setup

```bash
npm install --ignore-scripts        # inside packages/zeta-extensions
npm run install:extensions          # symlink package into ~/.pi/agent/extensions/
```

Then launch pi (TUI or source run) and use `/loop` and `/goal`.

## Check

```bash
npm run check                      # tsc --noEmit in packages/zeta-extensions
```
