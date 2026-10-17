//! External formatters, one table and one runner.
//!
//! The page formats the file it is showing by extension, through the tool the
//! ecosystem already uses for that language. Nothing is bundled: a missing
//! binary is reported by name instead of being silently skipped, because a
//! formatter that "worked" by doing nothing is worse than one that fails.

use std::path::Path;

/// One formatter: what to run and which arguments make it write in place.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Formatter {
    pub program: &'static str,
    pub args: &'static [&'static str],
}

/// The formatter for `path`, by extension.
pub fn for_path(path: &Path) -> Option<Formatter> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let (program, args): (&'static str, &'static [&'static str]) = match extension.as_str() {
        "rs" => ("rustfmt", &["--edition", "2021"]),
        "ts" | "tsx" | "js" | "jsx" | "json" | "css" | "scss" | "md" | "mdx" | "yaml" | "yml" => {
            ("prettier", &["--write"])
        }
        "py" | "pyi" => ("black", &["--quiet"]),
        "go" => ("gofmt", &["-w"]),
        "lua" => ("stylua", &[]),
        "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" => ("clang-format", &["-i"]),
        "sh" | "bash" | "zsh" => ("shfmt", &["-w"]),
        _ => return None,
    };
    Some(Formatter { program, args })
}

/// Format `path` in place. The success value is the program that ran, so the
/// status line can say which tool did it.
pub fn run(path: &Path) -> Result<&'static str, String> {
    let Some(formatter) = for_path(path) else {
        return Err(format!("no formatter for {}", path.display()));
    };
    match std::process::Command::new(formatter.program)
        .args(formatter.args)
        .arg(path)
        .status()
    {
        Ok(status) if status.success() => Ok(formatter.program),
        Ok(status) => Err(format!("{} failed: {status}", formatter.program)),
        Err(error) => Err(format!("cannot run {}: {error}", formatter.program)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn program(path: &str) -> Option<&'static str> {
        for_path(&PathBuf::from(path)).map(|formatter| formatter.program)
    }

    #[test]
    fn every_supported_language_maps_to_its_tool() {
        assert_eq!(program("a.rs"), Some("rustfmt"));
        assert_eq!(program("a.ts"), Some("prettier"));
        assert_eq!(program("a.py"), Some("black"));
        assert_eq!(program("a.go"), Some("gofmt"));
        assert_eq!(program("a.lua"), Some("stylua"));
        assert_eq!(program("a.cpp"), Some("clang-format"));
        assert_eq!(program("a.sh"), Some("shfmt"));
    }

    #[test]
    fn rustfmt_reformats_a_rust_file_in_place() {
        // The toolchain normally ships rustfmt; a machine without it skips
        // rather than failing the suite (the table test above still pins the
        // mapping).
        if std::process::Command::new("rustfmt")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let path = std::env::temp_dir().join(format!("panel-ide-fmt-{}.rs", std::process::id()));
        std::fs::write(&path, "fn  main( ){let x=1;}\n").expect("write the fixture");
        let program = run(&path).expect("rustfmt runs");
        assert_eq!(program, "rustfmt");
        let formatted = std::fs::read_to_string(&path).expect("read back");
        assert!(
            formatted.contains("fn main()"),
            "the file was reformatted: {formatted:?}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_unknown_language_is_refused_by_name() {
        assert_eq!(program("notes.txt"), None);
        let error = run(Path::new("notes.txt")).expect_err("no formatter");
        assert!(
            error.contains("notes.txt"),
            "the message names the file: {error}"
        );
    }
}
