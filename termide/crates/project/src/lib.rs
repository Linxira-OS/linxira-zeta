//! Saved project layouts for termide.
//!
//! Saves and restores application state between runs.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

mod maintenance;
pub use maintenance::*;
mod open_list;
pub use open_list::{load_open_projects, save_open_projects, SavedOpenProjects};

/// The saved layout of a project: its panels, restored on the next start
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectLayout {
    /// Panel groups (vertical columns with accordion)
    pub panel_groups: Vec<PanelGroupState>,
    /// Which group is currently focused (0-based index)
    pub focused_group: usize,
}

/// Legacy layout-mode tag retained for backward compatibility with
/// layouts saved before the unified-split refactor. Newer code never
/// writes this field; older layouts deserialize the tag and the
/// loader treats `Accordion` as a request to apply the
/// fullscreen-current-panel preset on top of `expanded_index`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum GroupLayoutMode {
    #[default]
    #[serde(rename = "accordion")]
    Accordion,
    #[serde(rename = "split")]
    Split,
}

/// A group of panels (one vertical column).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelGroupState {
    /// Panels in this group.
    pub panels: Vec<PanelState>,
    /// Which panel is focused (0-based index).
    pub expanded_index: usize,
    /// Column width in characters (None = auto-distributed).
    pub width: Option<u16>,
    /// Legacy mode tag — still parsed from old layouts to drive
    /// fullscreen-preset migration. New layouts never write it.
    #[serde(default, skip_serializing)]
    pub mode: GroupLayoutMode,
    /// Cached panel heights (in lines). `None` means "no cache yet —
    /// derive equal distribution on first use".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_heights: Option<Vec<u16>>,
    /// When `Some`, the group is in the fullscreen-current-panel preset
    /// and this is the heights snapshot to restore on toggle-off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fullscreen_cache: Option<Vec<u16>>,
}

/// Panel data for serialization
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PanelState {
    /// File manager panel
    #[serde(rename = "file_manager")]
    FileManager {
        /// Path for local filesystem, or VFS URL for remote (e.g., "sftp://user@host/path")
        #[serde(alias = "path")] // Support old format for backward compatibility
        path_or_url: String,
    },
    /// Text editor panel
    #[serde(rename = "editor")]
    Editor {
        /// File path (None for unnamed/scratch buffers)
        path: Option<PathBuf>,
        /// Temporary file name for unsaved buffers (format: unsaved-YYYYMMDD-HHIISS-MSEC.txt)
        #[serde(skip_serializing_if = "Option::is_none")]
        unsaved_buffer_file: Option<String>,
    },
    /// Terminal panel
    #[serde(rename = "terminal")]
    Terminal {
        /// Working directory
        working_dir: PathBuf,
    },
    /// Journal panel
    #[serde(rename = "journal")]
    Journal,
    /// Image viewer panel
    #[serde(rename = "image")]
    Image {
        /// Path to image file
        path: PathBuf,
    },
    /// Binary hex/ASCII viewer panel
    #[serde(rename = "binary")]
    Binary {
        /// Path to the binary file
        path: PathBuf,
    },
    /// Rendered Markdown preview panel
    #[serde(rename = "markdown")]
    Markdown {
        /// Path to the markdown file
        path: PathBuf,
    },
    /// Mermaid diagram viewer panel
    #[serde(rename = "mermaid")]
    Mermaid {
        /// Path to the `.mmd` file
        path: PathBuf,
    },
    /// Rendered HTML viewer panel
    #[serde(rename = "html")]
    Html {
        /// Path to the HTML file
        path: PathBuf,
    },
    /// Git status panel
    #[serde(rename = "git_status")]
    GitStatus {
        /// Repository path
        repo_path: PathBuf,
    },
    /// Git log panel
    #[serde(rename = "git_log")]
    GitLog {
        /// Repository path
        repo_path: PathBuf,
    },
    /// Git diff panel
    #[serde(rename = "git_diff")]
    GitDiff {
        /// Repository path
        repo_path: PathBuf,
        /// Commit hash (None = working directory changes, Some = specific commit)
        #[serde(skip_serializing_if = "Option::is_none")]
        commit_hash: Option<String>,
    },
    /// Outline panel (symbol navigator)
    #[serde(rename = "outline")]
    Outline,
    /// Diagnostics panel
    #[serde(rename = "diagnostics")]
    Diagnostics,
    /// Database viewer panel
    #[serde(rename = "database")]
    Database {
        /// Connection URL (as entered in the bookmark)
        url: String,
        /// Display label
        #[serde(default, skip_serializing_if = "String::is_empty")]
        label: String,
    },
    /// Coding agent panel
    #[serde(rename = "agent")]
    Agent {
        /// Working directory the agent's tools run in
        cwd: PathBuf,
        /// Agent session log to continue; absent when the panel ran without one
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session: Option<PathBuf>,
        /// Agent definition in use; the default one when absent
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent: Option<String>,
        /// What was set up on a session nothing was sent in yet. Its log is
        /// deleted as the panel closes, so a restore starts the fresh
        /// session on these instead
        #[serde(default, skip_serializing_if = "AgentSetupState::is_empty")]
        setup: AgentSetupState,
    },
    // Note: Welcome panels are NOT saved (they auto-close)
}

