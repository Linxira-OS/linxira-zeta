package ui

import "testing"

func TestHitRegionContains(t *testing.T) {
	h := HitRegion{X: 10, Y: 5, W: 3}

	if !h.Contains(10, 5) {
		t.Fatal("should contain left edge")
	}
	if !h.Contains(12, 5) {
		t.Fatal("should contain right edge (exclusive end)")
	}
	if h.Contains(13, 5) {
		t.Fatal("should not contain past right edge")
	}
	if h.Contains(9, 5) {
		t.Fatal("should not contain before left edge")
	}
	if h.Contains(10, 4) {
		t.Fatal("should not contain wrong row")
	}
	if h.Contains(10, 6) {
		t.Fatal("should not contain wrong row")
	}
}

func TestHitRegionZeroWidth(t *testing.T) {
	h := HitRegion{X: 5, Y: 3, W: 0}
	if h.Contains(5, 3) {
		t.Fatal("zero-width region should not contain anything")
	}
}
