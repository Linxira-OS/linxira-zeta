package lsp

import (
	"encoding/json"
	"testing"
)

// --- BoolOrObject ---

func TestBoolOrObjectTrue(t *testing.T) {
	var b BoolOrObject
	if err := json.Unmarshal([]byte(`true`), &b); err != nil {
		t.Fatal(err)
	}
	if b != true {
		t.Fatal("expected true")
	}
}

func TestBoolOrObjectFalse(t *testing.T) {
	var b BoolOrObject
	if err := json.Unmarshal([]byte(`false`), &b); err != nil {
		t.Fatal(err)
	}
	if b != false {
		t.Fatal("expected false")
	}
}

func TestBoolOrObjectEmptyObject(t *testing.T) {
	var b BoolOrObject
	if err := json.Unmarshal([]byte(`{}`), &b); err != nil {
		t.Fatal(err)
	}
	if b != true {
		t.Fatal("expected true for empty object")
	}
}

func TestBoolOrObjectWithFields(t *testing.T) {
	var b BoolOrObject
	if err := json.Unmarshal([]byte(`{"workDoneProgress":true}`), &b); err != nil {
		t.Fatal(err)
	}
	if b != true {
		t.Fatal("expected true for object with fields")
	}
}

func TestBoolOrObjectNumber(t *testing.T) {
	// A number is not a bool, so it falls through to the "treat as object" path
	var b BoolOrObject
	if err := json.Unmarshal([]byte(`1`), &b); err != nil {
		t.Fatal(err)
	}
	if b != true {
		t.Fatal("expected true for non-bool value")
	}
}

func TestBoolOrObjectNull(t *testing.T) {
	var b BoolOrObject
	// null unmarshals into a bool as false without error
	if err := json.Unmarshal([]byte(`null`), &b); err != nil {
		t.Fatal(err)
	}
	if b != false {
		t.Fatal("expected false for null")
	}
}

func TestBoolOrObjectInServerCapabilities(t *testing.T) {
	// Real-world: gopls returns documentFormattingProvider as true
	raw := `{"capabilities":{"documentFormattingProvider":true}}`
	var result InitializeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Capabilities.DocumentFormattingProvider != true {
		t.Fatal("expected documentFormattingProvider true")
	}
}

func TestBoolOrObjectAsObjectInServerCapabilities(t *testing.T) {
	// Real-world: some servers return an options object instead of a bool
	raw := `{"capabilities":{"documentRangeFormattingProvider":{"workDoneProgress":true}}}`
	var result InitializeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Capabilities.DocumentRangeFormattingProvider != true {
		t.Fatal("expected documentRangeFormattingProvider true for object form")
	}
}

// --- TextDocumentSyncOptions ---

