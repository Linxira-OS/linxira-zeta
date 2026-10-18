// SPDX-License-Identifier: AGPL-3.0-only
//! The workbench's project registry, in `~/.zeta/projects.json`.
//!
//! One file, read and written by both surfaces: the GUI (`zetawork-gui`) and
//! the terminal workbench (`zeta-main`). The shape is versioned and small —
//! a registration is a name, an absolute path and the time it was added:
//!
//! ```json
//! { "version": 1, "projects": [{ "id": "…", "name": "…", "path": "…", "addedAt": 0 }] }
//! ```
//!
//! # What a registration is
//!
//! A registration is **only** a row in this file. Removing one never touches
//! the directory and never touches conversation history (zetacode owns its own
//! sessions), which is why [`Registry::remove`] is safe to expose as a plain
//! user action.
//!
//! # Failure policy
//!
//! A missing file is an empty registry, not an error. A file that is present
//! but unreadable or malformed is an [`Error`] and **is not overwritten**: the
//! caller decides whether to fall back to an empty in-memory registry, and a
//! later save is the caller's decision rather than this crate's. Saves are
//! atomic (a sibling temporary file renamed over the registry), so a crash
//! leaves either the old file or the new one.

use std::{
	collections::HashSet,
	fmt, fs,
	io::Write,
	path::{Path, PathBuf},
	time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

/// The on-disk schema version this build writes and accepts.
pub const VERSION: u32 = 1;

/// One registered project. `id` is generated once, at registration, and is
/// the key every mutation uses; the path is absolute (canonicalised when the
/// project was added).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
	pub id: String,
	pub name: String,
	pub path: PathBuf,
	/// Seconds since the Unix epoch — the moment the row was added.
	#[serde(rename = "addedAt")]
	pub added_at: u64,
	/// What the row's seeded workspace is called, when the user renamed it.
	/// Absent means "name it after the project" — the historical behaviour.
	#[serde(rename = "workspaceName", default, skip_serializing_if = "Option::is_none")]
	pub workspace_name: Option<String>,
}

/// Everything the registry can go wrong with.
#[derive(Debug)]
pub enum Error {
	/// The file could not be read or written.
	Io { path: PathBuf, message: String },
	/// The file exists but is not this schema.
	Malformed { path: PathBuf, message: String },
	/// The file declares a schema version this build does not know.
	UnsupportedVersion { path: PathBuf, version: u32 },
	/// A project with the same canonical path is already registered.
	Duplicate { path: PathBuf },
	/// No project carries that id.
	NotFound { id: String },
	/// A project name was empty after trimming.
	InvalidName,
	/// The path resolved to something that is not a directory.
	NotADirectory { path: PathBuf },
}

impl fmt::Display for Error {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Io { path, message } => {
				write!(f, "{}: {message}", path.display())
			},
			Self::Malformed { path, message } => {
				write!(f, "{}: malformed project registry: {message}", path.display())
			},
			Self::UnsupportedVersion { path, version } => write!(
				f,
				"{}: unsupported project registry version {version} (this build reads {VERSION})",
				path.display()
			),
			Self::Duplicate { path } => {
				write!(f, "already registered: {}", path.display())
			},
			Self::NotFound { id } => write!(f, "no project with id {id}"),
			Self::InvalidName => f.write_str("a project name cannot be empty"),
			Self::NotADirectory { path } => {
				write!(f, "not a directory: {}", path.display())
			},
		}
	}
}

impl std::error::Error for Error {}

/// The JSON document on disk.
#[derive(Serialize, Deserialize)]
struct Document {
	version: u32,
	projects: Vec<Project>,
}

/// The in-memory registry plus the file it belongs to.
///
/// The registry is plain data: mutating methods persist immediately and roll
/// the in-memory copy back when the write fails, so a returned `Ok` means both
/// the list and the file changed.
#[derive(Clone, Debug)]
pub struct Registry {
	path: PathBuf,
	projects: Vec<Project>,
}

/// `~/.zeta/projects.json` — the file both surfaces share.
pub fn default_path() -> PathBuf {
	let mut home = std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."));
	home.push(".zeta");
	home.push("projects.json");
	home
}

impl Registry {
	/// Load `~/.zeta/projects.json`.
	pub fn load() -> Result<Self, Error> {
		Self::load_from(default_path())
	}

