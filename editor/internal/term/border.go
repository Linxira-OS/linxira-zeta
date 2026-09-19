package term

type BorderSet struct {
	Horizontal  rune
	Vertical    rune
	TopLeft     rune
	TopRight    rune
	BottomLeft  rune
	BottomRight rune
	TopTee      rune
	BottomTee   rune
	LeftTee     rune
	RightTee    rune
}

func DoubleBorderSet() BorderSet {
	return BorderSet{
		Horizontal:  '═',
		Vertical:    '║',
		TopLeft:     '╔',
		TopRight:    '╗',
		BottomLeft:  '╚',
		BottomRight: '╝',
		TopTee:      '╦',
		BottomTee:   '╩',
		LeftTee:     '╠',
		RightTee:    '╣',
	}
}

func SingleBorderSet() BorderSet {
	return BorderSet{
		Horizontal:  '─',
		Vertical:    '│',
		TopLeft:     '┌',
		TopRight:    '┐',
		BottomLeft:  '└',
		BottomRight: '┘',
		TopTee:      '┬',
		BottomTee:   '┴',
		LeftTee:     '├',
		RightTee:    '┤',
	}
}

func RoundedBorderSet() BorderSet {
	return BorderSet{
		Horizontal:  '─',
		Vertical:    '│',
		TopLeft:     '╭',
		TopRight:    '╮',
		BottomLeft:  '╰',
		BottomRight: '╯',
		TopTee:      '┬',
		BottomTee:   '┴',
		LeftTee:     '├',
		RightTee:    '┤',
	}
}

func BoldBorderSet() BorderSet {
	return BorderSet{
		Horizontal:  '━',
		Vertical:    '┃',
		TopLeft:     '┏',
		TopRight:    '┓',
		BottomLeft:  '┗',
		BottomRight: '┛',
		TopTee:      '┳',
		BottomTee:   '┻',
		LeftTee:     '┣',
		RightTee:    '┫',
	}
}

func AsciiBorderSet() BorderSet {
	return BorderSet{
		Horizontal:  '-',
		Vertical:    '|',
		TopLeft:     '+',
		TopRight:    '+',
		BottomLeft:  '+',
		BottomRight: '+',
		TopTee:      '+',
		BottomTee:   '+',
		LeftTee:     '+',
		RightTee:    '+',
	}
}

func NoneBorderSet() BorderSet {
	return BorderSet{
		Horizontal:  ' ',
		Vertical:    ' ',
		TopLeft:     ' ',
		TopRight:    ' ',
		BottomLeft:  ' ',
		BottomRight: ' ',
		TopTee:      ' ',
		BottomTee:   ' ',
		LeftTee:     ' ',
		RightTee:    ' ',
	}
}

func BorderSetByName(name string) BorderSet {
	switch name {
	case "rounded":
		return RoundedBorderSet()
	case "sharp":
		return SingleBorderSet()
	case "double":
		return DoubleBorderSet()
	case "bold":
		return BoldBorderSet()
	case "ascii":
		return AsciiBorderSet()
	case "none":
		return NoneBorderSet()
	default:
		return SingleBorderSet()
	}
}