func TestTextDocumentSyncOptionsNumber(t *testing.T) {
	var opts TextDocumentSyncOptions
	if err := json.Unmarshal([]byte(`1`), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.Change != 1 {
		t.Fatalf("expected Change 1, got %d", opts.Change)
	}
	if !opts.OpenClose {
		t.Fatal("expected OpenClose true when given a number")
	}
}

func TestTextDocumentSyncOptionsNumberFull(t *testing.T) {
	var opts TextDocumentSyncOptions
	// Full sync = 1
	if err := json.Unmarshal([]byte(`1`), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.Change != 1 {
		t.Fatalf("expected Change 1, got %d", opts.Change)
	}
}

func TestTextDocumentSyncOptionsNumberIncremental(t *testing.T) {
	var opts TextDocumentSyncOptions
	// Incremental sync = 2
	if err := json.Unmarshal([]byte(`2`), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.Change != 2 {
		t.Fatalf("expected Change 2, got %d", opts.Change)
	}
}

func TestTextDocumentSyncOptionsNumberNone(t *testing.T) {
	var opts TextDocumentSyncOptions
	// None = 0
	if err := json.Unmarshal([]byte(`0`), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.Change != 0 {
		t.Fatalf("expected Change 0, got %d", opts.Change)
	}
	if !opts.OpenClose {
		t.Fatal("expected OpenClose true even for sync kind 0")
	}
}

func TestTextDocumentSyncOptionsObject(t *testing.T) {
	raw := `{"openClose":true,"change":2}`
	var opts TextDocumentSyncOptions
	if err := json.Unmarshal([]byte(raw), &opts); err != nil {
		t.Fatal(err)
	}
	if !opts.OpenClose {
		t.Fatal("expected OpenClose true")
	}
	if opts.Change != 2 {
		t.Fatalf("expected Change 2, got %d", opts.Change)
	}
}

func TestTextDocumentSyncOptionsObjectPartial(t *testing.T) {
	// Only change, no openClose
	raw := `{"change":1}`
	var opts TextDocumentSyncOptions
	if err := json.Unmarshal([]byte(raw), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.OpenClose {
		t.Fatal("expected OpenClose false when not specified in object")
	}
	if opts.Change != 1 {
		t.Fatalf("expected Change 1, got %d", opts.Change)
	}
}

func TestTextDocumentSyncOptionsEmptyObject(t *testing.T) {
	var opts TextDocumentSyncOptions
	if err := json.Unmarshal([]byte(`{}`), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.OpenClose {
		t.Fatal("expected OpenClose false for empty object")
	}
	if opts.Change != 0 {
		t.Fatalf("expected Change 0, got %d", opts.Change)
	}
}

func TestTextDocumentSyncOptionsNull(t *testing.T) {
	var opts TextDocumentSyncOptions
	// null should fail the int unmarshal, then fail the object unmarshal
	// json.Unmarshal of null into a struct zeroes it out without error
	if err := json.Unmarshal([]byte(`null`), &opts); err != nil {
		t.Fatal(err)
	}
	if opts.Change != 0 {
		t.Fatalf("expected Change 0 for null, got %d", opts.Change)
	}
}

func TestTextDocumentSyncOptionsInServerCapabilities(t *testing.T) {
	// Real-world: gopls returns textDocumentSync as an object
	raw := `{"capabilities":{"textDocumentSync":{"openClose":true,"change":2}}}`
	var result InitializeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	sync := result.Capabilities.TextDocumentSync
	if sync == nil {
		t.Fatal("expected textDocumentSync to be set")
	}
	if !sync.OpenClose {
		t.Fatal("expected openClose true")
	}
	if sync.Change != 2 {
		t.Fatalf("expected change 2, got %d", sync.Change)
	}
}

func TestTextDocumentSyncOptionsAsNumberInServerCapabilities(t *testing.T) {
	// Real-world: some servers (e.g. pyright, clangd) return textDocumentSync as a number
	raw := `{"capabilities":{"textDocumentSync":1}}`
	var result InitializeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	sync := result.Capabilities.TextDocumentSync
	if sync == nil {
		t.Fatal("expected textDocumentSync to be set")
	}
	if sync.Change != 1 {
		t.Fatalf("expected change 1, got %d", sync.Change)
	}
	if !sync.OpenClose {
		t.Fatal("expected openClose true for numeric form")
	}
}

func TestTextDocumentSyncOptionsInvalidType(t *testing.T) {
	var opts TextDocumentSyncOptions
	err := json.Unmarshal([]byte(`"full"`), &opts)
	if err == nil {
		t.Fatal("expected error for string value")
	}
}

// --- MarkupContent ---

func TestMarkupContentPlainString(t *testing.T) {
	var mc MarkupContent
	if err := json.Unmarshal([]byte(`"func Println(a ...any)"`), &mc); err != nil {
		t.Fatal(err)
	}
	if mc.Kind != "plaintext" {
		t.Fatalf("expected kind plaintext, got %q", mc.Kind)
	}
	if mc.Value != "func Println(a ...any)" {
		t.Fatalf("expected value %q, got %q", "func Println(a ...any)", mc.Value)
	}
}

func TestMarkupContentEmptyString(t *testing.T) {
	var mc MarkupContent
	if err := json.Unmarshal([]byte(`""`), &mc); err != nil {
		t.Fatal(err)
	}
	if mc.Kind != "plaintext" {
		t.Fatalf("expected kind plaintext, got %q", mc.Kind)
	}
	if mc.Value != "" {
		t.Fatalf("expected empty value, got %q", mc.Value)
	}
}

func TestMarkupContentMarkdownObject(t *testing.T) {
	raw := "{\"kind\":\"markdown\",\"value\":\"func Println(a ...any)\"}"
	var mc MarkupContent
	if err := json.Unmarshal([]byte(raw), &mc); err != nil {
		t.Fatal(err)
	}
	if mc.Kind != "markdown" {
		t.Fatalf("expected kind markdown, got %q", mc.Kind)
	}
	if mc.Value != "func Println(a ...any)" {
		t.Fatalf("unexpected value: %q", mc.Value)
	}
}

func TestMarkupContentPlaintextObject(t *testing.T) {
	raw := `{"kind":"plaintext","value":"A simple description"}`
	var mc MarkupContent
	if err := json.Unmarshal([]byte(raw), &mc); err != nil {
		t.Fatal(err)
	}
	if mc.Kind != "plaintext" {
		t.Fatalf("expected kind plaintext, got %q", mc.Kind)
	}
	if mc.Value != "A simple description" {
		t.Fatalf("unexpected value: %q", mc.Value)
	}
}

func TestMarkupContentEmptyObject(t *testing.T) {
	var mc MarkupContent
	if err := json.Unmarshal([]byte(`{}`), &mc); err != nil {
		t.Fatal(err)
	}
	if mc.Kind != "" {
		t.Fatalf("expected empty kind, got %q", mc.Kind)
	}
	if mc.Value != "" {
		t.Fatalf("expected empty value, got %q", mc.Value)
	}
}

func TestMarkupContentNull(t *testing.T) {
	var mc MarkupContent
	// null unmarshals as an empty string successfully, so the string path
	// is taken and Kind is set to "plaintext"
	if err := json.Unmarshal([]byte(`null`), &mc); err != nil {
		t.Fatal(err)
	}
	if mc.Kind != "plaintext" {
		t.Fatalf("expected kind plaintext for null, got %q", mc.Kind)
	}
	if mc.Value != "" {
		t.Fatalf("expected empty value for null, got %q", mc.Value)
	}
}

func TestMarkupContentInvalidType(t *testing.T) {
	var mc MarkupContent
	// An array is neither a string nor a valid MarkupContent object
	err := json.Unmarshal([]byte(`[1, 2, 3]`), &mc)
	if err == nil {
		t.Fatal("expected error for array value")
	}
}

func TestMarkupContentInSignatureHelp(t *testing.T) {
	// Real-world: gopls returns documentation as a MarkupContent object
	raw := `{
		"signatures": [{
			"label": "Println(a ...any) (n int, err error)",
			"documentation": {"kind": "markdown", "value": "Println formats using default formats."},
			"parameters": [{"label": "a ...any"}]
		}],
		"activeSignature": 0,
		"activeParameter": 0
	}`
	var sh SignatureHelp
	if err := json.Unmarshal([]byte(raw), &sh); err != nil {
		t.Fatal(err)
	}
	if len(sh.Signatures) != 1 {
		t.Fatalf("expected 1 signature, got %d", len(sh.Signatures))
	}
	doc := sh.Signatures[0].Documentation
	if doc == nil {
		t.Fatal("expected documentation to be set")
	}
	if doc.Kind != "markdown" {
		t.Fatalf("expected kind markdown, got %q", doc.Kind)
	}
	if doc.Value != "Println formats using default formats." {
		t.Fatalf("unexpected doc value: %q", doc.Value)
	}
}

func TestMarkupContentAsStringInSignatureHelp(t *testing.T) {
	// Real-world: some LSP servers return documentation as a plain string
	raw := `{
		"signatures": [{
			"label": "print(value)",
			"documentation": "Prints a value to stdout",
			"parameters": [{"label": "value"}]
		}],
		"activeSignature": 0,
		"activeParameter": 0
	}`
	var sh SignatureHelp
	if err := json.Unmarshal([]byte(raw), &sh); err != nil {
		t.Fatal(err)
	}
	doc := sh.Signatures[0].Documentation
	if doc == nil {
		t.Fatal("expected documentation to be set")
	}
	if doc.Kind != "plaintext" {
		t.Fatalf("expected kind plaintext, got %q", doc.Kind)
	}
	if doc.Value != "Prints a value to stdout" {
		t.Fatalf("unexpected doc value: %q", doc.Value)
	}
}

func TestMarkupContentInHoverResult(t *testing.T) {
	// Real-world: hover response with markdown content
	raw := "{\"contents\": {\"kind\": \"markdown\", \"value\": \"var x int\"}, " +
		"\"range\": {\"start\": {\"line\": 5, \"character\": 4}, \"end\": {\"line\": 5, \"character\": 5}}}"
	var hover HoverResult
	if err := json.Unmarshal([]byte(raw), &hover); err != nil {
		t.Fatal(err)
	}
	if hover.Contents.Kind != "markdown" {
		t.Fatalf("expected markdown, got %q", hover.Contents.Kind)
	}
	if hover.Range == nil {
		t.Fatal("expected range to be set")
	}
}

func TestMarkupContentAsStringInHoverResult(t *testing.T) {
	// Some servers return hover contents as a plain string
	raw := `{"contents": "int"}`
	var hover HoverResult
	if err := json.Unmarshal([]byte(raw), &hover); err != nil {
		t.Fatal(err)
	}
	if hover.Contents.Kind != "plaintext" {
		t.Fatalf("expected plaintext, got %q", hover.Contents.Kind)
	}
	if hover.Contents.Value != "int" {
		t.Fatalf("expected value %q, got %q", "int", hover.Contents.Value)
	}
}

// --- Full InitializeResult round-trip ---

func TestInitializeResultFullResponse(t *testing.T) {
	// Realistic gopls-style initialize response
	raw := `{
		"capabilities": {
			"textDocumentSync": {"openClose": true, "change": 2},
			"completionProvider": {"triggerCharacters": ["."]},
			"signatureHelpProvider": {"triggerCharacters": ["(", ","], "retriggerCharacters": [")"]},
			"documentFormattingProvider": true,
			"documentRangeFormattingProvider": false
		}
	}`
	var result InitializeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	caps := result.Capabilities

	if caps.TextDocumentSync == nil {
		t.Fatal("expected textDocumentSync")
	}
	if caps.TextDocumentSync.Change != 2 {
		t.Fatalf("expected change 2, got %d", caps.TextDocumentSync.Change)
	}
	if !caps.TextDocumentSync.OpenClose {
		t.Fatal("expected openClose true")
	}
	if caps.CompletionProvider == nil {
		t.Fatal("expected completionProvider")
	}
	if len(caps.CompletionProvider.TriggerCharacters) != 1 || caps.CompletionProvider.TriggerCharacters[0] != "." {
		t.Fatalf("unexpected trigger characters: %v", caps.CompletionProvider.TriggerCharacters)
	}
	if caps.SignatureHelpProvider == nil {
		t.Fatal("expected signatureHelpProvider")
	}
	if caps.DocumentFormattingProvider != true {
		t.Fatal("expected documentFormattingProvider true")
	}
	if caps.DocumentRangeFormattingProvider != false {
		t.Fatal("expected documentRangeFormattingProvider false")
	}
}

func TestCompletionTextEditPlainTextEdit(t *testing.T) {
	raw := `{"label":"slog","textEdit":{"range":{"start":{"line":5,"character":1},"end":{"line":5,"character":4}},"newText":"slog"}}`
	var item CompletionItem
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	if item.TextEdit == nil {
		t.Fatal("expected textEdit")
	}
	r := item.TextEdit.EffectiveRange()
	if r.Start.Character != 1 || r.End.Character != 4 {
		t.Errorf("expected range 1-4, got %d-%d", r.Start.Character, r.End.Character)
	}
	if item.TextEdit.NewText != "slog" {
		t.Errorf("expected newText 'slog', got %q", item.TextEdit.NewText)
	}
}

func TestCompletionTextEditInsertReplaceEdit(t *testing.T) {
	raw := `{"label":"slog","textEdit":{"insert":{"start":{"line":5,"character":1},"end":{"line":5,"character":4}},"replace":{"start":{"line":5,"character":1},"end":{"line":5,"character":4}},"newText":"slog"}}`
	var item CompletionItem
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	if item.TextEdit == nil {
		t.Fatal("expected textEdit")
	}
	r := item.TextEdit.EffectiveRange()
	if r.Start.Character != 1 || r.End.Character != 4 {
		t.Errorf("expected range 1-4, got %d-%d", r.Start.Character, r.End.Character)
	}
	te := item.TextEdit.ToTextEdit()
	if te.Range.Start.Character != 1 || te.Range.End.Character != 4 {
		t.Errorf("ToTextEdit range mismatch: %d-%d", te.Range.Start.Character, te.Range.End.Character)
	}
}

func TestCompletionTextEditInsertReplaceEditDifferentRanges(t *testing.T) {
	raw := `{"label":"Any","textEdit":{"insert":{"start":{"line":5,"character":5},"end":{"line":5,"character":5}},"replace":{"start":{"line":5,"character":5},"end":{"line":5,"character":6}},"newText":"Any"}}`
	var item CompletionItem
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	r := item.TextEdit.EffectiveRange()
	if r.Start.Character != 5 || r.End.Character != 6 {
		t.Errorf("expected replace range 5-6, got %d-%d", r.Start.Character, r.End.Character)
	}
}

func TestInitializeResultMinimalResponse(t *testing.T) {
	// Some servers return very minimal capabilities
	raw := `{"capabilities":{"textDocumentSync":1}}`
	var result InitializeResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Capabilities.TextDocumentSync == nil {
		t.Fatal("expected textDocumentSync")
	}
	if result.Capabilities.TextDocumentSync.Change != 1 {
		t.Fatalf("expected change 1, got %d", result.Capabilities.TextDocumentSync.Change)
	}
}
