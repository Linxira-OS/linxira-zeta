//! 状态词表: the seven run states, copied word for word from the contract.
//!
//! `temp/zetawork-ui-mock/mock-override.js` (the user's spoken contract) fixes
//! the vocabulary and its priority order — the mock's own comment says the
//! seven are copied from Orca — and `mock-common.js`'s `ST` / `DOTE` tables fix
//! the machine keys and the glyphs:
//!
//! | # | key | glyph | word | meaning |
//! |---|---|---|---|---|
//! | 1 | `perm` | `◐` | `permission` | 在等你批准（最高优先级，盖过其它） |
//! | 2 | `fail` | `✕` | `failed` | 失败 |
//! | 3 | `work` | `●` | `working` | 正在干 |
//! | 4 | `mon` | `◇` | `monitoring` | 后台值守（等外部信号 / 定时任务） |
//! | 5 | `unc` | `◔` | `unconfirmed` | 说自己干完了，但没验证 —— 不等于 done |
//! | 6 | `int` | `‖` | `interrupted` | 中途被打断 |
//! | 7 | `done` | `✓` | `done` | 完成且已确认 |
//!
//! Every surface that shows a state — the left column's workspace row, the
//! 总面板's 状态 column, and any card that reports progress — reads it from
//! here, so the wording and the colour can only be changed in one place.
//!
//! # Colour
//!
//! Five of the seven have a colour of their own in the mock's stylesheet
//! (`.d-work` / `.d-perm` / `.d-fail` / `.d-mon` / `.d-done`, plus `.d-idle`).
//! `unconfirmed` and `interrupted` have no `.d-*` rule, so they take the two
//! neutral inks instead of a new colour being invented — see
//! [`RunState::ink`].

use egui::Color32;

use crate::theme;

/// One of the seven run states. Earlier variants are *higher* priority, which
/// is the order the contract's table lists them in (and what
/// [`RunState::outranks`] compares); the derive order is deliberately not used
/// for that, so the logic stays readable.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RunState {
	/// `◐ permission` — 在等你批准. Highest priority: it overrides everything.
	Perm,
	/// `✕ failed` — 失败.
	Fail,
	/// `● working` — 正在干. The state a freshly created workspace starts in.
	#[default]
	Work,
	/// `◇ monitoring` — 后台值守（等外部信号 / 定时任务）.
	Mon,
	/// `◔ unconfirmed` — 说自己干完了，但没验证. **Not** `done`.
	Unc,
	/// `‖ interrupted` — 中途被打断.
	Int,
	/// `✓ done` — 完成且已确认.
	Done,
}

impl RunState {
	/// The seven, in the contract's priority order (highest first).
	pub const ALL: [Self; 7] =
		[Self::Perm, Self::Fail, Self::Work, Self::Mon, Self::Unc, Self::Int, Self::Done];

	// The state's *icon* is painted by `widgets::status_dot` — deliberately not
	// a codepoint: the bundled faces lack ◐/✓/✕ (they render as tofu on the
	// hosts we tested), so the seven states must not depend on font coverage.

