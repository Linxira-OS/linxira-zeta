// Zeta deviation: embed the shared Zeta PE icon in the vendored TermIDE
// binaries (`zetaide` / `termide-editor`). Upstream TermIDE ships no Windows
// resource; see termide/VENDOR.md. Release windows-gnu builds fail if the
// resource cannot be compiled, so an iconless IDE is never published.
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=assets/termide.rc");
    println!("cargo:rerun-if-changed=../main/crates/zetawork-gui/assets/icon.ico");
    println!("cargo:rerun-if-changed=../packages/coding-agent/package.json");

    // The vendored TermIDE workspace keeps its upstream 0.46.0 crate version
    // so future snapshots stay mergeable. The product-facing `--version` still
    // follows the Zeta release line, with the upstream version kept in
    // parentheses for traceability.
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let upstream = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".to_owned());
    let zeta = zeta_version(&manifest_dir).unwrap_or_else(|| upstream.clone());
    println!("cargo:rustc-env=ZETA_DISPLAY_VERSION={zeta} (termide {upstream})");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("gnu") {
        return;
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let object = out_dir.join("termide-resource.o");
    let script = match resource_script(&manifest_dir, &out_dir) {
        Ok(script) => script,
        Err(error) => {
            if env::var("PROFILE").as_deref() == Ok("release")
                && env::var("ZETA_ALLOW_MISSING_WINDOWS_ICON").is_err()
            {
                panic!("could not prepare the Windows icon resource: {error}");
            }
            println!("cargo:warning=could not prepare the Windows icon resource: {error}");
            return;
        }
    };

    match compile(&script, &object, &manifest_dir) {
        Ok(()) => println!("cargo:rustc-link-arg={}", object.display()),
        Err(error) => {
            if env::var("PROFILE").as_deref() == Ok("release")
                && env::var("ZETA_ALLOW_MISSING_WINDOWS_ICON").is_err()
            {
                panic!("could not compile the Windows icon resource: {error}");
            }
            println!("cargo:warning=could not compile the Windows icon resource: {error}");
        }
    }
}

/// Zeta product version (`packages/coding-agent/package.json`). The vendored
/// workspace itself stays on the upstream TermIDE version.
fn zeta_version(manifest_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(
        manifest_dir
            .join("..")
            .join("packages")
            .join("coding-agent")
            .join("package.json"),
    )
    .ok()?;
    let key = "\"version\"";
    let after_key = &text[text.find(key)? + key.len()..];
    let after_colon = &after_key[after_key.find(':')? + 1..];
    let start = after_colon.find('"')? + 1;
    let end = after_colon[start..].find('"')? + start;
    Some(after_colon[start..end].to_owned())
}

/// Materialize the committed template with an absolute icon path. Older
/// `windres` resolves `ICON` paths against the working directory, while newer
/// ones resolve them against the `.rc` directory; an absolute path works for
/// both, including CI checkouts nested differently from the source tree.
fn resource_script(manifest_dir: &Path, out_dir: &Path) -> Result<PathBuf, String> {
    let template = fs::read_to_string(manifest_dir.join("assets").join("termide.rc"))
        .map_err(|error| format!("assets/termide.rc: {error}"))?;
    let icon = manifest_dir
        .join("..")
        .join("main")
        .join("crates")
        .join("zetawork-gui")
        .join("assets")
        .join("icon.ico");
    if !icon.exists() {
        return Err(format!("{}: missing", icon.display()));
    }
    let escaped = icon
        .display()
        .to_string()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let script = out_dir.join("termide-resource.rc");
    fs::write(&script, template.replace("@ZETA_ICON@", &escaped))
        .map_err(|error| format!("{}: {error}", script.display()))?;
    Ok(script)
}

fn candidates() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(windres) = env::var("WINDRES") {
        out.push(windres);
    }
    if let Ok(linker) = env::var("CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER")
        .or_else(|_| env::var("CARGO_TARGET_AARCH64_PC_WINDOWS_GNU_LINKER"))
    {
        let path = Path::new(&linker);
        if let Some(dir) = path.parent() {
            if !dir.as_os_str().is_empty() {
                let sibling = dir.join("windres");
                if sibling.exists() {
                    out.push(sibling.display().to_string());
                }
            }
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            if let Some(prefix) = name.strip_suffix("gcc") {
                out.push(format!("{prefix}windres"));
            }
        }
    }
    match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => out.push("aarch64-w64-mingw32-windres".to_owned()),
        _ => out.push("x86_64-w64-mingw32-windres".to_owned()),
    }
    out.push("windres".to_owned());
    out.dedup();
    out
}

fn compile(script: &Path, object: &Path, cwd: &Path) -> Result<(), String> {
    let mut errors = Vec::new();
    for windres in candidates() {
        let status = Command::new(&windres)
            .arg("--input")
            .arg(script)
            .arg("--output")
            .arg(object)
            .arg("--output-format=coff")
            .arg(format!("--include-dir={}", cwd.join("assets").display()))
            .current_dir(cwd)
            .status();
        match status {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => errors.push(format!("{windres} exited with {status}")),
            Err(error) => errors.push(format!("{windres}: {error}")),
        }
    }
    Err(errors.join("; "))
}
