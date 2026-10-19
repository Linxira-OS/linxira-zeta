// SPDX-License-Identifier: AGPL-3.0-only
//! The desktop app's self-update: check GitHub through the shipped `zetacode`.
//!
//! The GUI has no TLS client of its own (`usage::api` documents the one
//! loopback `GET` this crate owns), so every byte of network work is the
//! companion CLI's:
//!
//! * `zetacode update --desktop --check` prints one JSON object — the running
//!   version, the newest published desktop release, its installer asset, the
//!   download URL, size and SHA-256 digest;
//! * `zetacode update --desktop` downloads that installer, verifies the size
//!   and digest, starts it silently (`/S`) detached, and returns.
//!
//! Both calls run on a worker thread and are polled once per frame, in the
//! same shape as the 设置 modal's [`crate::settings_ui::ZetacodeCache`]: no
//! network or installer work ever happens on the UI thread. A headless shell
//! (`Shell::probe == false`) starts no job at all, so the tests render the
//! control without spawning anything.
//!
//! # What is drawn from what
//!
//! A check result is compared numerically against the running version
//! ([`compare_versions`]); `available` in the CLI's JSON is not trusted for
//! the install decision, so a stale or hand-edited answer cannot make the GUI
//! offer a downgrade. [`UpdateCache::can_install`] is the single gate the
//! status bar and the modal both read.

use crate::t;
use std::{
	cmp::Ordering,
	sync::mpsc::{Receiver, TryRecvError, channel},
};

/// One `zetacode update --desktop --check` answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopUpdate {
	pub current: String,
	pub latest: String,
	pub available: bool,
	/// Installer file name, `zetawork-<latest>-setup-x64.exe`.
	pub asset: String,
	pub url: String,
	pub size: u64,
	pub digest: String,
}

impl DesktopUpdate {
	/// Parse the single JSON object the CLI prints.
	///
	/// `available` is derived from the two versions rather than read from the
	/// document: it is the one field the install decision depends on, and a
	/// disagreement between the CLI's build and the GUI's must not turn into
	/// an offered downgrade.
	pub fn parse(text: &str) -> Result<Self, String> {
		let value: serde_json::Value = serde_json::from_str(text.trim())
			.map_err(|err| t!("更新检查的输出无法解析：{}", err).to_string())?;
		let current = text_field(&value, "current")?;
		let latest = text_field(&value, "latest")?;
		Ok(Self {
			available: compare_versions(&latest, &current) == Ordering::Greater,
			current,
			latest,
			asset: text_field(&value, "asset")?,
			url: text_field(&value, "url")?,
			size: value
				.get("size")
				.and_then(serde_json::Value::as_u64)
				.ok_or_else(|| "更新检查的输出缺少 size".to_owned())?,
			digest: text_field(&value, "digest")?,
		})
	}
}

/// One string member of the check JSON, or the field that is missing.
fn text_field(value: &serde_json::Value, key: &str) -> Result<String, String> {
	value
		.get(key)
		.and_then(serde_json::Value::as_str)
		.map(str::to_owned)
		.ok_or_else(|| format!("更新检查的输出缺少 {key}"))
}

/// Compare dotted version strings the way release names are ordered.
///
/// One leading `v`/`V` is ignored, a `-prerelease`/`+build` suffix is cut,
/// and missing trailing segments count as 0 (`1.2` == `1.2.0`). A malformed
/// segment counts as 0, so this never panics on a hand-written tag; the
/// stable channel only publishes dotted numeric tags anyway.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
	let parse = |value: &str| -> Vec<u64> {
		let value = value.trim();
		let value = value.strip_prefix('v').unwrap_or(value);
		let value = value.strip_prefix('V').unwrap_or(value);
		let value = value.split(['-', '+']).next().unwrap_or(value);
		value
			.split('.')
			.map(|part| part.parse::<u64>().unwrap_or(0))
			.collect()
	};
	let (left, right) = (parse(a), parse(b));
	for index in 0..left.len().max(right.len()) {
		let ordering = left
			.get(index)
			.copied()
			.unwrap_or(0)
			.cmp(&right.get(index).copied().unwrap_or(0));
		if ordering != Ordering::Equal {
			return ordering;
		}
	}
	Ordering::Equal
}

/// One worker's result.
enum Outcome {
	Checked(Result<DesktopUpdate, String>),
	Installed(Result<(), String>),
}

/// What the shell does with a landed job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
	/// A check succeeded; the cache now holds the answer.
	Checked,
	/// A check or the install failed; [`UpdateCache::error`] carries why.
	Failed,
	/// The installer is running; the shell quits so the install can replace
	/// the files it owns.
	Installed,
}

