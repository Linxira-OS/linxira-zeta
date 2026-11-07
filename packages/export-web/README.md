# @linxiraos/export-web

Standalone React viewer assets used by the HTML session export and the trace view. The
build produces one content-addressed bundle that `coding-agent` inlines into exported
HTML, so an exported file opens offline with tool cards and traces intact.

This package is not a hosted app and has no browser entry point of its own.

## Build

```sh
bun run gen:export-viewer          # verify the committed viewer asset
bun run gen:export-viewer --write  # regenerate it after changing the viewer
```

The generator writes `packages/coding-agent/src/export/html/viewer.generated.ts` and the
metadata in `packages/coding-agent/export-assets/`.

## Layout

- `src/tool-render/` — tool-call cards.
- `src/trace-render/` — session trace timeline.
- `src/components/transcript/Markdown.tsx` — Markdown rendering shared by tool cards.
- `src/export-standalone.ts` — bundle entry.

## Tests

```sh
bun test
bun run check
```
