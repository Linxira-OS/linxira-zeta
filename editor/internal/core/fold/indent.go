package fold

func indentLevel(line string) int {
	n := 0
	for _, ch := range line {
		if ch == ' ' {
			n++
		} else if ch == '\t' {
			n += 4
		} else {
			break
		}
	}
	return n
}

func isBlank(line string) bool {
	for _, ch := range line {
		if ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n' {
			return false
		}
	}
	return true
}

func nextNonBlank(lines []string, from int) int {
	for i := from; i < len(lines); i++ {
		if !isBlank(lines[i]) {
			return i
		}
	}
	return -1
}

func ComputeIndentRanges(lines []string) []Range {
	var ranges []Range
	n := len(lines)

	for i := 0; i < n; i++ {
		if isBlank(lines[i]) {
			continue
		}
		startIndent := indentLevel(lines[i])
		next := nextNonBlank(lines, i+1)
		if next < 0 {
			continue
		}
		if indentLevel(lines[next]) <= startIndent {
			continue
		}

		end := i
		for j := i + 1; j < n; j++ {
			if isBlank(lines[j]) {
				continue
			}
			if indentLevel(lines[j]) <= startIndent {
				break
			}
			end = j
		}

		if end > i {
			ranges = append(ranges, Range{StartLine: i, EndLine: end})
		}
	}

	return ranges
}
