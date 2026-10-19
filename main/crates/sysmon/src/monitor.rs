// SPDX-License-Identifier: AGPL-3.0-only
//! A background sampler for UI shells.
//!
//! [`Sampler::sample`] performs blocking file/OS reads and (on Linux) may spawn
//! `nvidia-smi`, so a UI must not call it on its draw thread. [`Monitor`] owns
//! a sampler on a worker thread and publishes the newest [`Snapshot`]; the UI
//! polls [`Monitor::refresh`] once per frame (a mutex check, no I/O) and draws
//! [`Monitor::latest`].
//!
//! The worker takes one baseline reading and samples once per interval. A
//! dropped `Monitor` stops the worker at its next wake-up, so opening the
//! resource panel and closing it again does not leave a sampler behind.

use std::{
	sync::{
		Arc, Mutex,
		atomic::{AtomicBool, Ordering},
	},
	thread::{self, JoinHandle},
	time::Duration,
};

use crate::{Sampler, Snapshot};

#[derive(Default)]
struct Shared {
	generation: u64,
	snapshot: Option<Snapshot>,
}

/// A [`Sampler`] running on its own thread.
pub struct Monitor {
	shared: Arc<Mutex<Shared>>,
	stop: Arc<AtomicBool>,
	worker: Option<JoinHandle<()>>,
	seen: u64,
	latest: Option<Snapshot>,
}

impl Monitor {
	/// Start a monitor that samples every `interval`.
	///
	/// The first reading lands after `sysinfo`'s minimum CPU interval, so the
	/// first published snapshot already carries a real CPU delta.
	pub fn new(interval: Duration) -> Self {
		let shared = Arc::new(Mutex::new(Shared::default()));
		let stop = Arc::new(AtomicBool::new(false));
		let worker = {
			let shared = Arc::clone(&shared);
			let stop = Arc::clone(&stop);
			thread::Builder::new()
				.name("sysmon-monitor".to_owned())
				.spawn(move || {
					let mut sampler = Sampler::new();
					thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
					loop {
						if stop.load(Ordering::Relaxed) {
							break;
						}
						let snapshot = sampler.sample();
						if let Ok(mut shared) = shared.lock() {
							shared.generation = shared.generation.wrapping_add(1);
							shared.snapshot = Some(snapshot);
						}
						thread::park_timeout(interval);
					}
				})
				.ok()
		};
		Self { shared, stop, worker, seen: 0, latest: None }
	}

	/// Copy the newest snapshot into this monitor. Returns `true` when a new
	/// reading was published since the previous call.
	///
	/// Cheap enough for every frame: no I/O, and the snapshot is cloned only
	/// when the worker's generation moved.
	pub fn refresh(&mut self) -> bool {
		let shared = self
			.shared
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		if shared.generation == self.seen {
			return false;
		}
		self.seen = shared.generation;
		self.latest = shared.snapshot.clone();
		true
	}

	/// The newest snapshot this monitor has seen.
	pub fn latest(&self) -> Option<&Snapshot> {
		self.latest.as_ref()
	}
}

impl Drop for Monitor {
	fn drop(&mut self) {
		self.stop.store(true, Ordering::Relaxed);
		if let Some(worker) = self.worker.take() {
			// The worker parks between samples; unparking makes it observe
			// `stop` now instead of after a full interval. It is not joined:
			// a sample already in flight (a wedged `nvidia-smi`) must not block
			// the shell's shutdown.
			worker.thread().unpark();
		}
	}
}