	/// Load an explicit file. A missing file is an empty registry; a malformed
	/// one is an error and the file is left exactly as it was.
	pub fn load_from(path: impl Into<PathBuf>) -> Result<Self, Error> {
		let path = path.into();
		let text = match fs::read_to_string(&path) {
			Ok(text) => text,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				return Ok(Self { path, projects: Vec::new() });
			},
			Err(error) => {
				return Err(Error::Io { path, message: error.to_string() });
			},
		};
		let document: Document = serde_json::from_str(&text)
			.map_err(|error| Error::Malformed { path: path.clone(), message: error.to_string() })?;
		if document.version != VERSION {
			return Err(Error::UnsupportedVersion { path, version: document.version });
		}
		// Ids are the mutation key: a file with two rows sharing one would make
		// remove/rename ambiguous, so it is malformed rather than "first wins".
		let mut seen = HashSet::with_capacity(document.projects.len());
		for project in &document.projects {
			if !seen.insert(project.id.clone()) {
				return Err(Error::Malformed {
					path,
					message: format!("duplicate project id {:?}", project.id),
				});
			}
		}
		Ok(Self { path, projects: document.projects })
	}

	/// An empty registry bound to `path` — the fallback for a malformed file,
	/// and the test seam. Nothing is written until a mutating method is called.
	pub fn empty_at(path: impl Into<PathBuf>) -> Self {
		Self { path: path.into(), projects: Vec::new() }
	}

	/// The file this registry reads and writes.
	pub fn path(&self) -> &Path {
		&self.path
	}

	/// The registered projects, in registration order.
	pub fn list(&self) -> &[Project] {
		&self.projects
	}

	pub fn get(&self, id: &str) -> Option<&Project> {
		self.projects.iter().find(|project| project.id == id)
	}

	pub fn len(&self) -> usize {
		self.projects.len()
	}

	pub fn is_empty(&self) -> bool {
		self.projects.is_empty()
	}

	/// Register the directory at `path` under its own name.
	///
	/// The path is canonicalised, so `C:\work\demo` and a junction to it are
	/// the same project. A second registration of the same directory is
	/// refused with [`Error::Duplicate`] instead of replaced.
	pub fn add(&mut self, path: &Path) -> Result<Project, Error> {
		let canonical = fs::canonicalize(path)
			.map_err(|error| Error::Io { path: path.to_path_buf(), message: error.to_string() })?;
		if !canonical.is_dir() {
			return Err(Error::NotADirectory { path: canonical });
		}
		if let Some(existing) = self
			.projects
			.iter()
			.find(|project| same_path(&project.path, &canonical))
		{
			return Err(Error::Duplicate { path: existing.path.clone() });
		}
		let name = canonical
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.filter(|name| !name.is_empty())
			.unwrap_or_else(|| canonical.display().to_string());
		let project = Project {
			id: self.fresh_id(),
			name,
			path: canonical,
			added_at: now_secs(),
			workspace_name: None,
		};
		let before = self.projects.clone();
		self.projects.push(project.clone());
		if let Err(error) = self.save() {
			self.projects = before;
			return Err(error);
		}
		Ok(project)
	}

	/// Rename one project. The directory and the id do not change.
	pub fn rename(&mut self, id: &str, name: &str) -> Result<(), Error> {
		let name = name.trim();
		if name.is_empty() {
			return Err(Error::InvalidName);
		}
		let index = self
			.projects
			.iter()
			.position(|project| project.id == id)
			.ok_or_else(|| Error::NotFound { id: id.to_owned() })?;
		let before = self.projects[index].name.clone();
		self.projects[index].name = name.to_owned();
		if let Err(error) = self.save() {
			self.projects[index].name = before;
			return Err(error);
		}
		Ok(())
	}

	/// Rename the workspace a project opens with. Unlike a project rename this
	/// does not touch the project's own name.
	pub fn rename_workspace(&mut self, id: &str, name: &str) -> Result<(), Error> {
		let name = name.trim();
		if name.is_empty() {
			return Err(Error::InvalidName);
		}
		let index = self
			.projects
			.iter()
			.position(|project| project.id == id)
			.ok_or_else(|| Error::NotFound { id: id.to_owned() })?;
		let before = self.projects[index].workspace_name.take();
		self.projects[index].workspace_name = Some(name.to_owned());
		if let Err(error) = self.save() {
			self.projects[index].workspace_name = before;
			return Err(error);
		}
		Ok(())
	}

	/// Remove one registration. `Ok(false)` means no such id; the directory is
	/// never touched either way.
	pub fn remove(&mut self, id: &str) -> Result<bool, Error> {
		let Some(index) = self.projects.iter().position(|project| project.id == id) else {
			return Ok(false);
		};
		let before = self.projects.clone();
		self.projects.remove(index);
		if let Err(error) = self.save() {
			self.projects = before;
			return Err(error);
		}
		Ok(true)
	}

	/// Write the registry atomically: a sibling temporary file, flushed, then
	/// renamed over the destination.
	pub fn save(&self) -> Result<(), Error> {
		let document = Document { version: VERSION, projects: self.projects.clone() };
		let json = serde_json::to_vec_pretty(&document)
			.map_err(|error| Error::Io { path: self.path.clone(), message: error.to_string() })?;
		let parent = self
			.path
			.parent()
			.filter(|parent| !parent.as_os_str().is_empty());
		if let Some(parent) = parent {
			fs::create_dir_all(parent).map_err(|error| Error::Io {
				path: parent.to_path_buf(),
				message: error.to_string(),
			})?;
		}
		let stamp = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|elapsed| elapsed.as_nanos())
			.unwrap_or_default();
		let name = self
			.path
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_else(|| "projects.json".to_owned());
		let temp = parent
			.unwrap_or_else(|| Path::new("."))
			.join(format!(".{name}.tmp-{}-{stamp}", std::process::id()));
		let write = (|| -> std::io::Result<()> {
			let mut file = fs::File::create(&temp)?;
			file.write_all(&json)?;
			file.sync_all()?;
			drop(file);
			fs::rename(&temp, &self.path)
		})();
		if let Err(error) = write {
			let _ = fs::remove_file(&temp);
			return Err(Error::Io { path: self.path.clone(), message: error.to_string() });
		}
		Ok(())
	}

	/// A stable id that is not in use. Wall-clock based, so two processes
	/// adding at the same moment do not need a shared counter to stay unique
	/// in practice; the collision loop is what makes it a guarantee here.
	fn fresh_id(&self) -> String {
		let base = now_millis();
		let mut suffix = 0u32;
		loop {
			let id = if suffix == 0 {
				format!("p{base:x}")
			} else {
				format!("p{base:x}-{suffix}")
			};
			if self.projects.iter().all(|project| project.id != id) {
				return id;
			}
			suffix += 1;
		}
	}
}