/// The settings picked on an agent panel before its first request: the
/// connection, the model, the reasoning level and the external agent's own
/// options, each absent when left as configured.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSetupState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    /// The external agent's options as `[option, value]` pairs, in the
    /// order they were picked
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<(String, String)>,
}

impl AgentSetupState {
    /// Whether nothing was picked, so there is nothing to save.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// The relative path a project's data is filed under: its canonical path
/// with the root separator dropped but the volume kept, so joining it onto a
/// base directory nests rather than replaces.
///
/// Keeping the volume is what tells `D:\CODE` from `E:\CODE`: stripping the
/// prefix made two removable drives with the same folder name share one
/// layout directory, and the drive mounted last inherited the other's
/// panels, cwd and terminal history. `Component::RootDir` covers `/` and the
/// separator after the volume; `Component::Prefix` becomes a readable
/// directory of its own:
///
/// - `C:\Users\me\proj` → `C/Users/me/proj`
/// - `D:\` (a drive root) → `D`, never the empty key
/// - `\\server\share\proj` → `unc/server/share/proj`
///
/// A rootless path (Unix `/home/me/proj`, Windows `\proj`) has no volume to
/// keep and still mirrors its path. `..` cannot escape the base directory:
/// canonical paths never contain it, and the non-canonical fallback encodes
/// it as `__parent__`.
#[must_use]
pub fn project_key(project_root: &Path) -> PathBuf {
    let canonical =
        dunce::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
    let mut key = PathBuf::new();
    for component in canonical.components() {
        match component {
            std::path::Component::Prefix(prefix) => key.push(prefix_key(prefix.kind())),
            std::path::Component::RootDir | std::path::Component::CurDir => {}
            std::path::Component::ParentDir => key.push("__parent__"),
            std::path::Component::Normal(name) => key.push(name),
        }
    }
    key
}

/// The directory name a volume prefix is filed under.
///
/// A drive letter is kept as the bare letter (`C`), so a drive root produces
/// the non-empty key `C`. UNC shares keep server and share readable instead
/// of being flattened into a path that would parse back as a network root.
fn prefix_key(prefix: std::path::Prefix<'_>) -> String {
    use std::path::Prefix;
    match prefix {
        Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
            char::from(letter).to_ascii_uppercase().to_string()
        }
        Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => format!(
            "unc/{}/{}",
            sanitize_component(&server.to_string_lossy()),
            sanitize_component(&share.to_string_lossy())
        ),
        Prefix::DeviceNS(device) => {
            format!("device/{}", sanitize_component(&device.to_string_lossy()))
        }
        Prefix::Verbatim(verbatim) => {
            format!(
                "verbatim/{}",
                sanitize_component(&verbatim.to_string_lossy())
            )
        }
    }
}

/// Make a prefix fragment safe to use as one path component of the key.
fn sanitize_component(text: &str) -> String {
    text.replace(['/', '\\', ':'], "_")
}

/// Get the data directory for termide.
pub(crate) fn get_data_dir() -> Result<PathBuf> {
    dirs::data_dir()
        .map(|p| p.join("termide"))
        .context("Failed to determine data directory")
}

