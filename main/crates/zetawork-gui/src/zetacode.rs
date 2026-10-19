// SPDX-License-Identifier: AGPL-3.0-only
//! zetacode's own options, the desktop app's provider (服务商) catalog, and
//! where the shipped companion binaries live.
//!
//! The 设置 modal has two rows that belong to zetacode rather than to
//! zetawork: the option list `zetacode config list --json` prints (backed by
//! `<agent dir>/config.yml`), and the provider table in
//! `<home>/.zeta/agent/models.yml` that the desktop app reads to reach a
//! model. This module is the real backend for both.
//!
//! [`Companion`] answers the other question the GUI asks itself: *which
//! `zetacode` / `zetaide` do I start?* Only the ones this install ships —
//! next to the GUI, in the npm platform leaves beside it, or in the checkout a
//! dev build came from. `PATH` is never consulted (a global npm install is a
//! different, older program), and when nothing is found [`resolve`] returns
//! the exact sentence the pane shows.
//!
//! # What is real
//!
//! [`config_list`] and [`set`] spawn the real [`resolve`]d binary — never a
//! shell, stdin closed, both pipes captured, no console window on Windows —
//! and hand back exactly what it printed. [`parse_config_list`] and
//! [`parse_providers`] are the parsers behind them, and
//! [`set_provider_field`] is a byte-preserving textual edit of the
//! `models.yml` source, so a hand-written file keeps its own formatting when
//! a single string literal is rewritten.
//!
//! # What is not
//!
//! Nothing here owns a window, a widget or a background writer: the modal
//! calls these functions and paints their result. `models.yml` is the only
//! file this module writes, only through [`write_provider_field`], and only
//! when the edit actually changes the bytes.

use crate::t;
#[cfg(windows)]
use std::os::windows::process::CommandExt as _;
use std::{
	fs,
	path::{Path, PathBuf},
	process::{Command, Stdio},
};

use serde_json::{Map, Value};

/// `CREATE_NO_WINDOW`, so spawning `zetacode` never flashes a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A binary zetawork ships and starts itself.
///
/// Resolution never consults `PATH`: a global npm install is an older program
/// with a different UI, and starting it instead of the shipped one is exactly
/// the bug this enum exists to prevent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Companion {
	/// The coding-agent CLI the GUI's zetacode page runs.
	Zetacode,
	/// The terminal IDE (`zetaide`, shipped as `termide`).
	Zetaide,
}

impl Companion {
	/// The name the user knows it by; the missing-binary sentence uses it.
	pub fn name(self) -> &'static str {
		match self {
			Self::Zetacode => "zetacode",
			Self::Zetaide => "zetaide",
		}
	}

	/// The file names that count as this companion, the platform spelling
	/// first. `zeta` is the coding agent's built binary, `termide` is the
	/// zetaide the `@linxiraos/ide*` leaves ship.
	pub fn executable_names(self) -> &'static [&'static str] {
		#[cfg(windows)]
		{
			match self {
				// `zeta.exe` beside the shell is the **workbench** (its own
				// binary), not the CLI: resolving it here made a zetacode page
				// run an old zetawork. The CLI answers to `zetacode` only; a
				// checkout's `packages/coding-agent/dist/zeta.exe` is reached
				// through `dev_names`, where the path names the program.
				Self::Zetacode => &["zetacode.exe", "zetacode"],
				Self::Zetaide => &["zetaide.exe", "termide.exe", "zetaide", "termide"],
			}
		}
		#[cfg(not(windows))]
		{
			match self {
				Self::Zetacode => &[
					"zetacode",
					// No bare `zeta`: that is the workbench's index bin.
					"zeta-linux-x64",
					"zeta-linux-arm64",
					"zeta-darwin-x64",
					"zeta-darwin-arm64",
				],
				Self::Zetaide => &[
					"zetaide",
					"termide",
					"termide-linux-x64",
					"termide-linux-arm64",
					"termide-darwin-x64",
					"termide-darwin-arm64",
				],
			}
		}
	}

	/// The `@linxiraos/<prefix>*` package-name prefix the npm platform leaves
	/// are published under (zetacode: `zeta*`, zetaide: `ide*`).
	fn scope_prefix(self) -> &'static str {
		match self {
			Self::Zetacode => "zeta",
			Self::Zetaide => "ide",
		}
	}

	/// The names a checkout's dev build is known by.
	fn dev_names(self) -> &'static [&'static str] {
		#[cfg(windows)]
		{
			match self {
				Self::Zetacode => &["zeta.exe", "zeta"],
				Self::Zetaide => &["termide.exe", "termide"],
			}
		}
		#[cfg(not(windows))]
		{
			match self {
				Self::Zetacode => &["zeta"],
				Self::Zetaide => &["termide", "termide-linux-x64", "termide-linux-arm64"],
			}
		}
	}
}

/// What a companion page's PTY runs: the resolved shipped binary, or the one
/// sentence explaining that this install ships none.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Launch {
	/// Run this binary directly — no shell, nothing typed into one.
	Binary(PathBuf),
	/// Nothing shipped was found; show this sentence in the pane.
	Missing(String),
}

