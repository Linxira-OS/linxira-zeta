//! CLI positional-argument parsing for termide.
//!
//! One canonical rule for `file[:line[:col]]`, aligned with the editor's
//! `splitLineCol`: 1-based line/column, at most two numeric suffixes,
//! trailing colons tolerated, and a Windows drive-letter colon is never
//! treated as a separator. A positional that already exists on disk is
//! taken literally (so a directory stays a directory and a file whose
//! name happens to contain a colon keeps working); the suffix is only
//! interpreted when the argument as a whole does not exist.

use std::path::{Path, PathBuf};

/// A resolved CLI positional argument.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedTarget {
    /// File path to open, or directory to use as the project root.
    pub path: PathBuf,
    /// 1-based line to place the cursor on, if a `:line` suffix was parsed.
    pub line: Option<usize>,
    /// 1-based column, if a `:col` suffix was parsed.
    pub col: Option<usize>,
    /// The argument resolved to an existing directory (no `:line` suffix),
    /// i.e. it asks to become the project root rather than open a panel.
    pub is_dir_root: bool,
}

/// Parse raw positional CLI arguments into openable targets.
///
/// `cwd` resolves relative paths (and is the fallback when the current
/// directory cannot be determined by the caller). Relative paths are
/// resolved against the *invoking* directory, before any directory
/// argument changes the project root.
pub fn parse_positional_args(args: &[String], cwd: &Path) -> Vec<OpenedTarget> {
    args.iter()
        .map(|arg| {
            let (path, line, col) = split_line_col(arg);
            let absolute = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            let is_dir_root = line.is_none() && absolute.is_dir();
            OpenedTarget {
                path: absolute,
                line,
                col,
                is_dir_root,
            }
        })
        .collect()
}

