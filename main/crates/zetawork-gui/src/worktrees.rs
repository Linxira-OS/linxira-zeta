// SPDX-License-Identifier: AGPL-3.0-only
//! The right column's 工作树 page: the git worktrees of the active
//! conversation's repository, and the three actions the web UI's switcher has.
//!
//! A conversation is a gateway session with a `cwd`; that cwd is inside a
//! worktree. The page resolves the repository from that directory (never from
//! a guessed project root), lists every checkout, marks the one the
//! conversation runs in, and lets the user:
//!
//! * **create** — `git worktree add` under `<repo>-worktrees/<branch>` and
//!   point the workspace at the new checkout;
//! * **switch** — point the workspace at an existing checkout, so the file
//!   tree, git panel and every new terminal start there;
//! * **remove** — `git worktree remove`, with a second click for `--force`
//!   when git refuses a dirty checkout.
//!
//! The argv builders live in [`crate::git`] and the tests there pin them; this
//! module only decides *which* command a row runs. The workspace's branch is
//! never typed in: [`crate::git::read_status`] and the worktree's own `branch`
//! line are the only sources.

use std::{
	path::{Path, PathBuf},
	time::{Duration, Instant},
};

use crate::{
	Shell,
	git::{self, Worktree},
	state::RightTab,
	t, theme,
	widgets::{empty_note, panel_head, truncated_mono, truncated_text},
};

/// How often the page re-reads the worktree list while it is visible.
pub const REFRESH: Duration = Duration::from_secs(5);

/// The directory the page is about: the active conversation's cwd, else the
/// active workspace's root.
///
/// The conversation's own directory is the more precise answer — a session can
/// live in a linked worktree while its workspace was opened on the main
/// checkout — so it wins whenever an Agent tab names a session the gateway
/// list knows.
pub fn conversation_dir(state: &crate::state::AppState) -> Option<PathBuf> {
	if let Some(id) = state
		.active_session_tab()
		.and_then(|tab| tab.session.as_deref())
	{
		if let Some(entry) = state.conversation(id) {
			if !entry.conversation.cwd.as_os_str().is_empty() {
				return Some(entry.conversation.cwd.clone());
			}
		}
	}
	state
		.active_workspace()
		.map(|workspace| PathBuf::from(&workspace.path))
}

/// Does `worktree` contain `cwd`?
///
/// Both sides are canonicalised first, because git reports the real path while
/// a session may have been created with a symlinked or short one.
pub fn contains(worktree: &Path, cwd: &Path) -> bool {
	let worktree = crate::workspace_memory::canonical(worktree);
	let cwd = crate::workspace_memory::canonical(cwd);
	cwd == worktree || cwd.starts_with(&worktree)
}

/// The page's state.
#[derive(Default)]
pub struct WorktreeCache {
	/// The directory the rows were read for.
	dir: Option<PathBuf>,
	/// The repository root, `None` when the directory is not a checkout.
	repo: Option<PathBuf>,
	rows: Vec<Worktree>,
	error: Option<String>,
	loaded_at: Option<Instant>,
	/// The 新建工作树 field's branch name.
	pub draft: String,
	/// A removal waiting for its second click.
	pending_remove: Option<PathBuf>,
	/// The last action's line: `true` = done, `false` = git's refusal.
	pub notice: Option<(bool, String)>,
}

impl WorktreeCache {
	/// Re-read when the directory changed or the TTL has passed.
	pub fn refresh(&mut self, dir: &Path, now: Instant) {
		let changed = self.dir.as_deref() != Some(dir);
		if !changed
			&& self
				.loaded_at
				.is_some_and(|at| now.saturating_duration_since(at) < REFRESH)
		{
			return;
		}
		self.dir = Some(dir.to_path_buf());
		self.pending_remove = None;
		self.reload(now);
	}

	/// Re-read now (the refresh button, or after an action).
	pub fn reload(&mut self, now: Instant) {
		let Some(dir) = self.dir.clone() else {
			return;
		};
		match git::repo_root(&dir) {
			Ok(repo) => {
				self.repo = Some(repo.clone());
				match git::list_worktrees(&repo) {
					Ok(rows) => {
						self.rows = rows.into_iter().filter(|row| !row.prunable).collect();
						self.error = None;
					},
					Err(error) => {
						self.rows.clear();
						self.error = Some(error);
					},
				}
			},
			Err(error) => {
				self.repo = None;
				self.rows.clear();
				self.error = Some(error);
			},
		}
		self.loaded_at = Some(now);
	}

	pub fn rows(&self) -> &[Worktree] {
		&self.rows
	}

