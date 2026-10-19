// SPDX-License-Identifier: AGPL-3.0-only
//! The 资源 widget pane's model: host resource readings from [`sysmon`].
//!
//! The GUI's right column draws the same [`sysmon::Snapshot`] — one model,
//! two renderers. Sampling runs on [`sysmon::Monitor`]'s worker thread (the
//! GPU probe may spawn `nvidia-smi` on Linux), so the event loop only polls
//! the published snapshot; the pane is opened, not the workbench, so the
//! worker exists only while a 资源 page does.

use std::time::Duration;

use sysmon::{Monitor, Snapshot};

/// How often the worker samples while a 资源 pane is visible.
pub const REFRESH: Duration = Duration::from_secs(1);

/// The pane's sampling cache.
#[derive(Default)]
pub struct Resources {
	monitor: Option<Monitor>,
}

impl Resources {
	/// Poll the newest snapshot, starting the worker on first use.
	pub fn refresh(&mut self) -> Option<&Snapshot> {
		let monitor = self.monitor.get_or_insert_with(|| Monitor::new(REFRESH));
		monitor.refresh();
		monitor.latest()
	}

	/// The latest snapshot, without starting the worker.
	pub fn snapshot(&self) -> Option<&Snapshot> {
		self.monitor.as_ref()?.latest()
	}

	/// Stop the worker while no 资源 page is visible.
	pub fn idle(&mut self) {
		self.monitor = None;
	}
}

#[cfg(test)]
mod tests {
	use super::Resources;

	#[test]
	fn an_idle_cache_starts_nothing() {
		let cache = Resources::default();
		assert!(cache.snapshot().is_none());
	}
}
