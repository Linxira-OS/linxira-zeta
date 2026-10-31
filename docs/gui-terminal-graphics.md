# Terminal graphics in the desktop app

A program running in a `zetawork` terminal pane can draw an image instead of
characters. This page covers what the pane answers, what it can decode, and the
two paths a pane's bytes can take.

## Where it lives

| Piece | Location |
| --- | --- |
| Kitty subset (decode, placements, replies) | `termide/crates/panel-terminal/src/kitty.rs` |
| Reply text (DA1, XTVERSION, `CSI 14/16/18 t`) | `termide/crates/panel-terminal/src/reports.rs` |
| Device-pixel cell measurement + painting | `main/crates/zetawork-gui/src/blit.rs` |
| Pane wiring (both backends) | `main/crates/zetawork-gui/src/center.rs`, `terminal_service.rs` |
| Client side (which protocol a program picks) | `packages/tui/src/terminal-capabilities.ts` |
| Screenshot | `cargo test -p zetawork-gui --test shots kitty_image_shot -- --ignored` → `11-kitty-image.png` |

## What a pane answers

The pane replies to the capability queries a graphics client asks before it
paints. Both backends (a PTY the app spawned, and a PTY owned by `zetacode
serve`) produce the same bytes; `reports.rs` is the single source.

| Query | Reply |
| --- | --- |
| `CSI 16 t` (cell size) | `CSI 6;<cell height>;<cell width> t`, in **device pixels** |
| `CSI 14 t` (window size) | `CSI 4;<rows×h>;<cols×w> t` |
| `CSI 18 t` (text area) | `CSI 8;<rows>;<cols> t` |
| DA1 (`CSI c`) | `CSI ?1;2c` |
| XTVERSION (`CSI > q`) | `DCS >\|zetawork(<version>) ST` |

`CSI 14 t` and `CSI 16 t` stay unanswered until the renderer has measured a
cell — a program that asks too early gets no answer instead of a wrong one.

The pane also tells the child who it is: `TERM_PROGRAM=zetawork`,
`TERM_PROGRAM_VERSION=<app version>`, `COLORTERM=truecolor`, and the
outer-emulator markers the pane inherited (`WT_SESSION`, `KITTY_WINDOW_ID`,
`GHOSTTY_RESOURCES_DIR`, `WEZTERM_PANE`, `ITERM_SESSION_ID`, `VSCODE_PID`,
`ALACRITTY_WINDOW_ID`) are stripped, because a leaked marker outranks
`TERM_PROGRAM` in client detection.

## What it can draw

The kitty graphics protocol, the subset a terminal client actually emits:

- actions `a=t` (transmit), `a=T` (transmit and place), `a=p` (place), `a=d`
  (delete, with `a`/`A`/`i`/`I`/`p`/`P`), `a=q` (query);
- chunked transfers (`m=1`), up to 32 MiB per image;
- `f=100` PNG, `f=32` RGBA, `f=24` RGB; image dimensions are checked before the
  buffer is allocated;
- source crops (`x`/`y`/`w`/`h`), cell sizing (`c`/`r`), `C=1` (do not move the
  cursor), z-order (`z`; negative z paints under the glyphs), quiet levels
  (`q=0|1|2`), and the `OK`/`EINVAL`/`ENOENT`/`ENOTSUP` replies.

Placements follow the text when the pane scrolls and are cleared when the pane
switches to the alternate screen.

Not implemented: `U=1` (unicode placeholders). A client that can fall back to a
direct `a=p` placement does that instead; one that cannot stays text-only.

## The image switch

`terminal.imageMode` (设置 → 全部设置 → 外观 → Images, values `auto`, `on`,
`off`, default `auto`) decides whether a pane decodes and paints placements:

| Value | Pane behaviour |
| --- | --- |
| `auto` | Enabled. The pane renders images itself, so there is no outer emulator whose capability could be detected; the state exists for a future probe. |
| `on` | Enabled, pinned. |
| `off` | The APC is stripped from the grid but its payload is not decoded, and no placement is painted or uploaded as a texture. |

The value is read from the same `GET /api/settings` catalog 全部设置 edits —
there is no second copy in `zetawork.toml`. `center.rs` publishes the mode to
both backends each frame: the serve backend (`terminal_service.rs`) skips
`Graphics::apc` while the mode is off, and the painter skips both image passes
and drops that pane's textures. On the in-process backend the emulator still
parses the escape (it owns deletion semantics), but the GUI uploads and paints
nothing.

## The two paths

A pane attaches to the PTY `zetacode serve` owns when the gateway is reachable,
and only falls back to its own PTY otherwise. The decoding and the painting are
the GUI's in both cases: the app parses the byte stream, answers the queries,
and writes the replies back through the terminal socket as input. That is why
the same program behaves identically on both paths.

## The sidebar sideband

`zetacode` running inside a pane draws its sidebar (context gauge, todos,
subagents, MCP health, Git) as a 36-cell ANSI gutter. The TUI also publishes
that column's semantic twin out of band, once per changed frame:

```text
ESC _ zeta;sidebar; <base64(UTF-8 JSON)> ESC \
JSON = {"v":1,"node":<TSP node>}
```

An empty body means "clear the column". Both backends strip the APC from the
byte stream before it reaches the grid or the graphics store, and
`main/crates/zetawork-gui/src/sidebar_tsp.rs` draws the flattened rows with
egui over the pane's last `ZETA_SIDEBAR_COLS` (36) cells: an opaque column with
a one-pixel left edge, replacing the ANSI gutter rather than duplicating it.
A pane narrower than 36 columns keeps the ANSI gutter, and so does a body that
does not parse (anything but base64 JSON with `v: 1`) — an unknown future
version degrades to what the TUI painted instead of a blank column.

The snapshot comes from `SidebarComponent.describeSnapshot()`
(`packages/coding-agent/src/modes/components/sidebar.ts`); a third-party widget
without the optional `describe` contributes its rendered rows as plain text.
The transport lives in `packages/tui/src/tui.ts` (`NativeSnapshotSource`) and
`termide/crates/panel-terminal/src/terminal/`; `cargo test -p zetawork-gui
--test sidebar_tsp` rasterizes the column headlessly and asserts its fill, edge,
glyphs and clip.
