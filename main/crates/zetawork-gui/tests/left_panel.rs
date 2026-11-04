// SPDX-License-Identifier: AGPL-3.0-only
//! Left-column lifecycle contracts, against the public surface only.
//!
//! These cover the three destructive-looking actions the left tree offers and
//! the close policy behind a tab's ✕:
//!
//! * 仅从视图移除 closes the session's tabs and keeps the conversation row;
//! * 移除工作区 removes the UI workspace and never touches the directory;
//! * 删除会话 only arms the modal on its first click — the soft delete into
//!   `~/.zeta/trash/sessions` is the gateway's second-click action;
//! * closing an Agent / editor / terminal tab follows its own rule, without a
//!   live gateway or PTY.
//!
//! Every state here is seeded over a temp registry, so no test reads or writes
//! `~/.zeta/projects.json`, the user's sessions, or a real checkout.

use std::path::Path;

use zetawork_gui::{
	Shell,
	left::{focus_order, step_focus},
	session_admin,
	sessions::Conversation,
	settings::Settings,
	state::{AppState, DEFAULT_PROJECT_ID, DEFAULT_WORKSPACE_ID, LeftFocus, SessionKind},
};

/// A shell over `root`: the 本机 project points at the temp directory and the
/// registry file lives beside it, so nothing escapes the temp tree.
fn shell_in(root: &Path) -> Shell {
	let registry = workbench_projects::Registry::empty_at(root.join("projects.json"));
	let state = AppState::seeded_with_registry(root, registry);
	Shell::with_state(state, Settings::default())
}

fn conversation(id: &str, cwd: &Path) -> Conversation {
	Conversation {
		id: id.to_owned(),
		cwd: cwd.to_path_buf(),
		title: format!("会话 {id}"),
		modified_ms: 1,
		message_count: 0,
		running: false,
	}
}

/// The active workspace's first pane — where a conversation opens.
fn first_pane(shell: &Shell) -> String {
	shell.state.active_workspace().unwrap().panes[0].id.clone()
}

#[test]
fn remove_conversation_view_closes_its_tabs_and_keeps_the_row() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	shell
		.state
		.set_conversations(vec![conversation("s-view", dir.path())]);

	assert!(shell.state.open_conversation("s-view").0.is_empty());
	let pane = first_pane(&shell);
	assert!(
		shell
			.state
			.add_tab_of(&pane, SessionKind::Term, "终端 2".to_owned())
			.0
			.is_empty()
	);
	assert_eq!(shell.state.tabs_for_session("s-view").len(), 1);

	// The notice counts the closed tab; the row's survival is the contract.
	let _ = shell.remove_conversation_view("s-view");
	assert!(shell.state.tabs_for_session("s-view").is_empty(), "the Agent tab is gone");
	assert!(shell.state.conversation("s-view").is_some(), "仅从视图移除 keeps the conversation row");
	let tabs = &shell.state.active_workspace().unwrap().panes[0].tabs;
	// The seeded workspace starts with its own 终端; the Agent tab is the
	// only thing this action removes.
	assert_eq!(tabs.len(), 2, "the terminal tabs stay");
	assert!(tabs.iter().all(|tab| tab.kind == SessionKind::Term));
}

#[test]
fn remove_conversation_view_leaves_the_last_tab_in_a_pane() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	shell
		.state
		.set_conversations(vec![conversation("s-only", dir.path())]);
	assert!(shell.state.open_conversation("s-only").0.is_empty());
	// Leave the Agent tab alone in the pane; the seeded 终端 is closed first.
	let pane = first_pane(&shell);
	let terminal = shell.state.active_workspace().unwrap().panes[0]
		.tabs
		.iter()
		.find(|tab| tab.kind == SessionKind::Term)
		.unwrap()
		.id
		.clone();
	assert!(shell.state.close_tab(&pane, &terminal).0.is_empty());

	// The pane would be empty, so the close rule refuses; the row is still
	// there because this action never deletes anything.
	let notice = shell.remove_conversation_view("s-only");
	assert!(!notice.0.is_empty(), "the refusal is reported");
	assert_eq!(shell.state.tabs_for_session("s-only").len(), 1, "至少保留一个小标签页");
	assert!(shell.state.conversation("s-only").is_some());
}