/// Split a trailing `:line[:col]` suffix off `arg`.
///
/// Returns `(path, line, col)` with 1-based numbers. Rules:
/// - The argument is stat'ed as-is first: if it exists, it is returned
///   untouched (this is what keeps directories and colon-bearing paths
///   intact).
/// - Trailing colons are tolerated (`main.go:42:` from `grep -n` output).
/// - At most two numeric suffixes are consumed; both must be positive.
/// - A drive-letter colon (`C:\x.go`) is never a separator, so
///   `C:\x.go:42` splits into `C:\x.go` + line 42.
/// - If no valid suffix is found, the whole argument is the path.
pub fn split_line_col(arg: &str) -> (PathBuf, Option<usize>, Option<usize>) {
    if Path::new(arg).exists() {
        return (PathBuf::from(arg), None, None);
    }

    // Tolerate trailing colon(s), e.g. `main.go:42:` pasted from grep -n.
    let trimmed = arg.trim_end_matches(':');
    let mut numbers: Vec<usize> = Vec::with_capacity(2);
    let mut rest = trimmed;
    while numbers.len() < 2 {
        let Some(idx) = rest.rfind(':') else { break };
        // Drive-letter guard: in `C:\x.go` the only colon is the drive
        // separator and must stay part of the path.
        if idx == 1 && rest.as_bytes()[0].is_ascii_alphabetic() {
            break;
        }
        let suffix = &rest[idx + 1..];
        let Ok(n) = suffix.parse::<usize>() else {
            break;
        };
        if n == 0 {
            // 1-based positions: `:0` is not a line/column, so stop here
            // and keep whatever we already collected.
            break;
        }
        numbers.push(n);
        rest = &rest[..idx];
    }

    match numbers.as_slice() {
        [line] => (PathBuf::from(rest), Some(*line), None),
        [col, line] => (PathBuf::from(rest), Some(*line), Some(*col)),
        _ => (PathBuf::from(arg), None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets(args: &[&str]) -> Vec<OpenedTarget> {
        let strs: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        parse_positional_args(&strs, Path::new("/cwd"))
    }

    // — split_line_col —

    #[test]
    fn plain_path_is_untouched() {
        assert_eq!(
            split_line_col("src/main.rs"),
            (PathBuf::from("src/main.rs"), None, None)
        );
    }

    #[test]
    fn splits_line_and_col() {
        assert_eq!(
            split_line_col("src/main.rs:42:7"),
            (PathBuf::from("src/main.rs"), Some(42), Some(7))
        );
    }

    #[test]
    fn splits_line_only() {
        assert_eq!(
            split_line_col("src/main.rs:42"),
            (PathBuf::from("src/main.rs"), Some(42), None)
        );
    }

    #[test]
    fn tolerates_trailing_colon() {
        assert_eq!(
            split_line_col("src/main.rs:42:"),
            (PathBuf::from("src/main.rs"), Some(42), None)
        );
        assert_eq!(
            split_line_col("src/main.rs:42:7:"),
            (PathBuf::from("src/main.rs"), Some(42), Some(7))
        );
    }

    #[test]
    fn windows_drive_letter_is_safe() {
        assert_eq!(
            split_line_col(r"C:\x.go:42"),
            (PathBuf::from(r"C:\x.go"), Some(42), None)
        );
        assert_eq!(
            split_line_col(r"C:\x.go"),
            (PathBuf::from(r"C:\x.go"), None, None)
        );
        // A drive colon followed by digits is still the drive, not a line.
        assert_eq!(
            split_line_col(r"C:42"),
            (PathBuf::from(r"C:42"), None, None)
        );
        assert_eq!(
            split_line_col(r"C:\42"),
            (PathBuf::from(r"C:\42"), None, None)
        );
    }

    #[test]
    fn non_numeric_or_zero_suffix_stays_in_the_path() {
        assert_eq!(
            split_line_col("main.go:x"),
            (PathBuf::from("main.go:x"), None, None)
        );
        assert_eq!(
            split_line_col("main.go:0"),
            (PathBuf::from("main.go:0"), None, None)
        );
    }

    #[test]
    fn existing_path_is_taken_literally() {
        let dir = std::env::temp_dir().join(format!("cli-args-literal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("notes:42");
        std::fs::write(&file, b"hi").unwrap();
        let arg = file.to_str().unwrap();
        // Exists → no suffix interpretation, even though it ends in `:42`.
        assert_eq!(split_line_col(arg), (file.clone(), None, None));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    // — parse_positional_args —

    #[test]
    fn existing_directory_becomes_dir_root() {
        let dir = std::env::temp_dir().join(format!("cli-args-dirroot-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let parsed = targets(&[dir.to_str().unwrap()]);
        assert_eq!(parsed.len(), 1);
        assert!(parsed[0].is_dir_root);
        assert_eq!(parsed[0].path, dir);
        assert_eq!(parsed[0].line, None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn directory_with_line_suffix_is_not_a_root() {
        let dir = std::env::temp_dir().join(format!("cli-args-suffix-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let arg = format!("{}:3", dir.to_str().unwrap());
        let parsed = targets(&[&arg]);
        assert!(!parsed[0].is_dir_root);
        assert_eq!(parsed[0].line, Some(3));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn relative_paths_resolve_against_cwd() {
        let cwd = std::env::temp_dir();
        let parsed = parse_positional_args(&[String::from("a.rs:5"), String::from("b.rs")], &cwd);
        assert_eq!(parsed[0].path, cwd.join("a.rs"));
        assert_eq!(parsed[0].line, Some(5));
        assert_eq!(parsed[1].path, cwd.join("b.rs"));
        assert!(!parsed[1].is_dir_root);
    }

    #[test]
    fn multiple_files_stay_separate_targets() {
        let parsed = targets(&["a.rs", "b.rs:2:3", "c.rs"]);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].path, Path::new("/cwd").join("a.rs"));
        assert_eq!(parsed[1].line, Some(2));
        assert_eq!(parsed[1].col, Some(3));
        assert!(parsed.iter().all(|t| !t.is_dir_root));
    }

    #[test]
    fn missing_files_are_new_file_targets_without_suffix() {
        // Nonexistent path without a numeric suffix: no split, plain target
        // (the editor keeps its create-parent-dirs + touch semantics).
        let parsed = targets(&["newdir/newfile.txt"]);
        assert_eq!(parsed[0].path, Path::new("/cwd").join("newdir/newfile.txt"));
        assert_eq!(parsed[0].line, None);
        assert!(!parsed[0].is_dir_root);
    }
}
