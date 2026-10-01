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
		// Exact ratios: percentage rounding made edges drift and jitter.
		weights
			.iter()
			.map(|w| Constraint::Ratio(*w, total))
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

fn collect_ids(node: &PaneNode, out: &mut Vec<usize>) {
	match node {
		PaneNode::Leaf(id) => out.push(*id),
		PaneNode::Split { children, .. } => {
			for (_, n) in children {
				collect_ids(n, out);
			}
		},
	}
}

impl PaneNode {
	pub fn single(pane: usize) -> Self {
		PaneNode::Leaf(pane)
	}

	/// Preset shapes the layout cycler and Tools menu walk through. The
	/// smart defaults follow the product sketch: a side-by-side pair gives
	/// the left pane a third of the width (agent-left workflows), three
	/// panes get thirds or the T shape (⅓ + ⅔ top band, full-width bottom
	/// half), four panes get the quad or dual columns (left pair ⅓ wide,
	/// right pair ⅔). Listed ascending by slot count so the cycler only
	/// ever grows.
	pub fn presets() -> Vec<(&'static str, PaneNode)> {
		let leaf = |id: usize| (1000, PaneNode::Leaf(id));
		let row =
			|children: Vec<(u32, PaneNode)>| (1000, PaneNode::Split { axis: Axis::Row, children });
		let col =
			|children: Vec<(u32, PaneNode)>| (1000, PaneNode::Split { axis: Axis::Column, children });
		let two_thirds_top = || {
			(
				1000,
				PaneNode::Split { axis: Axis::Row, children: vec![leaf(0), (2000, PaneNode::Leaf(1))] },
			)
		};
		vec![
			("single", PaneNode::Leaf(0)),
			(
				"1+2",
				PaneNode::Split { axis: Axis::Row, children: vec![leaf(0), (2000, PaneNode::Leaf(1))] },
			),
			("thirds", PaneNode::Split { axis: Axis::Row, children: vec![leaf(0), leaf(1), leaf(2)] }),
			("T", PaneNode::Split { axis: Axis::Column, children: vec![two_thirds_top(), leaf(2)] }),
			(
				"quad",
				PaneNode::Split {
					axis: Axis::Column,
					children: vec![row(vec![leaf(0), leaf(1)]), row(vec![leaf(2), leaf(3)])],
				},
			),
			(
				"columns",
				PaneNode::Split {
					axis: Axis::Row,
					children: vec![
						col(vec![leaf(0), leaf(1)]),
						(2000, PaneNode::Split { axis: Axis::Column, children: vec![leaf(2), leaf(3)] }),
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

	/// Split leaf `pane` along `axis`, wrapping it in a new split node with
	/// `new_pane` as its sibling. Always wraps at the leaf — the new pane
	/// lands exactly beside its target, never as a stray top-level row.
	pub fn split(&mut self, pane: usize, axis: Axis, new_pane: usize) {
		match self {
			PaneNode::Leaf(id) if *id == pane => {
				// Large unit weights: resize deltas move in cell-sized steps,
				// not third-of-the-screen jumps.
				*self = PaneNode::Split {
					axis,
					children: vec![(1000, PaneNode::Leaf(pane)), (1000, PaneNode::Leaf(new_pane))],
				};
			},
			PaneNode::Leaf(_) => {},
			PaneNode::Split { children, .. } => {
				for (_, node) in children.iter_mut() {
					node.split(pane, axis, new_pane);
				}
			},
		}
	}

	/// Whether any pane id occurs more than once — a corrupting invariant
	/// that makes two panes highlight and split together.
	pub fn has_duplicates(&self) -> bool {
		let mut ids: Vec<usize> = Vec::new();
		collect_ids(self, &mut ids);
		let total = ids.len();
		ids.sort_unstable();
		ids.dedup();
		ids.len() != total
	}

	/// Repair duplicates: second and later occurrences of each id are
	/// reassigned to fresh sequential ids. Returns the required store length
	/// (the caller grows the pane store with shell panes to match).
	pub fn deduplicate(&mut self, store_len: usize) -> usize {
		let mut seen: Vec<usize> = Vec::new();
		let mut next = store_len;
		fn walk(node: &mut PaneNode, seen: &mut Vec<usize>, next: &mut usize) {
			match node {
				PaneNode::Leaf(id) => {
					if seen.contains(id) {
						*id = *next;
						*next += 1;
					} else {
						seen.push(*id);
					}
				},
				PaneNode::Split { children, .. } => {
					for (_, n) in children.iter_mut() {
						walk(n, seen, next);
					}
				},
			}
		}
		walk(self, &mut seen, &mut next);
		next
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
				*w = 1000;
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
							// Convert the cell delta into weight units so the
							// edge follows the cursor one-to-one.
							let total: i32 = weights.iter().map(|w| *w as i32).sum();
							let length = match axis {
								Axis::Row => area.width as i32,
								Axis::Column => area.height as i32,
							};
							let wdelta = if length > 0 {
								delta * total / length
							} else {
								0
							};
							let (left, right) = (children[i].0 as i32, children[i + 1].0 as i32);
							let (new_left, new_right) = (left + wdelta, right - wdelta);
							const MIN_WEIGHT: i32 = 100;
							if new_left >= MIN_WEIGHT && new_right >= MIN_WEIGHT {
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

	/// Detach leaf `pane` from the tree (space flows to siblings, single-child
	/// parents collapse, pane store untouched). Returns false when the root is
	/// that leaf (nothing to detach) or the pane is absent.
	pub fn detach(&mut self, pane: usize) -> bool {
		if matches!(self, PaneNode::Leaf(_)) {
			return false;
		}
		if !self.contains(pane) {
			return false;
		}
		self.close(pane)
	}

	/// Place detached `moved` beside `target` on `side` (Left/Right share a
	/// Row axis; Top/Bottom share a Column axis). The target's slot splits to
	/// admit the moved pane — "drag to an edge = that-direction distribution".
	pub fn insert_beside(&mut self, moved: usize, target: usize, side: Side) {
		let axis = match side {
			Side::Left | Side::Right => Axis::Row,
			Side::Top | Side::Bottom => Axis::Column,
		};
		if let PaneNode::Leaf(id) = self {
			// Root is the target leaf itself: grow a fresh root split.
			if *id == target {
				let (first, second) = match side {
					Side::Left | Side::Top => (moved, target),
					Side::Right | Side::Bottom => (target, moved),
				};
				*self = PaneNode::Split {
					axis,
					children: vec![(1000, PaneNode::Leaf(first)), (1000, PaneNode::Leaf(second))],
				};
			}
			return;
		}
		// Walk to the split whose DIRECT leaf child is the target.
		if let PaneNode::Split { axis: node_axis, children } = self {
			let direct = children
				.iter()
				.position(|(_, n)| matches!(n, PaneNode::Leaf(id) if *id == target));
			if let Some(pos) = direct {
				let at = if matches!(side, Side::Right | Side::Bottom) {
					pos + 1
				} else {
					pos
				};
				if *node_axis == axis {
					// Same axis: insert as a sibling next to the target.
					children.insert(at, (1000, PaneNode::Leaf(moved)));
				} else {
					// Crossing axes: wrap the target leaf in a new split.
					let target_leaf =
						std::mem::replace(&mut children[pos].1, PaneNode::Leaf(usize::MAX));
					children[pos].0 = 1000;
					children[pos].1 = PaneNode::Split {
						axis,
						children: match side {
							Side::Left | Side::Top => {
								vec![(1000, PaneNode::Leaf(moved)), (1000, target_leaf)]
							},
							Side::Right | Side::Bottom => {
								vec![(1000, target_leaf), (1000, PaneNode::Leaf(moved))]
							},
						},
					};
				}
				return;
			}
			for (_, node) in children.iter_mut() {
				node.insert_beside(moved, target, side);
			}
		}
	}
}

/// Drop side for pane drags: a shared split axis with the target.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
	Left,
	Right,
	Top,
	Bottom,
}

/// The shared boundary nearest the cursor, with the pane ids flanking it
/// (`low` = left/top pane, `high` = right/bottom). Resize drags pin this
/// pair at press time and track one edge for the whole drag, so nested
/// boundaries are never re-grabbed mid-drag.
pub fn boundary_pair(
	areas: &[(usize, Rect)],
	column: u16,
	row: u16,
	tolerance: i32,
) -> Option<(Axis, usize, usize)> {
	let mut best: Option<(i32, Axis, usize, usize)> = None;
	for &(low, a) in areas {
		for &(high, b) in areas {
			if low == high {
				continue;
			}
			// Vertical boundary: a's right edge meets b's left edge over a
			// shared vertical span, cursor near the line and inside it.
			if b.left() != 0 && a.right() == b.left() && a.bottom() > b.top() && b.bottom() > a.top() {
				let row_in = row >= a.top().max(b.top()) && row < a.bottom().min(b.bottom());
				let dist = (column as i32 - b.left() as i32).abs();
				if row_in && dist <= tolerance && best.as_ref().map(|(d, ..)| dist < *d).unwrap_or(true)
				{
					best = Some((dist, Axis::Row, low, high));
				}
			}
			// Horizontal boundary: a's bottom edge meets b's top edge.
			if b.top() != 0 && a.bottom() == b.top() && a.right() > b.left() && b.right() > a.left() {
				let col_in = column >= a.left().max(b.left()) && column < a.right().min(b.right());
				let dist = (row as i32 - b.top() as i32).abs();
				if col_in && dist <= tolerance && best.as_ref().map(|(d, ..)| dist < *d).unwrap_or(true)
				{
					best = Some((dist, Axis::Column, low, high));
				}
			}
		}
	}
	best.map(|(_, axis, low, high)| (axis, low, high))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn row(children: Vec<PaneNode>) -> PaneNode {
		PaneNode::Split { axis: Axis::Row, children: children.into_iter().map(|n| (1, n)).collect() }
	}

	fn col(children: Vec<PaneNode>) -> PaneNode {
		PaneNode::Split {
			axis: Axis::Column,
			children: children.into_iter().map(|n| (1, n)).collect(),
		}
	}

	fn ids(tree: &PaneNode) -> Vec<usize> {
		tree
			.leaf_rects(Rect::new(0, 0, 80, 24))
			.iter()
			.map(|(id, _)| *id)
			.collect()
	}

	fn preset(name: &str) -> PaneNode {
		PaneNode::presets()
			.into_iter()
			.find(|(n, _)| *n == name)
			.unwrap_or_else(|| panic!("preset {name} missing"))
			.1
	}

	#[test]
	fn split_inserts_same_axis_sibling() {
		let mut tree = PaneNode::single(0);
		tree.split(0, Axis::Row, 1);
		tree.split(1, Axis::Row, 2);
		assert_eq!(ids(&tree), vec![0, 1, 2], "three columns in one row split");
	}

	#[test]
	fn close_collapses_and_reindexes() {
		let mut tree = row(vec![PaneNode::Leaf(0), col(vec![PaneNode::Leaf(1), PaneNode::Leaf(2)])]);
		assert!(tree.close(1));
		assert_eq!(ids(&tree), vec![0, 2], "space flows to sibling");
		tree.reindex_after_remove(1);
		assert_eq!(ids(&tree), vec![0, 1]);
		assert!(tree.close(0), "closing down to the last leaf is legal");
		assert_eq!(ids(&tree), vec![1]);
	}

	#[test]
	fn insert_beside_crosses_axis() {
		// User sketch: left tall | middle (top+bottom) | right tall.
		let mut tree = PaneNode::single(0);
		tree.split(0, Axis::Row, 1); // [0 | 1]
		tree.split(1, Axis::Column, 2); // [0 | 1 over 2]
		tree.split(1, Axis::Row, 3); // middle top cell 1 splits: 3 sits right of 1, above 2
		assert_eq!(ids(&tree), vec![0, 1, 3, 2]);
	}

	#[test]
	fn detach_then_insert_beside_moves_pane() {
		let mut tree = row(vec![PaneNode::Leaf(0), col(vec![PaneNode::Leaf(1), PaneNode::Leaf(2)])]);
		assert!(tree.detach(0));
		assert_eq!(ids(&tree), vec![1, 2]);
		tree.insert_beside(0, 2, Side::Left);
		assert_eq!(ids(&tree), vec![1, 0, 2], "moved pane sits left of target");
	}

	#[test]
	fn no_duplicate_ids_after_drags_and_splits() {
		// The user-reported scenario: 2x2 preset, drag panes around (edge
		// drops + center swaps), then split — every id must stay unique and
		// a split must land exactly beside its target.
		let mut tree = preset("quad");
		tree.detach(0);
		tree.insert_beside(0, 3, Side::Right);
		tree.detach(2);
		tree.insert_beside(2, 1, Side::Bottom);
		tree.swap(0, 3);
		tree.split(2, Axis::Row, 5);
		let mut ids = Vec::new();
		collect_ids(&tree, &mut ids);
		ids.sort_unstable();
		assert_eq!(ids, vec![0, 1, 2, 3, 5], "exactly the live ids, no dups, no losses");
		assert!(!tree.has_duplicates());
	}

	#[test]
	fn deduplicate_repairs_a_corrupted_tree() {
		let mut tree = PaneNode::Split {
			axis: Axis::Row,
			children: vec![(1, PaneNode::Leaf(0)), (1, PaneNode::Leaf(0)), (1, PaneNode::Leaf(1))],
		};
		assert!(tree.has_duplicates());
		let len = tree.deduplicate(2);
		assert_eq!(len, 3, "a fresh shell slot is needed for the duplicate");
		let mut ids = Vec::new();
		collect_ids(&tree, &mut ids);
		ids.sort_unstable();
		assert_eq!(ids, vec![0, 1, 2]);
		assert!(!tree.has_duplicates());
	}

	fn collect_ids(node: &PaneNode, out: &mut Vec<usize>) {
		match node {
			PaneNode::Leaf(id) => out.push(*id),
			PaneNode::Split { children, .. } => {
				for (_, n) in children {
					collect_ids(n, out);
				}
			},
		}
	}

	#[test]
	fn resize_tracks_the_cursor_one_to_one() {
		let mut tree = PaneNode::single(0);
		tree.split(0, Axis::Row, 1); // two equal columns in an 80-wide area
		let area = Rect::new(0, 0, 80, 24);
		let boundary = tree.leaf_rects(area)[0].1.right();
		assert_eq!(boundary, 40);
		tree.resize_at(area, Axis::Row, boundary, 10);
		let (l, r) = (tree.leaf_rects(area)[0].1, tree.leaf_rects(area)[1].1);
		assert_eq!(l.width, 50, "drag 10 cells = 10 cells wider");
		assert_eq!(r.x, 50);
		tree.resize_at(area, Axis::Row, l.right(), 5);
		let (l, r) = (tree.leaf_rects(area)[0].1, tree.leaf_rects(area)[1].1);
		assert_eq!(l.width, 55);
		assert_eq!(r.width, 25);
		// Min-size clamp holds.
		tree.resize_at(area, Axis::Row, l.right(), 200);
		let l = tree.leaf_rects(area)[0].1;
		assert!(l.width >= 4, "panes never collapse below a usable width");
	}

	#[test]
	fn insert_beside_root_leaf_grows_root() {
		let mut tree = PaneNode::single(0);
		tree.insert_beside(1, 0, Side::Top);
		assert_eq!(ids(&tree), vec![1, 0], "drop on the top edge = above the target");
		let mut tree = PaneNode::single(0);
		tree.insert_beside(1, 0, Side::Bottom);
		assert_eq!(ids(&tree), vec![0, 1], "drop on the bottom edge = below the target");
	}

	#[test]
	fn smart_presets_carry_the_sketch_ratios() {
		let area = Rect::new(0, 0, 90, 24);
		let rects = preset("1+2").leaf_rects(area);
		assert_eq!(rects[0].1.width, 30, "left pane takes a third");
		assert_eq!(rects[1].1.width, 60, "right pane takes two thirds");

		let rects = preset("thirds").leaf_rects(area);
		assert!(rects.iter().all(|(_, r)| r.width == 30), "three equal columns");

		let rects = preset("T").leaf_rects(area);
		assert_eq!(rects[0].1.width, 30, "T top band: left third");
		assert_eq!(rects[1].1.width, 60, "T top band: right two thirds");
		assert_eq!(rects[1].1.height, 12, "T top band: upper half");
		assert_eq!(
			(rects[2].1.y, rects[2].1.height, rects[2].1.width),
			(12, 12, 90),
			"T bottom: full width, lower half"
		);

		let rects = preset("quad").leaf_rects(area);
		assert_eq!(
			(rects[0].1.width, rects[0].1.height, rects[3].1.x),
			(45, 12, 45),
			"quad: 2x2 equal grid"
		);

		let rects = preset("columns").leaf_rects(area);
		assert_eq!(
			(rects[0].1.width, rects[1].1.y, rects[2].1.width),
			(30, 12, 60),
			"dual columns: left pair ⅓ wide stacked, right pair ⅔ wide stacked"
		);

		// The cycler only ever grows: slot counts ascend along the list.
		let counts: Vec<usize> = PaneNode::presets()
			.iter()
			.map(|(_, t)| count_leaves_pub(t))
			.collect();
		let mut sorted = counts.clone();
		sorted.sort_unstable();
		assert_eq!(counts, sorted, "presets ascend by slot count");
	}

	fn count_leaves_pub(node: &PaneNode) -> usize {
		match node {
			PaneNode::Leaf(_) => 1,
			PaneNode::Split { children, .. } => {
				children.iter().map(|(_, n)| count_leaves_pub(n)).sum()
			},
		}
	}

	#[test]
	fn boundary_pair_pins_the_flanking_panes() {
		// [0 | 1 over 2]: vertical boundary 0|1, horizontal 1|2.
		let tree = row(vec![PaneNode::Leaf(0), col(vec![PaneNode::Leaf(1), PaneNode::Leaf(2)])]);
		let areas = tree.leaf_rects(Rect::new(0, 0, 80, 24));
		let (x01, y12) = (areas[0].1.right(), areas[1].1.bottom());

		assert_eq!(
			boundary_pair(&areas, x01, 5, 1),
			Some((Axis::Row, 0, 1)),
			"vertical boundary pins 0 left, 1 right"
		);
		assert_eq!(
			boundary_pair(&areas, x01, 20, 1),
			Some((Axis::Row, 0, 2)),
			"below the 1|2 split the same line flanks 0 and 2"
		);
		assert_eq!(
			boundary_pair(&areas, 60, y12, 1),
			Some((Axis::Column, 1, 2)),
			"horizontal boundary pins 1 above, 2 below"
		);
		assert_eq!(boundary_pair(&areas, x01 + 5, 5, 1), None, "off-boundary clicks grab nothing");
		assert_eq!(
			boundary_pair(&areas, 20, y12, 1),
			None,
			"left half has no boundary at the T stem"
		);
		let lone = PaneNode::single(0).leaf_rects(Rect::new(0, 0, 80, 24));
		assert_eq!(boundary_pair(&lone, 40, 12, 1), None, "a lone pane has no boundary");
	}
}
