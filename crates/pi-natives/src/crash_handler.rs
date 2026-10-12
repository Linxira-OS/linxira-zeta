//! Native crash diagnostics.
//!
//! Installs Rust-side panic and allocation-error hooks the first time the
//! native module loads, so any crash inside `pi-natives` writes an actionable
//! record (thread, payload, backtrace, process/system memory counters) to disk
//! and to stderr before the host process exits.
//!
//! Without these hooks, Bun receives only the bare
//! `memory allocation of N bytes failed` line and aborts with no stack —
//! see issue #2211 ("Windows crash: Rust allocator failure after tasklist.exe
//! popup"). The cdylib builds with `panic = "unwind"`, so a panic in vendored
//! uutils code unwinds to the shell boundary and is recovered as a failed
//! command, and a panic in a `task::blocking` worker is caught at the napi
//! boundary and surfaces as a rejected JS Promise; such recoverable panics are
//! logged to disk only, while fatal crashes (allocation failure, or panics
//! with no active recovery scope) still get the stderr dump + process exit.
//! Either way the record stays diagnosable.
//!
//! Notes:
//! - Backtraces are captured via [`Backtrace::force_capture`], so they work
//!   regardless of `RUST_BACKTRACE`.
//! - The crash log path mirrors the JS side (`packages/utils/src/dirs.ts`):
//!   `$XDG_STATE_HOME/zeta/logs/` on Linux / macOS when the user has migrated
//!   to XDG (i.e. that directory already exists and `ZETA_CODING_AGENT_DIR`
//!   isn't pointed somewhere custom), otherwise `<home>/<PI_CONFIG_DIR>/logs/`
//!   (defaulting to `~/.zeta/logs/`).
//! - Hook installation is idempotent across repeated module loads.

use std::{
	alloc::Layout,
	backtrace::Backtrace,
	cell::Cell,
	ffi::OsStr,
	fmt::Write as _,
	fs::{self, OpenOptions},
	io::Write as _,
	path::{Path, PathBuf},
	process,
	sync::{
		Once,
		atomic::{AtomicBool, Ordering},
	},
	thread,
	time::{SystemTime, UNIX_EPOCH},
};

/// Default directory name for Zeta's per-user state (overridable via
/// `PI_CONFIG_DIR`, matching `packages/utils/src/dirs.ts`).
const DEFAULT_CONFIG_DIR: &str = ".zeta";

/// App name used as the XDG-root subdirectory (`$XDG_STATE_HOME/zeta/`),
/// matching `APP_NAME` in `packages/utils/src/dirs.ts`.
#[cfg(any(target_os = "linux", target_os = "macos"))]
const APP_NAME: &str = "zeta";

static INSTALL: Once = Once::new();
static ALLOC_HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);

thread_local! {
	/// Active `task::blocking` panic recovery frames on this thread.
	///
	/// The panic hook runs before [`std::panic::catch_unwind`] returns. A
	/// borrow-free `Cell` lets the hook recognize panics that are already inside
	/// a known recovery boundary without touching potentially borrowed task
	/// state while the stack is unwinding.
	static BLOCKING_TASK_PANIC_SCOPE_DEPTH: Cell<usize> = const { Cell::new(0) };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PanicDisposition {
	/// No recovery boundary is active: persist the report, echo it to stderr,
	/// and chain to the default hook (which ends the process).
	Fatal,
	/// The panic will be caught and mapped to a failed command / rejected
	/// Promise: persist the report to the crash log for diagnosis, but keep
	/// stderr quiet and do not chain to the default hook.
	LoggedRecoverable,
}

/// Install the panic and allocation-error hooks. Idempotent.
pub fn install() {
	INSTALL.call_once(|| {
		let prev_panic = std::panic::take_hook();
		std::panic::set_hook(Box::new(move |info| match panic_disposition() {
			PanicDisposition::LoggedRecoverable => {
				let report = format_panic_report(info);
				persist(&report, CrashKind::Panic, false);
			},
			PanicDisposition::Fatal => {
				let report = format_panic_report(info);
				persist(&report, CrashKind::Panic, true);
				prev_panic(info);
			},
		}));

		std::alloc::set_alloc_error_hook(|layout| {
			// Print the canonical line before doing anything allocation-prone.
			// If this is genuine process-wide OOM, report formatting/path work may
			// recursively enter this hook; the secondary entry writes the same
			// stack-only fallback and aborts immediately.
			write_alloc_failure_line(std::io::stderr(), layout.size());
			// The memory block is written before the re-entry guard and before any
			// allocation-prone formatting, so a genuine OOM that recurs while the
			// report is assembled still leaves the numbers behind.
			write_memory_block(std::io::stderr());
			if ALLOC_HOOK_ACTIVE.swap(true, Ordering::AcqRel) {
				process::abort();
			}
			let report = format_alloc_report(layout);
			persist(&report, CrashKind::Alloc, true);
			process::abort();
		});
	});
}

/// Run `f` inside a `task::blocking` panic recovery boundary.
///
/// The global panic hook checks this thread-local scope before reporting a
/// panic. When a blocking worker closure panics, [`std::panic::catch_unwind`]
/// will turn it into a rejected JS Promise, so the hook downgrades the panic
/// to [`PanicDisposition::LoggedRecoverable`]: the report (location +
/// backtrace) is still persisted to the crash log, but nothing is echoed to
/// stderr and the default hook is not chained.
pub(crate) fn blocking_task_panic_scope<R>(f: impl FnOnce() -> R) -> R {
	struct Guard;

	impl Drop for Guard {
		fn drop(&mut self) {
			BLOCKING_TASK_PANIC_SCOPE_DEPTH.with(|d| d.set(d.get().saturating_sub(1)));
		}
	}

	BLOCKING_TASK_PANIC_SCOPE_DEPTH.with(|d| d.set(d.get() + 1));
	let _guard = Guard;
	f()
}

fn blocking_task_panic_scope_active() -> bool {
	BLOCKING_TASK_PANIC_SCOPE_DEPTH.with(|d| d.get() > 0)
}

fn panic_disposition() -> PanicDisposition {
	if blocking_task_panic_scope_active() || pi_shell::panic_scope_active() {
		PanicDisposition::LoggedRecoverable
	} else {
		PanicDisposition::Fatal
	}
}

#[derive(Clone, Copy)]
enum CrashKind {
	Panic,
	Alloc,
}

impl CrashKind {
	const fn as_str(self) -> &'static str {
		match self {
			Self::Panic => "panic",
			Self::Alloc => "alloc",
		}
	}
}

