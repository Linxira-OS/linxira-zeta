//! Busy-pane detection: a terminal pane is busy when its shell has live
//! child processes (zetacode, vim, git, …) — closing it would kill work,
//! so the workspace asks before tearing it down. An idle shell (no
//! children) closes without friction.

use sysinfo::{Pid, ProcessesToUpdate, System};

/// Pure decision over a process snapshot: busy iff some live process
/// parents to the shell's pid. A shell without a known pid counts idle —
/// the probe must never trap the user.
fn busy_from_parents(parent_pids: &[Option<u32>], shell_pid: Option<u32>) -> bool {
	match shell_pid {
		None => false,
		Some(pid) => parent_pids.iter().any(|parent| *parent == Some(pid)),
	}
}

/// Whether the shell `pid` has live child processes right now. One
/// enumeration per invocation, only at close time. Any failure — the PTY
/// died mid-probe, the OS refuses the snapshot — counts idle: better to
/// let a close through than to wedge the workbench.
fn shell_has_live_children(pid: u32) -> bool {
	let mut system = System::new();
	system.refresh_processes(ProcessesToUpdate::All);
	let parents: Vec<Option<u32>> = system
		.processes()
		.values()
		.map(|process| process.parent().map(Pid::as_u32))
		.collect();
	busy_from_parents(&parents, Some(pid))
}

/// The busy verdict for one terminal pane: busy iff its shell (when the
/// pid is known) has live children.
pub fn pane_is_busy(shell_pid: Option<u32>) -> bool {
	match shell_pid {
		None => false,
		Some(pid) => shell_has_live_children(pid),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn busy_only_when_a_child_parents_to_the_shell() {
		assert!(busy_from_parents(&[Some(1), Some(42), Some(7)], Some(42)));
		assert!(!busy_from_parents(&[Some(1), Some(7)], Some(42)), "no child of 42");
		let orphans: [Option<u32>; 1] = [None];
		assert!(!busy_from_parents(&orphans, Some(42)), "orphaned children don't count");
	}

	#[test]
	fn unknown_shell_pid_is_idle() {
		assert!(!busy_from_parents(&[Some(1), Some(2)], None));
		assert!(!pane_is_busy(None), "probe failure paths stay idle");
	}
}