	/// The word the contract spells, in English, as the mock's `ST` table does.
	pub fn word(self) -> &'static str {
		match self {
			Self::Perm => "permission",
			Self::Fail => "failed",
			Self::Work => "working",
			Self::Mon => "monitoring",
			Self::Unc => "unconfirmed",
			Self::Int => "interrupted",
			Self::Done => "done",
		}
	}

	/// What the state means, word for word from the contract's table.
	pub fn meaning(self) -> &'static str {
		match self {
			Self::Perm => "在等你批准（最高优先级，盖过其它）",
			Self::Fail => "失败",
			Self::Work => "正在干",
			Self::Mon => "后台值守（等外部信号 / 定时任务）",
			Self::Unc => "说自己干完了，但没验证 —— 不等于 done",
			Self::Int => "中途被打断",
			Self::Done => "完成且已确认",
		}
	}

	/// `1` (highest) … `7` (lowest), the contract's table order.
	pub fn priority(self) -> u8 {
		match self {
			Self::Perm => 1,
			Self::Fail => 2,
			Self::Work => 3,
			Self::Mon => 4,
			Self::Unc => 5,
			Self::Int => 6,
			Self::Done => 7,
		}
	}

	/// The mock's key: what a `data-dot` / `.d-*` class was named after.
	pub fn key(self) -> &'static str {
		match self {
			Self::Perm => "perm",
			Self::Fail => "fail",
			Self::Work => "work",
			Self::Mon => "mon",
			Self::Unc => "unc",
			Self::Int => "int",
			Self::Done => "done",
		}
	}

	/// The ink the dot and the word are drawn in.
	///
	/// Five come straight from the mock's dot rules; the two that have none
	/// (`◔ unconfirmed` and `‖ interrupted`) take the neutral inks: `unconfirmed`
	/// stays legible because it is a *trust* signal — the agent claims it is
	/// finished and it is not verified — while `interrupted` recedes one step.
	pub fn ink(self) -> Color32 {
		match self {
			Self::Perm => theme::WARN,
			Self::Fail => theme::DEL,
			Self::Work => theme::ADD,
			Self::Mon => theme::PURPLE,
			Self::Unc => theme::TEXT_2,
			Self::Int => theme::TEXT_3,
			Self::Done => theme::ACCENT,
		}
	}

	/// Does this state outrank `other`? The higher-priority state is what a
	/// roll-up shows: a project with one `permission` workspace and four `done`
	/// ones is waiting for an approval, not finished.
	pub fn outranks(self, other: Self) -> bool {
		self.priority() < other.priority()
	}

	/// The highest-priority state of a group; `None` for an empty group.
	pub fn highest(states: impl IntoIterator<Item = Self>) -> Option<Self> {
		let mut best: Option<Self> = None;
		for state in states {
			if best.is_none_or(|current| state.outranks(current)) {
				best = Some(state);
			}
		}
		best
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::collections::HashSet;

	/// The contract's table: word, meaning and key, verbatim. The *icon* is not
	/// pinned here — `widgets::status_dot` paints it, so no codepoint can turn
	/// into tofu on a host whose faces lack the mock's glyphs.
	const CONTRACT: [(RunState, &str, &str); 7] = [
		(RunState::Perm, "permission", "在等你批准（最高优先级，盖过其它）"),
		(RunState::Fail, "failed", "失败"),
		(RunState::Work, "working", "正在干"),
		(RunState::Mon, "monitoring", "后台值守（等外部信号 / 定时任务）"),
		(RunState::Unc, "unconfirmed", "说自己干完了，但没验证 —— 不等于 done"),
		(RunState::Int, "interrupted", "中途被打断"),
		(RunState::Done, "done", "完成且已确认"),
	];

	#[test]
	fn the_seven_states_are_the_contracts_seven() {
		assert_eq!(RunState::ALL.len(), 7, "Orca's seven, no more and no fewer");
		for (state, word, meaning) in CONTRACT {
			assert_eq!(state.word(), word, "the contract's word, word for word");
			assert_eq!(state.meaning(), meaning, "the contract's meaning, word for word");
			assert!(RunState::ALL.contains(&state));
		}
		// The keys are the mock's `data-dot` names.
		assert_eq!(RunState::Perm.key(), "perm");
		assert_eq!(RunState::Unc.key(), "unc");
	}

	#[test]
	fn permission_outranks_everything_and_done_is_last() {
		let ordered: Vec<u8> = RunState::ALL.iter().map(|state| state.priority()).collect();
		assert_eq!(ordered, vec![1, 2, 3, 4, 5, 6, 7]);
		for state in RunState::ALL {
			if state != RunState::Perm {
				assert!(RunState::Perm.outranks(state), "permission 盖过其它");
			}
			if state != RunState::Done {
				assert!(state.outranks(RunState::Done), "{state:?} outranks done");
			}
		}
		// A roll-up shows the highest-priority member, which is what makes the
		// order load-bearing rather than decorative.
		assert_eq!(
			RunState::highest([RunState::Done, RunState::Perm, RunState::Work]),
			Some(RunState::Perm)
		);
		assert_eq!(RunState::highest([RunState::Done, RunState::Done]), Some(RunState::Done));
		assert_eq!(RunState::highest([]), None);
	}

	#[test]
	fn the_seven_states_are_seven_colours() {
		// Seven states that shared an ink would be one state as far as the eye
		// goes, and the whole point of the vocabulary is telling them apart.
		let inks: HashSet<[u8; 4]> = RunState::ALL
			.iter()
			.map(|state| state.ink().to_array())
			.collect();
		assert_eq!(inks.len(), 7, "every state has its own ink");
		// The five the mock's stylesheet colours keep those colours; only
		// `unconfirmed` and `interrupted` take a neutral ink, and the two are
		// still distinct from each other.
		assert_eq!(RunState::Perm.ink(), theme::WARN);
		assert_eq!(RunState::Fail.ink(), theme::DEL);
		assert_eq!(RunState::Work.ink(), theme::ADD);
		assert_eq!(RunState::Mon.ink(), theme::PURPLE);
		assert_eq!(RunState::Done.ink(), theme::ACCENT);
		assert_ne!(RunState::Unc.ink(), RunState::Int.ink());
	}

	#[test]
	fn the_default_is_a_state_and_not_an_absence() {
		// `RunState` always names one of the seven; "unknown" is expressed by
		// the *absent* value (`Option<RunState>`), never by a member.
		assert!(RunState::ALL.contains(&RunState::default()));
	}
}
