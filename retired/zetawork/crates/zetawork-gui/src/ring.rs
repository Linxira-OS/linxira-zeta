// SPDX-License-Identifier: AGPL-3.0-only
//! Geometry for the 用量 page's context ring.
//!
//! The ring is a full circle read clockwise from 12 o'clock: one arc per
//! context category, a tick where auto-compaction fires, and the used share in
//! the middle. Everything here is pure arithmetic over degrees and radii, so
//! the angles a test asserts are the angles the painter draws — the drawing
//! code in [`crate::right`] only turns these points into a path.
//!
//! # Angles
//!
//! Degrees, `0` at 12 o'clock, increasing clockwise. `-90` is therefore the
//! same point as `270`, and [`START_DEG`] names it once so the composition
//! never starts at 3 o'clock by accident.

use egui::{Pos2, pos2};

/// 12 o'clock in the screen's angle convention (y grows down).
pub const START_DEG: f32 = -90.0;

/// The default compaction threshold when a live report does not name one.
///
/// 90% is the runtime's own auto-compaction default; using it for the colour
/// transition means a journal-only conversation still warns at the point a
/// live one would compact.
pub const DEFAULT_THRESHOLD: f32 = 90.0;

/// How far below the threshold counts as "near" (the colour changes here).
pub const NEAR_MARGIN: f32 = 10.0;

/// The angle one percentage point occupies.
pub const DEG_PER_PERCENT: f32 = 3.6;

/// The sweep, in degrees, each category occupies of a `total`-token window.
///
/// The sweeps sum to at most 360: a category list that over-counts its window
/// (different tokenizers, a stale report) is clamped instead of wrapping the
/// ring past its start. A `total` of 0 yields an empty list.
pub fn segment_sweeps(values: &[u64], total: u64) -> Vec<f32> {
	if total == 0 {
		return Vec::new();
	}
	let mut spent = 0.0_f32;
	values
		.iter()
		.map(|value| {
			let sweep = (*value as f32 / total as f32 * 360.0)
				.min(360.0 - spent)
				.max(0.0);
			spent += sweep;
			sweep
		})
		.collect()
}

/// The angle, in degrees, of a percentage of the circle.
pub fn angle_at(percent: f32) -> f32 {
	START_DEG + percent.clamp(0.0, 100.0) * DEG_PER_PERCENT
}

/// A closed annulus sector, as a polygon: the outer arc forward, the inner arc
/// backward. A filled path is what gives the ring crisp ends; a thick
/// polyline would leave the arc's caps round and its joins notched.
///
/// `steps` is the number of straight edges per arc (at least 1).
pub fn annulus(
	center: Pos2,
	outer: f32,
	inner: f32,
	start_deg: f32,
	sweep_deg: f32,
	steps: usize,
) -> Vec<Pos2> {
	let outer = outer.max(0.0);
	let inner = inner.clamp(0.0, outer);
	let steps = steps.max(1);
	let sweep = sweep_deg.clamp(-360.0, 360.0);
	let mut points = Vec::with_capacity(steps * 2 + 2);
	for index in 0..=steps {
		let angle = start_deg + sweep * index as f32 / steps as f32;
		points.push(on_circle(center, outer, angle));
	}
	for index in (0..=steps).rev() {
		let angle = start_deg + sweep * index as f32 / steps as f32;
		points.push(on_circle(center, inner, angle));
	}
	points
}

/// The point at `radius` and `angle` around `center`.
pub fn on_circle(center: Pos2, radius: f32, angle_deg: f32) -> Pos2 {
	let radians = angle_deg.to_radians();
	pos2(center.x + radius * radians.cos(), center.y + radius * radians.sin())
}

/// The two ends of the threshold tick, which crosses the ring's band.
pub fn threshold_tick(center: Pos2, outer: f32, inner: f32, angle_deg: f32) -> (Pos2, Pos2) {
	(on_circle(center, inner - 2.0, angle_deg), on_circle(center, outer + 2.0, angle_deg))
}

/// How urgent the used share is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RingTone {
	/// Below the warning band: the ring draws each category in its own colour.
	Normal,
	/// Within [`NEAR_MARGIN`] of the threshold: accents turn amber.
	Near,
	/// At or past the threshold: the ring turns red, because the next turn may
	/// compact.
	Over,
}

/// Classify a share against a compaction threshold (percent).
pub fn tone(percent: f32, threshold: Option<f32>) -> RingTone {
	let threshold = threshold
		.filter(|value| *value > 0.0)
		.unwrap_or(DEFAULT_THRESHOLD);
	if percent >= threshold {
		RingTone::Over
	} else if percent >= threshold - NEAR_MARGIN {
		RingTone::Near
	} else {
		RingTone::Normal
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sweeps_are_proportional_and_clamped() {
		assert_eq!(segment_sweeps(&[1, 1], 4), [90.0, 90.0]);
		assert_eq!(segment_sweeps(&[], 100), Vec::<f32>::new());
		assert_eq!(segment_sweeps(&[5], 0), Vec::<f32>::new());
		let clamped = segment_sweeps(&[2_000, 2_000], 1_000);
		assert_eq!(clamped, [360.0, 0.0], "an over-count cannot wrap the ring");
		assert!(clamped.iter().sum::<f32>() <= 360.0);
	}

	#[test]
	fn angles_start_at_twelve_and_run_clockwise() {
		assert_eq!(angle_at(0.0), START_DEG);
		assert!((angle_at(25.0) - 0.0).abs() < 0.001, "a quarter is 3 o'clock");
		assert!((angle_at(50.0) - 90.0).abs() < 0.001, "half is 6 o'clock");
		assert!((angle_at(100.0) - 270.0).abs() < 0.001, "full circle");
		assert_eq!(angle_at(-5.0), START_DEG);
	}

	#[test]
	fn annulus_points_stay_in_the_band() {
		let center = pos2(50.0, 50.0);
		let points = annulus(center, 40.0, 30.0, START_DEG, 90.0, 8);
		assert_eq!(points.len(), 18, "outer arc + inner arc, closed");
		for point in &points {
			let distance = ((point.x - center.x).powi(2) + (point.y - center.y).powi(2)).sqrt();
			assert!((29.999..=40.001).contains(&distance), "{distance}");
		}
		let first = points[0];
		assert!(
			(first.x - center.x).abs() < 0.001 && first.y < center.y,
			"the first outer point is 12 o'clock"
		);
		let right = on_circle(center, 10.0, 0.0);
		assert!((right.x - 60.0).abs() < 0.001 && (right.y - 50.0).abs() < 0.001);
	}

	#[test]
	fn tone_changes_near_the_compaction_threshold() {
		assert_eq!(tone(40.0, Some(90.0)), RingTone::Normal);
		assert_eq!(tone(80.0, Some(90.0)), RingTone::Near);
		assert_eq!(tone(90.0, Some(90.0)), RingTone::Over);
		assert_eq!(tone(99.0, None), RingTone::Over, "the default threshold applies");
		assert_eq!(tone(85.0, None), RingTone::Near);
		assert_eq!(tone(50.0, Some(0.0)), RingTone::Normal, "a zero threshold is no threshold");

		let (inner, outer) = threshold_tick(pos2(0.0, 0.0), 40.0, 30.0, START_DEG);
		assert!((inner.y + 28.0).abs() < 0.001, "the tick crosses the band's inner edge");
		assert!((outer.y + 42.0).abs() < 0.001);
	}
}
