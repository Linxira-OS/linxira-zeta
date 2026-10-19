// SPDX-License-Identifier: AGPL-3.0-only
//! Process list sampling: one row per process, sorted for the resource panel.
//!
//! [`Sampler`](crate::Sampler) refreshes the platform process table and keeps
//! the top [`TOP_PROCESSES`] by CPU. The window is deliberately small: the
//! panel shows a scannable list, not a process manager, and copying every
//! process name every interval would be wasted work.
//!
//! `sysinfo` reports CPU usage per logical CPU, so one fully busy thread is
//! `100.0` and a process can exceed `100.0`. [`ProcessSample::machine_percent`]
//! is the 0–100 share of the whole machine, for callers that want the narrower
//! reading.

/// How many processes a snapshot carries.
pub const TOP_PROCESSES: usize = 20;

/// One process reading.
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessSample {
	/// Operating-system process id.
	pub pid: u32,
	/// Process name as the OS reports it (may be truncated on Linux).
	pub name: String,
	/// CPU usage in percent of one logical CPU; may exceed 100 on a
	/// multi-threaded process.
	pub cpu_percent: f32,
	/// Resident set size in bytes.
	pub memory_bytes: u64,
}

impl ProcessSample {
	/// CPU usage as a 0–100 share of the whole machine.
	///
	/// A zero CPU count (an unknown host) yields zero rather than a division
	/// by zero, and a negative/NaN reading is clamped to the valid range.
	pub fn machine_percent(&self, logical_cpus: usize) -> f32 {
		if logical_cpus == 0 || !self.cpu_percent.is_finite() {
			return 0.0;
		}
		(self.cpu_percent.max(0.0) / logical_cpus as f32).min(100.0)
	}
}

/// Sort heaviest CPU users first.
///
/// Ties fall back to memory (descending) and then pid (ascending), so the
/// order is deterministic when two processes report the same CPU: a list that
/// reshuffles every second would be unreadable.
fn sort_by_cpu(samples: &mut [ProcessSample]) {
	samples.sort_by(|left, right| {
		right
			.cpu_percent
			.total_cmp(&left.cpu_percent)
			.then_with(|| right.memory_bytes.cmp(&left.memory_bytes))
			.then_with(|| left.pid.cmp(&right.pid))
	});
}

/// The `limit` heaviest CPU users, sorted by CPU.
///
/// `limit == 0` returns an empty list. The input is sorted in place; callers
/// that need the whole list should use a large limit.
pub fn top_cpu(mut samples: Vec<ProcessSample>, limit: usize) -> Vec<ProcessSample> {
	sort_by_cpu(&mut samples);
	samples.truncate(limit);
	samples
}

#[cfg(test)]
mod tests {
	use super::{ProcessSample, TOP_PROCESSES, top_cpu};

	fn sample(pid: u32, cpu: f32, memory: u64) -> ProcessSample {
		ProcessSample { pid, name: format!("p{pid}"), cpu_percent: cpu, memory_bytes: memory }
	}

	#[test]
	fn heaviest_cpu_users_come_first() {
		let samples = vec![sample(1, 2.0, 10), sample(2, 80.0, 10), sample(3, 12.5, 10)];
		let sorted = top_cpu(samples, 10);
		assert_eq!(sorted.iter().map(|p| p.pid).collect::<Vec<_>>(), [2, 3, 1]);
	}

	#[test]
	fn ties_use_memory_then_pid() {
		let samples = vec![sample(9, 5.0, 100), sample(4, 5.0, 400), sample(7, 5.0, 400)];
		let sorted = top_cpu(samples, 10);
		assert_eq!(sorted.iter().map(|p| p.pid).collect::<Vec<_>>(), [4, 7, 9]);
	}

	#[test]
	fn top_cpu_respects_the_limit() {
		let samples = (1..=TOP_PROCESSES as u32 + 5)
			.map(|pid| sample(pid, pid as f32, 0))
			.collect::<Vec<_>>();
		let sorted = top_cpu(samples, TOP_PROCESSES);
		assert_eq!(sorted.len(), TOP_PROCESSES);
		assert_eq!(sorted[0].pid, TOP_PROCESSES as u32 + 5);
		assert!(top_cpu(vec![sample(1, 1.0, 0)], 0).is_empty());
	}

	#[test]
	fn machine_percent_is_the_per_cpu_share() {
		let process = sample(1, 150.0, 0);
		assert_eq!(process.machine_percent(4), 37.5);
		assert_eq!(process.machine_percent(1), 100.0, "clamped to the machine's 100%");
		assert_eq!(process.machine_percent(0), 0.0, "unknown CPU count");
		assert_eq!(sample(1, f32::NAN, 0).machine_percent(8), 0.0);
	}
}
