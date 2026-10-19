// SPDX-License-Identifier: AGPL-3.0-only
//! Pure parsers for the Linux GPU probes.
//!
//! Kept platform-independent so the malformed-input tests run on every host.

use super::{GpuSource, GpuUsage};

/// Parse the contents of `gpu_busy_percent`.
///
/// A malformed or out-of-range value yields `None` rather than a bogus load.
pub(super) fn parse_sysfs_percent(raw: &str) -> Option<f32> {
	let percent: f32 = raw.trim().parse().ok()?;
	(percent.is_finite() && (0.0..=100.0).contains(&percent)).then_some(percent)
}

/// Parse the contents of `mem_info_vram_used` (a decimal byte count).
pub(super) fn parse_sysfs_bytes(raw: &str) -> Option<u64> {
	raw.trim().parse().ok()
}

/// Parse `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader`
/// output, one GPU per line (`"12 %, 1024 MiB"`).
pub(super) fn parse_nvidia_smi_output(text: &str) -> Vec<GpuUsage> {
	text
		.lines()
		.filter(|line| !line.trim().is_empty())
		.enumerate()
		.filter_map(|(index, line)| {
			let (utilization, memory) = line.split_once(',')?;
			let utilization_percent = split_number(utilization)
				.map(|(value, _)| value)
				.filter(|value| value.is_finite())
				.map(|value| value.clamp(0.0, 100.0) as f32);
			let memory_used = parse_memory_bytes(memory);
			if utilization_percent.is_none() && memory_used.is_none() {
				return None;
			}
			Some(GpuUsage {
				name: format!("GPU {index}"),
				utilization_percent,
				memory_used,
				source: GpuSource::NvidiaSmi,
			})
		})
		.collect()
}

/// Split a token such as `"12 %"` or `"1024 MiB"` into its numeric prefix and
/// the unit suffix (which may be empty).
fn split_number(token: &str) -> Option<(f64, &str)> {
	let token = token.trim();
	let end = token
		.char_indices()
		.find(|(_, ch)| !(ch.is_ascii_digit() || matches!(ch, '.' | '-' | '+')))
		.map_or(token.len(), |(index, _)| index);
	if end == 0 {
		return None;
	}
	let value = token[..end].parse().ok()?;
	Some((value, &token[end..]))
}

/// `memory.used` is reported in MiB by nvidia-smi when units are enabled.
fn parse_memory_bytes(token: &str) -> Option<u64> {
	let (value, unit) = split_number(token)?;
	if !value.is_finite() || value < 0.0 {
		return None;
	}
	let multiplier = match unit.trim().to_ascii_uppercase().as_str() {
		"" | "MIB" | "MB" => 1024.0 * 1024.0,
		"KIB" | "KB" => 1024.0,
		"GIB" | "GB" => 1024.0 * 1024.0 * 1024.0,
		"B" => 1.0,
		_ => return None,
	};
	Some((value * multiplier).round() as u64)
}

#[cfg(test)]
mod tests {
	use super::{parse_nvidia_smi_output, parse_sysfs_bytes, parse_sysfs_percent};

	#[test]
	fn sysfs_percent_rejects_malformed_input() {
		assert_eq!(parse_sysfs_percent(""), None);
		assert_eq!(parse_sysfs_percent("not-a-number\n"), None);
		assert_eq!(parse_sysfs_percent("nan"), None);
		assert_eq!(parse_sysfs_percent("-1"), None);
		assert_eq!(parse_sysfs_percent("101"), None);
		assert_eq!(parse_sysfs_percent("42\n"), Some(42.0));
	}

	#[test]
	fn sysfs_bytes_rejects_malformed_input() {
		assert_eq!(parse_sysfs_bytes(""), None);
		assert_eq!(parse_sysfs_bytes("12 MiB\n"), None);
		assert_eq!(parse_sysfs_bytes("1073741824\n"), Some(1_073_741_824));
	}

	#[test]
	fn nvidia_smi_output_is_parsed() {
		let gpus = parse_nvidia_smi_output("12 %, 1024 MiB\n0 %, 512 MiB\n");
		assert_eq!(gpus.len(), 2);
		assert_eq!(gpus[0].utilization_percent, Some(12.0));
		assert_eq!(gpus[0].memory_used, Some(1024 * 1024 * 1024));
		assert_eq!(gpus[1].utilization_percent, Some(0.0));
		assert_eq!(gpus[1].memory_used, Some(512 * 1024 * 1024));
	}

	#[test]
	fn nvidia_smi_output_tolerates_unavailable_fields() {
		let gpus = parse_nvidia_smi_output("[N/A], [N/A]\n[Not Supported], 256 MiB\n");
		assert_eq!(gpus.len(), 1);
		assert_eq!(gpus[0].utilization_percent, None);
		assert_eq!(gpus[0].memory_used, Some(256 * 1024 * 1024));
	}
}