/// The package directories under `scope` whose name starts with `prefix`, in
/// name order so the candidate list is stable between runs.
/// `prefix` empty keeps every directory.
fn scoped_packages(scope: &Path, prefix: &str) -> Vec<PathBuf> {
	let Ok(entries) = std::fs::read_dir(scope) else {
		return Vec::new();
	};
	let mut found: Vec<PathBuf> = entries
		.flatten()
		.map(|entry| entry.path())
		.filter(|path| path.is_dir())
		.filter(|path| {
			prefix.is_empty()
				|| path
					.file_name()
					.and_then(|name| name.to_str())
					.is_some_and(|name| name.starts_with(prefix))
		})
		.collect();
	found.sort();
	found
}

fn push_unique(out: &mut Vec<PathBuf>, path: PathBuf) {
	if !out.contains(&path) {
		out.push(path);
	}
}

/// Every file this build would accept for `companion`, in resolution order.
///
/// 1. next to the running GUI — its own directory, then a `bin/` under it;
/// 2. the npm platform leaves one level up: `<exe>/../node_modules/`
///    `@linxiraos/{zeta,ide}*/bin/*`;
/// 3. a source checkout, walking up from the GUI's own directory:
///    `packages/coding-agent/dist/zeta(.exe)` for zetacode and
///    `termide/target/release/termide(.exe)` / `main/npm/<package>/bin` for
///    zetaide.
///
/// `PATH` is not a candidate: the only accepted programs are the ones this
/// install ships.
pub fn candidates(exe_dir: &Path, companion: Companion) -> Vec<PathBuf> {
	let mut out = Vec::new();
	// 1. The GUI's own directory and its `bin/`.
	for dir in [exe_dir.to_path_buf(), exe_dir.join("bin")] {
		for name in companion.executable_names() {
			push_unique(&mut out, dir.join(name));
		}
	}
	// 2. The npm platform leaves installed next to this install.
	if let Some(scope) = exe_dir
		.parent()
		.map(|dir| dir.join("node_modules").join("@linxiraos"))
	{
		for package in scoped_packages(&scope, companion.scope_prefix()) {
			for name in companion.executable_names() {
				push_unique(&mut out, package.join("bin").join(name));
			}
		}
	}
	// 3. The source checkout this binary was built from.
	for ancestor in exe_dir.ancestors() {
		match companion {
			Companion::Zetacode => {
				for name in companion.dev_names() {
					push_unique(
						&mut out,
						ancestor
							.join("packages")
							.join("coding-agent")
							.join("dist")
							.join(name),
					);
				}
			},
			Companion::Zetaide => {
				for name in companion.dev_names() {
					push_unique(
						&mut out,
						ancestor
							.join("termide")
							.join("target")
							.join("release")
							.join(name),
					);
				}
				for package in scoped_packages(&ancestor.join("main").join("npm"), "") {
					for name in companion.executable_names() {
						push_unique(&mut out, package.join("bin").join(name));
					}
				}
			},
		}
	}
	out
}

/// The first candidate that is a file, or every path that was searched.
pub fn resolve_in(exe_dir: &Path, companion: Companion) -> Result<PathBuf, Vec<PathBuf>> {
	let searched = candidates(exe_dir, companion);
	match searched.iter().find(|path| path.is_file()) {
		Some(path) => Ok(path.clone()),
		None => Err(searched),
	}
}

/// The exact sentence a pane shows when nothing shipped was found.
pub fn missing_sentence(companion: Companion, searched: &[PathBuf]) -> String {
	let paths: Vec<String> = searched
		.iter()
		.map(|path| path.display().to_string())
		.collect();
	t!("未找到随包的 {}：{}", companion.name(), paths.join(", "))
}

/// Resolve `companion` for this process, or the sentence explaining why the
/// install cannot open it.
pub fn resolve(companion: Companion) -> Result<PathBuf, String> {
	let missing = |detail: String| t!("未找到随包的 {}：{}", companion.name(), detail);
	let exe = std::env::current_exe().map_err(|err| missing(t!("无法定位运行目录（{}）", err)))?;
	let exe_dir = exe
		.parent()
		.ok_or_else(|| missing(t!("无法定位运行目录").to_owned()))?;
	resolve_in(exe_dir, companion).map_err(|searched| missing_sentence(companion, &searched))
}

/// Resolve `companion` for a new page: the binary to run, or the sentence the
/// pane shows instead.
pub fn launch(companion: Companion) -> Launch {
	match resolve(companion) {
		Ok(path) => Launch::Binary(path),
		Err(sentence) => Launch::Missing(sentence),
	}
}

/// One option `zetacode config list` reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZetacodeOption {
	/// The setting id, e.g. `theme.dark`.
	pub key: String,
	/// The stored value, rendered as text; `None` when the config file holds
	/// no value for this key and the built-in default applies.
	pub value: Option<String>,
	/// The CLI's own type tag: `string`, `enum`, `boolean`, `number`,
	/// `array`, `object` or `record`.
	pub kind: String,
	/// One-line help for the setting; empty when the CLI reports none.
	pub description: String,
}

impl ZetacodeOption {
	/// The text a row shows: the value itself, or `（未设置）` when the config
	/// file has no stored value for this key.
	pub fn display_value(&self) -> String {
		self
			.value
			.clone()
			.unwrap_or_else(|| t!("（未设置）").to_string())
	}
}

/// One provider of the desktop app's configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Provider {
	/// The provider id, as used under `providers:` in `models.yml`.
	pub id: String,
	/// `baseUrl`, when the file gives a string.
	pub base_url: Option<String>,
	/// `api`, when the file gives a string.
	pub api: Option<String>,
	/// The *name* of the environment variable holding the key, not the key.
	pub api_key: Option<String>,
	/// How many entries the provider's `models` array holds; `0` when there
	/// is no such array.
	pub models: usize,
}