fn format_panic_report(info: &std::panic::PanicHookInfo<'_>) -> String {
	let bt = Backtrace::force_capture();
	let location = info.location().map_or_else(
		|| String::from("<unknown>"),
		|l| format!("{}:{}:{}", l.file(), l.line(), l.column()),
	);
	let mut out = report_header(CrashKind::Panic);
	let _ = writeln!(out, "location: {location}");
	let _ = writeln!(out, "message:  {}", panic_payload(info.payload()));
	let _ = writeln!(out, "backtrace:\n{bt}");
	out
}

fn format_alloc_report(layout: Layout) -> String {
	// Capturing a backtrace allocates. If the global allocator is in a state
	// where small allocations keep failing this will recurse into the hook —
	// `Backtrace::force_capture` swallows the secondary failure internally and
	// returns an empty backtrace, which is still strictly more useful than the
	// nothing the default handler prints.
	let bt = Backtrace::force_capture();
	let mut out = report_header(CrashKind::Alloc);
	let _ = writeln!(out, "size:      {} bytes", layout.size());
	let _ = writeln!(out, "alignment: {} bytes", layout.align());
	let _ = writeln!(out, "backtrace:\n{bt}");
	out
}

fn report_header(kind: CrashKind) -> String {
	let thread_name = thread::current().name().unwrap_or("<unnamed>").to_owned();
	let now_ms = unix_millis();
	let mut header = format!(
		"pi-natives {kind} crash\npid:       {pid}\nthread:    {thread_name}\ntimestamp: {now_ms} \
		 (unix ms)\n",
		kind = kind.as_str(),
		pid = process::id(),
	);
	// Both reports carry the block. The fatal allocation path also writes it to
	// stderr on its own (see `install`) because the report itself is assembled
	// with `format!` and may not survive a real OOM — in that one path the
	// counters can therefore appear twice on stderr, while the file copy always
	// rides the report.
	// The block is rendered into a stack buffer and copied in: `String`
	// implements `fmt::Write`, not `io::Write`. The allocation-free copy is the
	// one the allocation-error hook writes to stderr directly.
	let mut mem = [0u8; mem_stats::BUFFER_LEN];
	let mem = mem_stats::take().render(&mut mem);
	header.push_str(&String::from_utf8_lossy(mem));
	header
}
fn write_alloc_failure_line(mut out: impl std::io::Write, size: usize) {
	let _ = out.write_all(b"memory allocation of ");
	let mut digits = [0u8; usize::MAX.ilog10() as usize + 1];
	let mut pos = digits.len();
	let mut value = size;
	if value == 0 {
		pos -= 1;
		digits[pos] = b'0';
	} else {
		while value > 0 {
			pos -= 1;
			digits[pos] = b'0' + (value % 10) as u8;
			value /= 10;
		}
	}
	let _ = out.write_all(&digits[pos..]);
	let _ = out.write_all(b" bytes failed\n");
}