/// Directory holding every project's saved layout.
///
/// Before the rename this was `sessions`; [`migrate_legacy_layouts`] moves
/// the old tree across at startup so saved layouts survive an upgrade.
pub(crate) const PROJECTS_DIR: &str = "projects";
const LEGACY_PROJECTS_DIR: &str = "sessions";

/// Move the saved layouts of a termide older than the rename into place.
///
/// Runs once at startup, before the logger is up, so the outcome is returned
/// for the caller to log rather than logged here. Run on every launch: an
/// older termide may have written `sessions/` again since the last one.
pub fn migrate_legacy_layouts() -> Vec<(log::Level, String)> {
    match get_data_dir() {
        Ok(data_dir) => migrate_legacy_dir(&data_dir),
        Err(_) => Vec::new(),
    }
}

/// File the saved layouts written before [`project_key`] kept the volume
/// under the current volume.
///
/// Those keys were rootless (`projects/CODE` for both `C:\CODE` and
/// `D:\CODE`), so which drive a tree belongs to is not recorded anywhere. A
/// tree is moved only when the mirrored path still exists on the volume the
/// launch runs from (`D:\CODE` for `projects/CODE` when launched from `D:`),
/// which is the only evidence available; otherwise it is left in place and
/// reported, never guessed at.
///
/// Runs at startup next to [`migrate_legacy_layouts`], before the logger is
/// up, and is idempotent: a tree that moved leaves no rootless directory
/// behind, and directories named like a volume (a drive letter, `unc`) are
/// already in the new layout and skipped.
pub fn migrate_rootless_layouts(project_root: &Path) -> Vec<(log::Level, String)> {
    let Ok(data_dir) = get_data_dir() else {
        return Vec::new();
    };
    let Some((volume_root, volume_key)) = volume_of(project_root) else {
        // Unix paths have no volume to put in front of a rootless key.
        return Vec::new();
    };
    migrate_rootless_dir(&data_dir.join(PROJECTS_DIR), &volume_root, &volume_key)
}

/// The root path and [`project_key`] directory name of the volume `path`
/// lives on, when it names one (Windows drive or UNC share).
fn volume_of(path: &Path) -> Option<(PathBuf, String)> {
    use std::path::{Component, Prefix};
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let prefix = canonical
        .components()
        .find_map(|component| match component {
            Component::Prefix(prefix) => Some(prefix.kind()),
            _ => None,
        })?;
    match prefix {
        Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
            let letter = char::from(letter).to_ascii_uppercase();
            Some((PathBuf::from(format!("{letter}:\\")), letter.to_string()))
        }
        Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
            let (server, share) = (server.to_string_lossy(), share.to_string_lossy());
            Some((
                PathBuf::from(format!(r"\\{server}\{share}")),
                format!(
                    "unc/{}/{}",
                    sanitize_component(&server),
                    sanitize_component(&share)
                ),
            ))
        }
        // Device namespaces and verbatim roots are not usable as mirror
        // targets; leaving those trees alone is safer than a guess.
        _ => None,
    }
}

/// Whether a top-level `projects/` directory is already filed by volume.
fn is_volume_directory(name: &str) -> bool {
    let mut chars = name.chars();
    let drive_letter = matches!(
        (chars.next(), chars.next()),
        (Some(letter), None) if letter.is_ascii_alphabetic()
    );
    drive_letter
        || name.eq_ignore_ascii_case("unc")
        || name.eq_ignore_ascii_case("device")
        || name.eq_ignore_ascii_case("verbatim")
}