/// Compare two paths by their canonical form when both still resolve, and by
/// their stored text otherwise (a project on an unmounted drive keeps its row
/// and still cannot be added twice from the text the user typed).
fn same_path(left: &Path, right: &Path) -> bool {
	let canonical = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
	canonical(left) == canonical(right)
}

fn now_secs() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|elapsed| elapsed.as_secs())
		.unwrap_or_default()
}

fn now_millis() -> u128 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|elapsed| elapsed.as_millis())
		.unwrap_or_default()
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A registry file in a fresh temp directory, plus two real directories to
	/// register.
	fn fixture() -> (tempfile::TempDir, PathBuf, Registry) {
		let dir = tempfile::tempdir().expect("temp dir");
		let path = dir.path().join(".zeta").join("projects.json");
		let root = dir.path().to_path_buf();
		(dir, root, Registry::empty_at(path))
	}

	fn project_dir(root: &Path, name: &str) -> PathBuf {
		let path = root.join(name);
		fs::create_dir_all(&path).expect("project dir");
		path
	}

	#[test]
	fn a_missing_file_is_an_empty_registry() {
		let (dir, ..) = fixture();
		let registry = Registry::load_from(dir.path().join("nothing.json")).expect("missing is fine");
		assert!(registry.is_empty());
		assert!(registry.list().is_empty());
	}

	#[test]
	fn add_round_trips_through_the_file() {
		let (dir, root, mut registry) = fixture();
		let alpha = project_dir(&root, "alpha");
		let beta = project_dir(&root, "beta");
		let alpha_row = registry.add(&alpha).expect("add alpha");
		let beta_row = registry.add(&beta).expect("add beta");
		assert_eq!(alpha_row.name, "alpha");
		assert!(alpha_row.path.is_absolute());
		assert_eq!(registry.len(), 2);
		assert!(registry.path().exists(), "add persists");

		let again =
			Registry::load_from(dir.path().join(".zeta").join("projects.json")).expect("reload");
		assert_eq!(again.list(), registry.list());
		assert_eq!(again.get(&beta_row.id), Some(&beta_row));
		assert!(again.get(&alpha_row.id).is_some());
	}

	#[test]
	fn duplicate_paths_are_rejected_and_the_rows_stay_put() {
		let (_dir, root, mut registry) = fixture();
		let alpha = project_dir(&root, "alpha");
		registry.add(&alpha).expect("first registration");
		let before = registry.list().to_vec();
		match registry.add(&alpha) {
			Err(Error::Duplicate { path }) => {
				assert_eq!(path, fs::canonicalize(&alpha).expect("canonical"))
			},
			other => panic!("expected Duplicate, got {other:?}"),
		}
		assert_eq!(registry.list(), before.as_slice(), "a refused add writes nothing");
	}

	#[test]
	fn a_file_is_not_a_project() {
		let (_dir, root, mut registry) = fixture();
		let file = root.join("notes.txt");
		fs::write(&file, "not a project").expect("file");
		assert!(matches!(registry.add(&file), Err(Error::NotADirectory { .. })));
		assert!(registry.is_empty());
	}

	#[test]
	fn rename_changes_the_name_and_survives_a_reload() {
		let (dir, root, mut registry) = fixture();
		let row = registry.add(&project_dir(&root, "alpha")).expect("add");
		registry.rename(&row.id, "  Alpha 工作区 ").expect("rename");
		let file = dir.path().join(".zeta").join("projects.json");
		let reloaded = Registry::load_from(file).expect("reload");
		assert_eq!(reloaded.get(&row.id).expect("row").name, "Alpha 工作区");
		assert_eq!(reloaded.get(&row.id).expect("row").path, row.path, "the path is untouched");
		assert!(matches!(registry.rename(&row.id, "   "), Err(Error::InvalidName)));
		assert!(matches!(registry.rename("missing", "x"), Err(Error::NotFound { .. })));
	}

	#[test]
	fn remove_leaves_the_directory_and_the_file_consistent() {
		let (_dir, root, mut registry) = fixture();
		let path = project_dir(&root, "alpha");
		let row = registry.add(&path).expect("add");
		assert!(registry.remove(&row.id).expect("remove"));
		assert!(!registry.remove(&row.id).expect("second remove is a no-op"));
		assert!(path.is_dir(), "removing a registration never deletes the directory");
		assert!(registry.is_empty());
		assert!(
			Registry::load_from(registry.path())
				.expect("reload")
				.is_empty()
		);
	}

	#[test]
	fn a_malformed_file_is_reported_and_left_alone() {
		let (dir, ..) = fixture();
		let path = dir.path().join(".zeta").join("projects.json");
		fs::create_dir_all(path.parent().expect("parent")).expect("config dir");
		let garbage = "{ \"version\": 1, \"projects\": [ {";
		fs::write(&path, garbage).expect("write garbage");
		let error = Registry::load_from(&path).expect_err("malformed must be reported");
		assert!(matches!(error, Error::Malformed { .. }), "{error:?}");
		assert_eq!(fs::read_to_string(&path).expect("read"), garbage, "the file is not wiped");
	}

	#[test]
	fn an_unknown_version_is_reported() {
		let (dir, ..) = fixture();
		let path = dir.path().join(".zeta").join("projects.json");
		fs::create_dir_all(path.parent().expect("parent")).expect("config dir");
		fs::write(&path, "{\"version\": 99, \"projects\": []}").expect("write");
		assert!(matches!(
			Registry::load_from(&path),
			Err(Error::UnsupportedVersion { version: 99, .. })
		));
	}

	#[test]
	fn a_duplicate_id_in_the_file_is_malformed() {
		let (dir, ..) = fixture();
		let path = dir.path().join(".zeta").join("projects.json");
		fs::create_dir_all(path.parent().expect("parent")).expect("config dir");
		fs::write(
			&path,
			"{\"version\":1,\"projects\":[{\"id\":\"same\",\"name\":\"a\",\"path\":\"/a\",\"addedAt\"\
			 :0},{\"id\":\"same\",\"name\":\"b\",\"path\":\"/b\",\"addedAt\":0}]}",
		)
		.expect("write");
		assert!(matches!(Registry::load_from(&path), Err(Error::Malformed { .. })));
	}

	#[test]
	fn saves_are_atomic_and_leave_no_temporary_file() {
		let (dir, root, mut registry) = fixture();
		registry.add(&project_dir(&root, "alpha")).expect("add");
		let entries: Vec<String> = fs::read_dir(dir.path().join(".zeta"))
			.expect("dir")
			.map(|entry| {
				entry
					.expect("entry")
					.file_name()
					.to_string_lossy()
					.into_owned()
			})
			.collect();
		assert_eq!(entries, ["projects.json"], "only the registry remains: {entries:?}");
	}
}
