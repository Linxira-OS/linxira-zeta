//! `termide-editor` — the editor-only entry point, and the payload of the
//! `@linxiraos/editor` platform leaves.
//!
//! The entry itself lives in `src/editor_entry.rs`. Two `#[path]` includes
//! are all this binary needs beyond its own `main`: the entry module and the
//! layout renderer both sit in `src/`, so no library target is introduced and
//! `src/main.rs` — the workbench shell, the file upstream rewrites most —
//! stays byte-identical to the snapshot.
//!
//! `/editor` semantics, the shared config, and the plumbing that keeps this
//! binary free of the workbench's agent / detached-instance / headless
//! surfaces: see `src/editor_entry.rs`.

#[path = "../ui.rs"]
mod ui;

#[path = "../editor_entry.rs"]
mod editor_entry;

fn main() -> anyhow::Result<()> {
    // The renderer is passed in rather than imported by the entry, so
    // `editor_entry` does not depend on how the frame is drawn.
    editor_entry::run(ui::render_layout_with_accordion)
}
