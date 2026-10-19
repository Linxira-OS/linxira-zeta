// SPDX-License-Identifier: AGPL-3.0-only
//! GPU utilisation probing.
//!
//! Three tiers are tried in order: Windows PDH counters, Linux DRM sysfs
//! attributes, then NVIDIA's `nvidia-smi`. Platforms without a supported probe
//! simply return an empty list, and a tier that exists but has no reading
//! reports `None` for that field instead of failing the whole snapshot.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(target_os = "linux", test))]
mod linux_parsers;
#[cfg(windows)]
mod windows;

/// Which probe produced a [`GpuUsage`] reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GpuSource {
	/// Windows Performance Data Helper counters.
	Pdh,
	/// Linux `/sys/class/drm/card*/device` attributes.
	Sysfs,
	/// NVIDIA's `nvidia-smi` utility.
	NvidiaSmi,
}

impl GpuSource {
	/// Stable identifier suitable for logs and diagnostics.
	pub fn as_str(self) -> &'static str {
		match self {
			Self::Pdh => "pdh",
			Self::Sysfs => "sysfs",
			Self::NvidiaSmi => "nvidia-smi",
		}
	}
}

impl std::fmt::Display for GpuSource {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.write_str(self.as_str())
	}
}

/// A single GPU (or, for PDH, the aggregate of all GPU engines) reading.
#[derive(Debug, Clone, PartialEq)]
pub struct GpuUsage {
	/// Human-readable adapter name (`GPU` for the Windows aggregate).
	pub name: String,
	/// Utilisation percentage. The Windows value sums every engine instance,
	/// so it can exceed 100 on multi-engine adapters.
	pub utilization_percent: Option<f32>,
	/// Dedicated GPU memory in bytes.
	pub memory_used: Option<u64>,
	/// Probe tier that produced this reading.
	pub source: GpuSource,
}

/// Platform-specific probe state. Construction never panics; an unavailable
/// probe is represented by `None`/empty state.
#[derive(Debug)]
pub(crate) struct GpuProbe {
	#[cfg(windows)]
	pdh: Option<windows::PdhProbe>,
	#[cfg(target_os = "linux")]
	linux: linux::LinuxProbe,
}

impl GpuProbe {
	#[cfg(windows)]
	pub(crate) fn new() -> Self {
		Self { pdh: windows::PdhProbe::new() }
	}

	#[cfg(target_os = "linux")]
	pub(crate) fn new() -> Self {
		Self { linux: linux::LinuxProbe::new() }
	}

	#[cfg(not(any(windows, target_os = "linux")))]
	pub(crate) fn new() -> Self {
		Self {}
	}

	#[cfg(windows)]
	pub(crate) fn sample(&mut self) -> Vec<GpuUsage> {
		self
			.pdh
			.as_mut()
			.map(windows::PdhProbe::sample)
			.unwrap_or_default()
	}

	#[cfg(target_os = "linux")]
	pub(crate) fn sample(&mut self) -> Vec<GpuUsage> {
		self.linux.sample()
	}

	#[cfg(not(any(windows, target_os = "linux")))]
	pub(crate) fn sample(&mut self) -> Vec<GpuUsage> {
		Vec::new()
	}
}

#[cfg(test)]
mod tests {
	use std::time::{Duration, Instant};

	use super::GpuProbe;

	/// The probe must always come back, even on hosts without a supported GPU,
	/// and a supported host must report plausible numbers.
	#[test]
	fn gpu_probe_returns_promptly() {
		let started = Instant::now();
		let mut probe = GpuProbe::new();
		let gpus = probe.sample();
		assert!(
			started.elapsed() < Duration::from_secs(5),
			"GPU probe took too long: {:?}",
			started.elapsed()
		);
		for gpu in &gpus {
			if let Some(utilization) = gpu.utilization_percent {
				assert!(utilization.is_finite());
				assert!(utilization >= 0.0);
			}
		}
	}
}
