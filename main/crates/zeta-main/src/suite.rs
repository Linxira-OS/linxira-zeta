//! Suite-tool resolution and the `zeta doctor` install report.
//!
//! The SUITE table is the single source of suite configuration: bin names,
//! the owning npm package, the canonical install command, and the workbench
//! pane kind. Every surface — `zeta doctor` fix lines, the CLI handoff
//! (`zetawork code|ide|web`), the pane layer and the workbench's install
//! flow — renders what this table computes; none writes its own copy.
//!
//! One name per product (registry: companion-product bins): `zetacode` and
//! `zetaide` are the only bin names these packages install. The hyphenated
//! compatibility aliases (`zeta-c`/`zeta-cli`/`zeta-ide`/`zeta-i`) and the
//! retired editor command (`zetaeditor`/`zeta-editor`/`zeta-e`) are gone —
//! a table carrying them would make `zeta doctor` resolve names no install
//! creates, and the coded panes would spawn nothing.

use crate::tab::PaneKind;

/// Bin names of the coding CLI (`@linxiraos/zeta`), in resolution order.
/// The workbench's own bins (`zeta`/`zetawork`) are deliberately absent:
/// resolving a pane to them would spawn the workbench recursively.
pub const CODING_BINS: &[&str] = &["zetacode"];

/// Bin names of the terminal IDE (`@linxiraos/ide`).
pub const IDE_BINS: &[&str] = &["zetaide"];

pub struct SuiteTool {
	/// Product name, as the menus spell it (full names: zeta-code, zeta-ide).
	pub name: &'static str,
	/// PATH lookup candidates: the canonical bin first, private aliases
	/// after. These are the bins the owning npm package actually installs.
	pub bins: &'static [&'static str],
	/// Owning npm package; non-npm tools carry their upstream package name.
	pub package: &'static str,
	/// The workbench pane that runs this tool.
	pub kind: PaneKind,
}

pub const SUITE: &[SuiteTool] = &[
	SuiteTool {
		name: "zetacode (coding CLI)",
		bins: CODING_BINS,
		package: "@linxiraos/zeta",
		kind: PaneKind::Agent,
	},
	SuiteTool {
		name: "zetaide (TermIDE)",
		bins: IDE_BINS,
		package: "@linxiraos/ide",
		kind: PaneKind::Ide,
	},
];

impl SuiteTool {
	/// The canonical install command — the exact string `zeta doctor`
	/// prints, the workbench's install pane runs, and the CLI hints. Single
	/// source: [`PaneKind::install_spec`]; the table carries no copy.
	pub fn install_command(&self) -> Option<String> {
		self
			.kind
			.install_spec()
			.map(|(_, command)| command.to_string())
	}
}

/// The suite tool behind a bin name. Each tool declares exactly one bin
/// today; the slice form stays because callers resolve by candidate list
/// (argv dispatcher and pane layer pass the same table entries).
pub fn tool_by_bins(bins: &[&str]) -> Option<&'static SuiteTool> {
	bins
		.iter()
		.find_map(|b| SUITE.iter().find(|t| t.bins.contains(b)))
}

/// Suite tools currently missing from PATH, in SUITE order.
pub fn missing_tools() -> Vec<&'static SuiteTool> {
	SUITE
		.iter()
		.filter(|t| resolve_bin(t.bins).is_none())
		.collect()
}