	pub fn repo(&self) -> Option<&Path> {
		self.repo.as_deref()
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	/// Seed the page (the headless screenshots and the pure tests).
	pub fn seed(&mut self, dir: PathBuf, repo: PathBuf, rows: Vec<Worktree>) {
		self.dir = Some(dir);
		self.repo = Some(repo);
		self.rows = rows;
		self.error = None;
		self.loaded_at = Some(Instant::now());
	}

	/// Which row a click on `path` would switch to.
	///
	/// The main checkout switches like any other; a row already containing the
	/// page's directory does nothing (switching to where you are is a no-op,
	/// not an error), and a detached/bare row has no branch to name.
	pub fn switch_target(&self, path: &Path) -> Option<&Worktree> {
		let dir = self.dir.as_deref()?;
		let row = self.rows.iter().find(|row| row.path == path)?;
		if row.bare || contains(&row.path, dir) {
			return None;
		}
		Some(row)
	}
}

/// The page.
pub fn panel(ui: &mut egui::Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Worktrees.title(), |ui| {
		if crate::icons::icon_button(ui, crate::icons::Icon::Refresh, 20.0, false, t!("重新读取工作树"))
			.clicked()
		{
			shell.worktrees.reload(Instant::now());
		}
	});
	let Some(dir) = conversation_dir(&shell.state) else {
		empty_note(ui, t!("没有打开的工作区"));
		return;
	};
	let now = Instant::now();
	shell.worktrees.refresh(&dir, now);
	let rows = shell.worktrees.rows().to_vec();
	let error = shell.worktrees.error().map(str::to_owned);

	ui.add_space(4.0);
	let (path_rect, _) =
		ui.allocate_exact_size(egui::vec2(ui.available_width(), 18.0), egui::Sense::hover());
	truncated_mono(
		ui,
		egui::pos2(path_rect.min.x + 8.0, path_rect.center().y),
		&dir.display().to_string(),
		10.0,
		theme::TEXT_3,
		path_rect.width() - 16.0,
	);
	ui.add_space(2.0);

	if let Some((ok, line)) = shell.worktrees.notice.clone() {
		truncated_text(
			ui,
			egui::pos2(ui.cursor().min.x + 8.0, ui.cursor().min.y + 8.0),
			&line,
			10.5,
			if ok { theme::ADD } else { theme::WARN },
			ui.available_width() - 16.0,
		);
		ui.add_space(18.0);
	}

	if rows.is_empty() {
		match error {
			Some(error) => empty_note(ui, &t!("无法读取工作树：{}", error)),
			None => empty_note(ui, t!("这个目录不在 git 仓库里")),
		}
		return;
	}

	let mut target: Option<PathBuf> = None;
	let mut remove: Option<PathBuf> = None;
	egui::ScrollArea::vertical()
		.id_salt("zetawork-worktrees")
		.max_height(ui.available_height() - 96.0)
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 2.0;
			for (index, row) in rows.iter().enumerate() {
				let here = contains(&row.path, &dir);
				let current = shell
					.state
					.active_workspace()
					.map(|workspace| {
						crate::workspace_memory::canonical(Path::new(&workspace.path)) == row.path
					})
					.unwrap_or(false);
				let (rect, response) = ui.allocate_exact_size(
					egui::vec2(ui.available_width(), 40.0),
					egui::Sense::click(),
				);
				if response.hovered() {
					ui.painter().rect_filled(
						rect.shrink2(egui::vec2(4.0, 0.0)),
						egui::CornerRadius::same(theme::R_CONTROL),
						theme::PANEL_3,
					);
				}
				let mut badges = String::new();
				if index == 0 {
					badges.push_str(t!("主工作树 "));
				}
				if here {
					badges.push_str(t!("会话 "));
				}
				if current {
					badges.push_str(t!("当前"));
				}
				if row.locked {
					badges.push_str(t!(" 已锁定"));
				}
				truncated_text(
					ui,
					egui::pos2(rect.min.x + 12.0, rect.center().y - 7.0),
					&row.label(),
					12.0,
					theme::TEXT,
					rect.width() - 60.0,
				);
				truncated_mono(
					ui,
					egui::pos2(rect.min.x + 12.0, rect.center().y + 8.0),
					&row.path.display().to_string(),
					9.5,
					theme::TEXT_3,
					rect.width() - 60.0,
				);
				if !badges.trim().is_empty() {
					crate::widgets::chip(
						ui,
						badges.trim(),
						if here {
							crate::widgets::Chip::Active
						} else {
							crate::widgets::Chip::Plain
						},
					);
				}
				let pending = shell.worktrees.pending_remove.as_deref() == Some(row.path.as_path());
				if response.clicked() {
					if index > 0 && pending {
						remove = Some(row.path.clone());
					} else {
						target = Some(row.path.clone());
					}
				}
				if response.secondary_clicked() && index > 0 {
					shell.worktrees.pending_remove = Some(row.path.clone());
					shell.worktrees.notice = Some((
						false,
						t!("再次点击该行以移除工作树 {}", row.path.display()),
					));
				}
			}
		});

	// 新建工作树: a branch name, then the checkout under `<repo>-worktrees/`.
	ui.add_space(8.0);
	truncated_text(
		ui,
		egui::pos2(ui.cursor().min.x + 8.0, ui.cursor().min.y + 6.0),
		t!("新建工作树"),
		10.5,
		theme::TEXT_3,
		ui.available_width() - 16.0,
	);
	ui.add_space(14.0);
	ui.horizontal(|ui| {
		ui.add_space(6.0);
		ui.add(
			egui::TextEdit::singleline(&mut shell.worktrees.draft)
				.hint_text(t!("分支名，例如 feat/worktree"))
				.desired_width(ui.available_width() - 70.0),
		);
		if ui
			.button(t!("新建"))
			.clicked()
			&& !shell.worktrees.draft.trim().is_empty()
		{
			create(shell, &dir);
		}
	});

	if let Some(path) = target {
		switch(shell, &path);
	}
	if let Some(path) = remove {
		remove_worktree(shell, &path, &dir);
	}
}

