//! The editor-only entry's contract, asserted against the real binary.
//!
//! Why these assertions: the payload of the `@linxiraos/editor` platform
//! leaves is spawned by other programs (git, crontab, visudo, and the
//! pi-messenger `/editor` command) and must stay *an editor* — the
//! `file[:line[:col]]` positional protocol, a blocking run with no detached
//! or headless sibling to reach, and loud failures before the UI takes the
//! terminal. The UI itself needs a terminal, so what is asserted here is
//! everything observable without one: the usage surface, the exit codes, and
//! that a bad `--config` fails before any terminal mode is touched.
//!
//! `CARGO_BIN_EXE_termide-editor` is the binary this package just built.

use std::process::{Command, Output};

const EDITOR_BIN: &str = env!("CARGO_BIN_EXE_termide-editor");

fn run(args: &[&str]) -> Output {
    Command::new(EDITOR_BIN)
        .args(args)
        // No terminal: these assertions are about the CLI surface, and a
        // pipe for stdin/stdout keeps a UI run from ever being attempted.
        .output()
        .expect("spawn the editor binary")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// `--help` names the positional and every flag: `FILE` (with the
/// `file:line[:col]` protocol) is the whole command line, and the settings
/// flags are the workbench's own.
#[test]
fn help_documents_the_positional_protocol() {
    let output = run(&["--help"]);

    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let help = stdout(&output);
    assert!(help.contains("FILE"), "help lacks the positional: {help}");
    assert!(
        help.contains("file:line[:col]"),
        "help lacks the position protocol: {help}"
    );
    assert!(help.contains("--no-lsp"), "help lacks --no-lsp: {help}");
    assert!(help.contains("--config"), "help lacks --config: {help}");
    assert!(
        help.contains("--log-level"),
        "help lacks --log-level: {help}"
    );
}

/// The payload reports the vendored version stamp, which is what the release
/// recipe checks when it copies the binary into a platform leaf.
#[test]
fn version_prints_the_snapshot_stamp() {
    let output = run(&["--version"]);

    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let version = stdout(&output);
    assert!(
        version.contains("termide-editor"),
        "version line names the binary: {version}"
    );
    assert!(
        version.contains(env!("CARGO_PKG_VERSION")) || version.contains(termide_core::VERSION),
        "version line carries the snapshot version: {version}"
    );
}

/// The editor payload has no workbench surface: the detached-instance and
/// headless options do not parse, so no caller can turn a blocking `$EDITOR`
/// launch into a background daemon or an agent run.
#[test]
fn workbench_only_options_are_rejected() {
    for flag in [
        "--detached",
        "--prompt",
        "--recall",
        "--restore",
        "--diagnostics",
    ] {
        let output = run(&[flag]);
        assert_eq!(
            output.status.code(),
            Some(2),
            "{flag} must not parse, got {:?}: {}",
            output.status.code(),
            stderr(&output)
        );
    }
}

/// A `--config` pointing nowhere fails before the terminal is taken over:
/// exit code 1, the path in the message, and the caller's terminal untouched
/// (a `$EDITOR` launch that starts on defaults and writes a new config at the
/// first save is worse than a refusal).
#[test]
fn a_missing_config_file_fails_before_the_ui() {
    let output = run(&["--config", "/no/such/termide.toml", "notes.md"]);

    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("/no/such/termide.toml"),
        "stderr names the path: {}",
        stderr(&output)
    );
}
