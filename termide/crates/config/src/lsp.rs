//! LSP defaults shared with the coding agent.
//!
//! The builtin table is generated from the repository's canonical registry
//! (`lsp/servers.json`) into [`crate::lsp_servers_generated`]. Two layers sit
//! on top of those builtins:
//!
//! 1. `~/.zeta/lsp.json` — the user override the coding-agent also reads,
//!    schema `{ "servers": { "<language>": <partial LspServerSettings> } }`.
//! 2. termide's `[lsp.servers.<language>]` settings, applied by the
//!    deserializer in [`crate::settings`].
//!
//! Precedence is therefore `builtin < ~/.zeta/lsp.json < termide settings`.
//!
//! The candidate chain is resolved here: the first command that exists on PATH
//! (or is a path to an executable) is the one started, and a chain with nothing
//! installed disables the language with a reason instead of spawn-failing.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::settings::{LspCandidate, LspServerSettings};

/// Where the shared override file lives (`~/.zeta/lsp.json` on every platform).
pub fn user_override_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".zeta").join("lsp.json"))
}

/// The builtin servers with `~/.zeta/lsp.json` laid over them.
pub fn default_servers() -> HashMap<String, LspServerSettings> {
    let mut servers = crate::lsp_servers_generated::builtin_lsp_servers();
    let Some(path) = user_override_path() else {
        return servers;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return servers; // absent on most machines: the builtins are the answer
    };
    match parse_overrides(&content) {
        Ok(overrides) => {
            apply_overrides(&mut servers, overrides);
            servers
        }
        Err(e) => {
            log::warn!("LSP: ignoring {}: {}", path.display(), e);
            servers
        }
    }
}

/// The user override file as written.
#[derive(Debug, Default, Deserialize)]
struct OverrideFile {
    #[serde(default)]
    servers: HashMap<String, PartialServer>,
}

/// One entry of the override file; every field is optional, and absent fields
/// keep the builtin value.
#[derive(Debug, Default, Deserialize)]
struct PartialServer {
    command: Option<String>,
    args: Option<Vec<String>>,
    root_markers: Option<Vec<String>>,
    candidates: Option<Vec<LspCandidate>>,
}

fn parse_overrides(content: &str) -> anyhow::Result<OverrideFile> {
    Ok(serde_json::from_str(content)?)
}

/// Lay `overrides` over `servers` with the same partial-merge rule termide's
/// TOML settings use. Naming a `command` without a `candidates` list replaces
/// the builtin chain, so an explicit command is not shadowed by an installed
/// first alternative.
///
/// A key may be a canonical server name (the coding-agent's key space, e.g.
/// `rust-analyzer`) or one of termide's language ids (`rust`). A server name is
/// expanded to every language that entry serves, so one shared file configures
/// both editors; an unknown key is added as a language entry.
fn apply_overrides(servers: &mut HashMap<String, LspServerSettings>, overrides: OverrideFile) {
    let server_languages = crate::lsp_servers_generated::builtin_lsp_server_languages();
    for (key, partial) in overrides.servers {
        let languages: Vec<String> = match server_languages.get(key.as_str()) {
            Some(languages) => languages
                .iter()
                .map(|language| (*language).to_string())
                .collect(),
            None => vec![key],
        };
        for language in languages {
            let entry = servers.entry(language).or_default();
            let replaces_chain = partial.command.is_some() && partial.candidates.is_none();
            if let Some(command) = &partial.command {
                entry.command = command.clone();
            }
            if let Some(args) = &partial.args {
                entry.args = args.clone();
            }
            if let Some(root_markers) = &partial.root_markers {
                entry.root_markers = root_markers.clone();
            }
            if let Some(candidates) = &partial.candidates {
                entry.candidates = candidates.clone();
            } else if replaces_chain {
                entry.candidates.clear();
            }
        }
    }
}

/// The candidate that will actually be started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedCommand {
    /// The candidate's command as written (e.g. `tsgo`), for status output.
    pub command: String,
    /// The candidate's arguments.
    pub args: Vec<String>,
    /// Absolute path the command resolved to.
    pub program: PathBuf,
}

/// Why no command could be selected. Both variants are logged when a language
/// is dropped from the startup table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectionError {
    /// Neither a command nor a candidate list is configured.
    NoCandidates,
    /// Every candidate was tried and none exists.
    NotOnPath { tried: Vec<String> },
}

impl std::fmt::Display for SelectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoCandidates => write!(f, "no command or candidate is configured"),
            Self::NotOnPath { tried } => write!(
                f,
                "no candidate resolves on PATH or to an executable (tried: {})",
                tried.join(", ")
            ),
        }
    }
}

impl std::error::Error for SelectionError {}

/// Select the first candidate that resolves, reading the process PATH.
pub fn select_command(settings: &LspServerSettings) -> Result<SelectedCommand, SelectionError> {
    let path = std::env::var_os("PATH");
    select_command_in(settings, path.as_deref())
}

/// Select the first candidate that resolves against an explicit PATH, so tests
/// (and callers with a captured environment) do not depend on the process.
pub fn select_command_in(
    settings: &LspServerSettings,
    path: Option<&OsStr>,
) -> Result<SelectedCommand, SelectionError> {
    if settings.candidates.is_empty() && settings.command.is_empty() {
        return Err(SelectionError::NoCandidates);
    }
    let candidates: Vec<(&str, &[String])> = if settings.candidates.is_empty() {
        vec![(settings.command.as_str(), settings.args.as_slice())]
    } else {
        settings
            .candidates
            .iter()
            .map(|candidate| (candidate.command.as_str(), candidate.args.as_slice()))
            .collect()
    };
    let mut tried = Vec::with_capacity(candidates.len());
    for (command, args) in candidates {
        if let Some(program) = find_in_path(command, path) {
            return Ok(SelectedCommand {
                command: command.to_string(),
                args: args.to_vec(),
                program,
            });
        }
        tried.push(command.to_string());
    }
    Err(SelectionError::NotOnPath { tried })
}