/// The batch-install status line for the workbench's Install missing flow:
/// one readable "bin: command" segment per missing tool (menu vocabulary —
/// the full tool names), built from the same [`SuiteTool::install_command`]
/// strings the doctor prints. `None` when nothing is missing.
pub fn install_batch_line(missing: &[&'static SuiteTool]) -> Option<String> {
	if missing.is_empty() {
		return None;
	}
	let list = missing
		.iter()
		.map(|t| {
			format!(
				"{}: {}",
				t.bins[0],
				t.install_command()
					.unwrap_or_else(|| format!("install {}", t.package))
			)
		})
		.collect::<Vec<_>>()
		.join(" · ");
	Some(format!("installing {} — {list}", missing.len()))
}

/// Resolve a suite bin on PATH (re-exported from the pane layer).
pub fn resolve_bin(bins: &[&str]) -> Option<std::path::PathBuf> {
	crate::tab::resolve_bin(bins)
}

/// `zeta doctor`: one line per suite tool — installed, or the exact fix (the
/// canonical [`SuiteTool::install_command`] string, the same command the
/// workbench's install flow shows). Ends with a summary.
pub fn doctor() -> String {
	let mut out = String::from("zeta suite — install status\n\n");
	let mut missing = 0usize;
	for tool in SUITE {
		if resolve_bin(tool.bins).is_some() {
			out.push_str(&format!("  ✓ {} — installed\n", tool.name));
		} else {
			missing += 1;
			let fix = tool
				.install_command()
				.unwrap_or_else(|| format!("install {}", tool.package));
			out.push_str(&format!("  ✗ {} — missing\n      fix: {fix}\n", tool.name));
		}
	}
	out.push_str(&format!(
		"\n  {} of {} tools installed. Missing tools self-install:\n  Alt+C/I opens an install \
		 pane; Tools ▸ Install missing\n  fills every gap at once.\n",
		SUITE.len() - missing,
		SUITE.len()
	));
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn suite_table_is_consistent() {
		assert_eq!(SUITE.len(), 2, "coding CLI + IDE; the editor pane is built in");
		for tool in SUITE {
			assert!(!tool.name.is_empty() && !tool.bins.is_empty(), "{}: identity set", tool.name);
			assert!(
				tool.package.starts_with("@linxiraos/"),
				"{}: every suite tool is npm-carried",
				tool.name
			);
		}
	}

	#[test]
	fn npm_install_commands_are_spelled_out() {
		for tool in SUITE {
			let Some(install) = tool.install_command() else {
				panic!("{}: every suite tool has a canonical command", tool.name);
			};
			assert_eq!(
				install,
				format!("npm install -g {}", tool.package),
				"{}: canonical full form only",
				tool.name
			);
			assert!(!install.contains("npm i "), "{}: never the abbreviated `npm i`", tool.name);
		}
	}

	#[test]
	fn bin_aliases_are_unique_across_tools() {
		for (i, a) in SUITE.iter().enumerate() {
			for b in SUITE.iter().skip(i + 1) {
				for alias in a.bins {
					assert!(
						!b.bins.contains(alias),
						"`{alias}` claimed by both {} and {}",
						a.name,
						b.name
					);
				}
			}
		}
	}

	#[test]
	fn workbench_bin_is_not_a_suite_alias() {
		// `zeta`/`zetawork` are the WORKBENCH bins (@linxiraos/main).
		// Treating them as a zetacode alias made doctor report the coding CLI
		// installed whenever the workbench itself was on PATH.
		for tool in SUITE {
			assert!(!tool.bins.contains(&"zeta"), "{} must not alias `zeta`", tool.name);
			assert!(!tool.bins.contains(&"zetawork"), "{} must not alias `zetawork`", tool.name);
		}
		assert!(tool_by_bins(&["zeta"]).is_none(), "`zeta` resolves to no suite tool");
		assert!(tool_by_bins(&["zetawork"]).is_none());
	}

	#[test]
	fn bins_match_the_published_packages() {
		// Ground truth: each package's own bin map (one name each).
		assert_eq!(tool_by_bins(&["zetacode"]).map(|t| t.package), Some("@linxiraos/zeta"));
		assert_eq!(tool_by_bins(&["zetaide"]).map(|t| t.package), Some("@linxiraos/ide"));
		assert!(tool_by_bins(&["nosuchbin"]).is_none());
		// The deleted compatibility names resolve to nothing, so no pane and
		// no install hint can silently fall back to a command that no longer
		// exists.
		for gone in
			["zeta-c", "zeta-cli", "zeta-ide", "zeta-i", "zeta-editor", "zeta-e", "zetaeditor"]
		{
			assert!(tool_by_bins(&[gone]).is_none(), "`{gone}` must not resolve");
		}
	}

	#[test]
	fn panes_map_one_to_one_onto_suite_kinds() {
		for (i, a) in SUITE.iter().enumerate() {
			for b in SUITE.iter().skip(i + 1) {
				assert_ne!(a.kind, b.kind, "{}/{} share a pane kind", a.name, b.name);
			}
		}
	}

	#[test]
	fn doctor_fix_lines_are_the_canonical_commands() {
		let report = doctor();
		let mut missing = 0usize;
		for tool in SUITE {
			if resolve_bin(tool.bins).is_none() {
				missing += 1;
				let fix = tool
					.install_command()
					.unwrap_or_else(|| format!("install {}", tool.package));
				assert!(
					report.contains(&format!("fix: {fix}")),
					"doctor must print the canonical command for {}",
					tool.name
				);
			} else {
				assert!(report.contains(&format!("✓ {}", tool.name)));
			}
		}
		assert!(report.contains(&format!(
			"{} of {} tools installed",
			SUITE.len() - missing,
			SUITE.len()
		)));
	}

	#[test]
	fn install_batch_line_lists_every_missing_tool_with_its_command() {
		let missing = missing_tools();
		match install_batch_line(&missing) {
			None => assert!(missing.is_empty(), "no line only when nothing is missing"),
			Some(line) => {
				assert!(line.starts_with(&format!("installing {} — ", missing.len())));
				for tool in &missing {
					assert!(line.contains(tool.bins[0]), "menu-vocabulary name: {}", tool.name);
					let cmd = tool
						.install_command()
						.unwrap_or_else(|| format!("install {}", tool.package));
					assert!(line.contains(&cmd), "canonical command: {cmd}");
				}
			},
		}
	}

	#[test]
	fn empty_batch_has_no_line() {
		assert!(install_batch_line(&[]).is_none());
	}
}
