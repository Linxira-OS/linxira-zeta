//! The editor-only entry point: `termide-editor FILE[:line[:col]]...`.
//!
//! `src/bin/termide-editor.rs` is the thin shell that includes this module
//! and `src/ui.rs`; `src/main.rs` (the workbench) neither knows nor includes
//! either of them.
//!
//! Why a second entry point rather than a `termide --editor` mode (Zeta
//! decision 2026-10-17, VENDOR.md deviation 23): the `@linxiraos/editor`
//! platform leaves ship *an editor* that other programs spawn by path
//! (`$EDITOR` from git/crontab/visudo, and the pi-messenger `/editor`
//! command), so the payload carries no agent, headless, detached-instance or
//! completion surface and grows no user-visible command or flag — the
//! workbench's own CLI (help text and the three completion scripts, which a
//! test keeps in sync with every clap option) stays exactly as it is.
//!
//! What is shared with the workbench is the editor itself: the same
//! `termide-panel-editor` panels, the same layout renderer (`src/ui.rs`), the
//! same `file[:line[:col]]` positional parser (`termide_app::cli_args`), and
//! the same layered config — LSP, themes, keybindings and editor settings
//! still come from `config.toml` and the project overlay.
//!
//! `$EDITOR` contract:
//! - The process blocks until the UI is closed. There is no `--detached`
//!   option and no attach path, so the launching tool always regains control
//!   on exit — `termide`'s detached-instance machinery is never reachable
//!   from here.
//! - Closing the last panel ends the process rather than opening a Help panel,
//!   because layout persistence is off: `App::set_layout_persistence` gates
//!   the layout save, the saved-project set, and the "no panels left" branch
//!   in `App::close_panel_at_index`. Unsaved edits still ask first.
//! - A directory positional becomes the project root (chdir before anything
//!   reads the current directory), and a file that does not exist yet is
//!   created, so `$EDITOR` works for new files.
//! - An invocation with no file at all opens one empty editor panel with
//!   the project root as its SaveAs directory, instead of an empty screen.

use anyhow::Result;
use clap::Parser;
use crossterm::{event::PopKeyboardEnhancementFlags, execute, terminal::enable_raw_mode};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::path::{Path, PathBuf};

use termide_app::{App, AppState, OpenedTarget};
use termide_config::Config;
use termide_core::{init_icon_mode, init_terminal_caps};
use termide_i18n::init_with_language;
use termide_layout::LayoutManager;
use termide_theme::{set_ansi16_mode, set_themes_dir};

#[derive(Parser)]
#[command(
    name = "termide-editor",
    version = termide_core::VERSION,
    about = "Terminal editor (the @linxiraos/editor payload)"
)]
struct EditorCli {
    /// Override minimum log level (trace, debug, info, warn, error)
    #[arg(long)]
    log_level: Option<String>,

    /// Disable LSP support
    #[arg(long)]
    no_lsp: bool,

    /// Global config file to read and save, in place of config.toml in the
    /// config directory; a project's .termide/config.toml still applies on top
    #[arg(long, value_name = "PATH")]
    config: Option<PathBuf>,

    /// File(s) to open, optionally with a `file:line[:col]` position suffix.
    /// An existing directory becomes the project root. With no argument at
    /// all, one empty editor opens in the current directory.
    #[arg(value_name = "FILE")]
    files: Vec<String>,
}

/// What the command line asks for, resolved against the invoking directory.
#[derive(Debug, PartialEq, Eq)]
struct EditorPlan {
    /// Directory positional to become the project root, if any. `chdir`ed to
    /// before anything else reads the current directory (config layering,
    /// LSP and git roots), exactly like the workbench's own directory
    /// positional.
    root: Option<PathBuf>,
    /// Files to open in editor panels, in argument order. Only the first
    /// directory positional is a root; the rest are dropped with a warning.
    files: Vec<OpenedTarget>,
    /// Non-fatal argument problems, logged once the logger is up.
    warnings: Vec<String>,
}

/// Resolve positional arguments into an [`EditorPlan`].
///
/// Delegates to [`termide_app::parse_positional_args`] so the editor entry
/// parses `file[:line[:col]]` by the same rule the workbench does (1-based,
/// at most two numeric suffixes, Windows drive letters exempt).
fn plan(files: &[String], cwd: &Path) -> EditorPlan {
    let mut plan = EditorPlan {
        root: None,
        files: Vec::new(),
        warnings: Vec::new(),
    };
    for target in termide_app::parse_positional_args(files, cwd) {
        if !target.is_dir_root {
            plan.files.push(target);
            continue;
        }
        if plan.root.is_none() {
            plan.root = Some(target.path);
        } else {
            plan.warnings.push(format!(
                "Ignoring extra directory argument '{}'",
                target.path.display()
            ));
        }
    }
    plan
}

