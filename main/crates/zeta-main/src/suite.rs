//! Suite-tool resolution and the `zeta doctor` install report.
//!
//! The SUITE table is the single source of suite configuration: bin
//! aliases, the owning npm package, the canonical install command, and the
//! workbench pane kind. Every surface — `zeta doctor` fix lines, the CLI
//! handoff (`zeta code|editor|ide`), and the workbench's install
//! flow — renders what this table computes; none writes its own copy.

use crate::tab::PaneKind;

pub struct SuiteTool {
	/// Product name, as the menus spell it (full names: zeta-editor,
	/// zeta-ide).
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
		bins: &["zetacode", "zeta-c", "zeta-cli"],
		package: "@linxiraos/zeta",
		kind: PaneKind::Agent,
	},
	SuiteTool {
		name: "zetaeditor (TTT)",
		bins: &["zetaeditor", "zeta-editor", "zeta-e"],
		package: "@linxiraos/editor",
		kind: PaneKind::Editor,
	},
	SuiteTool {
		name: "zetaide (TermIDE)",
		bins: &["zetaide", "zeta-ide", "zeta-i"],
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

/// The suite tool behind a bin name — any alias resolves, not just the
/// primary (aliases ship together in one package, so a secondary is just as
/// authoritative).
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
		"\n  {} of {} tools installed. Missing tools self-install:\n  Alt+C/E/I opens an install pane; Tools ▸ Install missing\n  fills every gap at once.\n",
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
		assert_eq!(SUITE.len(), 3, "workspace + coding CLI + editor + IDE, no files leg");
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
		// `zeta` is the WORKBENCH binary (@linxiraos/main). Treating it as a
		// zeta-c alias made doctor report the coding CLI installed whenever
		// the workbench itself was on PATH.
		for tool in SUITE {
			assert!(!tool.bins.contains(&"zeta"), "{} must not alias `zeta`", tool.name);
		}
		assert!(tool_by_bins(&["zeta"]).is_none(), "`zeta` resolves to no suite tool");
	}

	#[test]
	fn bin_aliases_match_the_published_packages() {
		// Ground truth: each package's own bin map.
		assert_eq!(
			tool_by_bins(&["zeta-c", "zeta-cli", "zetacode"]).map(|t| t.package),
			Some("@linxiraos/zeta")
		);
		assert_eq!(
			tool_by_bins(&["zeta-editor", "zeta-e"]).map(|t| t.package),
			Some("@linxiraos/editor")
		);
		assert_eq!(tool_by_bins(&["zeta-ide", "zeta-i"]).map(|t| t.package), Some("@linxiraos/ide"));
		assert!(tool_by_bins(&["nosuchbin"]).is_none());
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

	#[test]
	fn secondary_alias_yields_the_canonical_command() {
		let zeta_c = tool_by_bins(&["zeta-cli"]).expect("secondary alias resolves");
		assert_eq!(zeta_c.install_command().as_deref(), Some("npm install -g @linxiraos/zeta"));
		let editor = tool_by_bins(&["zeta-e"]).expect("secondary alias resolves");
		assert_eq!(editor.install_command().as_deref(), Some("npm install -g @linxiraos/editor"));
	}
}
