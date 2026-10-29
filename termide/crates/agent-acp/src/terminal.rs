//! The terminals an ACP agent asks its client to create.
//!
//! `zetacode` uses these for its `bash` tool when the client advertises the
//! terminal capability. termide runs the command directly (the agent wraps a
//! shell line in the shell it wants), captures stdout and stderr in order of
//! arrival, and serves the poll/exit/kill contract ACP expects. A terminal is
//! a process, not a panel: its output reaches the agent's tool result, and
//! `release` ends it.
//!
//! The methods are served from the ACP reader thread, so `wait_for_exit`
//! waits on a thread of its own — a command may run for minutes, and the
//! writer must keep answering the agent meanwhile.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};

/// How much output a terminal keeps when the request names no limit.
const DEFAULT_OUTPUT_LIMIT: usize = 1_000_000;
/// The process exit's poll interval: `Child::try_wait` needs no wait handle
/// on any platform and lets `kill` take the same child lock in between.
const EXIT_POLL: Duration = Duration::from_millis(20);

/// A terminal exit, as ACP's `exitStatus`/`wait_for_exit` spell it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Exit {
    code: Option<i32>,
    signal: Option<String>,
}

impl Exit {
    fn json(&self) -> Value {
        json!({ "exitCode": self.code, "signal": self.signal })
    }
}

struct Output {
    bytes: Vec<u8>,
    truncated: bool,
}

struct Terminal {
    child: Arc<Mutex<Child>>,
    output: Mutex<Output>,
    exit: Arc<(Mutex<Option<Exit>>, Condvar)>,
    readers: Arc<(Mutex<usize>, Condvar)>,
    limit: usize,
}

impl Terminal {
    fn push(&self, bytes: &[u8]) {
        let mut output = self.output.lock().unwrap_or_else(PoisonError::into_inner);
        output.bytes.extend_from_slice(bytes);
        if output.bytes.len() > self.limit {
            let excess = output.bytes.len() - self.limit;
            output.bytes.drain(..excess);
            output.truncated = true;
        }
    }

    fn take_output(&self) -> (String, bool) {
        let mut output = self.output.lock().unwrap_or_else(PoisonError::into_inner);
        let text = String::from_utf8_lossy(&output.bytes).into_owned();
        output.bytes.clear();
        (text, output.truncated)
    }

    fn exit_now(&self) -> Option<Exit> {
        self.exit
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        // The map's last reference going away (the ACP connection ended)
        // must not leave the command running behind zetaide.
        let _ = self
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .kill();
    }
}

/// The open terminals of one ACP connection.
pub(crate) struct Terminals {
    next: AtomicU64,
    open: Mutex<HashMap<String, Arc<Terminal>>>,
}

impl Terminals {
    pub(crate) fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
            open: Mutex::new(HashMap::new()),
        }
    }

    /// `terminal/create`: start `command` and remember it under a fresh id.
    pub(crate) fn create(&self, cwd: &Path, params: &Value) -> Result<Value, String> {
        let command = params["command"]
            .as_str()
            .filter(|command| !command.is_empty())
            .ok_or("command missing")?;
        let args: Vec<String> = params["args"]
            .as_array()
            .map(|args| {
                args.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let working_dir = params["cwd"]
            .as_str()
            .map(|dir| resolve(cwd, dir))
            .unwrap_or_else(|| cwd.to_path_buf());
        let limit = params["outputByteLimit"]
            .as_u64()
            .unwrap_or(DEFAULT_OUTPUT_LIMIT as u64)
            .clamp(1, 64 * 1024 * 1024) as usize;

        let mut spawn = Command::new(command);
        spawn
            .args(&args)
            .current_dir(&working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(env) = params["env"].as_array() {
            for entry in env {
                if let (Some(name), Some(value)) = (entry["name"].as_str(), entry["value"].as_str())
                {
                    spawn.env(name, value);
                }
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // A server-side command must not flash a console in zetaide.
            spawn.creation_flags(0x0800_0000);
        }

        let mut child = spawn
            .spawn()
            .map_err(|error| format!("cannot start {command}: {error}"))?;
        let stdout = child.stdout.take().ok_or("the command has no stdout")?;
        let stderr = child.stderr.take().ok_or("the command has no stderr")?;
        let child = Arc::new(Mutex::new(child));
        let exit = Arc::new((Mutex::new(None), Condvar::new()));
        let readers = Arc::new((Mutex::new(2), Condvar::new()));
        let terminal = Arc::new(Terminal {
            child: Arc::clone(&child),
            output: Mutex::new(Output {
                bytes: Vec::new(),
                truncated: false,
            }),
            exit: Arc::clone(&exit),
            readers: Arc::clone(&readers),
            limit,
        });

        pump(stdout, Arc::clone(&terminal), Arc::clone(&readers));
        pump(stderr, Arc::clone(&terminal), Arc::clone(&readers));
        watch(child, exit);

        let id = format!("termide-{}", self.next.fetch_add(1, Ordering::Relaxed));
        self.open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), terminal);
        Ok(json!({ "terminalId": id }))
    }

    /// `terminal/output`: the output since the last read, and the exit once
    /// it has happened.
    pub(crate) fn output(&self, params: &Value) -> Result<Value, String> {
        let terminal = self.get(params)?;
        let (text, truncated) = terminal.take_output();
        let exit = terminal.exit_now();
        Ok(json!({
            "output": text,
            "truncated": truncated,
            "exitStatus": exit.as_ref().map(Exit::json),
        }))
    }

    /// `terminal/wait_for_exit`: block until the process ends.
    pub(crate) fn wait(&self, params: &Value) -> Result<Value, String> {
        let terminal = self.get(params)?;
        let (lock, changed) = &*terminal.exit;
        let mut exit = lock.lock().unwrap_or_else(PoisonError::into_inner);
        while exit.is_none() {
            exit = changed.wait(exit).unwrap_or_else(PoisonError::into_inner);
        }
        let outcome = exit
            .as_ref()
            .map(Exit::json)
            .unwrap_or_else(|| json!({ "exitCode": null, "signal": null }));
        drop(exit);
        // The pipes may still hold the command's last bytes after the
        // process ended; `wait_for_exit` returns only once both readers
        // have drained them, so a following `terminal/output` sees them.
        let (readers, drained) = &*terminal.readers;
        let mut left = readers.lock().unwrap_or_else(PoisonError::into_inner);
        while *left > 0 {
            left = drained.wait(left).unwrap_or_else(PoisonError::into_inner);
        }
        Ok(outcome)
    }

    /// `terminal/kill`: stop the process, keeping its output readable.
    pub(crate) fn kill(&self, params: &Value) -> Result<Value, String> {
        let terminal = self.get(params)?;
        let _ = terminal
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .kill();
        Ok(json!({}))
    }

    /// `terminal/release`: kill and forget it.
    pub(crate) fn release(&self, params: &Value) -> Result<Value, String> {
        let id = params["terminalId"].as_str().ok_or("terminalId missing")?;
        let terminal = self
            .open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(id)
            .ok_or_else(|| format!("unknown terminal {id}"))?;
        let _ = terminal
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .kill();
        Ok(json!({}))
    }

    fn get(&self, params: &Value) -> Result<Arc<Terminal>, String> {
        let id = params["terminalId"].as_str().ok_or("terminalId missing")?;
        self.open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
            .cloned()
            .ok_or_else(|| format!("unknown terminal {id}"))
    }
}

fn resolve(cwd: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

fn pump(
    mut stream: impl Read + Send + 'static,
    terminal: Arc<Terminal>,
    readers: Arc<(Mutex<usize>, Condvar)>,
) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => terminal.push(&buffer[..read]),
            }
        }
        let (left, drained) = &*readers;
        let mut left = left.lock().unwrap_or_else(PoisonError::into_inner);
        *left = left.saturating_sub(1);
        drained.notify_all();
    });
}