/// Append the process/system memory block to `out`.
///
/// Allocation-free by construction: the snapshot is read through syscalls and
/// rendered with integer arithmetic into a stack buffer, so the
/// allocation-error hook can call this while the allocator has nothing left to
/// hand out.
fn write_memory_block(mut out: impl std::io::Write) {
	let mut buf = [0u8; mem_stats::BUFFER_LEN];
	let bytes = mem_stats::take().render(&mut buf);
	if !bytes.is_empty() {
		let _ = out.write_all(bytes);
	}
}

/// Process and system memory counters embedded in crash reports.
///
/// The allocation-error hook runs exactly when the allocator is exhausted, so
/// nothing here may allocate: both platforms fill a struct of plain integers
/// through syscalls, and [`Snapshot::render`] formats into a caller-provided
/// stack buffer.
///
/// Windows numbers come from `K32GetProcessMemoryInfo` and
/// `GlobalMemoryStatusEx`; both are exported by `kernel32`, so no new
/// `windows-sys` feature (and therefore no `MODULE.bazel.lock` churn) is
/// involved. Linux numbers come from `/proc` through `libc`. Other platforms
/// report nothing — macOS is outside the release surface, and an empty block
/// beats numbers no one can trust.
mod mem_stats {
	use std::io::Write as _;

	/// Stack buffer the snapshot is rendered into; the block never exceeds it.
	pub(super) const BUFFER_LEN: usize = 512;

	/// Integer-only memory counters. Every field is optional because no single
	/// platform reports all of them.
	#[derive(Clone, Copy, Default)]
	pub(super) struct Snapshot {
		/// Resident set size of this process.
		pub(super) rss_bytes:                     Option<u64>,
		/// Peak resident set size of this process.
		pub(super) peak_rss_bytes:                Option<u64>,
		/// Committed private bytes of this process.
		pub(super) commit_bytes:                  Option<u64>,
		/// Physical memory available to the system.
		pub(super) system_available_bytes:        Option<u64>,
		/// Physical memory installed in the system.
		pub(super) system_total_bytes:            Option<u64>,
		/// Commit charge the system can still hand out.
		pub(super) system_commit_available_bytes: Option<u64>,
		/// System commit limit.
		pub(super) system_commit_limit_bytes:     Option<u64>,
	}