/// Move each rootless tree in `projects_dir` under `volume_key` when
/// `volume_root` proves where it came from. `volume_key` is the directory
/// name the new layout uses for that volume (`D`, `unc/server/share`).
fn migrate_rootless_dir(
    projects_dir: &Path,
    volume_root: &Path,
    volume_key: &str,
) -> Vec<(log::Level, String)> {
    let mut notes = Vec::new();
    let entries = match fs::read_dir(projects_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return notes,
        Err(e) => {
            notes.push((
                log::Level::Warn,
                format!(
                    "could not inspect saved layouts in {}: {e}",
                    projects_dir.display()
                ),
            ));
            return notes;
        }
    };
    let mut entries: Vec<_> = entries.filter_map(|entry| entry.ok()).collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if is_volume_directory(name) {
            continue;
        }
        let source = entry.path();
        let mirrored = volume_root.join(name);
        if !mirrored.exists() {
            notes.push((
                log::Level::Warn,
                format!(
                    "left saved layout {} alone: cannot tell which drive '{name}' came from \
                     (open that project once to save it under its volume)",
                    source.display()
                ),
            ));
            continue;
        }
        let volume_dir = projects_dir.join(volume_key);
        let target = volume_dir.join(name);
        let result = if target.exists() {
            merge_move(&source, &target).map(|()| "folded")
        } else {
            fs::create_dir_all(&volume_dir)
                .and_then(|()| fs::rename(&source, &target))
                .map(|()| "moved")
        };
        notes.push(match result {
            Ok(action) => (
                log::Level::Info,
                format!(
                    "{action} saved layout {} under {volume_key} ({} exists)",
                    source.display(),
                    mirrored.display()
                ),
            ),
            Err(e) => (
                log::Level::Warn,
                format!(
                    "could not move saved layout {} under {volume_key}: {e}",
                    source.display()
                ),
            ),
        });
    }
    notes
}

/// Move `<data>/sessions` to `<data>/projects`, or fold it into `projects`
/// when both exist. Failures are reported, never fatal: a fresh directory is
/// created instead and only the old layouts are lost.
fn migrate_legacy_dir(data_dir: &Path) -> Vec<(log::Level, String)> {
    let legacy = data_dir.join(LEGACY_PROJECTS_DIR);
    let current = data_dir.join(PROJECTS_DIR);
    if !legacy.is_dir() {
        return Vec::new();
    }
    let (from, to) = (legacy.display(), current.display());
    if !current.exists() {
        return vec![match std::fs::rename(&legacy, &current) {
            Ok(()) => (
                log::Level::Info,
                format!("moved saved layouts from {from} to {to}"),
            ),
            Err(e) => (
                log::Level::Warn,
                format!("could not move {from} to {to}: {e}"),
            ),
        }];
    }
    // Both exist: an older termide kept writing to the legacy directory after
    // the move. Fold what it left into the current one and drop the shell.
    vec![match merge_move(&legacy, &current) {
        Ok(()) => (
            log::Level::Info,
            format!("folded saved layouts from {from} into {to}"),
        ),
        Err(e) => (
            log::Level::Warn,
            format!("could not fold {from} into {to}: {e}"),
        ),
    }]
}

/// Move everything under `src` into `dst`, recursing into directories that
/// exist on both sides and keeping the newer of two files with the same
/// name. Directories emptied on the way are removed, `src` included.
fn merge_move(src: &Path, dst: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if !to.exists() {
            std::fs::rename(&from, &to)?;
        } else if from.is_dir() && to.is_dir() {
            merge_move(&from, &to)?;
        } else if from.is_file() && to.is_file() {
            let newer = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
            if newer(&from) > newer(&to) {
                std::fs::rename(&from, &to)?;
            } else {
                std::fs::remove_file(&from)?;
            }
        }
    }
    // Only an empty directory goes; anything unexpected stays for the user.
    let _ = std::fs::remove_dir(src);
    Ok(())
}

/// Remove the files of the project stored in `project_dir`, then the
/// directories left empty up to `projects_dir`.
///
/// Storage directories nest like the project paths they mirror, so the
/// subdirectories of `project_dir` hold the state of projects inside this
/// one and are kept.
fn delete_project_files(project_dir: &Path, projects_dir: &Path) -> std::io::Result<()> {
    if !project_dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(project_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            fs::remove_file(entry.path())?;
        }
    }
    let mut dir = project_dir;
    while dir != projects_dir && dir.starts_with(projects_dir) && fs::remove_dir(dir).is_ok() {
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }
    Ok(())
}

impl ProjectLayout {
    /// Get the storage directory for a specific project
    ///
    /// Creates nested subdirectories matching the project path with its
    /// volume kept (see [`project_key`]).
    /// Example (Unix):    /home/user/project1 -> ~/.local/share/termide/projects/home/user/project1/
    /// Example (Windows): C:\Users\user\proj  -> %APPDATA%\termide\projects\C\Users\user\proj
    /// Example (Windows): D:\                 -> %APPDATA%\termide\projects\D
    pub fn get_project_dir(project_root: &Path) -> Result<PathBuf> {
        Ok(get_data_dir()?
            .join(PROJECTS_DIR)
            .join(project_key(project_root)))
    }

