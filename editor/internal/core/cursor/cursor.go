package cursor

// Cursor represents the position in the buffer.
type Cursor struct {
	Line int // current line
	Col  int // visual column
}