	impl Snapshot {
		/// Render the block into `buf`, returning the bytes to write. Empty when
		/// no counter was readable or `buf` cannot hold the first line.
		pub(super) fn render<'b>(&self, buf: &'b mut [u8]) -> &'b [u8] {
			let mut out = SliceWriter { buf: &mut *buf, len: 0 };
			if self.rss_bytes.is_none()
				&& self.peak_rss_bytes.is_none()
				&& self.system_total_bytes.is_none()
			{
				return &[];
			}
			if self.rss_bytes.is_some() || self.peak_rss_bytes.is_some() || self.commit_bytes.is_some()
			{
				let _ = write!(&mut out, "memory:    ");
				let mut first = true;
				write_optional_mib(&mut out, &mut first, "rss", self.rss_bytes);
				write_optional_mib(&mut out, &mut first, "peak", self.peak_rss_bytes);
				write_optional_mib(&mut out, &mut first, "commit", self.commit_bytes);
				let _ = writeln!(&mut out);
			}
			if self.system_total_bytes.is_some()
				|| self.system_available_bytes.is_some()
				|| self.system_commit_limit_bytes.is_some()
			{
				let _ = write!(&mut out, "system:    ");
				let mut first = true;
				write_optional_mib(&mut out, &mut first, "available", self.system_available_bytes);
				write_optional_mib(&mut out, &mut first, "total", self.system_total_bytes);
				write_optional_mib(
					&mut out,
					&mut first,
					"commit available",
					self.system_commit_available_bytes,
				);
				write_optional_mib(
					&mut out,
					&mut first,
					"commit limit",
					self.system_commit_limit_bytes,
				);
				let _ = writeln!(&mut out);
			}
			&out.buf[..out.len]
		}
	}

	/// `label 123.4 MiB`, comma-separated after the first entry of a line.
	/// Integer arithmetic on tenths of a MiB keeps this heap-free.
	fn write_optional_mib(
		out: &mut SliceWriter<'_>,
		first: &mut bool,
		label: &str,
		value: Option<u64>,
	) {
		let Some(value) = value else {
			return;
		};
		let tenths = (u128::from(value) * 10 + 524_288) / 1_048_576;
		let separator = if *first { "" } else { ", " };
		*first = false;
		let _ = write!(out, "{separator}{label} {}.{} MiB", tenths / 10, tenths % 10);
	}

	/// `Write` sink over a caller-owned slice; short writes truncate the block
	/// instead of growing it.
	struct SliceWriter<'a> {
		buf: &'a mut [u8],
		len: usize,
	}

	impl std::io::Write for SliceWriter<'_> {
		fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
			let room = self.buf.len().saturating_sub(self.len);
			let take = room.min(bytes.len());
			self.buf[self.len..self.len + take].copy_from_slice(&bytes[..take]);
			self.len += take;
			Ok(take)
		}

		fn flush(&mut self) -> std::io::Result<()> {
			Ok(())
		}
	}

	#[cfg(target_os = "linux")]
	pub(super) fn take() -> Snapshot {
		// 4 KiB covers `/proc/self/statm` (a few dozen bytes) and `/proc/meminfo`
		// (~1.5 KiB) with room to spare.
		let mut buf = [0u8; 4096];
		let mut snap = Snapshot::default();
		if let Some(len) = read_proc(c"/proc/self/statm", &mut buf) {
			let page_size = page_size_bytes();
			if page_size > 0 {
				// statm: size resident shared text lib data dt, in pages.
				if let Some(pages) = field_as_u64(&buf[..len], b' ', 1) {
					snap.rss_bytes = Some(pages.saturating_mul(page_size));
				}
			}
		}
		if let Some(len) = read_proc(c"/proc/meminfo", &mut buf) {
			let info = &buf[..len];
			snap.system_total_bytes = meminfo_field(info, b"MemTotal:");
			snap.system_available_bytes = meminfo_field(info, b"MemAvailable:");
		}
		snap
	}

	#[cfg(target_os = "linux")]
	fn page_size_bytes() -> u64 {
		let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
		if size > 0 { size as u64 } else { 0 }
	}

	/// Read up to `buf.len()` bytes of a NUL-terminated path with raw syscalls,
	/// returning the byte count actually read.
	#[cfg(target_os = "linux")]
	fn read_proc(path: &core::ffi::CStr, buf: &mut [u8]) -> Option<usize> {
		let fd = unsafe {
			libc::open(path.as_ptr().cast::<libc::c_char>(), libc::O_RDONLY | libc::O_CLOEXEC)
		};
		if fd < 0 {
			return None;
		}
		let mut total = 0usize;
		while total < buf.len() {
			let read = unsafe {
				libc::read(fd, buf[total..].as_mut_ptr().cast::<libc::c_void>(), buf.len() - total)
			};
			if read <= 0 {
				break;
			}
			total += usize::try_from(read).unwrap_or(0);
		}
		unsafe { libc::close(fd) };
		Some(total)
	}

	/// Whitespace-separated field `index` of `text`, parsed as `u64`.
	#[cfg(target_os = "linux")]
	fn field_as_u64(text: &[u8], separator: u8, index: usize) -> Option<u64> {
		text
			.split(|byte| *byte == separator)
			.filter(|field| !field.is_empty())
			.nth(index)
			.and_then(parse_u64)
	}

	/// Leading decimal digits of `digits`, or `None` when there are none.
	#[cfg(target_os = "linux")]
	fn parse_u64(digits: &[u8]) -> Option<u64> {
		let mut value = 0u64;
		let mut seen = false;
		for byte in digits {
			if !byte.is_ascii_digit() {
				break;
			}
			seen = true;
			value = value.checked_mul(10)?.checked_add(u64::from(byte - b'0'))?;
		}
		seen.then_some(value)
	}

	/// `MemTotal:`-style `/proc/meminfo` line, converted from KiB to bytes.
	#[cfg(target_os = "linux")]
	fn meminfo_field(info: &[u8], prefix: &[u8]) -> Option<u64> {
		for line in info.split(|byte| *byte == b'\n') {
			let Some(rest) = line.strip_prefix(prefix) else {
				continue;
			};
			let start = rest.iter().position(u8::is_ascii_digit)?;
			return parse_u64(&rest[start..]).map(|kib| kib.saturating_mul(1024));
		}
		None
	}

	#[cfg(target_os = "windows")]
	pub(super) fn take() -> Snapshot {
		// Hand-rolled because the workspace's `windows-sys` feature list does not
		// include `Win32_System_ProcessStatus`/`Win32_System_SystemInformation`,
		// and adding features would churn `MODULE.bazel.lock` for a crash report.
		// ABI mirrors MSDN; the layouts are `#[repr(C)]` and stable.
		#[repr(C)]
		#[allow(dead_code, reason = "ABI layout mirror: fields are read by the OS call, not by us")]
		struct ProcessMemoryCounters {
			cb: u32,
			page_fault_count: u32,
			peak_working_set_size: usize,
			working_set_size: usize,
			quota_peak_paged_pool_usage: usize,
			quota_paged_pool_usage: usize,
			quota_peak_non_paged_pool_usage: usize,
			quota_non_paged_pool_usage: usize,
			pagefile_usage: usize,
			peak_pagefile_usage: usize,
		}
		#[repr(C)]
		#[allow(dead_code, reason = "ABI layout mirror: fields are read by the OS call, not by us")]
		struct MemoryStatusEx {
			length:                 u32,
			memory_load:            u32,
			total_phys:             u64,
			avail_phys:             u64,
			total_page_file:        u64,
			avail_page_file:        u64,
			total_virtual:          u64,
			avail_virtual:          u64,
			avail_extended_virtual: u64,
		}
		#[link(name = "kernel32")]
		unsafe extern "system" {
			fn GetCurrentProcess() -> *mut core::ffi::c_void;
			fn K32GetProcessMemoryInfo(
				process: *mut core::ffi::c_void,
				counters: *mut ProcessMemoryCounters,
				cb: u32,
			) -> i32;
			fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
		}

		let mut snap = Snapshot::default();
		unsafe {
			let mut counters: ProcessMemoryCounters = core::mem::zeroed();
			counters.cb = core::mem::size_of::<ProcessMemoryCounters>() as u32;
			if K32GetProcessMemoryInfo(GetCurrentProcess(), &raw mut counters, counters.cb) != 0 {
				snap.rss_bytes = Some(counters.working_set_size as u64);
				snap.peak_rss_bytes = Some(counters.peak_working_set_size as u64);
				snap.commit_bytes = Some(counters.pagefile_usage as u64);
			}
			let mut status: MemoryStatusEx = core::mem::zeroed();
			status.length = core::mem::size_of::<MemoryStatusEx>() as u32;
			if GlobalMemoryStatusEx(&raw mut status) != 0 {
				snap.system_total_bytes = Some(status.total_phys);
				snap.system_available_bytes = Some(status.avail_phys);
				snap.system_commit_limit_bytes = Some(status.total_page_file);
				snap.system_commit_available_bytes = Some(status.avail_page_file);
			}
		}
		snap
	}

	#[cfg(not(any(target_os = "linux", target_os = "windows")))]
	pub(super) fn take() -> Snapshot {
		Snapshot::default()
	}
}

