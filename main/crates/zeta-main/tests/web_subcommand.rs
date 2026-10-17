// SPDX-License-Identifier: AGPL-3.0-only
//! `zetawork web` end to end, through the real binary.
//!
//! The acceptance for the command unify is not "the dispatch table returns
//! the right value" but "asking the workbench for a browser-facing server
//! hands the request to the coding CLI's serve machine and that machine is
//! reachable". This test therefore:
//!
//!   ① writes a **stub** `zetacode` launcher into a temp dir and points the
//!     workbench at it with `ZETA_BIN_DIR` (the documented tier-① override),
//!   ② execs the REAL binary (`CARGO_BIN_EXE_zeta`) as `zetawork … web`,
//!   ③ asserts the stub received `serve` plus the pass-through flags,
//!   ④ probes the loopback port over HTTP and requires a 200,
//!   ⑤ tells the stub to stop and reaps the child it spawned.
//!
//! The stub stands in for the coding CLI itself: a real `zetacode serve`
//! boots the full Web UI, which needs a built (or npm-installed) web-ui the
//! repository does not carry in a clean checkout — the release and desktop
//! smoke jobs cover that leg. What this test owns is the wiring the
//! workbench is responsible for: entry resolution, argv hand-off, and the
//! fact that the launched process is a live localhost server that answers.
//!
//! Requires `node` on PATH (the stub is a few lines of JavaScript); without
//! it the test reports why and passes, instead of failing for a missing
//! prerequisite it cannot install.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// How long the workbench + stub may take to come up before the probe fails.
const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-attempt socket/read timeout while polling.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// A port nothing is listening on: bind :0, read the assignment, release it.
fn free_port() -> u16 {
	let listener = TcpListener::bind("127.0.0.1:0").expect("reserve a loopback port");
	let port = listener.local_addr().expect("local addr").port();
	drop(listener);
	port
}

/// `HTTP/1.x <status> <reason>` from a one-shot GET, or `None` when nothing
/// answers yet.
fn http_status(port: u16, path: &str) -> Option<String> {
	let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
	stream.set_read_timeout(Some(PROBE_TIMEOUT)).ok()?;
	write!(stream, "GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").ok()?;
	let mut body = String::new();
	stream.read_to_string(&mut body).ok()?;
	body.lines().next().map(str::to_string)
}

/// Absolute path of the `node` this machine would run, or `None`.
fn node_path() -> Option<PathBuf> {
	let probe = Command::new("node").arg("--version").output().ok()?;
	if !probe.status.success() {
		return None;
	}
	let which = if cfg!(windows) { "where" } else { "which" };
	let output = Command::new(which).arg("node").output().ok()?;
	if !output.status.success() {
		return None;
	}
	let first = String::from_utf8_lossy(&output.stdout)
		.lines()
		.next()?
		.trim()
		.to_string();
	Some(PathBuf::from(first))
}

/// JavaScript stub: record the argv, answer HTTP on `--web-port`, exit when
/// asked to stop. Self-terminating so no process outlives the test — on
/// Windows the launcher is a `cmd` shim, and killing that would leave the
/// grandchild running. The watchdog is the backstop for a probe that never
/// arrives.
const STUB_JS: &str = r#"
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf("--web-port") + 1]);
const server = http.createServer((req, res) => {
	if (req.url === "/__stop") {
		res.end("stopping");
		server.close(() => process.exit(0));
		return;
	}
	res.end("zetacode serve stub");
});
// The handshake IS the readiness signal: `argv.txt` is published only from the
// listen callback, and the tmp+rename keeps it from ever being read
// half-written. Publishing it before `listen()` raced the probe — under load
// the parent read the file and connected before the bind, saw ECONNREFUSED
// and failed with "stub did not answer for <spelling>".
server.listen(port, "127.0.0.1", () => {
	const tmp = path.join(__dirname, "argv.txt.tmp");
	fs.writeFileSync(tmp, argv.join("\n") + "\n");
	fs.renameSync(tmp, path.join(__dirname, "argv.txt"));
});
setTimeout(() => process.exit(0), 120000);
"#;

/// Write the stub launcher for this platform; returns the dir to hand over
/// as `ZETA_BIN_DIR`.
fn write_stub(dir: &Path, node: &Path) -> PathBuf {
	std::fs::write(dir.join("zetacode-stub.js"), STUB_JS).expect("write stub script");
	let node = node.to_string_lossy().replace('\\', "/");
	let launcher = if cfg!(windows) {
		let path = dir.join("zetacode.cmd");
		std::fs::write(&path, format!("@echo off\r\n\"{node}\" \"%~dp0zetacode-stub.js\" %*\r\n"))
			.expect("write cmd shim");
		path
	} else {
		let path = dir.join("zetacode");
		std::fs::write(
			&path,
			format!("#!/bin/sh\nexec \"{node}\" \"$(dirname \"$0\")/zetacode-stub.js\" \"$@\"\n"),
		)
		.expect("write sh shim");
		path
	};
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let mut perms = std::fs::metadata(&launcher)
			.expect("stat shim")
			.permissions();
		perms.set_mode(0o755);
		std::fs::set_permissions(&launcher, perms).expect("chmod shim");
	}
	#[cfg(not(unix))]
	let _ = &launcher;
	dir.to_path_buf()
}

