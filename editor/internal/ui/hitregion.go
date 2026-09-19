package ui

type HitRegion struct {
	X, Y, W int
}

func (h HitRegion) Contains(mx, my int) bool {
	return my == h.Y && mx >= h.X && mx < h.X+h.W
}
