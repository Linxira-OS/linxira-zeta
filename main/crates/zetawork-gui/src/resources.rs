// SPDX-License-Identifier: AGPL-3.0-only
//! The right column's 资源 page: CPU, memory, GPU and the top processes.
//!
//! The readings come from [`sysmon`], the same crate the TUI's resources pane
//! uses — one model, two renderers. Sampling runs on a worker thread
//! ([`sysmon::Monitor`]) because the GPU probe may spawn `nvidia-smi` on
//! Linux; the page only polls the published snapshot.
//!
//! The process table is the snapshot's own top-N list (already sorted by CPU),
//! so the panel does not re-sort or re-read the process table per frame.

use std::time::Duration;

use egui::{Align2, CornerRadius, FontId, Rect, Sense, Ui, pos2, vec2};

use crate::{
	Shell,
	state::RightTab,
	t, theme,
	widgets::{empty_note, panel_head, truncated_mono, truncated_mono_right, truncated_text},
};

/// How often the worker samples while the page is visible.
pub const REFRESH: Duration = Duration::from_secs(1);

/// The page's sampling cache: a monitor that exists only while the page has
/// been opened. Closing the page (or the column) drops it and stops the
/// worker.
#[derive(Default)]
pub struct ResourceCache {
	monitor: Option<sysmon::Monitor>,
}

impl ResourceCache {
	/// Poll the newest snapshot, starting the worker on first use.
	pub fn refresh(&mut self) -> Option<&sysmon::Snapshot> {
		let monitor = self
			.monitor
			.get_or_insert_with(|| sysmon::Monitor::new(REFRESH));
		monitor.refresh();
		monitor.latest()
	}

	/// The latest snapshot, without starting the worker.
	pub fn snapshot(&self) -> Option<&sysmon::Snapshot> {
		self.monitor.as_ref()?.latest()
	}

	/// Stop the worker while the page is not visible.
	pub fn idle(&mut self) {
		self.monitor = None;
	}
}

/// Draw the page.
pub fn panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Resources.title(), |_| {});
	shell.resources.refresh();
	let Some(snapshot) = shell.resources.snapshot() else {
		empty_note(ui, t!("正在采样…"));
		return;
	};
	egui::ScrollArea::vertical()
		.id_salt("zetawork-resources")
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 4.0;
			ui.add_space(2.0);
			gauge(
				ui,
				t!("CPU"),
				&format!("{:.1}%", snapshot.cpu_percent),
				Some(snapshot.cpu_percent / 100.0),
			);
			gauge(
				ui,
				t!("内存"),
				&format!(
					"{} / {}",
					bytes_label(snapshot.memory_used),
					bytes_label(snapshot.memory_total)
				),
				Some(snapshot.memory_percent() / 100.0),
			);
			if snapshot.gpus.is_empty() {
				note_row(ui, t!("没有可用的 GPU 探针"));
			} else {
				for gpu in &snapshot.gpus {
					let value = match (gpu.utilization_percent, gpu.memory_used) {
						(Some(percent), Some(memory)) => {
							format!("{percent:.0}% · {}", bytes_label(memory))
						},
						(Some(percent), None) => format!("{percent:.0}%"),
						(None, Some(memory)) => bytes_label(memory),
						(None, None) => "—".to_owned(),
					};
					gauge(ui, &gpu.name, &value, gpu.utilization_percent.map(|p| p / 100.0));
				}
			}
			ui.add_space(8.0);
			section_head(ui, t!("进程（按 CPU）"));
			if snapshot.processes.is_empty() {
				note_row(ui, t!("还没有可读的进程"));
				return;
			}
			process_head(ui);
			for process in &snapshot.processes {
				process_row(ui, process);
			}
		});
}

/// A labelled share: value on the right, a thin bar underneath.
fn gauge(ui: &mut Ui, label: &str, value: &str, fraction: Option<f32>) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
	truncated_text(
		ui,
		pos2(row.min.x + 2.0, row.center().y),
		label,
		11.0,
		theme::TEXT_3,
		row.width() - 150.0,
	);
	truncated_mono_right(ui, row.max.x - 2.0, row.center().y, value, 11.0, theme::TEXT, 146.0);
	bar(ui, fraction);
}

/// A 6 pt bar whose fill is the real share; `None` draws the empty track only.
fn bar(ui: &mut Ui, fraction: Option<f32>) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 7.0), Sense::hover());
	let rect = Rect::from_min_size(
		pos2(row.min.x + 2.0, row.center().y - 3.0),
		vec2((row.width() - 4.0).max(1.0), 6.0),
	);
	ui.painter()
		.rect_filled(rect, CornerRadius::same(3), theme::PANEL_4);
	if let Some(fraction) = fraction {
		let filled = (rect.width() * fraction.clamp(0.0, 1.0)).max(0.0);
		if filled > 0.0 {
			ui.painter().rect_filled(
				Rect::from_min_size(rect.min, vec2(filled, rect.height())),
				CornerRadius::same(3),
				theme::ACCENT,
			);
		}
	}
}

