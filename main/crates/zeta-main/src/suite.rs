//! Suite-tool resolution and the `zeta doctor` install report.
//!
//! The workbench is the unified entry: `zeta code|editor|ide` hand off to the
//! suite binaries, `zeta doctor` reports what is installed and how to fill
//! the gaps, and the workbench itself installs missing tools into a pane.

pub struct SuiteTool {
	pub name: &'static str,
	pub bins: &'static [&'static str],
	pub package: &'static str,
}

pub const SUITE: &[SuiteTool] = &[
	SuiteTool {
		name: "zeta-c (coding CLI)",
		bins: &["zeta-c", "zeta", "zetacode"],
		package: "@linxiraos/zeta",
	},
	SuiteTool {
		name: "zeta-editor (TTT)",
		bins: &["zeta-e", "zeta-editor"],
		package: "@linxiraos/editor",
	},
	SuiteTool {
		name: "zeta-ide (TermIDE)",
		bins: &["zeta-i", "zeta-ide"],
		package: "@linxiraos/ide",
	},
	SuiteTool { name: "files (yazi)", bins: &["yazi"], package: "yazi (see website)" },
];

/// Platform-native install command for a suite tool (used where npm does not
/// carry the package). Linux-first: pacman on the Linxira/Arch line.
pub fn native_install(tool: &SuiteTool) -> Option<String> {
	if tool.bins.first() != Some(&"yazi") {
		return None;
	}
	Some(if cfg!(windows) {
		"winget install sxyazi.yazi".into()
	} else {
		"sudo pacman -S yazi".into()
	})
}

pub fn tool_by_bins(bins: &[&str]) -> Option<&'static SuiteTool> {
	SUITE.iter().find(|t| t.bins.first() == bins.first())
}

/// The quick-install command for the tool behind `bins`, when it maps to an
/// npm package.
pub fn install_for(bins: &[&str]) -> Option<String> {
	let tool = tool_by_bins(bins)?;
	if tool.package.starts_with("@linxiraos/") {
		Some(format!("npm i -g {}", tool.package))
	} else {
		None // non-npm tools fall through to their native install command
	}
}

/// Resolve a suite bin on PATH (re-exported from the pane layer).
pub fn resolve_bin(bins: &[&str]) -> Option<std::path::PathBuf> {
	crate::tab::resolve_bin(bins)
}

/// `zeta doctor`: one line per suite tool — installed (with version when the
/// tool reports one quickly) or the exact fix. Ends with a summary.
pub fn doctor() -> String {
	let mut out = String::from("zeta suite — install status\n\n");
	let mut missing = 0usize;
	for tool in SUITE {
		match resolve_bin(tool.bins) {
			Some(path) => {
				let _ = path;
				out.push_str(&format!("  ✓ {} — installed\n", tool.name));
			},
			None => {
				missing += 1;
				let fix = install_for(tool.bins)
					.or_else(|| native_install(tool))
					.unwrap_or_else(|| format!("install {}", tool.package));
				out.push_str(&format!("  ✗ {} — missing\n      fix: {fix}\n", tool.name));
			},
		}
	}
	out.push_str(&format!(
		"\n  {} of {} tools installed. Missing tools also self-install\n  from the workbench: split a pane of that kind (Pane menu or the\n  pane's ↔/↕ controls).\n",
		SUITE.len() - missing,
		SUITE.len()
	));
	out
}