/// PATH for the child: the stub dir first (tier-① is explicit, this is
/// belt-and-braces), plus only what a launcher shell needs — so a real
/// `zetacode` installed on the developer's machine can never be the process
/// under test.
fn child_path(stub_dir: &Path) -> String {
	let system = if cfg!(windows) {
		let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
		format!("{root}\\System32;{root}")
	} else {
		"/usr/bin:/bin".to_string()
	};
	format!("{}{}{system}", stub_dir.display(), if cfg!(windows) { ";" } else { ":" })
}

/// Poll until `probe` answers, or the ready timeout expires.
fn wait_for<T>(mut probe: impl FnMut() -> Option<T>) -> Option<T> {
	let deadline = Instant::now() + READY_TIMEOUT;
	while Instant::now() < deadline {
		if let Some(value) = probe() {
			return Some(value);
		}
		std::thread::sleep(Duration::from_millis(250));
	}
	None
}

/// Kill the child we spawned and wait it out, so a failure never leaves a
/// workbench behind.
fn reap(mut child: Child) {
	let _ = child.kill();
	let _ = child.wait();
}

fn spawn_workbench(stub_dir: &Path, args: &[String]) -> Child {
	Command::new(env!("CARGO_BIN_EXE_zeta"))
		.args(args)
		.env("ZETA_BIN_DIR", stub_dir)
		.env("PATH", child_path(stub_dir))
		.stdout(Stdio::null())
		.stderr(Stdio::null())
		.spawn()
		.expect("spawn the workbench binary")
}

#[test]
fn web_subcommand_runs_the_serve_machine_on_loopback() {
	let Some(node) = node_path() else {
		eprintln!("skipping: this test needs `node` for its stub launcher");
		return;
	};
	let temp = tempfile::tempdir().expect("temp dir");
	let stub_dir = write_stub(temp.path(), &node);
	let web_port = free_port();
	let stats_port = free_port();
	let gateway_port = free_port();
	let argv_file = stub_dir.join("argv.txt");

	let args: Vec<String> = vec![
		"--zeta-entry=workbench".into(),
		"web".into(),
		"--web-port".into(),
		web_port.to_string(),
		"--stats-port".into(),
		stats_port.to_string(),
		"--gateway-port".into(),
		gateway_port.to_string(),
	];
	let mut child = spawn_workbench(&stub_dir, &args);

	let ready = wait_for(|| {
		let argv = std::fs::read_to_string(&argv_file).ok()?;
		let status = http_status(web_port, "/")?;
		Some((argv, status))
	});

	let Some((argv, status)) = ready else {
		reap(child);
		panic!("`zetawork web` never brought a server up on 127.0.0.1:{web_port}");
	};

	// ③ the hand-off: the serve machine received the subcommand plus every
	// pass-through flag, unchanged.
	let got: Vec<&str> = argv
		.lines()
		.map(str::trim)
		.filter(|l| !l.is_empty())
		.collect();
	let expected: Vec<String> = vec![
		"serve".into(),
		"--web-port".into(),
		web_port.to_string(),
		"--stats-port".into(),
		stats_port.to_string(),
		"--gateway-port".into(),
		gateway_port.to_string(),
	];
	assert_eq!(
		got,
		expected.iter().map(String::as_str).collect::<Vec<_>>(),
		"`zetawork web` must exec `zetacode serve` with the flags untouched"
	);

	// ④ the launched process answers HTTP, not just claims to have started.
	assert!(status.starts_with("HTTP/1."), "no HTTP status line: {status:?}");
	assert!(status.contains(" 200 "), "expected a 200 from the serve machine, got {status:?}");

	// ⑤ stop the stub, then reap the workbench that launched it.
	assert!(http_status(web_port, "/__stop").is_some(), "the stub must accept its stop request");
	let exited = wait_for(|| child.try_wait().ok().flatten());
	reap(child);
	assert!(exited.is_some(), "the workbench must exit once its serve child stops");
}

#[test]
fn web_and_server_spellings_are_the_same_subcommand() {
	// Both spellings hand off to the coding CLI's serve machine — asserted at
	// the argv level, with the port probe covered by the test above.
	let Some(node) = node_path() else {
		eprintln!("skipping: this test needs `node` for its stub launcher");
		return;
	};
	let temp = tempfile::tempdir().expect("temp dir");
	let stub_dir = write_stub(temp.path(), &node);
	let argv_file = stub_dir.join("argv.txt");

	for spelling in ["web", "server"] {
		let web_port = free_port();
		let args: Vec<String> = vec![
			"--zeta-entry=workbench".into(),
			spelling.into(),
			"--web-port".into(),
			web_port.to_string(),
		];
		let child = spawn_workbench(&stub_dir, &args);
		// `argv.txt` is the stub's ready signal and it now lands only once the
		// port is bound, but the probe still polls: a single-shot request right
		// after the handshake raced the accept queue under load and failed with
		// "stub did not answer for …".
		let argv = wait_for(|| std::fs::read_to_string(&argv_file).ok());
		let stopped = wait_for(|| http_status(web_port, "/__stop"));
		assert!(stopped.is_some(), "stub did not answer for {spelling}");
		reap(child);
		let expected = format!("serve\n--web-port\n{web_port}");
		assert_eq!(
			argv.as_deref().map(str::trim),
			Some(expected.as_str()),
			"`zetawork {spelling}` must hand off to `serve`"
		);
		let _ = std::fs::remove_file(&argv_file);
	}
}