/// Locate `command` on `path` without spawning a process.
///
/// A command that contains a path separator is used as a path: existence as a
/// file is enough (a configured `/opt/my-ls` need not be on PATH). Otherwise
/// each PATH entry is tried as-is and then with the executable extensions the
/// platform uses.
pub fn find_in_path(command: &str, path: Option<&OsStr>) -> Option<PathBuf> {
    if command.is_empty() {
        return None;
    }
    let command_path = Path::new(command);
    if command_path.is_absolute()
        || command.contains(std::path::MAIN_SEPARATOR)
        || (cfg!(windows) && command.contains('/'))
    {
        return is_executable_file(command_path).then(|| command_path.to_path_buf());
    }
    let path = path?;
    for dir in std::env::split_paths(path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let direct = dir.join(command);
        if is_executable_file(&direct) {
            return Some(direct);
        }
        for extension in executable_extensions() {
            let candidate = dir.join(format!("{command}{extension}"));
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn executable_extensions() -> Vec<String> {
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|extension| !extension.is_empty())
        .map(str::to_ascii_lowercase)
        .collect()
}

#[cfg(not(windows))]
fn executable_extensions() -> Vec<String> {
    Vec::new()
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typescript_chain() -> LspServerSettings {
        let generated = crate::lsp_servers_generated::builtin_lsp_servers();
        generated["typescript"].clone()
    }

    fn executable(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn first_installed_candidate_wins() {
        let dir = tempfile::tempdir().unwrap();
        executable(dir.path(), "tsgo");
        executable(dir.path(), "tsc");
        let path = dir.path().as_os_str();
        let selected = select_command_in(&typescript_chain(), Some(path)).unwrap();
        assert_eq!(selected.command, "tsgo");
        assert_eq!(selected.args, ["--lsp", "--stdio"]);
        assert_eq!(selected.program, dir.path().join("tsgo"));
    }

    #[test]
    fn tsc_is_used_when_it_is_the_only_one_installed() {
        let dir = tempfile::tempdir().unwrap();
        executable(dir.path(), "tsc");
        let selected =
            select_command_in(&typescript_chain(), Some(dir.path().as_os_str())).unwrap();
        assert_eq!(selected.command, "tsc");
        assert_eq!(selected.args, ["--lsp", "--stdio"]);
    }

    #[test]
    fn nothing_installed_reports_the_candidates_it_tried() {
        let dir = tempfile::tempdir().unwrap();
        let error =
            select_command_in(&typescript_chain(), Some(dir.path().as_os_str())).unwrap_err();
        let message = error.to_string();
        for command in ["tsgo", "typescript-language-server", "tsc"] {
            assert!(message.contains(command), "{message}");
        }
    }

    #[test]
    fn a_command_without_a_chain_is_the_only_candidate() {
        let dir = tempfile::tempdir().unwrap();
        executable(dir.path(), "pylsp");
        let settings = LspServerSettings {
            command: "pylsp".to_string(),
            args: vec![],
            root_markers: vec![],
            candidates: vec![],
        };
        let selected = select_command_in(&settings, Some(dir.path().as_os_str())).unwrap();
        assert_eq!(selected.command, "pylsp");
        assert!(
            select_command_in(&LspServerSettings::default(), Some(dir.path().as_os_str())).is_err()
        );
    }

    #[test]
    fn an_explicit_override_command_replaces_the_chain() {
        let generated = crate::lsp_servers_generated::builtin_lsp_servers();
        assert!(!generated["typescript"].candidates.is_empty());
        let mut servers = generated;
        let overrides =
            parse_overrides(r#"{ "servers": { "typescript": { "command": "/opt/my-tsgo" } } }"#)
                .unwrap();
        apply_overrides(&mut servers, overrides);
        assert_eq!(servers["typescript"].command, "/opt/my-tsgo");
        assert!(servers["typescript"].candidates.is_empty());
        // Unset fields keep the builtin value.
        assert!(servers["typescript"]
            .root_markers
            .contains(&"tsconfig.json".to_string()));
    }

    #[test]
    fn a_server_key_in_the_shared_file_applies_to_its_languages() {
        let mut servers = crate::lsp_servers_generated::builtin_lsp_servers();
        let overrides = parse_overrides(
            r#"{ "servers": { "rust-analyzer": { "command": "/opt/rust-analyzer" } } }"#,
        )
        .unwrap();
        apply_overrides(&mut servers, overrides);
        // Canonical server key, expanded to termide's language id.
        assert_eq!(servers["rust"].command, "/opt/rust-analyzer");
    }

    #[test]
    fn override_entries_add_languages_and_accept_candidates() {
        let mut servers = crate::lsp_servers_generated::builtin_lsp_servers();
        let overrides = parse_overrides(
            r#"{
                "servers": {
                    "zig": { "command": "zls", "root_markers": ["build.zig"] },
                    "python": { "candidates": [{ "command": "pyrefly", "args": ["lsp"] }] }
                }
            }"#,
        )
        .unwrap();
        apply_overrides(&mut servers, overrides);
        assert_eq!(servers["zig"].command, "zls");
        assert_eq!(servers["zig"].root_markers, ["build.zig"]);
        assert_eq!(servers["python"].candidates[0].command, "pyrefly");
        assert_eq!(servers["python"].command, "pylsp");
    }

    #[test]
    fn a_malformed_override_is_rejected_rather_than_silently_partial() {
        assert!(parse_overrides("{ not json").is_err());
    }
}
