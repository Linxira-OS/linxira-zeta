//! Acceptance item 6: is the dock's layout state serializable, and does a
//! round trip keep the topology, the tab order and the sizes?
//!
//! Short answer: **yes**, and the state is `gpui_component`'s own, not ours.
//! `gpui-base` ships the schema (`gpui-base/src/dock/state.rs`) behind the skin
//! `gpui-component` adds, and the whole tree is `Serialize + Deserialize +
//! PartialEq`:
//!
//! ```text
//! DockAreaState { version: Option<usize>,
//!                 center: PanelState,
//!                 left_dock / right_dock / bottom_dock: Option<DockState> }
//! DockState     { panel: PanelState, placement: DockPlacement, size: Pixels, open: bool }
//! PanelState    { panel_name: String, children: Vec<PanelState>, info: PanelInfo }
//! PanelInfo     = Stack { sizes: Vec<Pixels>, axis: 0|1 }
//!               | Tabs  { active_index: usize }
//!               | Panel(serde_json::Value)   // a panel's own payload
//! ```
//!
//! Reading/writing it is `DockArea::dump(&self, cx) -> DockAreaState` and
//! `DockArea::load(&mut self, state, window, cx) -> Result<()>`; a panel that
//! carries its own state overrides `gpui_base::dock::Panel::dump`. Panels are
//! rebuilt on load from the factories registered with
//! `register_panel(cx, name, |ctx, window, cx| …)`.
//!
//! What stays *ours* if zetawork adopts it: where the JSON lives
//! (`~/.zeta/workbench.toml` already exists for preferences), when to write it
//! (the dock only emits `DockEvent::LayoutChanged`), what to do with a state
//! whose `version` does not match (`version: Option<usize>` exists for exactly
//! that), and the fallback layout for a panel this build no longer registers.

#[cfg(test)]
mod tests {
	use gpui_kit::AppContext as _;
	use gpui_kit::TestAppContext;
	use gpui_kit::component::dock::{
		DockArea, DockAreaState, DockLayout, DockPlacement, DockSkin, PanelInfo, PanelState,
		panel_handle, register_panel,
	};
	use gpui_kit::{App, Axis, Entity, Window, px};

	use crate::panels::{ContextPanel, ImePanel, NotePanel, RatatuiPanel};

	/// Panel names in the order a tab group lists them.
	fn tab_order(state: &PanelState) -> Vec<String> {
		state
			.children
			.iter()
			.map(|child| child.panel_name.clone())
			.collect()
	}

	fn register_spike_panels(cx: &mut App) {
		gpui_kit::init(cx);
		register_panel(cx, "RatatuiBlit", |_state, window, cx| {
			panel_handle(cx.new(|cx| RatatuiPanel::new(window, cx)))
		});
		register_panel(cx, "ContextPanel", |_state, _window, cx| {
			panel_handle(cx.new(ContextPanel::new))
		});
		register_panel(cx, "ImePanel", |_state, window, cx| {
			panel_handle(cx.new(|cx| ImePanel::new(window, cx)))
		});
		for name in ["SessionPanel", "RenderCompare"] {
			register_panel(cx, name, move |_state, _window, cx| {
				panel_handle(cx.new(|cx| NotePanel::new(name, name, vec!["restored".to_string()], cx)))
			});
		}
	}

	/// The shell's first big tab, built the way `shell.rs` builds it.
	fn build_layout(dock: &Entity<DockArea>, window: &mut Window, cx: &mut App) {
		let ratatui = cx.new(|cx| RatatuiPanel::new(window, cx));
		let compare = cx.new(|cx| {
			NotePanel::new(
				"RenderCompare",
				"渲染对比",
				vec!["终端(ratatui) vs Web 渲染".to_string()],
				cx,
			)
		});
		let session = cx.new(|cx| {
			NotePanel::new("SessionPanel", "会话", vec!["第一个大标签页的第二个子页".to_string()], cx)
		});
		let context = cx.new(ContextPanel::new);
		let ime = cx.new(|cx| ImePanel::new(window, cx));

		dock.update(cx, |dock, cx| {
			let center = DockLayout::h_split()
				.child(
					DockLayout::tabs()
						.panel_view(panel_handle(ratatui), cx)
						.panel_view(panel_handle(compare), cx),
					None,
				)
				.child(DockLayout::tabs().panel_view(panel_handle(session), cx), Some(px(360.)));
			let right = DockLayout::tabs()
				.panel_view(panel_handle(context), cx)
				.panel_view(panel_handle(ime), cx);
			dock.set_center(center, window, cx);
			dock.set_dock(DockPlacement::Right, right, window, cx);
			dock.set_dock_size(DockPlacement::Right, px(330.), window, cx);
		});
	}

	/// A live dock area in its own test window, plus the state it dumps.
	fn dumped_spike_layout(cx: &mut TestAppContext, id: &'static str) -> DockAreaState {
		let (dock, vcx) = cx.add_window_view(move |window, cx| {
			let skin = DockSkin::new(cx);
			DockArea::new(id, Some(1), window, cx).with_renderer(skin)
		});
		vcx.update(|window, cx| build_layout(&dock, window, cx));
		vcx.read(|cx| dock.read(cx).dump(cx))
	}

