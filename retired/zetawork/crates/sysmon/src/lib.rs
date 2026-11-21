// SPDX-License-Identifier: AGPL-3.0-only
//! Host resource sampling for the Zeta workbench.
//!
//! [`Sampler`] owns the platform state and returns a [`Snapshot`] per call.
//! Counters that are only meaningful as a rate (CPU usage, GPU utilisation,
//! network bytes, per-process CPU) are kept between calls so each snapshot
//! describes the interval since the previous one rather than a
//! process-lifetime absolute.
//!
//! ```no_run
//! use std::time::Duration;
//!
//! use sysmon::Sampler;
//!
//! let mut sampler = Sampler::new();
//! std::thread::sleep(Duration::from_millis(500));
//! let snapshot = sampler.sample();
//! println!("cpu {}%", snapshot.cpu_percent);
//! ```
//!
//! Sampling performs blocking file/OS reads and (on Linux) may spawn
//! `nvidia-smi`; call it off the UI thread.

mod gpu;
mod monitor;
mod process;

use std::collections::HashMap;
use std::time::SystemTime;

use sysinfo::{
	CpuRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessRefreshKind, ProcessesToUpdate,
	RefreshKind, System,
};

pub use gpu::{GpuSource, GpuUsage};
pub use monitor::Monitor;
pub use process::{ProcessSample, TOP_PROCESSES};

/// Usage of one mounted filesystem.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiskUsage {
	/// Device name reported by the OS (for example `sda2` or `C:\`).
	pub name: String,
	/// Mount point as a display string.
	pub mount_point: String,
	/// Filesystem size in bytes.
	pub total: u64,
	/// Free bytes available to unprivileged users.
	pub available: u64,
}

impl DiskUsage {
	/// Used bytes, saturating if the OS reports more free space than total.
	pub fn used(&self) -> u64 {
		self.total.saturating_sub(self.available)
	}

	/// Used space as a percentage of the total (0 when the total is unknown).
	pub fn used_percent(&self) -> f32 {
		if self.total == 0 {
			0.0
		} else {
			(self.used() as f64 / self.total as f64 * 100.0) as f32
		}
	}
}

/// One complete host reading.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
	/// Average CPU utilisation since the previous snapshot, 0-100.
	pub cpu_percent: f32,
	/// Physical memory in use, in bytes.
	pub memory_used: u64,
	/// Physical memory installed, in bytes.
	pub memory_total: u64,
	/// Mounted filesystems with a non-zero size.
	pub disks: Vec<DiskUsage>,
	/// Bytes received across all interfaces since the previous snapshot.
	pub net_rx_bytes: u64,
	/// Bytes transmitted across all interfaces since the previous snapshot.
	pub net_tx_bytes: u64,
	/// GPU readings; empty when no probe tier could answer.
	pub gpus: Vec<GpuUsage>,
	/// Heaviest CPU users, sorted by CPU ([`TOP_PROCESSES`] at most).
	pub processes: Vec<ProcessSample>,
	/// Wall-clock time at which the snapshot was taken.
	pub sampled_at: SystemTime,
}

impl Snapshot {
	/// Physical memory usage as a percentage of the total.
	pub fn memory_percent(&self) -> f32 {
		if self.memory_total == 0 {
			0.0
		} else {
			(self.memory_used as f64 / self.memory_total as f64 * 100.0) as f32
		}
	}
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct NetTotal {
	rx: u64,
	tx: u64,
}

/// Sampling state. Reuse one instance: CPU and network rates need the previous
/// collection, so a fresh `Sampler` reports zero deltas on its first snapshot.
#[derive(Debug)]
pub struct Sampler {
	system: System,
	disks: Disks,
	networks: Networks,
	net_previous: HashMap<String, NetTotal>,
	gpu: gpu::GpuProbe,
}

impl Default for Sampler {
	fn default() -> Self {
		Self::new()
	}
}

impl Sampler {
	/// Create a sampler and take the baseline collection.
	pub fn new() -> Self {
		let mut system = System::new_with_specifics(
			RefreshKind::new()
				.with_cpu(CpuRefreshKind::new().with_cpu_usage())
				.with_memory(MemoryRefreshKind::new().with_ram()),
		);
		// Prime the CPU and per-process deltas; the first `sample` needs a
		// second point.
		system.refresh_cpu_usage();
		system.refresh_processes_specifics(
			ProcessesToUpdate::All,
			ProcessRefreshKind::new().with_cpu().with_memory(),
		);

		let disks = Disks::new_with_refreshed_list();
		let networks = Networks::new_with_refreshed_list();
		let net_previous = networks
			.list()
			.iter()
			.map(|(name, data)| {
				(name.clone(), NetTotal { rx: data.total_received(), tx: data.total_transmitted() })
			})
			.collect();

		Self { system, disks, networks, net_previous, gpu: gpu::GpuProbe::new() }
	}