/// Extract a printable message from a panic payload captured by
/// [`std::panic::catch_unwind`] or handed to the panic hook. Handles the two
/// shapes `panic!` produces — `&'static str` (literal) and `String`
/// (formatted) — and degrades to a sentinel for arbitrary
/// [`panic_any`](std::panic::panic_any) payloads.
pub(crate) fn panic_payload(payload: &(dyn std::any::Any + Send)) -> String {
	if let Some(s) = payload.downcast_ref::<&'static str>() {
		(*s).to_owned()
	} else if let Some(s) = payload.downcast_ref::<String>() {
		s.clone()
	} else {
		String::from("<non-string panic payload>")
	}
}

fn persist(report: &str, kind: CrashKind, echo_stderr: bool) {
	// Echo to stderr so the user sees something even when the file write fails
	// (read-only home, missing $HOME, …). Suppressed for recoverable panics
	// (uutils shell boundary, `task::blocking` workers), which surface as a
	// failed command / rejected Promise instead of a crash.
	if echo_stderr {
		let _ = writeln!(std::io::stderr(), "{report}");
	}

	let Some(path) = crash_log_path(kind) else {
		return;
	};
	if let Some(parent) = path.parent() {
		let _ = fs::create_dir_all(parent);
	}
	if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
		let _ = f.write_all(report.as_bytes());
		let _ = f.flush();
		let _ = f.sync_data();
		if echo_stderr {
			let _ =
				writeln!(std::io::stderr(), "pi-natives crash report written to {}", path.display());
		}
	}
}

fn crash_log_path(kind: CrashKind) -> Option<PathBuf> {
	let dir = logs_dir()?;
	Some(build_crash_log_path(&dir, kind, process::id(), unix_millis()))
}

fn build_crash_log_path(dir: &Path, kind: CrashKind, pid: u32, now_ms: u128) -> PathBuf {
	dir.join(format!("native-{}-{pid}-{now_ms}.log", kind.as_str()))
}

fn logs_dir() -> Option<PathBuf> {
	let home = home_dir()?;
	let config_override = std::env::var_os("PI_CONFIG_DIR");
	let xdg_logs = xdg_state_logs_from_env(&home, config_override.as_deref());
	Some(resolve_logs_dir(&home, config_override.as_deref(), xdg_logs))
}

fn resolve_logs_dir(
	home: &Path,
	config_dir_override: Option<&OsStr>,
	xdg_state_logs: Option<PathBuf>,
) -> PathBuf {
	// XDG takes precedence so users who migrated to `$XDG_STATE_HOME/zeta/logs/`
	// see native crash reports in the same directory the JS logger rotates.
	if let Some(p) = xdg_state_logs {
		return p;
	}
	let config_dir = config_dir_override
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| OsStr::new(DEFAULT_CONFIG_DIR));
	let base = config_root_dir(home, config_dir);
	base.join("logs")
}

