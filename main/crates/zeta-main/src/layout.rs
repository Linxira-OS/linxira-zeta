use ratatui::layout::{Constraint, Layout, Rect};

/// Split axis of a tree node. `Row` = children side by side (left|right),
/// `Column` = children stacked (top / bottom).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Axis {
	Row,
	Column,
}

impl Axis {
	/// The axis a leaf should split along: across its longer side, so new
	/// panes come out as square as possible (Windows Terminal "auto").
	pub fn for_rect(area: Rect) -> Self {
		if area.width >= area.height {
			Axis::Row
		} else {
			Axis::Column
		}
	}

	fn constraints(weights: &[u32]) -> Vec<Constraint> {
		let total: u32 = weights.iter().sum();
		if total == 0 {
			let even = (100 / weights.len().max(1)) as u16;
			return vec![Constraint::Percentage(even); weights.len()];
		}
		weights
			.iter()
			.map(|w| Constraint::Percentage((*w * 100 / total) as u16))
			.collect()
	}

	fn split_rects(area: Rect, axis: Axis, weights: &[u32]) -> Vec<Rect> {
		match axis {
			Axis::Row => Layout::horizontal(Axis::constraints(weights))
				.split(area)
				.to_vec(),
			Axis::Column => Layout::vertical(Axis::constraints(weights))
				.split(area)
				.to_vec(),
		}
	}
}

/// n-ary weighted layout tree (tmux-style flattening): leaves are pane ids,
/// splits hold same-axis children with relative weights. Same-axis splits
/// insert siblings in place; only crossing axes wraps a new node — trees stay
/// shallow and three columns are one node with equal weights.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PaneNode {
	Leaf(usize),
	Split { axis: Axis, children: Vec<(u32, PaneNode)> },
}

impl PaneNode {
	pub fn single(pane: usize) -> Self {
		PaneNode::Leaf(pane)
	}

	/// Preset trees the layout cycler walks through.
	pub fn presets() -> Vec<(&'static str, PaneNode)> {
		vec![
			("1x1", PaneNode::Leaf(0)),
			(
				"1x2",
				PaneNode::Split {
					axis: Axis::Row,
					children: vec![(1, PaneNode::Leaf(0)), (1, PaneNode::Leaf(1))],
				},
			),
			(
				"2x2",
				PaneNode::Split {
					axis: Axis::Column,
					children: vec![
						(
							1,
							PaneNode::Split {
								axis: Axis::Row,
								children: vec![(1, PaneNode::Leaf(0)), (1, PaneNode::Leaf(1))],
							},
						),
						(
							1,
							PaneNode::Split {
								axis: Axis::Row,
								children: vec![(1, PaneNode::Leaf(2)), (1, PaneNode::Leaf(3))],
							},
						),
					],
				},
			),
		]
	}

	/// Rect for every leaf, depth-first in tree order.
	pub fn leaf_rects(&self, area: Rect) -> Vec<(usize, Rect)> {
		let mut out = Vec::new();
		self.collect_rects(area, &mut out);
		out
	}

	fn collect_rects(&self, area: Rect, out: &mut Vec<(usize, Rect)>) {
		match self {
			PaneNode::Leaf(id) => out.push((*id, area)),
			PaneNode::Split { axis, children } => {
				let weights: Vec<u32> = children.iter().map(|(w, _)| *w).collect();
				for ((_, node), rect) in children
					.iter()
					.zip(Axis::split_rects(area, *axis, &weights))
				{
					node.collect_rects(rect, out);
				}
			},
		}
	}

	/// Split leaf `pane` along `axis`, inserting `new_pane` as its sibling.
	/// Same-axis parent: insert in place (tmux flattening) and rebalance;
	/// otherwise wrap the leaf in a new split node.
	pub fn split(&mut self, pane: usize, axis: Axis, new_pane: usize) {
		match self {
			PaneNode::Leaf(id) if *id == pane => {
				*self = PaneNode::Split {
					axis,
					children: vec![(1, PaneNode::Leaf(pane)), (1, PaneNode::Leaf(new_pane))],
				};
			},
			PaneNode::Leaf(_) => {},
			PaneNode::Split { axis: node_axis, children } => {
				if *node_axis == axis {
					let pos = children
						.iter()
						.position(|(_, n)| n.contains(pane))
						.unwrap_or(children.len().saturating_sub(1));
					children.insert(pos + 1, (1, PaneNode::Leaf(new_pane)));
					// Rebalance so the insertion is actually visible.
					for (w, _) in children.iter_mut() {
						*w = 4;
					}
				} else {
					for (_, node) in children.iter_mut() {
						node.split(pane, axis, new_pane);
					}
				}
			},
		}
	}

