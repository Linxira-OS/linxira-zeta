//! `zetawork-gui` — the egui/eframe shell of the zetawork GUI spike.
//!
//! Run modes:
//!
//! * `zetawork-gui` — interactive shell (WebView2 child window attached).
//! * `zetawork-gui --bench 6` — unattended run: prints `[bench]` lines
//!   (first frame, probes, WebView2 inner size) and closes itself, so the cold
//!   start / RSS numbers in the report have a reproducible command.
//! * `zetawork-gui --log-ime ime.log` — appends every IME event, for the
//!   manual CJK input test.
//! * `zetawork-gui --no-embed` — UI only, no WebView2 (fallback path check).

use std::time::Instant;

fn main() -> eframe::Result<()> {
	let process_start = Instant::now();
	let opts = zetawork_gui::RunOptions {
		process_start,
		..zetawork_gui::RunOptions::from_args(std::env::args().skip(1))
	};

	let native_options = eframe::NativeOptions {
		viewport: egui::ViewportBuilder::default()
			.with_title(zetawork_gui::APP_TITLE)
			.with_inner_size([opts.width, opts.height]),
		..Default::default()
	};
	eframe::run_native(
		zetawork_gui::APP_TITLE,
		native_options,
		Box::new(move |cc| Ok(Box::new(zetawork_gui::ShellApp::new_native(cc, opts)))),
	)
}