impl Provider {
	/// The provider's model count as a label for the modal's 服务商 row.
	pub fn models_label(&self) -> String {
		if self.models == 0 {
			t!("无模型").to_string()
		} else {
			t!("{} 个模型", self.models)
		}
	}
}

/// Parse `zetacode config list --json`.
///
/// The document is an object keyed by setting id, each value carrying a
/// `type`, a `description` and — only when the config file actually stores
/// one — a `value`. Scalars are rendered plainly (`zh`, `true`, `2`) and
/// arrays or objects as compact JSON; the result is sorted by key, so the
/// modal's rows are stable between reads. Anything that is not that shape is
/// an `Err` naming the offending key.
pub fn parse_config_list(json: &str) -> Result<Vec<ZetacodeOption>, String> {
	let root: Value =
		serde_json::from_str(json).map_err(|err| format!("invalid config list JSON: {err}"))?;
	let entries = root
		.as_object()
		.ok_or_else(|| "config list is not a JSON object".to_string())?;

	let mut options = Vec::with_capacity(entries.len());
	for (key, entry) in entries {
		let entry = entry
			.as_object()
			.ok_or_else(|| format!("setting {key} is not a JSON object"))?;
		let kind = entry
			.get("type")
			.and_then(Value::as_str)
			.ok_or_else(|| format!("setting {key} has no string 'type'"))?;
		let description = entry
			.get("description")
			.and_then(Value::as_str)
			.unwrap_or("");
		let value = match entry.get("value") {
			None | Some(Value::Null) => None,
			Some(value) => Some(render_value(value)),
		};
		options.push(ZetacodeOption {
			key: key.clone(),
			value,
			kind: kind.to_string(),
			description: description.to_string(),
		});
	}
	options.sort_by(|a, b| a.key.cmp(&b.key));
	Ok(options)
}

/// Read the option list from a real `zetacode config list --json`.
///
/// A non-zero exit, or a missing `zetacode`, comes back as the failure text.
pub fn config_list() -> Result<Vec<ZetacodeOption>, String> {
	let argv = ["config".to_string(), "list".to_string(), "--json".to_string()];
	let (stdout, _) = run_zetacode(&argv)?;
	parse_config_list(&stdout)
}

/// The option with this key, for a row that binds to one setting.
pub fn option<'a>(options: &'a [ZetacodeOption], key: &str) -> Option<&'a ZetacodeOption> {
	options.iter().find(|option| option.key == key)
}

/// The argv (after the program name) of `zetacode config set <key> <value>`.
///
/// Pure, so the modal can show the command it is about to run — and the
/// tests can pin it — without spawning anything.
pub fn set_argv(key: &str, value: &str) -> Vec<String> {
	vec!["config".to_string(), "set".to_string(), key.to_string(), value.to_string()]
}

/// Run a real `zetacode config set <key> <value>`.
///
/// `Ok` carries the command's own stdout followed by its stderr, so the modal
/// can show whatever zetacode said; a non-zero exit is an `Err` carrying the
/// stderr text.
pub fn set(key: &str, value: &str) -> Result<String, String> {
	let (stdout, stderr) = run_zetacode(&set_argv(key, value))?;
	Ok(format!("{stdout}{stderr}"))
}

/// `<home>/.zeta/agent/models.yml`, the agent dir's provider catalog.
pub fn models_yml_path(home: &Path) -> PathBuf {
	home.join(".zeta").join("agent").join("models.yml")
}

/// Parse the provider catalog of a `models.yml`.
///
/// Providers come back in file order — the order the file itself lists them,
/// not sorted — with `baseUrl`, `api` and `apiKey` taken as strings when they
/// are strings, and `models` counted. A file that is not JSON, has no
/// `providers` object, or lists a provider that is not an object is an `Err`.
pub fn parse_providers(yml: &str) -> Result<Vec<Provider>, String> {
	let root: Value =
		serde_json::from_str(yml).map_err(|err| format!("invalid models.yml: {err}"))?;
	let providers = root
		.get("providers")
		.and_then(Value::as_object)
		.ok_or_else(|| "models.yml has no 'providers' object".to_string())?;
	let ids = provider_ids(yml)?;
	if ids.len() != providers.len() {
		return Err(format!(
			"models.yml lists {} providers but {} keys were scanned",
			providers.len(),
			ids.len()
		));
	}

	let mut catalog = Vec::with_capacity(ids.len());
	for id in ids {
		let entry = providers
			.get(&id)
			.and_then(Value::as_object)
			.ok_or_else(|| format!("provider {id} is not an object"))?;
		catalog.push(Provider {
			id,
			base_url: text_field(entry, "baseUrl"),
			api: text_field(entry, "api"),
			api_key: text_field(entry, "apiKey"),
			models: entry
				.get("models")
				.and_then(Value::as_array)
				.map_or(0, Vec::len),
		});
	}
	Ok(catalog)
}

/// Read the provider catalog of `<home>/.zeta/agent/models.yml`.
///
/// A missing or unreadable file is an `Err` naming the path.
pub fn read_providers(home: &Path) -> Result<Vec<Provider>, String> {
	let path = models_yml_path(home);
	let yml = fs::read_to_string(&path).map_err(|err| format!("{}: {err}", path.display()))?;
	parse_providers(&yml)
}