#[test]
fn remove_workspace_view_never_touches_the_directory() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	let project = shell.state.active_project.clone().unwrap();
	assert!(shell.state.new_workspace(&project).0.is_empty());
	let workspace = shell
		.state
		.project(&project)
		.unwrap()
		.workspaces
		.last()
		.unwrap()
		.id
		.clone();

	let checkout = dir.path().join("checkout-two");
	std::fs::create_dir_all(&checkout).unwrap();
	let sentinel = checkout.join("keep.txt");
	std::fs::write(&sentinel, "keep").unwrap();
	assert!(
		shell
			.state
			.retarget(workspace.clone(), &checkout, "feature")
			.0
			.is_empty()
	);
	// A row that lives under the workspace must survive as a conversation;
	// it is not opened, so removal has no tab to close or archive.
	shell
		.state
		.set_conversations(vec![conversation("s-ws", &checkout)]);

	let notice = shell.remove_workspace_view(&workspace);
	assert!(notice.0.is_empty(), "removed from the UI: {}", notice.0);
	assert!(shell.state.workspace(&workspace).is_none(), "workspace is gone");
	assert!(checkout.is_dir(), "the directory is the user's");
	assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "keep", "files are untouched");
	assert!(
		shell.state.conversation("s-ws").is_some(),
		"the conversation row is not deleted with the view"
	);
}

#[test]
fn request_delete_conversation_arms_the_modal_without_deleting() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	shell
		.state
		.set_conversations(vec![conversation("s-del", dir.path())]);
	assert!(shell.state.open_conversation("s-del").0.is_empty());

	let notice = shell.request_delete_conversation("s-del");
	assert!(notice.0.is_empty(), "opening the modal is not a failure");
	assert!(shell.state.sessions_open, "会话管理 is open");
	assert_eq!(shell.session_admin.query, "s-del");
	assert_eq!(shell.session_admin.tab, session_admin::Tab::Active);
	assert!(shell.session_admin.notice.is_some(), "the row is already armed for 确认删除");
	assert!(!shell.session_admin.is_busy("s-del"), "no DELETE request was sent");
	assert!(shell.state.conversation("s-del").is_some(), "the transcript is untouched");
	assert_eq!(shell.state.tabs_for_session("s-del").len(), 1, "the open tab is untouched");
}

#[test]
fn prepare_delete_only_arms_the_second_click() {
	let mut admin = session_admin::Admin::default();
	admin.prepare_delete("abc");
	assert_eq!(admin.query, "abc");
	assert_eq!(admin.tab, session_admin::Tab::Active);
	assert!(!admin.is_busy("abc"), "prepare never starts a request");
	assert!(admin.notice.is_some());
	assert!(admin.error().is_none());
}

#[test]
fn closing_an_agent_tab_removes_it_and_keeps_the_terminal() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	shell
		.state
		.set_conversations(vec![conversation("s-close", dir.path())]);
	assert!(shell.state.open_conversation("s-close").0.is_empty());
	let pane = first_pane(&shell);
	assert!(
		shell
			.state
			.add_tab_of(&pane, SessionKind::Term, "终端 2".to_owned())
			.0
			.is_empty()
	);
	let (pane, tab) = shell.state.tabs_for_session("s-close")[0].clone();

	// With no gateway origin the archive cannot go out, but the tab must still
	// close; the notice carries the failure and does not keep the view open.
	let notice = shell.close_tab_saving(&pane, &tab);
	assert!(!notice.0.is_empty(), "the missing gateway is reported");
	assert!(shell.state.tabs_for_session("s-close").is_empty());
	let tabs = &shell.state.active_workspace().unwrap().panes[0].tabs;
	assert_eq!(tabs.len(), 2, "the seeded and added terminals stay");
	assert!(tabs.iter().all(|tab| tab.kind == SessionKind::Term));
}

#[test]
fn closing_a_dirty_editor_tab_saves_before_removing_it() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	let file = dir.path().join("note.txt");
	std::fs::write(&file, "before").unwrap();
	let pane = first_pane(&shell);
	assert!(
		shell
			.state
			.add_tab_of(&pane, SessionKind::Term, "终端".to_owned())
			.0
			.is_empty()
	);
	assert!(shell.state.open_file(&pane, &file).0.is_empty());
	let tab = shell.state.active_session_tab().unwrap().id.clone();
	{
		let doc = shell.state.doc_mut(&pane, &tab).unwrap();
		doc.text = "after".to_owned();
		doc.dirty = true;
	}

	let notice = shell.close_tab_saving(&pane, &tab);
	assert!(notice.0.is_empty(), "save succeeded: {}", notice.0);
	assert_eq!(
		std::fs::read_to_string(&file).unwrap(),
		"after",
		"the buffer was written before the tab went away"
	);
	let tabs = &shell.state.active_workspace().unwrap().panes[0].tabs;
	assert_eq!(tabs.len(), 2, "the seeded and added terminals stay");
	assert!(tabs.iter().all(|tab| tab.kind == SessionKind::Term));
}