/// Point the active workspace at `path`, taking the branch from the checkout.
fn switch(shell: &mut Shell, path: &Path) {
	let Some(row) = shell.worktrees.switch_target(path).cloned() else {
		// Already there (or a detached row): say so instead of running git.
		if shell.worktrees.rows().iter().any(|row| row.path == path) {
			shell.worktrees.notice = Some((true, t!("已经在这个工作树里").to_owned()));
		}
		return;
	};
	let branch = row
		.branch
		.clone()
		.unwrap_or_else(|| git::read_status(path, 0).branch);
	let notice = shell.retarget_workspace(path, &branch);
	if notice.0.is_empty() {
		shell.worktrees.notice =
			Some((true, t!("已切换到工作树 {}", row.label())));
		shell.worktrees.refresh(path, Instant::now());
		shell.refresh_git();
	} else {
		shell.worktrees.notice = Some((false, notice.0));
	}
}

/// Create a worktree for the draft branch and move the workspace into it.
fn create(shell: &mut Shell, dir: &Path) {
	let branch = shell.worktrees.draft.trim().to_owned();
	let Some(workspace) = shell.state.active_workspace().map(|w| w.id.clone()) else {
		shell.worktrees.notice = Some((false, t!("没有打开的工作区").to_owned()));
		return;
	};
	let base = shell
		.worktrees
		.repo()
		.map(Path::to_path_buf)
		.unwrap_or_else(|| dir.to_path_buf());
	match git::add_worktree(&base, &branch) {
		Ok(path) => {
			let _ = workspace;
			shell.worktrees.draft.clear();
			let notice = shell.retarget_workspace(&path, &branch);
			shell.worktrees.notice = Some((
				notice.0.is_empty(),
				if notice.0.is_empty() {
					t!("已创建工作树 {}（{}）", branch, path.display())
				} else {
					notice.0
				},
			));
			shell.worktrees.dir = Some(path.clone());
			shell.worktrees.reload(Instant::now());
			shell.refresh_git();
		},
		Err(error) => shell.worktrees.notice = Some((false, error)),
	}
}