/// Rewrite one *string* field of one provider in `models.yml`'s source text.
///
/// The edit is textual and byte-preserving: the provider's block is located,
/// then that block's `"field": "…"` member, and only the characters between
/// the value's quotes are replaced (`\` and `"` escaped). Every other byte of
/// `text` — comments, key order, indentation, unrelated providers — survives
/// untouched. It never guesses: an absent provider id, an absent field, or a
/// field whose value is not a string literal is an `Err`.
pub fn set_provider_field(
	text: &str,
	provider_id: &str,
	field: &str,
	value: &str,
) -> Result<String, String> {
	let root: Value =
		serde_json::from_str(text).map_err(|err| format!("invalid models.yml: {err}"))?;
	let entry = root
		.get("providers")
		.and_then(Value::as_object)
		.and_then(|providers| providers.get(provider_id))
		.ok_or_else(|| format!("unknown provider: {provider_id}"))?
		.as_object()
		.ok_or_else(|| format!("provider {provider_id} is not an object"))?;
	let current = entry
		.get(field)
		.ok_or_else(|| format!("provider {provider_id} has no '{field}' field"))?;
	if !current.is_string() {
		return Err(format!("provider {provider_id} field '{field}' is not a string"));
	}

	let open = provider_open(text)?;
	let (block, _) =
		member(text, open, provider_id).map_err(|err| format!("provider {provider_id}: {err}"))?;
	if text.as_bytes().get(block) != Some(&b'{') {
		return Err(format!("provider {provider_id} is not a JSON object"));
	}
	let (start, end) =
		member(text, block, field).map_err(|err| format!("provider {provider_id}: {err}"))?;
	if text.as_bytes().get(start) != Some(&b'"') {
		return Err(format!("provider {provider_id} field '{field}' is not a string literal"));
	}

	let mut out = String::with_capacity(text.len() + value.len());
	out.push_str(&text[..start]);
	out.push('"');
	out.push_str(&escape(value));
	out.push('"');
	out.push_str(&text[end..]);
	Ok(out)
}

/// Read `<home>/.zeta/agent/models.yml`, apply [`set_provider_field`], and
/// write the file back only when the edit changed it.
///
/// Every failure — unreadable file, unknown provider, absent field, non-string
/// field — returns before the file is touched, so a rejected edit leaves the
/// user's catalog exactly as it was.
pub fn write_provider_field(
	home: &Path,
	provider_id: &str,
	field: &str,
	value: &str,
) -> Result<(), String> {
	let path = models_yml_path(home);
	let text = fs::read_to_string(&path).map_err(|err| format!("{}: {err}", path.display()))?;
	let edited = set_provider_field(&text, provider_id, field, value)?;
	if edited == text {
		return Ok(());
	}
	fs::write(&path, edited).map_err(|err| format!("{}: {err}", path.display()))
}

/// Run the shipped `zetacode <args>…`, returning `(stdout, stderr)` with `\r`
/// stripped.
///
/// The binary is the one this install ships ([`resolve`]) — never a `PATH`
/// lookup, so the settings modal cannot silently drive an older global npm
/// install. stdin is closed and both pipes are captured; on Windows the child
/// gets [`CREATE_NO_WINDOW`]. A non-zero exit is an `Err` carrying the stderr
/// text, so callers can show what the CLI complained about; a missing binary is
/// the resolution sentence.
fn run_zetacode(args: &[String]) -> Result<(String, String), String> {
	let program = resolve(Companion::Zetacode)?;
	let shown = program.display().to_string();
	let mut cmd = Command::new(&program);
	cmd.args(args);
	cmd.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());
	#[cfg(windows)]
	cmd.creation_flags(CREATE_NO_WINDOW);

	let argv = args.join(" ");
	let child = cmd
		.spawn()
		.map_err(|err| format!("{shown} {argv}: {err}"))?;
	crate::spawn_probe::record_command(child.id(), &cmd);
	let output = child
		.wait_with_output()
		.map_err(|err| format!("{shown} {argv}: {err}"))?;
	let stdout = String::from_utf8_lossy(&output.stdout).replace('\r', "");
	let stderr = String::from_utf8_lossy(&output.stderr).replace('\r', "");
	if !output.status.success() {
		let detail = stderr.trim();
		let detail = if detail.is_empty() {
			"command failed"
		} else {
			detail
		};
		return Err(format!("{shown} {argv}: {detail}"));
	}
	Ok((stdout, stderr))
}

/// Render a stored value the way a row shows it: strings as themselves,
/// everything else (numbers, booleans, arrays, objects) as JSON text.
fn render_value(value: &Value) -> String {
	match value {
		Value::String(text) => text.clone(),
		other => other.to_string(),
	}
}

/// A provider's string field, or `None` when it is absent or not a string.
fn text_field(entry: &Map<String, Value>, key: &str) -> Option<String> {
	entry.get(key).and_then(Value::as_str).map(String::from)
}

/// Escape only what JSON demands for the values we write: `\` and `"`.
fn escape(value: &str) -> String {
	let mut out = String::with_capacity(value.len());
	for ch in value.chars() {
		if matches!(ch, '\\' | '"') {
			out.push('\\');
		}
		out.push(ch);
	}
	out
}

/// The byte index of the `{` that opens the top-level `providers` object.
fn provider_open(text: &str) -> Result<usize, String> {
	let root = text.find('{').ok_or_else(|| "no JSON object".to_string())?;
	let (start, _) = member(text, root, "providers")?;
	if text.as_bytes().get(start) != Some(&b'{') {
		return Err("'providers' is not a JSON object".to_string());
	}
	Ok(start)
}