/// The update control's state and its single worker.
///
/// `checked_once` is what makes `update.check_on_start = true` one request per
/// process instead of one per frame, and what keeps a manual 检查更新 click
/// from queueing a second CLI behind the first.
#[derive(Default)]
pub struct UpdateCache {
	job: Option<Receiver<Outcome>>,
	update: Option<DesktopUpdate>,
	checking: bool,
	installing: bool,
	error: Option<String>,
	checked_once: bool,
}

impl UpdateCache {
	/// A cache that already holds a check result — the headless checks and the
	/// status-bar screenshots use this; it never spawns.
	pub fn loaded(update: DesktopUpdate) -> Self {
		Self { update: Some(update), ..Self::default() }
	}

	/// Start `zetacode update --desktop --check` on a worker thread.
	///
	/// A job already in flight wins: the click is a no-op rather than a second
	/// process. The error from the previous attempt is cleared as soon as a
	/// retry starts, so the status bar stops saying 更新失败 while it runs.
	pub fn start_check(&mut self) {
		if self.job.is_some() {
			return;
		}
		self.checking = true;
		self.error = None;
		self.job = Some(spawn(|| Outcome::Checked(check())));
	}

	/// Start the startup check once, and only when this shell is a real run.
	///
	/// `probe` is [`crate::Shell::probe`]: the headless constructors leave it
	/// false, and must not run a CLI just because a test opened the modal.
	pub fn check_on_start(&mut self, probe: bool) {
		if self.checked_once {
			return;
		}
		self.checked_once = true;
		if probe {
			self.start_check();
		}
	}

	/// Download, verify, and start the installer on a worker thread.
	///
	/// Refused unless [`Self::can_install`]: the current version is not older
	/// than the latest one, a job is already running, or there is no answer
	/// yet. Returns whether a job was actually started.
	pub fn start_install(&mut self) -> bool {
		if !self.can_install() {
			return false;
		}
		self.installing = true;
		self.error = None;
		self.job = Some(spawn(|| Outcome::Installed(install())));
		true
	}

	/// Take a finished job once per frame.
	pub fn poll(&mut self) -> Option<Event> {
		let outcome = {
			let receiver = self.job.as_ref()?;
			match receiver.try_recv() {
				Ok(outcome) => outcome,
				Err(TryRecvError::Empty) => return None,
				Err(TryRecvError::Disconnected) => {
					self.job = None;
					self.checking = false;
					self.installing = false;
					self.error = Some(t!("更新检查失败：worker 已退出").to_owned());
					return Some(Event::Failed);
				},
			}
		};
		self.job = None;
		self.checking = false;
		self.installing = false;
		self.checked_once = true;
		match outcome {
			Outcome::Checked(Ok(update)) => {
				self.update = Some(update);
				self.error = None;
				Some(Event::Checked)
			},
			Outcome::Checked(Err(error)) => {
				self.error = Some(error);
				Some(Event::Failed)
			},
			Outcome::Installed(Ok(())) => Some(Event::Installed),
			Outcome::Installed(Err(error)) => {
				self.error = Some(error);
				Some(Event::Failed)
			},
		}
	}

	/// The last successful check, if any.
	pub fn update(&self) -> Option<&DesktopUpdate> {
		self.update.as_ref()
	}

	/// The install gate: a newer release, and no job in flight.
	pub fn can_install(&self) -> bool {
		self.job.is_none()
			&& !self.installing
			&& self.update.as_ref().is_some_and(|update| update.available)
	}

	pub fn checking(&self) -> bool {
		self.checking
	}

	pub fn installing(&self) -> bool {
		self.installing
	}