/// Remove `path`, asking git for `--force` only on the confirming click.
fn remove_worktree(shell: &mut Shell, path: &Path, dir: &Path) {
	let base = shell
		.worktrees
		.repo()
		.map(Path::to_path_buf)
		.unwrap_or_else(|| dir.to_path_buf());
	match git::remove_worktree(&base, path, false) {
		Ok(()) => {
			shell.worktrees.pending_remove = None;
			shell.worktrees.notice = Some((true, t!("已移除工作树 {}", path.display())));
		},
		Err(error) => {
			// git refuses a dirty checkout; the next click on the same row
			// forces it, which is the confirmation the web UI also asks for.
			shell.worktrees.pending_remove = Some(path.to_path_buf());
			shell.worktrees.notice =
				Some((false, t!("{}（再次点击该行强制移除）", error)));
		},
	}
	shell.worktrees.reload(Instant::now());
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::state::AppState;

	fn worktree(path: &str, branch: Option<&str>) -> Worktree {
		Worktree {
			path: PathBuf::from(path),
			branch: branch.map(str::to_owned),
			..Default::default()
		}
	}

	fn state(dir: &Path) -> AppState {
		AppState::seeded_with_registry(
			dir,
			workbench_projects::Registry::empty_at(dir.join("projects.json")),
		)
	}

	#[test]
	fn the_page_follows_the_active_conversation_then_the_workspace() {
		let root = std::env::temp_dir().join(format!("zetawork-gui-wt-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&root);
		std::fs::create_dir_all(&root).unwrap();
		let mut state = state(&root);
		let workspace = state.projects[0].workspaces[0].path.clone();
		assert_eq!(conversation_dir(&state), Some(PathBuf::from(&workspace)));

		let session_dir = root.join("linked");
		std::fs::create_dir_all(&session_dir).unwrap();
		let conversation = crate::sessions::Conversation {
			id: "s1".to_owned(),
			cwd: session_dir.clone(),
			title: "Work".to_owned(),
			modified_ms: 1,
			message_count: 1,
			running: false,
		};
		state.set_conversations(vec![conversation]);
		let ws_id = state.conversations[0]
			.workspace_id
			.clone()
			.expect("the local workspace owns the directory");
		let title = state.conversations[0].conversation.display_title().to_owned();
		state.attach_conversation(&ws_id, "s1", &title);
		assert_eq!(
			conversation_dir(&state),
			Some(session_dir),
			"an attached Agent tab wins over the workspace root"
		);
		let _ = std::fs::remove_dir_all(&root);
	}

	#[test]
	fn containment_is_prefix_based_and_rows_mark_the_right_things() {
		assert!(contains(Path::new("/work/zeta"), Path::new("/work/zeta/src")));
		assert!(contains(Path::new("/work/zeta"), Path::new("/work/zeta")));
		assert!(!contains(Path::new("/work/zeta"), Path::new("/work/zeta-two")));

		let mut cache = WorktreeCache::default();
		cache.seed(
			PathBuf::from("/work/zeta-worktrees/feat-x"),
			PathBuf::from("/work/zeta"),
			vec![
				worktree("/work/zeta", Some("main")),
				worktree("/work/zeta-worktrees/feat-x", Some("feat/x")),
			],
		);
		assert_eq!(cache.rows().len(), 2);
		assert_eq!(cache.repo(), Some(Path::new("/work/zeta")));
		assert!(
			cache.switch_target(Path::new("/work/zeta-worktrees/feat-x")).is_none(),
			"switching to where the conversation already is is a no-op"
		);
		let target = cache
			.switch_target(Path::new("/work/zeta"))
			.expect("the main checkout is a target");
		assert_eq!(target.branch.as_deref(), Some("main"));
		assert!(cache.switch_target(Path::new("/elsewhere")).is_none());

		let mut detached = WorktreeCache::default();
		detached.seed(
			PathBuf::from("/work/a"),
			PathBuf::from("/work/a"),
			vec![Worktree { path: PathBuf::from("/work/a"), bare: true, ..Default::default() }],
		);
		assert!(detached.switch_target(Path::new("/work/a")).is_none(), "a bare row has no target");
	}

	#[test]
	fn a_new_workspace_reads_its_branch_and_can_be_repointed() {
		let repo = std::env::temp_dir().join(format!("zetawork-gui-wt-repo-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&repo);
		std::fs::create_dir_all(&repo).unwrap();
		let run = |args: &[&str]| {
			let out = std::process::Command::new("git")
				.arg("-C")
				.arg(&repo)
				.args(args)
				.output()
				.expect("git must be on PATH for this test");
			assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
		};
		run(&["init", "--quiet"]);
		std::fs::write(repo.join("a.txt"), "a\n").unwrap();
		run(&["add", "a.txt"]);
		run(&[
			"-c",
			"user.email=zetawork@test",
			"-c",
			"user.name=zetawork",
			"commit",
			"--quiet",
			"-m",
			"seed",
		]);
		let mut state = state(&repo);
		let project = state.active_project().expect("a project").id.clone();
		state.new_workspace(&project);
		let project_row = state.project(&project).expect("the project");
		let fresh = project_row.workspaces.last().expect("a new workspace").clone();
		let expected = crate::git::read_status(&repo, 0).branch;
		assert_eq!(fresh.branch, expected, "the branch is read from git, not typed in");
		assert!(!fresh.branch.is_empty());
		let ws = fresh.id.clone();
		let moved = state.retarget_workspace(Path::new("/work/other"), "feat/x");
		assert!(moved.0.is_empty(), "{moved:?}");
		let row = state.workspace(&ws).expect("the workspace");
		assert_eq!(row.path, "/work/other");
		assert_eq!(row.branch, "feat/x");
		let _ = std::fs::remove_dir_all(&repo);
	}
}