	/// Remove leaf `pane`; the vacated space flows to the adjacent sibling
	/// and single-child parents collapse. Returns false when the root is a
	/// bare leaf (nothing left to close).
	pub fn close(&mut self, pane: usize) -> bool {
		match self {
			PaneNode::Leaf(_) => false,
			PaneNode::Split { children, .. } => {
				let direct = children
					.iter()
					.position(|(_, n)| matches!(n, PaneNode::Leaf(id) if *id == pane));
				if let Some(pos) = direct {
					children.remove(pos);
					return self.collapse();
				}
				for (_, node) in children.iter_mut() {
					if node.close(pane) {
						return true;
					}
				}
				self.collapse()
			},
		}
	}

	/// Collapse single-child splits at this level: a split with one child
	/// dissolves and the child takes its place.
	fn collapse(&mut self) -> bool {
		if let PaneNode::Split { children, .. } = self {
			if children.is_empty() {
				return false;
			}
			if children.len() == 1 {
				let inner = std::mem::replace(self, PaneNode::Leaf(usize::MAX));
				if let PaneNode::Split { mut children, .. } = inner {
					*self = children.remove(0).1;
				}
			}
		}
		true
	}

	pub fn contains(&self, pane: usize) -> bool {
		match self {
			PaneNode::Leaf(id) => *id == pane,
			PaneNode::Split { children, .. } => children.iter().any(|(_, n)| n.contains(pane)),
		}
	}

	/// Reindex all leaves after a pane was removed from the store: ids above
	/// `removed` shift down by one.
	pub fn reindex_after_remove(&mut self, removed: usize) {
		match self {
			PaneNode::Leaf(id) => {
				if *id > removed {
					*id -= 1;
				}
			},
			PaneNode::Split { children, .. } => {
				for (_, node) in children.iter_mut() {
					node.reindex_after_remove(removed);
				}
			},
		}
	}

	/// Swap the ids of two leaves (pane swap — contents travel with ids).
	pub fn swap(&mut self, a: usize, b: usize) {
		if a == b {
			return;
		}
		match self {
			PaneNode::Leaf(id) => {
				if *id == a {
					*id = b;
				} else if *id == b {
					*id = a;
				}
			},
			PaneNode::Split { children, .. } => {
				for (_, node) in children.iter_mut() {
					node.swap(a, b);
				}
			},
		}
	}

	/// Equalize sibling weights across the whole tree.
	pub fn equalize(&mut self) {
		if let PaneNode::Split { children, .. } = self {
			for (w, node) in children.iter_mut() {
				*w = 4;
				node.equalize();
			}
		}
	}

	/// Resize by dragging boundaries: find the split child whose right/bottom
	/// edge sits on `line` (in area coords) and shift weight between it and
	/// its next sibling by `delta` cells.
	pub fn resize_at(&mut self, area: Rect, axis: Axis, line: u16, delta: i32) {
		match self {
			PaneNode::Leaf(_) => {},
			PaneNode::Split { axis: node_axis, children } => {
				let weights: Vec<u32> = children.iter().map(|(w, _)| *w).collect();
				let rects = Axis::split_rects(area, *node_axis, &weights);
				if *node_axis == axis && children.len() >= 2 {
					for (i, rect) in rects.iter().enumerate() {
						let edge = if matches!(axis, Axis::Row) {
							rect.right()
						} else {
							rect.bottom()
						};
						if edge == line && i + 1 < children.len() {
							let (left, right) = (children[i].0 as i32, children[i + 1].0 as i32);
							let (new_left, new_right) = (left + delta, right - delta);
							if new_left >= 2 && new_right >= 2 {
								children[i].0 = new_left as u32;
								children[i + 1].0 = new_right as u32;
							}
							return;
						}
					}
				}
				for ((_, node), rect) in children.iter_mut().zip(rects) {
					node.resize_at(rect, axis, line, delta);
				}
			},
		}
	}
}