/// Compute the XDG-state logs dir if the runtime environment matches the
/// JS-side eligibility rules in `packages/utils/src/dirs.ts`: linux/macos,
/// `$XDG_STATE_HOME` set, `$XDG_STATE_HOME/zeta` exists on disk, and
/// `ZETA_CODING_AGENT_DIR` is unset or pointing at the default agent dir.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn xdg_state_logs_from_env(home: &Path, config_dir_override: Option<&OsStr>) -> Option<PathBuf> {
	let default_agent_dir = default_agent_dir(home, config_dir_override);
	let agent_override = std::env::var_os("ZETA_CODING_AGENT_DIR");
	let xdg_state_home = std::env::var_os("XDG_STATE_HOME");
	xdg_state_logs(
		xdg_state_home.as_deref(),
		agent_override.as_deref(),
		&default_agent_dir,
		Path::exists,
	)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[allow(clippy::missing_const_for_fn, reason = "windows/non-xdg platforms keep the signature")]
fn xdg_state_logs_from_env(_home: &Path, _config_dir_override: Option<&OsStr>) -> Option<PathBuf> {
	None
}

/// Pure XDG-eligibility computation extracted for unit testing — no env
/// reads, no fs reads. `zeta_dir_exists` decides whether the candidate
/// `<xdg_state_home>/zeta` actually lives on disk.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn xdg_state_logs(
	xdg_state_home: Option<&OsStr>,
	agent_dir_override: Option<&OsStr>,
	default_agent_dir: &Path,
	zeta_dir_exists: impl FnOnce(&Path) -> bool,
) -> Option<PathBuf> {
	if let Some(ov) = agent_dir_override.filter(|s| !s.is_empty()) {
		// `path.resolve(value)` on the JS side: make absolute against cwd
		// without touching the filesystem. Anything that diverges from the
		// default agent dir disables XDG, matching `isDefault === false`.
		let resolved = std::path::absolute(Path::new(ov)).ok()?;
		if resolved != default_agent_dir {
			return None;
		}
	}
	let xdg = xdg_state_home.filter(|s| !s.is_empty())?;
	let zeta_dir = Path::new(xdg).join(APP_NAME);
	if !zeta_dir_exists(&zeta_dir) {
		return None;
	}
	Some(zeta_dir.join("logs"))
}
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn default_agent_dir(home: &Path, config_dir_override: Option<&OsStr>) -> PathBuf {
	let config_dir = config_dir_override
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| OsStr::new(DEFAULT_CONFIG_DIR));
	let base = config_root_dir(home, config_dir);
	base.join("agent")
}

fn config_root_dir(home: &Path, config_dir: &OsStr) -> PathBuf {
	let mut base = PathBuf::from(home);
	for component in Path::new(config_dir).components() {
		match component {
			std::path::Component::Prefix(_) | std::path::Component::RootDir => {},
			std::path::Component::CurDir => {},
			std::path::Component::ParentDir => {
				base.pop();
			},
			std::path::Component::Normal(part) => base.push(part),
		}
	}
	base
}

fn home_dir() -> Option<PathBuf> {
	#[cfg(unix)]
	{
		std::env::var_os("HOME").map(PathBuf::from)
	}
	#[cfg(windows)]
	{
		if let Some(profile) = std::env::var_os("USERPROFILE") {
			return Some(PathBuf::from(profile));
		}
		let drive = std::env::var_os("HOMEDRIVE")?;
		let path = std::env::var_os("HOMEPATH")?;
		let mut combined = drive;
		combined.push(path);
		Some(PathBuf::from(combined))
	}
}

