//! zetawork GPUI spike — `spike/gpui-shell`.
//!
//! One window that answers the five nailed questions of R19:
//! ① does the crate build for `x86_64-pc-windows-gnu` on this MSVC-less box,
//! ② dock/multi-panel shell, ③ ratatui buffer blitted into a panel (CJK aligned),
//! ④ WebView2 child window in a panel, ⑤ Chinese IME in a real input.
//!
//! Run:
//! ```text
//! cargo +nightly-2026-08-12-x86_64-pc-windows-gnu run -p zetawork-gui-gpui -- \
//!     --shots temp/spike-gpui-shell/shots --auto-exit 4000
//! ```

mod cell_grid;
mod grid_view;
#[cfg(test)]
mod layout_persistence;
mod panels;
mod shell;
mod shot;
mod webview;

use std::path::PathBuf;
use std::time::Instant;

use gpui_kit::*;

use shell::{Config, Shell};

#[derive(Debug, Default)]
struct Args {
	shot_dir: Option<PathBuf>,
	shot_delay_ms: u64,
	auto_exit_ms: Option<u64>,
	no_webview: bool,
}

impl Args {
	fn parse() -> Self {
		let mut args = Args { shot_delay_ms: 900, ..Default::default() };
		let mut argv = std::env::args().skip(1);
		while let Some(arg) = argv.next() {
			match arg.as_str() {
				"--no-webview" => args.no_webview = true,
				"--shots" => {
					args.shot_dir = argv.next().map(PathBuf::from);
				},
				"--shot-delay" => {
					if let Some(value) = argv.next().and_then(|v| v.parse().ok()) {
						args.shot_delay_ms = value;
					}
				},
				"--auto-exit" => {
					args.auto_exit_ms = argv.next().and_then(|v| v.parse().ok());
				},
				"--help" | "-h" => {
					println!(
						"zetawork-gui-gpui [--shots <dir>] [--shot-delay <ms>] \
                         [--auto-exit <ms>] [--no-webview]"
					);
					std::process::exit(0);
				},
				other => eprintln!("[zeta-spike] ignoring unknown argument {other}"),
			}
		}
		args
	}
}

fn window_options() -> WindowOptions {
	WindowOptions {
		window_bounds: Some(WindowBounds::Windowed(Bounds {
			origin: point(px(60.), px(60.)),
			size: size(px(1500.), px(940.)),
		})),
		titlebar: Some(TitlebarOptions {
			title: Some("zetawork · GPUI spike — dock + ratatui blit + WebView2".into()),
			appears_transparent: false,
			traffic_light_position: None,
		}),
		focus: true,
		show: true,
		..Default::default()
	}
}

fn main() {
	let args = Args::parse();
	// Printed before any GPUI work so the harness can read the pid, cold-start
	// timing and (later) the RSS of this exact process.
	println!("[zeta-spike] pid={} cold_start_begin", std::process::id());

	let started = Instant::now();
	let config = Config {
		shot_dir: args.shot_dir,
		shot_delay_ms: args.shot_delay_ms,
		auto_exit_ms: args.auto_exit_ms,
		no_webview: args.no_webview,
	};

	gpui_kit::application()
		.with_assets(gpui_kit::assets::Assets)
		.run(move |cx| {
			gpui_kit::init(cx);
			cx.activate(true);
			let (_, _view) = gpui_kit::open_window(window_options(), cx, |window, cx| {
				cx.new(|cx| Shell::new(window, cx, config, started))
			})
			.expect("failed to open the shell window");
			println!("[zeta-spike] window_opened_ms={}", started.elapsed().as_millis());
		});
}
