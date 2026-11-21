// SPDX-License-Identifier: AGPL-3.0-only
//! Linux GPU probes: DRM sysfs first (AMD), then `nvidia-smi`.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::linux_parsers::{parse_nvidia_smi_output, parse_sysfs_bytes, parse_sysfs_percent};
use super::{GpuSource, GpuUsage};

/// `nvidia-smi` occasionally wedges (driver reset, suspended GPU); never let it
/// hold a sampler indefinitely.
const NVIDIA_SMI_TIMEOUT: Duration = Duration::from_millis(750);

#[derive(Debug, Default)]
pub(super) struct LinuxProbe {
	/// `None` until the first attempt; once the utility is missing we stop
	/// spawning it on every sample.
	nvidia_smi: Option<bool>,
}

impl LinuxProbe {
	pub(super) fn new() -> Self {
		Self::default()
	}

	pub(super) fn sample(&mut self) -> Vec<GpuUsage> {
		let sysfs = read_sysfs_gpus();
		if !sysfs.is_empty() {
			return sysfs;
		}
		if self.nvidia_smi == Some(false) {
			return Vec::new();
		}

		match read_nvidia_gpus() {
			Some(gpus) => {
				self.nvidia_smi = Some(true);
				gpus
			},
			None => {
				self.nvidia_smi = Some(false);
				Vec::new()
			},
		}
	}
}

/// Read `gpu_busy_percent` (and, when available, `mem_info_vram_used`) for
/// every DRM card. Connector entries such as `card0-DP-1` are not cards and are
/// ignored.
fn read_sysfs_gpus() -> Vec<GpuUsage> {
	const DRM_ROOT: &str = "/sys/class/drm";

	let Ok(entries) = std::fs::read_dir(DRM_ROOT) else {
		return Vec::new();
	};

	let mut cards: Vec<(u32, PathBuf)> = entries
		.flatten()
		.filter_map(|entry| {
			let name = entry.file_name().into_string().ok()?;
			let index = name.strip_prefix("card")?.parse::<u32>().ok()?;
			Some((index, entry.path()))
		})
		.collect();
	cards.sort_unstable_by_key(|(index, _)| *index);

	cards
		.into_iter()
		.filter_map(|(index, path)| {
			let busy = std::fs::read_to_string(path.join("device/gpu_busy_percent")).ok()?;
			let utilization_percent = parse_sysfs_percent(&busy)?;
			let memory_used = std::fs::read_to_string(path.join("device/mem_info_vram_used"))
				.ok()
				.and_then(|raw| parse_sysfs_bytes(&raw));
			Some(GpuUsage {
				name: format!("card{index}"),
				utilization_percent: Some(utilization_percent),
				memory_used,
				source: GpuSource::Sysfs,
			})
		})
		.collect()
}

fn read_nvidia_gpus() -> Option<Vec<GpuUsage>> {
	let output = run_with_timeout(
		"nvidia-smi",
		&["--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader"],
		NVIDIA_SMI_TIMEOUT,
	)?;
	let text = String::from_utf8_lossy(&output);
	let gpus = parse_nvidia_smi_output(&text);
	(!gpus.is_empty()).then_some(gpus)
}

/// Run a command, draining stdout on a helper thread, and kill it after
/// `timeout`. Returns `None` for a missing binary, a non-zero exit, or a
/// timeout.
fn run_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<Vec<u8>> {
	let mut child = Command::new(program)
		.args(args)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::null())
		.spawn()
		.ok()?;
	let mut stdout = child.stdout.take()?;
	// Drain the pipe so a chatty child cannot block on a full buffer.
	let reader = std::thread::spawn(move || {
		let mut buffer = Vec::new();
		let _ = stdout.read_to_end(&mut buffer);
		buffer
	});

	let deadline = Instant::now() + timeout;
	let mut status = None;
	loop {
		match child.try_wait() {
			Ok(Some(exited)) => {
				status = Some(exited);
				break;
			},
			Ok(None) => {},
			Err(_) => break,
		}
		if Instant::now() >= deadline {
			break;
		}
		std::thread::sleep(Duration::from_millis(10));
	}

	let success = match status {
		Some(exited) => exited.success(),
		None => {
			let _ = child.kill();
			let _ = child.wait();
			false
		},
	};
	let output = reader.join().unwrap_or_default();
	success.then_some(output)
}
