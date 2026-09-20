package view

// Viewport represents the visible region of the buffer.
type Viewport struct {
	TopLine int // first visible line in the buffer
	LeftCol int // first visible column
	Width   int // width of the viewport (in columns)
	Height  int // height of the viewport (in lines)
}