/// A quiet one-line note inside the page.
fn note_row(ui: &mut Ui, text: &str) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
	truncated_text(
		ui,
		pos2(row.min.x + 4.0, row.center().y),
		text,
		11.5,
		theme::TEXT_3,
		row.width() - 8.0,
	);
}

/// A section divider: 11 pt, dim, with a rule under it.
fn section_head(ui: &mut Ui, label: &str) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
	ui.painter().text(
		pos2(row.min.x + 2.0, row.center().y),
		Align2::LEFT_CENTER,
		label,
		FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	ui.painter().line_segment(
		[pos2(row.min.x + 2.0, row.max.y - 0.5), pos2(row.max.x - 2.0, row.max.y - 0.5)],
		egui::Stroke::new(1.0_f32, theme::BORDER),
	);
}

/// The process table's columns: a flexing name, then pid / CPU / RSS.
struct Columns {
	name: f32,
	pid: f32,
	cpu: f32,
	mem: f32,
}

impl Columns {
	fn of(width: f32) -> Self {
		// Each field is the column's right edge: the values are right-aligned,
		// so the width between two edges is what the column owns.
		let mem = width - 2.0;
		let cpu = mem - 64.0;
		let pid = cpu - 52.0;
		Self { name: (pid - 48.0 - 8.0).max(24.0), pid, cpu, mem }
	}
}

fn process_head(ui: &mut Ui) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
	let columns = Columns::of(row.width());
	let font = FontId::new(10.5, egui::FontFamily::Monospace);
	let ink = theme::TEXT_3;
	let y = row.center().y;
	truncated_mono(ui, pos2(row.min.x + 4.0, y), t!("名称"), 10.5, ink, columns.name);
	ui.painter().text(
		pos2(row.min.x + columns.pid, y),
		Align2::RIGHT_CENTER,
		"PID",
		font.clone(),
		ink,
	);
	ui.painter().text(
		pos2(row.min.x + columns.cpu, y),
		Align2::RIGHT_CENTER,
		"CPU%",
		font.clone(),
		ink,
	);
	ui.painter()
		.text(pos2(row.min.x + columns.mem, y), Align2::RIGHT_CENTER, t!("内存"), font, ink);
}

fn process_row(ui: &mut Ui, process: &sysmon::ProcessSample) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
	let columns = Columns::of(row.width());
	let font = FontId::new(11.0, egui::FontFamily::Monospace);
	let y = row.center().y;
	truncated_mono(
		ui,
		pos2(row.min.x + 4.0, y),
		&process.name,
		11.0,
		if process.cpu_percent >= 25.0 {
			theme::TEXT
		} else {
			theme::TEXT_2
		},
		columns.name,
	);
	ui.painter().text(
		pos2(row.min.x + columns.pid, y),
		Align2::RIGHT_CENTER,
		process.pid.to_string(),
		font.clone(),
		theme::TEXT_3,
	);
	ui.painter().text(
		pos2(row.min.x + columns.cpu, y),
		Align2::RIGHT_CENTER,
		format!("{:.1}", process.cpu_percent),
		font.clone(),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(row.min.x + columns.mem, y),
		Align2::RIGHT_CENTER,
		bytes_label(process.memory_bytes),
		font,
		theme::TEXT_2,
	);
}

/// `1536` → `1.5 KiB`. Binary units, one decimal — a process table reads as
/// sizes, not as byte counts.
pub fn bytes_label(bytes: u64) -> String {
	const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
	let mut value = bytes as f64;
	let mut unit = 0;
	while value >= 1024.0 && unit + 1 < UNITS.len() {
		value /= 1024.0;
		unit += 1;
	}
	if unit == 0 {
		format!("{bytes} B")
	} else {
		format!("{value:.1} {}", UNITS[unit])
	}
}

#[cfg(test)]
mod tests {
	use super::bytes_label;

	#[test]
	fn bytes_use_binary_units() {
		assert_eq!(bytes_label(0), "0 B");
		assert_eq!(bytes_label(1023), "1023 B");
		assert_eq!(bytes_label(1024), "1.0 KiB");
		assert_eq!(bytes_label(1536), "1.5 KiB");
		assert_eq!(bytes_label(5 * 1024 * 1024 * 1024), "5.0 GiB");
	}
}
