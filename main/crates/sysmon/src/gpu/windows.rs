// SPDX-License-Identifier: AGPL-3.0-only
//! Windows GPU probe backed by Performance Data Helper (PDH) counters.

use std::ptr;

use windows_sys::Win32::System::Performance::{
	PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
	PDH_MORE_DATA, PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
	PdhGetFormattedCounterArrayW, PdhOpenQueryW,
};

use super::{GpuSource, GpuUsage};

/// Sum of every GPU engine's utilisation.
const UTILIZATION_COUNTER: &str = "\\GPU Engine(*)\\Utilization Percentage";
/// Sum of every adapter's dedicated memory.
const MEMORY_COUNTER: &str = "\\GPU Adapter Memory(*)\\Dedicated Usage";

/// An open PDH query over the two wildcard GPU counters.
///
/// The query is opened once; every [`PdhProbe::sample`] performs a single
/// `PdhCollectQueryData`, which lets PDH compute the rate from the previous
/// collection. Counter names are added with `PdhAddEnglishCounterW` so the
/// probe works on non-English Windows installations.
#[derive(Debug)]
pub(super) struct PdhProbe {
	query: isize,
	utilization: Option<isize>,
	memory: Option<isize>,
}

impl PdhProbe {
	pub(super) fn new() -> Option<Self> {
		unsafe {
			let mut query: isize = 0;
			if PdhOpenQueryW(ptr::null(), 0, &mut query) != 0 {
				return None;
			}

			let utilization = add_english_counter(query, UTILIZATION_COUNTER);
			let memory = add_english_counter(query, MEMORY_COUNTER);
			if utilization.is_none() && memory.is_none() {
				PdhCloseQuery(query);
				return None;
			}

			// Prime rate counters; the first sample collects the second point.
			PdhCollectQueryData(query);
			Some(Self { query, utilization, memory })
		}
	}

	pub(super) fn sample(&mut self) -> Vec<GpuUsage> {
		unsafe {
			PdhCollectQueryData(self.query);
		}

		let utilization = self
			.utilization
			.and_then(|counter| unsafe { counter_array_sum(counter, PDH_FMT_DOUBLE) })
			.map(|value| value.max(0.0) as f32);
		let memory = self
			.memory
			.and_then(|counter| unsafe { counter_array_sum(counter, PDH_FMT_DOUBLE) })
			.map(|value| value.max(0.0).round() as u64);

		if utilization.is_none() && memory.is_none() {
			return Vec::new();
		}

		vec![GpuUsage {
			name: "GPU".to_owned(),
			utilization_percent: utilization,
			memory_used: memory,
			source: GpuSource::Pdh,
		}]
	}
}

impl Drop for PdhProbe {
	fn drop(&mut self) {
		unsafe {
			PdhCloseQuery(self.query);
		}
	}
}

fn add_english_counter(query: isize, path: &str) -> Option<isize> {
	let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
	let mut counter: isize = 0;
	let status = unsafe { PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &mut counter) };
	(status == 0).then_some(counter)
}

/// Sum a wildcard counter across all instances, ignoring instances PDH marks
/// invalid (for example the first collection of a rate counter).
///
/// # Safety
///
/// `counter` must be a live counter handle added to an open query.
unsafe fn counter_array_sum(counter: isize, format: u32) -> Option<f64> {
	let mut size = 0u32;
	let mut count = 0u32;
	let mut buffer: Vec<u64> = Vec::new();

	loop {
		let items = if buffer.is_empty() {
			ptr::null_mut()
		} else {
			buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>()
		};
		let status =
			unsafe { PdhGetFormattedCounterArrayW(counter, format, &mut size, &mut count, items) };

		if status == PDH_MORE_DATA {
			let words = (size as usize).div_ceil(std::mem::size_of::<u64>());
			if words == 0 || words <= buffer.len() {
				return None;
			}
			buffer.resize(words, 0);
			continue;
		}

		if status != 0 || count == 0 || buffer.is_empty() {
			return None;
		}

		// SAFETY: PDH filled `buffer` with `count` `PDH_FMT_COUNTERVALUE_ITEM_W`
		// values; `Vec<u64>` guarantees the required pointer alignment.
		let items = unsafe {
			std::slice::from_raw_parts(
				buffer.as_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>(),
				count as usize,
			)
		};
		let mut total = 0.0f64;
		let mut any_valid = false;
		for item in items {
			let status = item.FmtValue.CStatus;
			if status == PDH_CSTATUS_VALID_DATA || status == PDH_CSTATUS_NEW_DATA {
				any_valid = true;
				total += unsafe { item.FmtValue.Anonymous.doubleValue };
			}
		}
		return any_valid.then_some(total);
	}
}