/// The provider ids of a `models.yml`, in the order the file lists them.
///
/// `serde_json`'s map sorts its keys, so the order — which is what the modal
/// shows — has to come from the source text: this walks the `providers`
/// object's own level and collects each member key in encounter order.
fn provider_ids(text: &str) -> Result<Vec<String>, String> {
	let bytes = text.as_bytes();
	let mut ids = Vec::new();
	let mut depth = 0usize;
	let mut i = provider_open(text)?;
	let mut expect_key = true;

	while i < bytes.len() {
		match bytes[i] {
			b'{' | b'[' => {
				depth += 1;
				i += 1;
			},
			b'}' | b']' => {
				depth = depth.saturating_sub(1);
				i += 1;
				if depth == 0 {
					break;
				}
			},
			b'"' => {
				let end = string_end(bytes, i).ok_or_else(|| "unterminated string".to_string())?;
				if depth == 1 && expect_key {
					ids.push(decode_string(&text[i..end])?);
					expect_key = false;
				}
				i = end;
			},
			b',' if depth == 1 => {
				expect_key = true;
				i += 1;
			},
			_ => i += 1,
		}
	}
	Ok(ids)
}

/// The `(start, end)` span of the value of member `key` in the object whose
/// `{` sits at `open`; `end` is exclusive and `key` must be at that object's
/// own level, so a nested object with the same key is skipped.
fn member(text: &str, open: usize, key: &str) -> Result<(usize, usize), String> {
	let bytes = text.as_bytes();
	if bytes.get(open) != Some(&b'{') {
		return Err(format!("no object at byte {open}"));
	}
	let mut depth = 0usize;
	let mut i = open;
	let mut expect_key = true;

	while i < bytes.len() {
		match bytes[i] {
			b'{' | b'[' => {
				depth += 1;
				i += 1;
			},
			b'}' | b']' => {
				depth = depth.saturating_sub(1);
				i += 1;
				if depth == 0 {
					break;
				}
			},
			b'"' => {
				let end = string_end(bytes, i).ok_or_else(|| "unterminated string".to_string())?;
				if depth == 1 && expect_key {
					if decode_string(&text[i..end])? == key {
						return value_span(text, end);
					}
					expect_key = false;
				}
				i = end;
			},
			b',' if depth == 1 => {
				expect_key = true;
				i += 1;
			},
			_ => i += 1,
		}
	}
	Err(format!("no '{key}' member"))
}

/// The span of the value that follows a member's closing key quote.
fn value_span(text: &str, after_key: usize) -> Result<(usize, usize), String> {
	let bytes = text.as_bytes();
	let mut i = after_key;
	while matches!(bytes.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
		i += 1;
	}
	if bytes.get(i) != Some(&b':') {
		return Err("expected ':' after a member key".to_string());
	}
	i += 1;
	while matches!(bytes.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
		i += 1;
	}
	let end = scan_value_end(bytes, i).ok_or_else(|| "missing member value".to_string())?;
	Ok((i, end))
}

/// The exclusive end of the JSON value starting at `start`.
fn scan_value_end(bytes: &[u8], start: usize) -> Option<usize> {
	match bytes.get(start)? {
		b'"' => string_end(bytes, start),
		b'{' | b'[' => {
			let mut depth = 0usize;
			let mut i = start;
			while i < bytes.len() {
				match bytes[i] {
					b'"' => i = string_end(bytes, i)?,
					b'{' | b'[' => {
						depth += 1;
						i += 1;
					},
					b'}' | b']' => {
						depth = depth.saturating_sub(1);
						i += 1;
						if depth == 0 {
							return Some(i);
						}
					},
					_ => i += 1,
				}
			}
			None
		},
		_ => {
			let mut i = start;
			while i < bytes.len() && !matches!(bytes[i], b',' | b'}' | b']') {
				i += 1;
			}
			Some(i)
		},
	}
}

/// The index just past the closing quote of the string literal at `start`.
fn string_end(bytes: &[u8], start: usize) -> Option<usize> {
	if bytes.get(start) != Some(&b'"') {
		return None;
	}
	let mut i = start + 1;
	while i < bytes.len() {
		match bytes[i] {
			b'\\' => i += 2,
			b'"' => return Some(i + 1),
			_ => i += 1,
		}
	}
	None
}

