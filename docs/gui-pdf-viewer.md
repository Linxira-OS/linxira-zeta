# GUI PDF page

The desktop app (`zetawork`) can display a PDF inside a pane. The terminal app
(`zetawork`'s TUI, `main/crates/zeta-main`) never renders a PDF; this page is
the only PDF surface in the product.

## Where it lives

| Piece | Location |
| --- | --- |
| Page implementation | `main/crates/zetawork-gui/src/pdf.rs` |
| Page kind | `state::SessionKind::Pdf` (a centre-pane session tab) |
| Open path | `AppState::open_file` → `AppState::open_pdf` when the path ends in `.pdf` (case-insensitive) |
| Document/texture cache | `pdf::PdfCache`, keyed by session-tab id, pruned when the tab closes (`Shell::tick`) |
| Screenshot | `cargo test -p zetawork-gui --test shots pdf_viewer -- --ignored --nocapture` → `16-pdf-viewer.png` |
| Fixture | `main/crates/zetawork-gui/tests/fixtures/two-pages.pdf` (1.9 KB, two A4 pages, text + vector fills) |

A `.pdf` clicked in the right column's file tree reaches the same dispatch as
any other file: `right.rs` hands the path to `AppState::open_file`, which routes
to the PDF page. Re-opening the same path activates the existing tab instead of
opening a second copy. It is a **centre pane page** rather than a right-column
tab because a 324 px sidebar cannot show a page at a readable zoom, and because
the editor page already established the "file from the tree opens a page in the
grid" flow — the PDF page joins that flow instead of inventing a second one.

## Renderer

The renderer is [`hayro`](https://crates.io/crates/hayro) 0.8, a pure-Rust PDF
rasterizer (Apache-2.0 OR MIT, `#![forbid(unsafe_code)]`).

Why it fits the CI: nothing is compiled from C or C++, no system PDF library is
loaded at run time, and no dynamic library is shipped beside the binary. It
builds with the pinned toolchain (1.97.1; hayro's own MSRV is 1.92) on the
ubuntu-22.04 runner with no extra `apt` package — unlike pdfium or MuPDF, which
would add a C/C++ build and a per-platform binary to the installer. The
workspace already had no web-view dependency usable for documents: the 用量
panel's WebView2 child is a Windows-only COM component, so it is not a portable
option.

Pipeline: `hayro::render` paints one page into a `vello_cpu::Pixmap`; the pixmap
is converted to premultiplied RGBA and uploaded once as an `egui` texture. The
texture is cached per (page, zoom, display pixel density), so scrolling and
hovering never re-rasterize. One raster is capped at 4 Mpx (`pdf::MAX_PIXELS`) —
a large sheet at maximum zoom cannot allocate unbounded memory; beyond the cap
the raster resolution drops while the on-screen size stays at the requested
zoom.

## Controls

- Previous / next page with the page counter (`3 / 12`).
- Zoom out / in (`－` / `＋`, 50 %–300 %) and **适应宽度** (fit width).
- **重新读取** re-reads the file from disk, keeping the page and zoom.
- Vertical and horizontal scrolling (scroll area, scrollbars).
- The footer shows the page size in points, the last raster's wall time, the
  zoom, and the renderer's name.

## Empty and error states

| State | What the page shows |
| --- | --- |
| A PDF tab without a path | 这个标签页没有打开 PDF |
| File missing / unreadable | 打不开 PDF：&lt;path&gt;: &lt;OS error&gt; |
| File present but malformed | 不是有效的 PDF（&lt;parse error&gt;）：&lt;path&gt; |
| Document parses, page fails to raster | 这一页渲染失败 |
| No pages at all | 这一页没有可渲染的内容 |

The parse error is recorded on the page, not raised as a transient notice, so
the file's path and the reason stay visible.

All GUI copy goes through the `t!` macro with zh + en rows.

## Limits

- **GUI only.** The TUI refuses a `.pdf` path (`tab::pdf_handoff_notice`) and
  links no PDF renderer; `tab.rs`'s `the_workbench_never_renders_a_pdf` test
  pins both facts (the refusal and the absence of a renderer in the manifest or
  sources).
- **Read-only viewer.** No text selection, search, links, form fields,
  bookmarks or annotations authoring.
- **One page at a time.** Only the visible page is rasterized; there is no
  continuous page strip and no print dialog.
- **Encrypted PDFs are not supported** (hayro limitation); they land in the
  malformed-file state, with the parse error naming the file.
- **Rendering is synchronous** on the UI thread, once per (page, zoom). A very
  complex page blocks the frame that first shows it. Small and ordinary
  documents are measured below; a background worker is the obvious next step
  if a pathological file ever shows up.

## Measured on the fixture

Measured in this worktree (Windows 11, x86_64, **debug** profile of the test
suite — a release build is several times faster):

- Fixture: 1,944 bytes, 2 pages (612 × 792 pt each).
- `PdfDoc::open` (read + parse + page tree): **≈ 1 ms** (980 µs; printed by
  `pdf::tests::the_fixture_loads_as_a_two_page_document`).
- First page raster, 1.5× (918 × 1188 px): **≈ 110 ms**, all of it inside
  hayro (`pdf::tests::the_fixture_rasterizes_real_ink`).
- First page raster as the window shows it (2× display density,
  1224 × 1584 px): **≈ 140 ms**, printed by the shot and shown in the page
  footer. Later frames, scrolling and hovering do not re-rasterize.

Run the shot to reproduce:

```bash
cd main
cargo +1.97.1-x86_64-pc-windows-gnu test -p zetawork-gui --test shots pdf_viewer \
  -- --ignored --nocapture
```

(Any toolchain that has a working linker for the host works; the repository
pin is 1.97.1.)