#[test]
fn closing_a_terminal_tab_removes_only_that_tab() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	let pane = first_pane(&shell);
	assert!(
		shell
			.state
			.add_tab_of(&pane, SessionKind::Term, "终端 1".to_owned())
			.0
			.is_empty()
	);
	assert!(
		shell
			.state
			.add_tab_of(&pane, SessionKind::Term, "终端 2".to_owned())
			.0
			.is_empty()
	);
	let closing = shell.state.active_session_tab().unwrap().id.clone();

	let notice = shell.close_tab_saving(&pane, &closing);
	assert!(notice.0.is_empty(), "closed: {}", notice.0);
	let tabs = &shell.state.active_workspace().unwrap().panes[0].tabs;
	assert_eq!(tabs.len(), 2, "the seeded and the other added terminal stay");
	assert!(tabs.iter().all(|tab| tab.kind == SessionKind::Term));
	assert!(tabs.iter().all(|tab| tab.id != closing));
}

#[test]
fn focus_order_is_the_pinned_block_then_the_active_project_tree() {
	let dir = tempfile::tempdir().unwrap();
	let mut state = AppState::seeded_with_registry(
		dir.path(),
		workbench_projects::Registry::empty_at(dir.path().join("projects.json")),
	);
	let local_project = state.active_project.clone().unwrap();
	let local_workspace = state.active_workspace.clone().unwrap();
	state.set_conversations(vec![conversation("s-focus", dir.path())]);

	let order = focus_order(&state);
	assert_eq!(
		order.first(),
		Some(&LeftFocus::Workspace(DEFAULT_WORKSPACE_ID.to_owned())),
		"the pinned 默认工作区 comes first"
	);
	assert!(
		!order.contains(&LeftFocus::Project(DEFAULT_PROJECT_ID.to_owned())),
		"the system project has no focusable heading"
	);
	let project = order
		.iter()
		.position(|row| row == &LeftFocus::Project(local_project.clone()))
		.expect("the active project is focusable");
	let workspace = order
		.iter()
		.position(|row| row == &LeftFocus::Workspace(local_workspace.clone()))
		.expect("the active workspace is focusable");
	let conversation = order
		.iter()
		.position(|row| row == &LeftFocus::Conversation("s-focus".to_owned()))
		.expect("the conversation row is focusable");
	assert!(project < workspace, "a project precedes its workspaces");
	assert!(workspace < conversation, "a workspace precedes its conversations");
}

#[test]
fn step_focus_clamps_and_starts_from_the_edge_when_focus_is_hidden() {
	let order = vec![
		LeftFocus::Project("p".to_owned()),
		LeftFocus::Workspace("w".to_owned()),
		LeftFocus::Conversation("c".to_owned()),
	];
	assert_eq!(step_focus(&order, None, 1), Some(order[0].clone()));
	assert_eq!(step_focus(&order, None, -1), Some(order[2].clone()));
	assert_eq!(step_focus(&order, Some(&order[0]), 1), Some(order[1].clone()));
	assert_eq!(step_focus(&order, Some(&order[1]), -1), Some(order[0].clone()));
	assert_eq!(step_focus(&order, Some(&order[2]), 1), Some(order[2].clone()));
	assert_eq!(step_focus(&order, Some(&order[0]), -1), Some(order[0].clone()));
	// A row removed by a refresh no longer matches: the walk restarts at the
	// edge the step points at rather than guessing a neighbour.
	let stale = LeftFocus::Conversation("gone".to_owned());
	assert_eq!(step_focus(&order, Some(&stale), 1), Some(order[0].clone()));
	assert_eq!(step_focus(&order, Some(&stale), -1), Some(order[2].clone()));
	assert_eq!(step_focus(&[], None, 1), None);
}

#[test]
fn close_and_archive_removes_the_view_but_never_the_row() {
	let dir = tempfile::tempdir().unwrap();
	let mut shell = shell_in(dir.path());
	shell
		.state
		.set_conversations(vec![conversation("s-arch", dir.path())]);
	assert!(shell.state.open_conversation("s-arch").0.is_empty());
	let pane = first_pane(&shell);
	assert!(
		shell
			.state
			.add_tab_of(&pane, SessionKind::Term, "终端 2".to_owned())
			.0
			.is_empty()
	);

	// No gateway is reachable in the test, so the archive leg fails; the view
	// must still close and the conversation row must survive — this action is
	// recoverable, not a delete.
	let notice = shell.close_conversation_and_archive("s-arch");
	assert!(!notice.0.is_empty(), "the failed archive is reported");
	assert!(shell.state.tabs_for_session("s-arch").is_empty());
	assert!(shell.state.conversation("s-arch").is_some());
}