    /// Get the path to the layout file (`session.toml`) of a specific project
    pub fn get_project_path(project_root: &Path) -> Result<PathBuf> {
        Ok(Self::get_project_dir(project_root)?.join("session.toml"))
    }

    /// Delete the stored state of a specific project.
    pub fn delete_layout(project_root: &Path) -> Result<()> {
        let project_dir = Self::get_project_dir(project_root)?;
        let projects_dir = get_data_dir()?.join(PROJECTS_DIR);
        delete_project_files(&project_dir, &projects_dir)
            .with_context(|| format!("Failed to delete project layout: {}", project_dir.display()))
    }

    /// Load the saved layout of a specific project
    pub fn load(project_root: &Path) -> Result<Self> {
        let path = Self::get_project_path(project_root)?;
        let contents = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read layout file: {}", path.display()))?;
        let layout: ProjectLayout = toml::from_str(&contents)
            .with_context(|| format!("Failed to parse layout file: {}", path.display()))?;
        Ok(layout)
    }

    /// Save this layout for a specific project
    pub fn save(&self, project_root: &Path) -> Result<()> {
        let project_dir = Self::get_project_dir(project_root)?;

        // Ensure the project directory exists
        fs::create_dir_all(&project_dir).with_context(|| {
            format!(
                "Failed to create project directory: {}",
                project_dir.display()
            )
        })?;

        let path = project_dir.join("session.toml");
        let contents = toml::to_string_pretty(self).context("Failed to serialize layout")?;

        fs::write(&path, contents)
            .with_context(|| format!("Failed to write layout file: {}", path.display()))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize, Deserialize)]
    struct Panels {
        panels: Vec<PanelState>,
    }

    /// Deleting a project keeps the projects stored inside it and prunes
    /// only the directories it leaves empty.
    #[test]
    fn deleting_a_project_keeps_nested_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let projects = tmp.path().join(PROJECTS_DIR);
        let outer = projects.join("home/u/notes");
        let inner = outer.join("journal");
        let lone = projects.join("home/u/work/api");
        for dir in [&inner, &lone] {
            fs::create_dir_all(dir).unwrap();
        }
        for file in [
            outer.join("session.toml"),
            outer.join("session-1.log"),
            inner.join("session.toml"),
            lone.join("session.toml"),
        ] {
            fs::write(file, "").unwrap();
        }

        delete_project_files(&outer, &projects).unwrap();
        assert!(!outer.join("session.toml").exists());
        assert!(!outer.join("session-1.log").exists());
        assert!(inner.join("session.toml").exists());

        delete_project_files(&lone, &projects).unwrap();
        assert!(!projects.join("home/u/work").exists());
        assert!(projects.join("home/u").exists());

        delete_project_files(&inner, &projects).unwrap();
        assert!(!projects.join("home").exists());
        assert!(projects.exists());
    }

    /// The agent variant serialises like the others and an absent session
    /// log is left out rather than written as an empty value.
    #[test]
    fn agent_panel_state_round_trips_through_toml() {
        let panels = Panels {
            panels: vec![
                PanelState::Agent {
                    cwd: PathBuf::from("/work"),
                    session: Some(PathBuf::from("/data/agent/s.jsonl")),
                    agent: Some("review".into()),
                    setup: AgentSetupState::default(),
                },
                PanelState::Agent {
                    cwd: PathBuf::from("/work"),
                    session: None,
                    agent: None,
                    setup: AgentSetupState {
                        connection: Some("local".into()),
                        model: Some("qwen".into()),
                        thinking: Some("high".into()),
                        options: vec![("model".into(), "opus".into())],
                    },
                },
            ],
        };
        let text = toml::to_string(&panels).unwrap();
        assert!(text.contains("type = \"agent\""), "{text}");
        assert_eq!(text.matches("session").count(), 1, "{text}");
        assert_eq!(text.matches("[panels.setup]").count(), 1, "{text}");
        let back: Panels = toml::from_str(&text).unwrap();
        assert_eq!(back.panels, panels.panels);
    }
    /// A termide older than the rename keeps writing `sessions/` after the
    /// first move; what it leaves there is folded into `projects/`, newer
    /// files winning, and the empty shell disappears.
    #[test]
    fn leftover_legacy_layouts_are_folded_into_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join(LEGACY_PROJECTS_DIR);
        let current = tmp.path().join(PROJECTS_DIR);
        let write = |base: &Path, rel: &str, body: &str| {
            let path = base.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        };
        write(&legacy, "home/u/only-legacy/session.toml", "legacy only");
        write(&legacy, "home/u/both/session.toml", "legacy newer");
        write(&current, "home/u/both/session.toml", "current older");
        write(&current, "home/u/only-current/session.toml", "current only");
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(600);
        // Setting the modification time needs a writable handle on Windows;
        // a read-only `File::open` is refused there.
        std::fs::OpenOptions::new()
            .write(true)
            .open(current.join("home/u/both/session.toml"))
            .unwrap()
            .set_modified(old)
            .unwrap();

        let notes = migrate_legacy_dir(tmp.path());

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].0, log::Level::Info, "{}", notes[0].1);
        assert!(!legacy.exists());
        let read = |rel: &str| std::fs::read_to_string(current.join(rel)).unwrap();
        assert_eq!(read("home/u/only-legacy/session.toml"), "legacy only");
        assert_eq!(read("home/u/both/session.toml"), "legacy newer");
        assert_eq!(read("home/u/only-current/session.toml"), "current only");

        // Idempotent: nothing left to do.
        assert!(migrate_legacy_dir(tmp.path()).is_empty());
        assert!(current.join("home/u/both/session.toml").is_file());
    }
    /// The first launch after the upgrade finds only `sessions/` and moves
    /// the whole tree, reporting it for the journal.
    #[test]
    fn legacy_layouts_move_to_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join(LEGACY_PROJECTS_DIR);
        let current = tmp.path().join(PROJECTS_DIR);
        std::fs::create_dir_all(legacy.join("home/u/proj")).unwrap();
        std::fs::write(legacy.join("home/u/proj/session.toml"), "layout").unwrap();

        let notes = migrate_legacy_dir(tmp.path());

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].0, log::Level::Info, "{}", notes[0].1);
        assert!(!legacy.exists());
        let moved = std::fs::read_to_string(current.join("home/u/proj/session.toml")).unwrap();
        assert_eq!(moved, "layout");
        assert!(migrate_legacy_dir(tmp.path()).is_empty());
    }
    #[test]
    fn project_key_mirrors_the_path_without_its_root() {
        // A rootless path has no volume to keep; only the root separator goes.
        assert_eq!(
            project_key(Path::new("/nonexistent/home/u/proj")),
            PathBuf::from("nonexistent/home/u/proj")
        );
        #[cfg(windows)]
        assert_eq!(
            project_key(Path::new(r"C:\Users\u\proj")),
            PathBuf::from("C").join("Users").join("u").join("proj")
        );
    }

    /// Two removable drives with the same folder name must not share a
    /// layout directory.
    #[cfg(windows)]
    #[test]
    fn project_key_keeps_the_volume_so_equal_suffixes_differ() {
        let d = project_key(Path::new(r"D:\CODE"));
        let e = project_key(Path::new(r"E:\CODE"));
        assert_eq!(d, PathBuf::from("D").join("CODE"));
        assert_eq!(e, PathBuf::from("E").join("CODE"));
        assert_ne!(d, e);
    }

    /// A drive root is a project too: joining its key must not land on the
    /// `projects/` directory itself.
    #[cfg(windows)]
    #[test]
    fn project_key_of_a_drive_root_is_the_non_empty_drive_name() {
        assert_eq!(project_key(Path::new(r"D:\")), PathBuf::from("D"));
        assert_eq!(project_key(Path::new(r"D:")), PathBuf::from("D"));
    }

    /// A UNC share keeps its server and share as readable components, and
    /// verbatim and non-verbatim spellings of the same share agree.
    #[cfg(windows)]
    #[test]
    fn project_key_of_a_unc_path_is_stable_and_legible() {
        let plain = project_key(Path::new(r"\\server\share\dir"));
        assert_eq!(
            plain,
            PathBuf::from("unc")
                .join("server")
                .join("share")
                .join("dir")
        );
        assert_eq!(
            plain,
            project_key(Path::new(r"\\server\share\dir\")),
            "a trailing separator must not change the key"
        );
        assert_eq!(
            plain,
            project_key(Path::new(r"\\?\UNC\server\share\dir")),
            "the verbatim spelling of a share is the same volume"
        );
    }

    /// The rootless key of a tree whose mirrored path still exists on the
    /// launched volume is moved under that volume once, and only once.
    #[test]
    fn rootless_layouts_move_under_their_volume_once() {
        let tmp = tempfile::tempdir().unwrap();
        let projects = tmp.path().join(PROJECTS_DIR);
        let volume = tmp.path().join("D");
        // The project exists on the current volume, so the origin is proven.
        std::fs::create_dir_all(volume.join("CODE")).unwrap();
        std::fs::create_dir_all(projects.join("CODE")).unwrap();
        std::fs::write(projects.join("CODE/session.toml"), "layout").unwrap();
        // A new-layout drive directory must be left where it is.
        std::fs::create_dir_all(projects.join("E/CODE")).unwrap();
        std::fs::write(projects.join("E/CODE/session.toml"), "other").unwrap();

        let notes = migrate_rootless_dir(&projects, &volume, "D");
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert_eq!(notes[0].0, log::Level::Info, "{}", notes[0].1);
        assert!(!projects.join("CODE").exists());
        assert_eq!(
            std::fs::read_to_string(projects.join("D/CODE/session.toml")).unwrap(),
            "layout"
        );
        assert_eq!(
            std::fs::read_to_string(projects.join("E/CODE/session.toml")).unwrap(),
            "other"
        );

        // Idempotent.
        assert!(migrate_rootless_dir(&projects, &volume, "D").is_empty());
        assert!(projects.join("D/CODE/session.toml").is_file());
    }

    /// A rootless tree whose path does not exist on the launched volume
    /// cannot be assigned to a drive, so it stays and is reported.
    #[test]
    fn ambiguous_rootless_layouts_stay_and_warn() {
        let tmp = tempfile::tempdir().unwrap();
        let projects = tmp.path().join(PROJECTS_DIR);
        let volume = tmp.path().join("D");
        std::fs::create_dir_all(&volume).unwrap();
        std::fs::create_dir_all(projects.join("GONE")).unwrap();
        std::fs::write(projects.join("GONE/session.toml"), "layout").unwrap();

        let notes = migrate_rootless_dir(&projects, &volume, "D");

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].0, log::Level::Warn, "{}", notes[0].1);
        assert!(notes[0].1.contains("cannot tell which drive"));
        assert!(projects.join("GONE/session.toml").is_file());
        assert!(!projects.join("D").exists());
    }

    /// A tree already filed under the volume is merged, newer files winning,
    /// so a half-migrated directory is completed rather than duplicated.
    #[test]
    fn rootless_layouts_fold_into_an_existing_volume_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let projects = tmp.path().join(PROJECTS_DIR);
        let volume = tmp.path().join("D");
        std::fs::create_dir_all(volume.join("CODE")).unwrap();
        std::fs::create_dir_all(projects.join("CODE/nested")).unwrap();
        std::fs::create_dir_all(projects.join("D/CODE")).unwrap();
        std::fs::write(projects.join("CODE/session.toml"), "rootless").unwrap();
        std::fs::write(projects.join("CODE/nested/only.toml"), "nested").unwrap();
        std::fs::write(projects.join("D/CODE/keep.toml"), "keep").unwrap();

        let notes = migrate_rootless_dir(&projects, &volume, "D");

        assert_eq!(notes.len(), 1, "{notes:?}");
        assert_eq!(notes[0].0, log::Level::Info, "{}", notes[0].1);
        assert!(!projects.join("CODE").exists());
        assert_eq!(
            std::fs::read_to_string(projects.join("D/CODE/session.toml")).unwrap(),
            "rootless"
        );
        assert_eq!(
            std::fs::read_to_string(projects.join("D/CODE/nested/only.toml")).unwrap(),
            "nested"
        );
        assert!(projects.join("D/CODE/keep.toml").is_file());
    }
}