	/// A job is running (either kind); the modal asks for repaints.
	pub fn busy(&self) -> bool {
		self.job.is_some()
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	/// The status bar's derived label.
	pub fn label(&self) -> String {
		self.label_for(crate::i18n::Lang::current())
	}

	/// [`Self::label`] with the language supplied, so the mapping is testable
	/// without the process-global language cell.
	pub fn label_for(&self, lang: crate::i18n::Lang) -> String {
		if self.error.is_some() {
			return crate::i18n::tr_in(lang, "更新失败").to_owned();
		}
		if self.checking {
			return crate::i18n::tr_in(lang, "正在检查…").to_owned();
		}
		match self.update.as_ref() {
			Some(update) if update.available => {
				crate::i18n::tf_in(lang, "有更新 {}", std::slice::from_ref(&update.latest))
			},
			_ => crate::i18n::tr_in(lang, "检查更新").to_owned(),
		}
	}
}

/// The check itself: one companion call, one JSON line.
fn check() -> Result<DesktopUpdate, String> {
	let (stdout, _) = crate::zetacode::run_zetacode(&[
		"update".to_owned(),
		"--desktop".to_owned(),
		"--check".to_owned(),
	])?;
	DesktopUpdate::parse(&stdout)
}

/// The install: the companion downloads, verifies, and starts the installer.
fn install() -> Result<(), String> {
	crate::zetacode::run_zetacode(&["update".to_owned(), "--desktop".to_owned()]).map(|_| ())
}

/// One worker thread per job; the result comes back over the channel.
fn spawn(job: impl FnOnce() -> Outcome + Send + 'static) -> Receiver<Outcome> {
	let (sender, receiver) = channel();
	std::thread::spawn(move || {
		let _ = sender.send(job());
	});
	receiver
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::i18n::Lang;

	fn update(current: &str, latest: &str) -> DesktopUpdate {
		DesktopUpdate {
			current: current.to_owned(),
			latest: latest.to_owned(),
			available: compare_versions(latest, current) == Ordering::Greater,
			asset: format!("zetawork-{latest}-setup-x64.exe"),
			url: format!("https://example.invalid/zetawork-{latest}-setup-x64.exe"),
			size: 1024,
			digest: format!("sha256:{}", "a".repeat(64)),
		}
	}

	#[test]
	fn versions_compare_numerically_not_lexically() {
		assert_eq!(compare_versions("1.10.0", "1.9.9"), Ordering::Greater);
		assert_eq!(compare_versions("v1.3.2", "1.3.2"), Ordering::Equal);
		assert_eq!(compare_versions("1.2", "1.2.0"), Ordering::Equal);
		assert_eq!(compare_versions("1.2.0-beta", "1.2.0"), Ordering::Equal);
		assert_eq!(compare_versions("9.0.0", "10.0.0"), Ordering::Less);
	}

	#[test]
	fn the_status_label_follows_the_check_state() {
		let idle = UpdateCache::default();
		assert_eq!(idle.label_for(Lang::Zh), "检查更新");
		assert_eq!(idle.label_for(Lang::En), "Check for updates");

		let checking = UpdateCache { checking: true, ..UpdateCache::default() };
		assert_eq!(checking.label_for(Lang::Zh), "正在检查…");
		assert_eq!(checking.label_for(Lang::En), "Checking…");

		let ready = UpdateCache::loaded(update("1.3.1", "1.3.2"));
		assert_eq!(ready.label_for(Lang::Zh), "有更新 1.3.2");
		assert_eq!(ready.label_for(Lang::En), "Update 1.3.2 available");

		let failed = UpdateCache { error: Some("boom".to_owned()), ..UpdateCache::default() };
		assert_eq!(failed.label_for(Lang::Zh), "更新失败");
		assert_eq!(failed.label_for(Lang::En), "Update failed");
	}

	#[test]
	fn an_answer_is_parsed_and_compared_against_the_running_version() {
		let json = r#"{"current":"1.3.1","latest":"1.3.2","available":false,"asset":"zetawork-1.3.2-setup-x64.exe","url":"https://example.invalid/a.exe","size":42,"digest":"sha256:aa"}"#;
		let parsed = DesktopUpdate::parse(json).expect("valid answer");
		assert_eq!(parsed.current, "1.3.1");
		assert_eq!(parsed.latest, "1.3.2");
		assert_eq!(parsed.size, 42);
		// The document's own `available: false` is not trusted: the versions
		// say this is an update.
		assert!(parsed.available);
	}

	#[test]
	fn a_release_that_is_not_newer_cannot_be_installed() {
		let mut same = UpdateCache::loaded(update("1.3.2", "1.3.2"));
		assert!(!same.can_install());
		assert!(!same.start_install(), "no job is started");
		assert!(!same.busy());

		let mut older = UpdateCache::loaded(update("1.4.0", "1.3.2"));
		assert!(!older.can_install());
		assert!(!older.start_install());

		let newer = UpdateCache::loaded(update("1.3.1", "1.3.2"));
		assert!(newer.can_install());
	}

	#[test]
	fn the_startup_check_runs_once_and_never_from_a_headless_shell() {
		let mut headless = UpdateCache::default();
		headless.check_on_start(false);
		headless.check_on_start(true);
		assert!(!headless.busy(), "probe: false spawns nothing, and it stays once-only");
	}
}