fn watch(child: Arc<Mutex<Child>>, exit: Arc<(Mutex<Option<Exit>>, Condvar)>) {
    std::thread::spawn(move || loop {
        let status = child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .try_wait();
        match status {
            Ok(Some(status)) => {
                let (lock, changed) = &*exit;
                *lock.lock().unwrap_or_else(PoisonError::into_inner) = Some(from_status(status));
                changed.notify_all();
                break;
            }
            Ok(None) => std::thread::sleep(EXIT_POLL),
            Err(error) => {
                let (lock, changed) = &*exit;
                *lock.lock().unwrap_or_else(PoisonError::into_inner) = Some(Exit {
                    code: None,
                    signal: Some(format!("wait failed: {error}")),
                });
                changed.notify_all();
                break;
            }
        }
    });
}

fn from_status(status: ExitStatus) -> Exit {
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.signal().map(|signal| format!("SIG{signal}"))
    };
    #[cfg(not(unix))]
    let signal = None;
    Exit {
        code: status.code(),
        signal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command() -> (&'static str, Vec<&'static str>) {
        #[cfg(unix)]
        {
            (
                "sh",
                vec!["-c", "printf 'hello'; printf 'oops' >&2; exit 7"],
            )
        }
        #[cfg(windows)]
        {
            ("cmd", vec!["/C", "echo hello & echo oops 1>&2 & exit /b 7"])
        }
    }

    #[test]
    fn a_command_runs_and_its_output_is_read_once() {
        let (program, args) = command();
        let terminals = Terminals::new();
        let created = terminals
            .create(
                &std::env::temp_dir(),
                &json!({ "command": program, "args": args }),
            )
            .unwrap();
        let id = created["terminalId"].as_str().unwrap();
        let exit = terminals.wait(&json!({ "terminalId": id })).unwrap();
        assert_eq!(exit["exitCode"], 7);
        let output = terminals.output(&json!({ "terminalId": id })).unwrap();
        assert!(output["output"].as_str().unwrap().contains("hello"));
        assert!(output["output"].as_str().unwrap().contains("oops"));
        assert_eq!(
            terminals.output(&json!({ "terminalId": id })).unwrap()["output"],
            ""
        );
        terminals.release(&json!({ "terminalId": id })).unwrap();
    }

    #[test]
    fn a_terminal_is_gone_after_release() {
        let (program, args) = command();
        let terminals = Terminals::new();
        let created = terminals
            .create(
                &std::env::temp_dir(),
                &json!({ "command": program, "args": args }),
            )
            .unwrap();
        let id = created["terminalId"].as_str().unwrap();
        terminals.release(&json!({ "terminalId": id })).unwrap();
        assert!(terminals.output(&json!({ "terminalId": id })).is_err());
    }
}