	/// Take one snapshot. Cheap enough for a periodic background task; never
	/// panics.
	pub fn sample(&mut self) -> Snapshot {
		let sampled_at = SystemTime::now();
		let Self { system, disks, networks, net_previous, gpu } = self;

		system.refresh_specifics(
			RefreshKind::new()
				.with_cpu(CpuRefreshKind::new().with_cpu_usage())
				.with_memory(MemoryRefreshKind::new().with_ram()),
		);
		system.refresh_processes_specifics(
			ProcessesToUpdate::All,
			ProcessRefreshKind::new().with_cpu().with_memory(),
		);
		let processes = process::top_cpu(
			system
				.processes()
				.iter()
				.map(|(pid, process)| ProcessSample {
					pid: pid.as_u32(),
					name: process.name().to_string_lossy().into_owned(),
					cpu_percent: process.cpu_usage(),
					memory_bytes: process.memory(),
				})
				.collect(),
			TOP_PROCESSES,
		);

		disks.refresh();
		let disks = disks
			.list()
			.iter()
			.filter(|disk| disk.total_space() > 0)
			.map(|disk| DiskUsage {
				name: disk.name().to_string_lossy().into_owned(),
				mount_point: disk.mount_point().to_string_lossy().into_owned(),
				total: disk.total_space(),
				available: disk.available_space(),
			})
			.collect();

		networks.refresh();
		let (net_rx_bytes, net_tx_bytes) = accumulate_network_delta(
			net_previous,
			networks.list().iter().map(|(name, data)| {
				(name.as_str(), NetTotal { rx: data.total_received(), tx: data.total_transmitted() })
			}),
		);

		Snapshot {
			cpu_percent: system.global_cpu_usage(),
			memory_used: system.used_memory(),
			memory_total: system.total_memory(),
			disks,
			net_rx_bytes,
			net_tx_bytes,
			gpus: gpu.sample(),
			processes,
			sampled_at,
		}
	}
}

/// Compute byte deltas for the current interface totals, updating `previous` in
/// place. Interfaces seen for the first time contribute zero (their lifetime
/// total is not traffic observed during this interval), and counters that move
/// backwards saturate at zero.
fn accumulate_network_delta<'a>(
	previous: &mut HashMap<String, NetTotal>,
	current: impl IntoIterator<Item = (&'a str, NetTotal)>,
) -> (u64, u64) {
	let mut received = 0u64;
	let mut transmitted = 0u64;
	let mut present = Vec::new();

	for (name, value) in current {
		let key = name.to_owned();
		if let Some(before) = previous.get(name) {
			received = received.saturating_add(value.rx.saturating_sub(before.rx));
			transmitted = transmitted.saturating_add(value.tx.saturating_sub(before.tx));
		}
		previous.insert(key.clone(), value);
		present.push(key);
	}
	// Forget interfaces that disappeared so they start clean if they return.
	previous.retain(|name, _| present.contains(name));

	(received, transmitted)
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::time::SystemTime;

	use super::{DiskUsage, NetTotal, Sampler, Snapshot, TOP_PROCESSES, accumulate_network_delta};

	fn snapshot(memory_used: u64, memory_total: u64) -> Snapshot {
		Snapshot {
			cpu_percent: 0.0,
			memory_used,
			memory_total,
			disks: Vec::new(),
			net_rx_bytes: 0,
			net_tx_bytes: 0,
			gpus: Vec::new(),
			processes: Vec::new(),
			sampled_at: SystemTime::UNIX_EPOCH,
		}
	}

	#[test]
	fn memory_percent_handles_unknown_total() {
		assert_eq!(snapshot(512, 2048).memory_percent(), 25.0);
		assert_eq!(snapshot(1, 0).memory_percent(), 0.0);
	}

	#[test]
	fn disk_usage_arithmetic_saturates() {
		let disk = DiskUsage {
			name: "sda1".to_owned(),
			mount_point: "/".to_owned(),
			total: 1000,
			available: 250,
		};
		assert_eq!(disk.used(), 750);
		assert_eq!(disk.used_percent(), 75.0);

		let overfull = DiskUsage { available: 2000, ..disk.clone() };
		assert_eq!(overfull.used(), 0);
		assert_eq!(overfull.used_percent(), 0.0);

		let empty = DiskUsage { total: 0, available: 0, ..disk };
		assert_eq!(empty.used_percent(), 0.0);
	}

	#[test]
	fn network_counters_yield_deltas_between_samples() {
		let mut previous = HashMap::new();
		let first = [("eth0", NetTotal { rx: 100, tx: 40 })];
		assert_eq!(accumulate_network_delta(&mut previous, first), (0, 0));

		let second = [("eth0", NetTotal { rx: 350, tx: 140 })];
		assert_eq!(accumulate_network_delta(&mut previous, second), (250, 100));

		// A counter reset must not produce a huge negative/overflowing delta.
		let reset = [("eth0", NetTotal { rx: 10, tx: 5 })];
		assert_eq!(accumulate_network_delta(&mut previous, reset), (0, 0));

		// A vanished interface is dropped from the baseline.
		assert_eq!(accumulate_network_delta(&mut previous, std::iter::empty()), (0, 0));
		assert!(previous.is_empty());
	}

	#[test]
	fn sampler_reports_physical_memory_and_cpu() {
		let mut sampler = Sampler::new();
		std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
		let first = sampler.sample();

		assert!(first.memory_total > 0);
		assert!(first.memory_used <= first.memory_total);
		assert!((0.0..=100.0).contains(&first.cpu_percent));
		assert!((0.0..=100.0).contains(&first.memory_percent()));

		assert!(!first.processes.is_empty(), "the host runs at least one process");
		assert!(first.processes.len() <= TOP_PROCESSES);
		assert!(
			first
				.processes
				.windows(2)
				.all(|pair| pair[0].cpu_percent >= pair[1].cpu_percent),
			"processes are sorted by CPU"
		);

		let second = sampler.sample();
		assert!(second.memory_used <= second.memory_total);
	}
}
