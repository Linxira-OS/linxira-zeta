package workspace

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// writePlacesFixture points XDG_CONFIG_HOME at a temp dir holding both files,
// and returns the fake home whose subdirectories the entries refer to.
func writePlacesFixture(t *testing.T, userDirs, bookmarks string) string {
	t.Helper()
	home := t.TempDir()
	cfg := filepath.Join(home, ".config")
	if err := os.MkdirAll(filepath.Join(cfg, "gtk-3.0"), 0755); err != nil {
		t.Fatal(err)
	}
	if userDirs != "" {
		if err := os.WriteFile(filepath.Join(cfg, "user-dirs.dirs"), []byte(userDirs), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if bookmarks != "" {
		if err := os.WriteFile(filepath.Join(cfg, "gtk-3.0", "bookmarks"), []byte(bookmarks), 0644); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("XDG_CONFIG_HOME", cfg)
	t.Setenv("HOME", home)
	return home
}

func names(places []Place) []string {
	out := make([]string, len(places))
	for i, p := range places {
		out[i] = p.Name
	}
	return out
}

func TestPlacesReadsBothSources(t *testing.T) {
	home := writePlacesFixture(t,
		"# comment\nXDG_DOWNLOAD_DIR=\"$HOME/Descargas\"\nXDG_DESKTOP_DIR=\"$HOME/Escritorio\"\n",
		"file:///REPOS repos\nfile:///GONE\n")

	for _, d := range []string{"Descargas", "Escritorio"} {
		if err := os.Mkdir(filepath.Join(home, d), 0755); err != nil {
			t.Fatal(err)
		}
	}
	repos := t.TempDir()
	bookmarks := filepath.Join(home, ".config", "gtk-3.0", "bookmarks")
	if err := os.WriteFile(bookmarks, []byte("file://"+repos+" repos\nfile:///nonexistent-"+t.Name()+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	got := names(Places())
	for _, want := range []string{"Home", "Downloads", "Desktop", "repos"} {
		if !slices.Contains(got, want) {
			t.Errorf("Places() = %v, missing %q", got, want)
		}
	}
	// The localized directory names must not leak through as entry names: the
	// label is ours, only the path comes from the file.
	if slices.Contains(got, "Descargas") {
		t.Errorf("Places() = %v, used the localized directory name", got)
	}
}

// A bookmark whose directory is gone is worse than no bookmark at all.
func TestPlacesSkipsMissingDirectories(t *testing.T) {
	writePlacesFixture(t, "", "file:///definitely/not/here banana\n")
	if got := names(Places()); slices.Contains(got, "banana") {
		t.Errorf("Places() = %v, kept a bookmark that does not exist", got)
	}
}

// GTK marks an unset user directory by pointing it at $HOME; taking that
// literally would list Home several times under different names.
func TestPlacesIgnoresUnsetUserDirs(t *testing.T) {
	writePlacesFixture(t, "XDG_DOWNLOAD_DIR=\"$HOME\"\n", "")
	if got := names(Places()); slices.Contains(got, "Downloads") {
		t.Errorf("Places() = %v, kept a user dir that was unset", got)
	}
}

func TestPlacesDeduplicates(t *testing.T) {
	home := writePlacesFixture(t, "", "")
	bookmarks := filepath.Join(home, ".config", "gtk-3.0", "bookmarks")
	if err := os.WriteFile(bookmarks, []byte("file://"+home+" First\nfile://"+home+" Second\n"), 0644); err != nil {
		t.Fatal(err)
	}
	got := Places()
	seen := map[string]int{}
	for _, p := range got {
		seen[p.Path]++
	}
	if seen[home] != 1 {
		t.Fatalf("Places() = %v, listed %s %d times", names(got), home, seen[home])
	}
}

func TestUnescapeURIPath(t *testing.T) {
	for in, want := range map[string]string{
		"/home/u/My%20Docs": "/home/u/My Docs",
		"/plain/path":       "/plain/path",
		"/100%":             "/100%", // a trailing stray percent costs nothing
		"/bad/%zz/escape":   "/bad/%zz/escape",
	} {
		if got := unescapeURIPath(in); got != want {
			t.Errorf("unescapeURIPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// The XDG directories must come out in a stable, sensible order: they used to be
// collected in a map, so the picker listed them differently on every run.
func TestPlacesOrderIsStable(t *testing.T) {
	home := writePlacesFixture(t, `XDG_DESKTOP_DIR="$HOME/d"
XDG_DOWNLOAD_DIR="$HOME/w"
XDG_DOCUMENTS_DIR="$HOME/o"
`, "")
	for _, d := range []string{"d", "w", "o"} {
		if err := os.Mkdir(filepath.Join(home, d), 0755); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"Home", "Documents", "Downloads", "Desktop"}
	for range 5 {
		if got := names(Places()); !slices.Equal(got, want) {
			t.Fatalf("Places() = %v, want %v", got, want)
		}
	}
}