fn unix_millis() -> u128 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map_or(0, |d| d.as_millis())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn blocking_task_panic_scope_downgrades_to_logged_recoverable() {
		assert_eq!(panic_disposition(), PanicDisposition::Fatal);
		blocking_task_panic_scope(|| {
			assert_eq!(panic_disposition(), PanicDisposition::LoggedRecoverable);
		});
		assert_eq!(panic_disposition(), PanicDisposition::Fatal);
	}

	#[test]
	fn blocking_task_panic_scope_restores_after_unwind() {
		// Silence the process-global hook for the injected panic (and serialize
		// the swap with every other hook-mutating test — see `crate::testing`).
		let _silence = crate::testing::SilenceHook::new();
		let unwound = std::panic::catch_unwind(|| blocking_task_panic_scope(|| panic!("boom")));

		assert!(unwound.is_err(), "panic propagated to catch_unwind");
		assert_eq!(panic_disposition(), PanicDisposition::Fatal);
	}

	#[test]
	fn alloc_report_contains_size_alignment_and_backtrace() {
		let layout = Layout::from_size_align(7714, 8).unwrap();
		let report = format_alloc_report(layout);
		assert!(report.contains("pi-natives alloc crash"), "report missing header: {report}");
		assert!(report.contains("size:      7714 bytes"), "report missing size: {report}");
		assert!(report.contains("alignment: 8 bytes"), "report missing alignment: {report}");
		assert!(report.contains("backtrace:"), "report missing backtrace section: {report}");
		assert!(
			report.contains(&format!("pid:       {}", process::id())),
			"report missing pid: {report}"
		);
		assert!(report.contains("thread:"), "report missing thread: {report}");
	}

	#[cfg(any(target_os = "linux", target_os = "windows"))]
	#[test]
	fn alloc_report_carries_memory_counters() {
		let layout = Layout::from_size_align(1, 8).unwrap();
		let report = format_alloc_report(layout);
		assert!(report.contains("memory:"), "report missing memory block: {report}");
	}

	#[test]
	fn memory_block_renders_known_values_without_allocating() {
		let snap = mem_stats::Snapshot {
			rss_bytes: Some(1024 * 1_048_576),
			peak_rss_bytes: Some(2048 * 1_048_576),
			commit_bytes: Some(512 * 1_048_576),
			system_available_bytes: Some(4096 * 1_048_576),
			system_total_bytes: Some(32768 * 1_048_576),
			..mem_stats::Snapshot::default()
		};
		let mut buf = [0u8; mem_stats::BUFFER_LEN];
		let text = String::from_utf8_lossy(snap.render(&mut buf)).into_owned();
		assert_eq!(
			text,
			"memory:    rss 1024.0 MiB, peak 2048.0 MiB, commit 512.0 MiB\nsystem:    available \
			 4096.0 MiB, total 32768.0 MiB\n"
		);
	}

	#[test]
	fn memory_block_truncates_into_a_small_buffer() {
		let snap = mem_stats::Snapshot {
			rss_bytes: Some(1024 * 1_048_576),
			..mem_stats::Snapshot::default()
		};
		let mut tiny = [0u8; 12];
		let rendered = snap.render(&mut tiny);
		assert_eq!(rendered.len(), 12, "short buffer must truncate, not grow");
		assert_eq!(rendered, b"memory:    ");
	}

	#[test]
	fn memory_block_is_empty_when_nothing_is_readable() {
		let mut buf = [0u8; mem_stats::BUFFER_LEN];
		assert!(mem_stats::Snapshot::default().render(&mut buf).is_empty());
	}

	#[cfg(target_os = "linux")]
	#[test]
	fn snapshot_reads_process_and_system_memory() {
		let snap = mem_stats::take();
		let rss = snap.rss_bytes.expect("rss from /proc/self/statm");
		let total = snap
			.system_total_bytes
			.expect("MemTotal from /proc/meminfo");
		assert!(rss > 0, "rss must be positive, got {rss}");
		assert!(total > 0, "system total must be positive, got {total}");
		assert!(rss <= total, "rss {rss} cannot exceed installed memory {total}");
	}

	#[test]
	fn alloc_failure_line_matches_rust_default_text_without_heap_formatting() {
		let mut buf = Vec::new();
		write_alloc_failure_line(&mut buf, 7714);
		assert_eq!(buf, b"memory allocation of 7714 bytes failed\n");
		buf.clear();
		write_alloc_failure_line(&mut buf, usize::MAX);
		assert_eq!(buf, format!("memory allocation of {} bytes failed\n", usize::MAX).as_bytes());
	}

	#[test]
	fn panic_payload_handles_str_string_and_other() {
		let static_str: Box<dyn std::any::Any + Send> = Box::new("static panic");
		assert_eq!(panic_payload(&*static_str), "static panic");

		let owned: Box<dyn std::any::Any + Send> = Box::new(String::from("owned panic"));
		assert_eq!(panic_payload(&*owned), "owned panic");

		let other: Box<dyn std::any::Any + Send> = Box::new(42u32);
		assert_eq!(panic_payload(&*other), "<non-string panic payload>");
	}

	#[test]
	fn resolve_logs_dir_defaults_under_dot_omp() {
		let dir = resolve_logs_dir(Path::new("/tmp/pi-natives-test-home"), None, None);
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/.zeta/logs"));
	}

	#[test]
	fn resolve_logs_dir_honors_relative_pi_config_dir() {
		let dir = resolve_logs_dir(
			Path::new("/tmp/pi-natives-test-home"),
			Some(OsStr::new(".zeta-dev")),
			None,
		);
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/.zeta-dev/logs"));
	}

	#[test]
	fn resolve_logs_dir_reroots_absolute_pi_config_dir_under_home() {
		// JS resolves the config root via `path.join(os.homedir(),
		// getConfigDirName())`, which never honors an absolute PI_CONFIG_DIR — it
		// is always re-rooted under `$HOME` (and `..` components are normalized
		// away).
		let dir = resolve_logs_dir(
			Path::new("/tmp/pi-natives-test-home"),
			Some(OsStr::new("/var/tmp/pi-natives-state")),
			None,
		);
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/var/tmp/pi-natives-state/logs"));
	}

	#[test]
	fn resolve_logs_dir_normalizes_parent_components_like_path_join() {
		let dir = resolve_logs_dir(
			Path::new("/tmp/pi-natives-test-home"),
			Some(OsStr::new("nested/../.zeta-dev")),
			None,
		);
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/.zeta-dev/logs"));
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn xdg_state_logs_ignores_empty_agent_dir_override() {
		// An empty ZETA_CODING_AGENT_DIR is "unset", not a divergent override; it
		// must not disable XDG resolution.
		let dir = xdg_state_logs(
			Some(OsStr::new("/xdg/state")),
			Some(OsStr::new("")),
			Path::new("/tmp/pi-natives-test-home/.zeta/agent"),
			|_p| true,
		);
		assert_eq!(dir, Some(PathBuf::from("/xdg/state/zeta/logs")));
	}

	#[test]
	fn resolve_logs_dir_ignores_empty_pi_config_dir() {
		let dir =
			resolve_logs_dir(Path::new("/tmp/pi-natives-test-home"), Some(OsStr::new("")), None);
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/.zeta/logs"));
	}

	#[test]
	fn resolve_logs_dir_prefers_xdg_when_provided() {
		let dir = resolve_logs_dir(
			Path::new("/tmp/pi-natives-test-home"),
			None,
			Some(PathBuf::from("/xdg/state/zeta/logs")),
		);
		assert_eq!(dir, PathBuf::from("/xdg/state/zeta/logs"));
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn xdg_state_logs_resolves_when_dir_exists_and_no_agent_override() {
		let dir = xdg_state_logs(
			Some(OsStr::new("/xdg/state")),
			None,
			Path::new("/tmp/pi-natives-test-home/.zeta/agent"),
			|_p| true,
		);
		assert_eq!(dir, Some(PathBuf::from("/xdg/state/zeta/logs")));
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn xdg_state_logs_skipped_when_omp_dir_missing() {
		let dir = xdg_state_logs(
			Some(OsStr::new("/xdg/state")),
			None,
			Path::new("/tmp/pi-natives-test-home/.zeta/agent"),
			|_p| false,
		);
		assert_eq!(dir, None);
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn xdg_state_logs_skipped_when_xdg_state_home_unset_or_empty() {
		let default_agent = Path::new("/tmp/pi-natives-test-home/.zeta/agent");
		assert_eq!(xdg_state_logs(None, None, default_agent, |_p| true), None);
		assert_eq!(xdg_state_logs(Some(OsStr::new("")), None, default_agent, |_p| true), None);
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn xdg_state_logs_skipped_when_agent_dir_overridden() {
		// `ZETA_CODING_AGENT_DIR` pointing elsewhere mirrors the JS `isDefault
		// === false` branch in `packages/utils/src/dirs.ts` and must
		// disable XDG.
		let dir = xdg_state_logs(
			Some(OsStr::new("/xdg/state")),
			Some(OsStr::new("/some/custom/agent")),
			Path::new("/tmp/pi-natives-test-home/.zeta/agent"),
			|_p| true,
		);
		assert_eq!(dir, None);
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn xdg_state_logs_honored_when_agent_override_matches_default() {
		let default_agent = std::path::absolute(Path::new("./.zeta/agent")).unwrap();
		let dir = xdg_state_logs(
			Some(OsStr::new("/xdg/state")),
			Some(OsStr::new("./.zeta/agent")),
			&default_agent,
			|_p| true,
		);
		assert_eq!(dir, Some(PathBuf::from("/xdg/state/zeta/logs")));
	}

	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn default_agent_dir_uses_dot_omp_by_default() {
		let dir = default_agent_dir(Path::new("/tmp/pi-natives-test-home"), None);
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/.zeta/agent"));
	}
	#[cfg(any(target_os = "linux", target_os = "macos"))]
	#[test]
	fn default_agent_dir_respects_pi_config_dir() {
		let dir =
			default_agent_dir(Path::new("/tmp/pi-natives-test-home"), Some(OsStr::new(".zeta-dev")));
		assert_eq!(dir, PathBuf::from("/tmp/pi-natives-test-home/.zeta-dev/agent"));
	}

	#[test]
	fn build_crash_log_path_tags_kind_and_pid() {
		let dir = Path::new("/tmp/pi-natives-test-home/.zeta/logs");
		let panic_log = build_crash_log_path(dir, CrashKind::Panic, 4242, 1_700_000_000_000);
		assert_eq!(
			panic_log,
			PathBuf::from("/tmp/pi-natives-test-home/.zeta/logs/native-panic-4242-1700000000000.log")
		);
		let alloc_log = build_crash_log_path(dir, CrashKind::Alloc, 99, 1);
		assert_eq!(
			alloc_log,
			PathBuf::from("/tmp/pi-natives-test-home/.zeta/logs/native-alloc-99-1.log")
		);
	}
}
