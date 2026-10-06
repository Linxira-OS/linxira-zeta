package lsp

import (
	"net/url"
	"path/filepath"
	"strings"
)

// FileURI builds the file:// URI a language server is handed for a path.
//
// Concatenating the path onto the scheme is not enough. A relative path turns
// its first segment into the authority — "docs/a.md" becomes "file://docs/a.md",
// where "docs" is the hostname — and a path containing a space is not a valid
// URI at all. Servers that parse URIs strictly reject both; marksman crashes
// outright on the first, taking the server down for the rest of the session.
//
// Windows paths need the same care: backslashes are not URI path characters
// and the drive letter would end up in the authority — "file://C:%5C..." —
// which every server rejects. Convert to forward slashes and tuck the drive
// into the path segment: "file:///C:/Users/u/note.md".
func FileURI(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	} else if !strings.HasPrefix(path, "/") {
		// Abs only fails when the working directory is gone. Leading slash or not
		// is what decides whether the first segment is read as a hostname, so it
		// is the one thing worth forcing even then.
		path = "/" + path
	}
	unix := filepath.ToSlash(path)
	if !strings.HasPrefix(unix, "/") {
		unix = "/" + unix
	}
	return (&url.URL{Scheme: "file", Path: unix}).String()
}

// URIToPath is the inverse, undoing the escaping FileURI applies and handing
// back a path in the operating system's own form.
func URIToPath(uri string) string {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "file" {
		return filepath.FromSlash(strings.TrimPrefix(uri, "file://"))
	}
	// file:///C:/... keeps the drive inside the path with a placeholder slash;
	// drop it so the result compares equal to the app's native paths.
	if len(u.Path) > 2 && u.Path[0] == '/' && u.Path[2] == ':' && isDriveLetter(u.Path[1]) {
		u.Path = u.Path[1:]
	}
	return filepath.FromSlash(u.Path)
}

func isDriveLetter(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
}