/// Run the editor: parse the command line, bring up the panel-editor UI on
/// the requested files, and block until it is closed.
///
/// `render` is the layout renderer from `src/ui.rs`, passed in by the binary
/// so this module stays independent of how the frame is drawn.
pub fn run(
    render: impl Fn(&mut ratatui::Frame<'_>, &mut AppState, &mut LayoutManager),
) -> Result<()> {
    let cli = EditorCli::parse();

    let invoke_cwd = std::env::current_dir()
        .unwrap_or_else(|_| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")));
    let plan = plan(&cli.files, &invoke_cwd);
    // A directory argument is the project root: move before anything reads
    // the current directory, so the layered config, the LSP workspace roots
    // and the git root all resolve against it.
    if let Some(root) = &plan.root {
        if let Err(e) = std::env::set_current_dir(root) {
            eprintln!(
                "termide-editor: cannot use '{}' as project root: {e}",
                root.display()
            );
        }
    }

    // Every wait, terminal-mode change and raw-mode entry below is plain
    // stdout/stderr work: no UI, no alternate screen, so a run that fails
    // here leaves the caller's terminal (and its exit code) meaningful.
    let mut warnings = plan.warnings;

    if let Some(path) = &cli.config {
        // A mistyped path should not quietly start on defaults and create a
        // new file at the first change.
        if !path.is_file() {
            anyhow::bail!("config file not found: {}", path.display());
        }
        termide_config::set_global_config_file(path);
    }

    // Terminal capabilities before themes: a Linux VT needs its own palette.
    let caps = init_terminal_caps();
    if caps.needs_color_adaptation() {
        set_ansi16_mode(true);
    }

    let project_root = std::env::current_dir()
        .unwrap_or_else(|_| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")));
    let (mut config, global_baseline) = match Config::load_layered(&project_root) {
        Ok(loaded) => {
            warnings.extend(loaded.warnings);
            (loaded.effective, loaded.global_layer)
        }
        // With `--config` the user named the file: a broken one is an error,
        // not a reason to run on defaults and overwrite it at the next save.
        Err(e) if cli.config.is_some() => return Err(e),
        Err(e) => {
            warnings.push(format!("Could not load config: {e}. Using defaults."));
            (Config::default(), Config::default())
        }
    };

    // What this run forces on top: the command line, and on a Linux VT the
    // norton-commander theme in place of the default one. Kept out of every
    // save — see `RuntimeOverrides`.
    let mut runtime_overrides = termide_config::RuntimeOverrides::new(
        cli.log_level.clone(),
        cli.no_lsp,
        caps.is_linux_console,
    );
    runtime_overrides.apply(&mut config);

    init_icon_mode(config.general.icon_mode);
    if let Ok(themes_dir) = Config::get_themes_dir() {
        set_themes_dir(themes_dir);
    }
    init_with_language(&config.general.language)?;

    // Install the panic handler before any terminal mode changes: without it
    // a panic leaves the terminal in raw mode + alternate screen, which for
    // git/crontab waiting on this process looks like a hung editor.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        termide_core::leave_terminal_modes();
        default_hook(info);
    }));

    enable_raw_mode()?;
    let stdout = io::stdout();

    let keyboard_caps = termide_keyboard::KeyboardCaps::detect(config.general.report_all_keys);
    let keyboard_enhanced = keyboard_caps.kitty_full;

    let title = format!(
        "zetaide: {}",
        termide_core::util::shorten_home_path(
            &std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default()
        )
    );

    // Alternate screen, mouse, focus and paste reporting, plus the keyboard
    // enhancement flags — the same set the workbench enters, so the editor
    // renders and takes input identically.
    termide_core::enter_terminal_modes(&keyboard_caps, Some(&title))?;

    // Whether `⏱️`-style emoji take one column or two is the host terminal's
    // call, and the frame diff must agree with it.
    let vs16_probe = Some(termide_core::probe_variation_selector_width());
    let vs16_wide = termide_core::adopt_variation_selector_width(vs16_probe.flatten());

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Guard against 0x0 (can happen over SSH before PTY size negotiation).
    let size = terminal.size()?;
    let width = size.width.max(20);
    let height = size.height.max(5);

    let mut app = App::new_with_config(
        config,
        global_baseline,
        runtime_overrides,
        width,
        height,
        keyboard_caps,
    );

    // The logger is up now (App::new_with_config initializes it), so what was
    // collected during bring-up reaches the Journal instead of being dropped.
    match vs16_probe {
        Some(Some(answer)) => log::info!(
            "Host terminal makes emoji + VS16 (⏱️) {} wide; frame diff follows it",
            if answer { "two columns" } else { "one column" }
        ),
        Some(None) => log::warn!(
            "Host terminal did not answer the VS16 width probe; assuming {} (set {}=0|1 to override)",
            if vs16_wide { "two columns" } else { "one column" },
            termide_core::VS16_WIDTH_ENV
        ),
        None => {}
    }
    for msg in warnings {
        log::warn!("{}", msg);
    }

    // Never touch the project's saved layouts: this entry opens what it was
    // told to open and leaves the workbench's view of the project alone. It
    // is also what makes closing the last panel end the process.
    app.set_layout_persistence(false);

    if plan.files.is_empty() {
        app.open_new_editor()?;
    } else {
        for target in &plan.files {
            if let Err(e) = app.open_path_in_editor_at(target.path.clone(), target.line, target.col)
            {
                // Reported, not fatal: the remaining arguments still open,
                // and the user sees the failure in the app itself.
                log::error!("Failed to open '{}' from CLI: {e}", target.path.display());
            }
        }
    }

    let result = app.run(&mut terminal, render);

    if keyboard_enhanced {
        let _ = execute!(terminal.backend_mut(), PopKeyboardEnhancementFlags);
    }
    termide_core::leave_terminal_modes();

    // A closed UI is a successful edit as far as the caller is concerned:
    // git, crontab and visudo treat a non-zero editor exit as "the edit
    // failed" and abort. Failures of the UI loop itself are therefore logged
    // (they are in the Journal and the log file) and not turned into an exit
    // code. Anything that must fail loudly fails above, before the UI exists.
    if let Err(err) = result {
        log::error!("Error: {:?}", err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    /// `file:line:col`, `file:line` and a bare path all resolve, 1-based,
    /// through the workbench's own parser.
    #[test]
    fn positionals_keep_their_line_and_column() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan(
            &strings(&["notes.md:12:3", "main.rs:7", "bare.txt"]),
            dir.path(),
        );

        assert_eq!(plan.root, None);
        assert!(plan.warnings.is_empty());
        assert_eq!(
            plan.files
                .iter()
                .map(|t| (t.path.clone(), t.line, t.col))
                .collect::<Vec<_>>(),
            vec![
                (dir.path().join("notes.md"), Some(12), Some(3)),
                (dir.path().join("main.rs"), Some(7), None),
                (dir.path().join("bare.txt"), None, None),
            ]
        );
    }

    /// A drive-letter colon is never a `:line` separator, so `C:\src\x.go:42`
    /// stays one path with a line — the drive colon is not read as `:x`, and
    /// the only position consumed is the trailing `:42`.
    ///
    /// The path is asserted by suffix, not by equality: off Windows a
    /// drive-letter path is not absolute, so the parser resolves it against
    /// the invoking directory (exactly what the editor does with any relative
    /// argument). What matters here is that the colon splitting left the drive
    /// colon alone and took the line.
    #[test]
    fn a_drive_letter_colon_is_not_a_position() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan(&strings(&[r"C:\src\x.go:42"]), dir.path());

        assert_eq!(plan.files.len(), 1);
        assert_eq!(plan.files[0].line, Some(42));
        assert_eq!(plan.files[0].col, None);
        assert!(
            plan.files[0]
                .path
                .to_string_lossy()
                .ends_with(r"C:\src\x.go"),
            "the drive colon stays part of the path: {:?}",
            plan.files[0].path
        );
    }

    /// A directory argument is the project root, not a panel; extra ones are
    /// dropped with a warning, and the files around them still open.
    #[test]
    fn the_first_directory_becomes_the_root_and_the_rest_are_dropped() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let plan = plan(
            &[
                first.path().display().to_string(),
                "a.rs".to_string(),
                second.path().display().to_string(),
            ],
            first.path(),
        );

        assert_eq!(plan.root, Some(first.path().to_path_buf()));
        assert_eq!(plan.files.len(), 1);
        assert_eq!(plan.files[0].path, first.path().join("a.rs"));
        assert_eq!(plan.warnings.len(), 1);
        assert!(plan.warnings[0].contains(&second.path().display().to_string()));
    }

    /// No arguments at all means "one empty editor here": no root to move to
    /// and no file to open, which the run loop turns into a new buffer.
    #[test]
    fn no_arguments_is_an_empty_editor_not_a_root() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan(&[], dir.path());

        assert_eq!(plan.root, None);
        assert!(plan.files.is_empty());
    }
}
