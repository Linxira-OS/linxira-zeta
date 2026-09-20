package ui

import "strings"

// fuzzyMatch checks whether query matches candidate using fuzzy matching.
// Characters must appear in order but not necessarily contiguously.
// Returns whether it matched and a score (higher = better).
// Matching is case-insensitive.
func fuzzyMatch(query, candidate string) (bool, int) {
	if query == "" {
		return true, 0
	}

	lowerQuery := strings.ToLower(query)
	lowerCandidate := strings.ToLower(candidate)

	// Fast path: exact substring match gets highest priority.
	if idx := strings.Index(lowerCandidate, lowerQuery); idx >= 0 {
		score := 1000
		// Bonus for matching at start of string.
		if idx == 0 {
			score += 100
		}
		// Bonus for matching at start of a word.
		if idx > 0 && isWordBoundary(candidate[idx-1]) {
			score += 50
		}
		return true, score
	}

	// Fuzzy match: each query character must appear in order.
	candidateRunes := []rune(lowerCandidate)
	queryRunes := []rune(lowerQuery)
	origRunes := []rune(candidate)

	qi := 0 // index into query
	score := 0
	lastMatchIdx := -1
	consecutive := 0

	for ci := 0; ci < len(candidateRunes) && qi < len(queryRunes); ci++ {
		if candidateRunes[ci] == queryRunes[qi] {
			// Consecutive match bonus.
			if lastMatchIdx == ci-1 {
				consecutive++
				score += consecutive * 8
			} else {
				consecutive = 0
			}

			// Word boundary bonus: match at start of word.
			if ci == 0 {
				score += 20
			} else if isWordBoundaryRune(origRunes[ci-1]) {
				score += 15
			}

			// Bonus for matching uppercase letters (initials).
			if ci < len(origRunes) && origRunes[ci] >= 'A' && origRunes[ci] <= 'Z' {
				score += 5
			}

			lastMatchIdx = ci
			qi++
		}
	}

	if qi < len(queryRunes) {
		return false, 0
	}

	// Base score for a fuzzy match.
	score += 100

	// Penalty for longer candidates (prefer shorter, more specific matches).
	score -= len(candidateRunes) / 4

	return true, score
}

func isWordBoundary(b byte) bool {
	return b == ' ' || b == '/' || b == '\\' || b == '_' || b == '-' || b == '.' || b == ':'
}

func isWordBoundaryRune(r rune) bool {
	return r == ' ' || r == '/' || r == '\\' || r == '_' || r == '-' || r == '.' || r == ':'
}
