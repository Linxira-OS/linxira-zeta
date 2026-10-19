// SPDX-License-Identifier: AGPL-3.0-only
//! Print one host snapshot with the real numbers from this machine.
//!
//! ```text
//! cargo run -p sysmon --example snapshot
//! ```

use std::time::Duration;

use sysmon::Sampler;

fn bytes(value: u64) -> String {
	format!("{:.1} MiB", value as f64 / (1024.0 * 1024.0))
}

fn main() {
	let mut sampler = Sampler::new();
	// Give the CPU/PDH rate counters a second collection point.
	std::thread::sleep(Duration::from_millis(500));
	let snapshot = sampler.sample();

	println!("sampled_at: {:?}", snapshot.sampled_at);
	println!("cpu: {:.2}%", snapshot.cpu_percent);
	println!(
		"memory: {} / {} ({:.1}%)",
		bytes(snapshot.memory_used),
		bytes(snapshot.memory_total),
		snapshot.memory_percent()
	);

	for disk in &snapshot.disks {
		println!(
			"disk {} at {}: {} / {} ({:.1}%)",
			disk.name,
			disk.mount_point,
			bytes(disk.used()),
			bytes(disk.total),
			disk.used_percent()
		);
	}

	println!(
		"net: rx {} B ({}), tx {} B ({}) since the previous sample",
		snapshot.net_rx_bytes,
		bytes(snapshot.net_rx_bytes),
		snapshot.net_tx_bytes,
		bytes(snapshot.net_tx_bytes)
	);

	if snapshot.gpus.is_empty() {
		println!("gpu: unavailable");
	} else {
		for gpu in &snapshot.gpus {
			let utilization = gpu
				.utilization_percent
				.map_or_else(|| "unavailable".to_owned(), |value| format!("{value:.2}%"));
			let memory = gpu
				.memory_used
				.map_or_else(|| "unavailable".to_owned(), bytes);
			println!(
				"gpu {} ({}): util {}, dedicated memory {}",
				gpu.name,
				gpu.source.as_str(),
				utilization,
				memory
			);
		}
	}

	println!("processes (top {} by CPU):", snapshot.processes.len());
	for process in &snapshot.processes {
		println!(
			"  {:>7}  {:>6.1}%  {:>10}  {}",
			process.pid,
			process.cpu_percent,
			bytes(process.memory_bytes),
			process.name
		);
	}
}
