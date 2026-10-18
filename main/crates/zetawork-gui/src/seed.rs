// SPDX-License-Identifier: AGPL-3.0-only
//! The shell's starting data: the pseudo-project for the directory the shell
//! was started in and one project per registration in `~/.zeta/projects.json`.
//!
//! Everything here reflects real state:
//!
//! * 本机 is the process's own directory: a pseudo-entry that is **not** a
//!   registry row. Its path is the working directory and its branch is read
//!   from `git`.
//! * Every other project comes from the shared registry
//!   ([`workbench_projects`]); its path is a directory the user registered.
//! * A fresh workspace opens **one** pane holding one real terminal page.

use std::path::Path;

use crate::git;
use crate::state::{Pane, Project, SessionKind, SessionTab, Workspace};

/// The heading 本机's pseudo-project gets.
pub const LOCAL_PROJECT: &str = "本机";

/// Every start: 本机 first, then one project per registry row.
pub fn projects(cwd: &Path, registered: &[workbench_projects::Project]) -> Vec<Project> {
	let mut projects = vec![local_project(cwd)];
	projects.extend(registered.iter().map(registered_project));
	projects
}

/// The project for the directory the shell runs in: real path, real branch.
pub fn local_project(cwd: &Path) -> Project {
	let name = cwd
		.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.filter(|name| !name.is_empty())
		.unwrap_or_else(|| cwd.display().to_string());
	let status = git::read_status(cwd, 0);
	// A path with no repository is not a problem: the workspace keeps `—` and
	// the git panel explains itself.
	let branch = if status.branch.is_empty() {
		"—".to_owned()
	} else {
		status.branch.clone()
	};
	let mut workspace = Workspace {
		id: "ws-local".to_owned(),
		name,
		branch,
		path: cwd.display().to_string(),
		cols: 1,
		panes: Vec::new(),
		// Nothing observes this directory's state: there is no session state
		// machine, so the row shows `—` rather than a word from the seven that
		// nothing produced.
		run_state: None,
	};
	workspace.panes = default_panes("ws-local");
	Project {
		id: "p-local".to_owned(),
		name: LOCAL_PROJECT.to_owned(),
		path: cwd.to_path_buf(),
		workspaces: vec![workspace],
	}
}

/// One registered project as the GUI models it: a real path, a real branch,
/// and one workspace over that path. The registry owns the registration; the
/// workspace is the shell's own working set.
pub fn registered_project(entry: &workbench_projects::Project) -> Project {
	let status = git::read_status(&entry.path, 0);
	let branch = if status.branch.is_empty() {
		"—".to_owned()
	} else {
		status.branch.clone()
	};
	let ws_id = format!("{}-ws", entry.id);
	Project {
		id: entry.id.clone(),
		name: entry.name.clone(),
		path: entry.path.clone(),
		workspaces: vec![Workspace {
			id: ws_id.clone(),
			name: entry.name.clone(),
			branch,
			path: entry.path.display().to_string(),
			cols: 1,
			panes: default_panes(&ws_id),
			run_state: None,
		}],
	}
}

/// The layout a workspace opens on: **one** pane holding one terminal page.
///
/// The maintainer's ruling (2026-10-18): a fresh workspace gets a single pane,
/// running a real terminal in the workspace directory. 分屏 is the user's
/// action, not the seed; a workspace that was split keeps its saved layout when
/// it is restored — this function only says what a workspace with no saved
/// state starts as.
pub fn default_panes(ws_id: &str) -> Vec<Pane> {
	let pane_id = format!("{ws_id}-p1");
	let term_id = format!("{pane_id}-t1");
	vec![Pane {
		id: pane_id,
		active: term_id.clone(),
		tabs: vec![SessionTab::new(term_id, SessionKind::Term, "终端 1".to_owned())],
	}]
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_local_pseudo_project_comes_first_and_reads_its_branch() {
		let cwd = std::env::current_dir().unwrap();
		let projects = projects(&cwd, &[]);
		assert_eq!(projects.len(), 1, "本机 与 no registrations");
		assert_eq!(projects[0].name, LOCAL_PROJECT);
		assert_eq!(projects[0].workspaces[0].path, cwd.display().to_string());
		assert!(!projects[0].workspaces[0].branch.is_empty());
		assert_eq!(projects[0].workspaces[0].panes.len(), 1, "a fresh workspace opens one pane");
		assert_eq!(projects[0].workspaces[0].cols, 1);
	}

	#[test]
	fn a_registration_becomes_one_real_project() {
		let dir = tempfile::tempdir().expect("temp dir");
		let path = dir.path().join("demo");
		std::fs::create_dir_all(&path).unwrap();
		let entry = workbench_projects::Project {
			id: "p-1".to_owned(),
			name: "演示".to_owned(),
			path: path.clone(),
			added_at: 0,
		};
		let project = registered_project(&entry);
		assert_eq!(project.id, "p-1");
		assert_eq!(project.name, "演示");
		assert_eq!(project.path, path);
		assert_eq!(project.workspaces.len(), 1);
		assert_eq!(project.workspaces[0].path, path.display().to_string());
		assert_eq!(project.workspaces[0].panes.len(), 1);
		assert_eq!(project.workspaces[0].cols, 1);
		assert!(project.workspaces[0].run_state.is_none(), "nothing observes it yet");
	}

	#[test]
	fn the_seeded_workspace_is_exactly_one_terminal_and_no_documents() {
		let cwd = std::env::current_dir().unwrap();
		let panes = &local_project(&cwd).workspaces[0].panes;
		assert_eq!(panes.len(), 1, "one pane");
		assert_eq!(panes[0].tabs.len(), 1, "one tab");
		assert_eq!(panes[0].tabs[0].kind, SessionKind::Term, "and it is a terminal");
		assert!(panes[0].tabs[0].doc.is_none(), "no fabricated editor document");
		assert!(panes[0].tabs[0].command.is_none(), "nothing is typed into the shell");
		assert_eq!(panes[0].active, panes[0].tabs[0].id);
	}

	#[test]
	fn a_registered_workspace_gets_the_same_single_terminal() {
		let dir = tempfile::tempdir().expect("temp dir");
		let entry = workbench_projects::Project {
			id: "p-2".to_owned(),
			name: "项目".to_owned(),
			path: dir.path().to_path_buf(),
			added_at: 0,
		};
		let pane = &registered_project(&entry).workspaces[0].panes[0];
		assert_eq!(pane.tabs.len(), 1);
		assert_eq!(pane.tabs[0].kind, SessionKind::Term);
		assert!(pane.tabs[0].doc.is_none());
	}
}