	/// Load `state` into a brand-new dock area and dump it back.
	fn reloaded_spike_layout(
		cx: &mut TestAppContext,
		id: &'static str,
		state: DockAreaState,
	) -> anyhow::Result<DockAreaState> {
		let (restored, vcx) = cx.add_window_view(move |window, cx| {
			let skin = DockSkin::new(cx);
			DockArea::new(id, Some(1), window, cx).with_renderer(skin)
		});
		vcx.update(|window, cx| restored.update(cx, |dock, cx| dock.load(state, window, cx)))?;
		Ok(vcx.read(|cx| restored.read(cx).dump(cx)))
	}

	#[gpui_kit::test]
	fn dock_layout_round_trips_through_serde_into_a_fresh_state(cx: &mut TestAppContext) {
		cx.update(register_spike_panels);

		// 1. A live dock: center stack of two tab groups + right dock.
		let state = dumped_spike_layout(cx, "spike-dock");

		// 2. It serializes, and deserializes back to an equal state.
		let json = serde_json::to_string_pretty(&state).expect("DockAreaState serializes");
		println!("--- DockAreaState JSON ---\n{json}");
		let parsed: DockAreaState = serde_json::from_str(&json).expect("DockAreaState deserializes");
		assert_eq!(parsed, state, "serde round trip is lossless");

		// 3. Topology, tab order and sizes, straight out of the schema.
		assert_eq!(state.version, Some(1));
		assert_eq!(state.center.panel_name, "StackPanel", "center is a split");
		assert_eq!(state.center.children.len(), 2, "two panes side by side");
		assert_eq!(
			tab_order(&state.center.children[0]),
			vec!["RatatuiBlit", "RenderCompare"],
			"center-left tab order"
		);
		assert_eq!(tab_order(&state.center.children[1]), vec!["SessionPanel"]);

		let center_sizes = state
			.center
			.info
			.sizes()
			.expect("a Stack records its children's sizes");
		assert_eq!(center_sizes.len(), 2);
		// The recorded size is the *resolved* pixel width of the last layout,
		// not the authored `px(360.)` constraint (it came back 345.55 in this
		// window), so what a reload restores is the layout that was on screen —
		// which the fixpoint assertion below is the real proof of.
		assert!(center_sizes[0] > px(0.) && center_sizes[1] > px(0.));
		assert_eq!(state.center.info.axis(), Some(Axis::Horizontal), "h_split");

		let right = state.right_dock.as_ref().expect("right dock survived");
		assert_eq!(right.placement(), DockPlacement::Right);
		assert_eq!(right.size(), px(330.), "dock size survives");
		assert!(right.open());
		assert_eq!(
			tab_order(right.panel()),
			vec!["ContextPanel", "ImePanel"],
			"right dock tab order"
		);

		// 4. A *fresh* dock area, built from the serialized bytes.
		let fresh: DockAreaState =
			serde_json::from_str(&json).expect("the persisted bytes are the input");
		let again =
			reloaded_spike_layout(cx, "spike-dock-restored", fresh).expect("load accepts the dump");
		assert_eq!(again, state, "load/dump is a fixpoint on a fresh area");
		assert_eq!(
			tab_order(&again.center.children[0]),
			vec!["RatatuiBlit", "RenderCompare"],
			"the fresh area rebuilt the same panels, in the same order"
		);
		assert_eq!(again.right_dock.as_ref().map(|dock| dock.size()), Some(px(330.)));
	}

	#[gpui_kit::test]
	fn a_panel_payload_has_a_slot_in_the_schema(cx: &mut TestAppContext) {
		cx.update(register_spike_panels);

		let (dock, vcx) = cx.add_window_view(move |window, cx| {
			let skin = DockSkin::new(cx);
			DockArea::new("payload-dock", Some(1), window, cx).with_renderer(skin)
		});
		vcx.update(|window, cx| {
			let ime = cx.new(|cx| ImePanel::new(window, cx));
			dock.update(cx, |dock, cx| {
				dock.set_center(DockLayout::tabs().panel_view(panel_handle(ime), cx), window, cx);
			});
		});

		let state = vcx.read(|cx| dock.read(cx).dump(cx));
		// `set_center` always keeps a `StackPanel` root; the tab group is its
		// child, and the panel is the group's child.
		assert_eq!(state.center.panel_name, "StackPanel");
		assert_eq!(state.center.children[0].panel_name, "TabPanel");
		let panel = &state.center.children[0].children[0];
		assert_eq!(panel.panel_name, "ImePanel");
		// The default `Panel::dump` records the name and nothing else; a panel
		// with real state overrides `dump` to return `PanelInfo::Panel(json)` —
		// that is the extension point for "restore my input text too".
		assert!(
			matches!(panel.info, PanelInfo::Panel(_) | PanelInfo::Tabs { .. }),
			"a leaf carries the panel's own info slot"
		);

		// An unregistered panel name is the failure mode zetawork would have to
		// handle itself: `load` needs a factory per `panel_name`. The component
		// ships `gpui-component/src/dock/invalid_panel.rs` (`InvalidPanel`) for
		// names it cannot rebuild, so the shape to plan for is "placeholder tab,
		// not a crash" — this spike did not verify which of the two `load`
		// returns, and does not claim to.
	}
}