/// Decode a JSON string literal, quotes included, into its text.
fn decode_string(raw: &str) -> Result<String, String> {
	serde_json::from_str::<String>(raw).map_err(|err| format!("invalid JSON string {raw}: {err}"))
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A slice of the real `zetacode config list --json` output: two stored
	/// scalars, an empty array, a value-less key, a nested `record` and a
	/// compact one-line array.
	const CONFIG_LIST: &str = r#"{
  "language": {
    "value": "zh",
    "type": "enum",
    "description": "CLI language for user-facing text (system prompts stay English)"
  },
  "providers.webSearchOrder": {
    "value": [],
    "type": "array",
    "description": "Prioritized providers for the web_search tool"
  },
  "providers.webSearchGeminiModel": {
    "type": "string",
    "description": "Model ID for Gemini Google Search grounding. Defaults to gemini-2.5-flash."
  },
  "modelRoles": {
    "value": {
      "default": "stepfun/step-5-preview:max",
      "tiny": "local/lfm2.5-230m"
    },
    "type": "record",
    "description": ""
  },
  "setupVersion": {
    "value": 2,
    "type": "number",
    "description": ""
  },
  "autoResume": {
    "value": true,
    "type": "boolean",
    "description": "Automatically resume the most recent session in the current directory"
  },
  "cycleOrder": {
    "value": ["smol", "default", "slow"],
    "type": "array",
    "description": ""
  }
}"#;

	/// A slice of the real `~/.zeta/agent/models.yml`: two providers in file
	/// order (deliberately not alphabetical), one with models and one without.
	const MODELS_YML: &str = r#"{
  "providers": {
    "zai": {
      "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
      "api": "openai-completions",
      "apiKey": "ZAI_API_KEY",
      "models": [
        {
          "id": "glm-5.3",
          "name": "GLM 5.3"
        },
        {
          "id": "glm-5.3-flash",
          "name": "GLM 5.3 Flash"
        }
      ]
    },
    "aaccxx": {
      "baseUrl": "https://api.aaccx.pw/v1",
      "api": "openai-completions",
      "apiKey": "AACCXX_API_KEY",
      "models": []
    }
  }
}"#;

	fn temp_dir(tag: &str) -> PathBuf {
		let dir =
			std::env::temp_dir().join(format!("zetawork-gui-zetacode-{tag}-{}", std::process::id()));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn the_workbench_is_never_resolved_as_zetacode() {
		// A workbench binary sits in the same directory as the GUI (and, in an
		// npm install, in the leaf beside it). Taking it for the CLI is how a
		// zetacode page started an old zetawork instead of the current CLI.
		let names = Companion::Zetacode.executable_names();
		assert!(
			!names
				.iter()
				.any(|name| name.eq_ignore_ascii_case("zeta.exe") || name.eq_ignore_ascii_case("zeta")),
			"the workbench's own names must not count as zetacode: {names:?}"
		);
		assert!(names.iter().any(|name| name.starts_with("zetacode")));

		// The names are per platform (`zetacode` on unix, `zetacode.exe` on
		// Windows), so the fixture uses the list's own first entry rather than
		// a hard-coded Windows spelling; the decoy is the workbench's name on
		// this platform. The Linux leg caught the hard-coded version.
		let cli = names[0];
		let workbench = if cfg!(windows) { "zeta.exe" } else { "zeta" };

		let scratch = tempfile::tempdir().expect("scratch dir");
		let dir = scratch.path();
		std::fs::write(dir.join(workbench), b"workbench").expect("write decoy");
		std::fs::write(dir.join(cli), b"cli").expect("write cli");
		let found = candidates(dir, Companion::Zetacode);
		// Beside the shell (and in its `bin/`) only the CLI's own name counts.
		// The checkout's `packages/coding-agent/dist/zeta` stays legal: that
		// directory is the CLI's own build, not the workbench's neighbour.
		for beside in [dir.to_path_buf(), dir.join("bin")] {
			assert!(
				!found.contains(&beside.join(workbench)),
				"the workbench beside the GUI must not be a candidate: {found:?}"
			);
		}
		assert!(
			found
				.iter()
				.any(|path| path.file_name().is_some_and(|name| name == cli)),
			"the real CLI beside the GUI is: {found:?}"
		);
	}

	#[test]
	fn config_list_is_sorted_and_renders_every_value_shape() {
		let options = parse_config_list(CONFIG_LIST).unwrap();
		let keys: Vec<&str> = options.iter().map(|o| o.key.as_str()).collect();
		assert_eq!(
			keys,
			[
				"autoResume",
				"cycleOrder",
				"language",
				"modelRoles",
				"providers.webSearchGeminiModel",
				"providers.webSearchOrder",
				"setupVersion",
			]
		);

		let language = option(&options, "language").unwrap();
		assert_eq!(language.value.as_deref(), Some("zh"));
		assert_eq!(language.kind, "enum");
		assert_eq!(language.display_value(), "zh");
		assert!(language.description.starts_with("CLI language"));

		assert_eq!(option(&options, "setupVersion").unwrap().display_value(), "2");
		assert_eq!(option(&options, "autoResume").unwrap().display_value(), "true");
		assert_eq!(
			option(&options, "providers.webSearchOrder")
				.unwrap()
				.display_value(),
			"[]"
		);
		assert_eq!(
			option(&options, "cycleOrder").unwrap().display_value(),
			r#"["smol","default","slow"]"#
		);
		assert_eq!(
			option(&options, "modelRoles").unwrap().display_value(),
			r#"{"default":"stepfun/step-5-preview:max","tiny":"local/lfm2.5-230m"}"#
		);

		let unset = option(&options, "providers.webSearchGeminiModel").unwrap();
		assert_eq!(unset.value, None, "a key with no stored value has no value field");
		assert_eq!(unset.display_value(), "（未设置）");
		assert_eq!(unset.kind, "string");
		assert_eq!(option(&options, "nope"), None);
	}

	#[test]
	fn config_list_rejects_input_it_cannot_read() {
		assert!(parse_config_list("{ \"a\": ").is_err(), "truncated JSON");
		assert!(parse_config_list("[]").is_err(), "a list is not a keyed object");
		assert!(parse_config_list("{\"a\": 1}").is_err(), "an entry must be an object");
		assert!(
			parse_config_list("{\"a\": {\"description\": \"\"}}").is_err(),
			"an entry must carry a string type"
		);
	}

	#[test]
	fn set_argv_is_the_cli_command() {
		assert_eq!(set_argv("language", "en"), ["config", "set", "language", "en"].map(String::from));
	}

	#[test]
	fn providers_keep_file_order() {
		let catalog = parse_providers(MODELS_YML).unwrap();
		let ids: Vec<&str> = catalog.iter().map(|p| p.id.as_str()).collect();
		assert_eq!(ids, ["zai", "aaccxx"], "file order, not the sorted order serde_json gives");
		assert_eq!(
			catalog[0].base_url.as_deref(),
			Some("https://open.bigmodel.cn/api/coding/paas/v4")
		);
		assert_eq!(catalog[0].api.as_deref(), Some("openai-completions"));
		assert_eq!(catalog[0].api_key.as_deref(), Some("ZAI_API_KEY"));
		assert_eq!(catalog[0].models, 2);
		assert_eq!(catalog[0].models_label(), "2 个模型");
		assert_eq!(catalog[1].models, 0);
		assert_eq!(catalog[1].models_label(), "无模型");
	}

	#[test]
	fn providers_reject_input_they_cannot_read() {
		assert!(parse_providers("{").is_err(), "truncated JSON");
		assert!(parse_providers("[]").is_err(), "a list is not a catalog");
		assert!(parse_providers("{\"providers\": []}").is_err(), "providers must be an object");
		assert!(
			parse_providers("{\"providers\": {\"zai\": 3}}").is_err(),
			"a provider must be an object"
		);
	}

	#[test]
	fn models_yml_path_is_the_agent_dir_catalog() {
		let home = Path::new("C:\\Users\\someone");
		assert_eq!(models_yml_path(home), home.join(".zeta").join("agent").join("models.yml"));
	}

	#[test]
	fn set_provider_field_replaces_only_the_targeted_literal() {
		let edited = set_provider_field(MODELS_YML, "zai", "apiKey", "NEW_KEY").unwrap();
		assert_eq!(edited, MODELS_YML.replace("ZAI_API_KEY", "NEW_KEY"));

		let catalog = parse_providers(&edited).unwrap();
		assert_eq!(catalog[0].api_key.as_deref(), Some("NEW_KEY"));
		assert_eq!(catalog[1].api_key.as_deref(), Some("AACCXX_API_KEY"), "the other provider");
		assert_eq!(catalog[0].base_url, parse_providers(MODELS_YML).unwrap()[0].base_url);

		// A field that is not inside the targeted provider's block is not
		// touched: every byte outside that provider's own value survives.
		let literal = "https://api.aaccx.pw/v1";
		let start = MODELS_YML.find(literal).unwrap();
		let end = start + literal.len();
		let other =
			set_provider_field(MODELS_YML, "aaccxx", "baseUrl", "https://example.test").unwrap();
		assert_eq!(&other[..start], &MODELS_YML[..start]);
		assert_eq!(&other[start..start + "https://example.test".len()], "https://example.test");
		assert_eq!(&other[start + "https://example.test".len()..], &MODELS_YML[end..]);
	}

	#[test]
	fn set_provider_field_escapes_quotes_and_backslashes() {
		let value = "a\"b\\c";
		let edited = set_provider_field(MODELS_YML, "zai", "apiKey", value).unwrap();
		assert!(edited.contains(r#""apiKey": "a\"b\\c""#), "{edited}");
		let catalog = parse_providers(&edited).unwrap();
		assert_eq!(catalog[0].api_key.as_deref(), Some(value));
	}

	#[test]
	fn set_provider_field_refuses_to_guess() {
		assert!(set_provider_field(MODELS_YML, "nope", "apiKey", "x").is_err(), "unknown provider");
		assert!(set_provider_field(MODELS_YML, "zai", "nope", "x").is_err(), "unknown field");
		assert!(set_provider_field(MODELS_YML, "zai", "models", "x").is_err(), "array, not a string");
		assert!(set_provider_field("{", "zai", "apiKey", "x").is_err(), "unreadable source");
	}

	#[test]
	fn set_provider_field_round_trips_byte_for_byte() {
		let there = set_provider_field(MODELS_YML, "zai", "apiKey", "TEMP").unwrap();
		assert_ne!(there, MODELS_YML);
		let back = set_provider_field(&there, "zai", "apiKey", "ZAI_API_KEY").unwrap();
		assert_eq!(back, MODELS_YML, "setting the original value back reproduces the input");
	}

	#[test]
	fn write_provider_field_writes_only_a_real_change() {
		let dir = temp_dir("write-provider");
		let path = models_yml_path(&dir);
		fs::create_dir_all(path.parent().unwrap()).unwrap();
		fs::write(&path, MODELS_YML).unwrap();

		assert!(write_provider_field(&dir, "nope", "apiKey", "x").is_err());
		assert_eq!(
			fs::read_to_string(&path).unwrap(),
			MODELS_YML,
			"a rejected edit must leave the file untouched"
		);

		write_provider_field(&dir, "aaccxx", "baseUrl", "https://example.test/v1").unwrap();
		let edited = fs::read_to_string(&path).unwrap();
		assert_eq!(edited, MODELS_YML.replace("https://api.aaccx.pw/v1", "https://example.test/v1"));
		assert_eq!(
			read_providers(&dir).unwrap()[1].base_url.as_deref(),
			Some("https://example.test/v1"),
			"the file just written is what read_providers sees"
		);
		assert!(read_providers(&dir.join("nowhere")).is_err(), "a missing catalog is an error");

		write_provider_field(&dir, "aaccxx", "baseUrl", "https://example.test/v1").unwrap();
		assert_eq!(fs::read_to_string(&path).unwrap(), edited, "an identical value rewrites nothing");
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn the_candidate_list_is_gui_then_npm_leaves_then_the_checkout() {
		let root = temp_dir("candidate-order");
		let exe_dir = root.join("app");
		let leaf = root
			.join("node_modules")
			.join("@linxiraos")
			.join("zeta-win32-x64")
			.join("bin");
		let dist = root.join("packages").join("coding-agent").join("dist");
		for dir in [&exe_dir, &leaf, &dist] {
			fs::create_dir_all(dir).unwrap();
		}
		let names = Companion::Zetacode.executable_names();
		let all = candidates(&exe_dir, Companion::Zetacode);
		assert_eq!(all[0], exe_dir.join(names[0]), "next to the GUI wins");
		assert_eq!(all[names.len()], exe_dir.join("bin").join(names[0]), "then its bin/");
		assert!(all.contains(&leaf.join(names[0])), "the npm platform leaf: {all:?}");
		assert!(
			all.contains(&dist.join(Companion::Zetacode.dev_names()[0])),
			"the checkout's dist: {all:?}"
		);

		// `main/npm` ships zetawork, not zetacode: it must never be accepted
		// for the coding agent (that was the old launch bug).
		let main_bin = root
			.join("main")
			.join("npm")
			.join("main-windows-x64")
			.join("bin");
		fs::create_dir_all(&main_bin).unwrap();
		fs::write(main_bin.join("zeta.exe"), b"zetawork").unwrap();
		assert!(
			!candidates(&exe_dir, Companion::Zetacode).contains(&main_bin.join("zeta.exe")),
			"main/npm is zetawork, not zetacode"
		);
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn resolution_takes_the_first_existing_shipped_file() {
		let root = temp_dir("resolve-order");
		let exe_dir = root.join("app");
		let leaf = root
			.join("node_modules")
			.join("@linxiraos")
			.join("zeta-win32-x64")
			.join("bin");
		let dist = root.join("packages").join("coding-agent").join("dist");
		for dir in [&exe_dir, &leaf, &dist] {
			fs::create_dir_all(dir).unwrap();
		}
		let name = Companion::Zetacode.executable_names()[0];
		let dev = Companion::Zetacode.dev_names()[0];

		// Nothing shipped: the error names everything that was searched.
		let searched = resolve_in(&exe_dir, Companion::Zetacode).expect_err("nothing to run");
		assert!(searched.iter().all(|path| !path.is_file()));
		assert!(searched.contains(&exe_dir.join(name)), "{searched:?}");

		// The checkout a dev build came from.
		fs::write(dist.join(dev), b"zeta").unwrap();
		assert_eq!(
			resolve_in(&exe_dir, Companion::Zetacode),
			Ok(dist.join(dev)),
			"a dev build finds the checkout"
		);
		// An installed npm platform leaf outranks the checkout.
		fs::write(leaf.join(name), b"leaf").unwrap();
		assert_eq!(
			resolve_in(&exe_dir, Companion::Zetacode),
			Ok(leaf.join(name)),
			"the npm leaf outranks the checkout"
		);
		// The binary next to the GUI outranks everything.
		fs::write(exe_dir.join(name), b"exe").unwrap();
		assert_eq!(
			resolve_in(&exe_dir, Companion::Zetacode),
			Ok(exe_dir.join(name)),
			"the co-located binary wins"
		);
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn a_missing_companion_names_every_searched_path() {
		let root = temp_dir("missing");
		let exe_dir = root.join("app");
		fs::create_dir_all(&exe_dir).unwrap();
		let searched = resolve_in(&exe_dir, Companion::Zetacode).expect_err("nothing shipped");
		let sentence = missing_sentence(Companion::Zetacode, &searched);
		assert!(sentence.starts_with("未找到随包的 zetacode："), "{sentence}");
		for path in &searched {
			assert!(
				sentence.contains(&path.display().to_string()),
				"{} missing from {sentence}",
				path.display()
			);
		}
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn zetaide_resolves_from_its_own_leaves_the_checkout_and_main_npm() {
		let root = temp_dir("zetaide");
		let exe_dir = root.join("app");
		let leaf = root
			.join("node_modules")
			.join("@linxiraos")
			.join("ide-windows-x64")
			.join("bin");
		let release = root.join("termide").join("target").join("release");
		let main_bin = root
			.join("main")
			.join("npm")
			.join("ide-windows-x64")
			.join("bin");
		for dir in [&exe_dir, &leaf, &release, &main_bin] {
			fs::create_dir_all(dir).unwrap();
		}
		let name = Companion::Zetaide.executable_names()[0];
		let dev = Companion::Zetaide.dev_names()[0];

		assert!(candidates(&exe_dir, Companion::Zetaide).contains(&main_bin.join(name)));
		fs::write(release.join(dev), b"termide").unwrap();
		assert_eq!(resolve_in(&exe_dir, Companion::Zetaide), Ok(release.join(dev)));
		fs::write(leaf.join(name), b"leaf").unwrap();
		assert_eq!(resolve_in(&exe_dir, Companion::Zetaide), Ok(leaf.join(name)));
		let _ = fs::remove_dir_all(&root);
	}
}
