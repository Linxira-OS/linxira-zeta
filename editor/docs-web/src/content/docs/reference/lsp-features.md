---
title: LSP Protocol Support
description: Supported Language Server Protocol methods.
sidebar:
  order: 3
---

TTT implements a subset of the Language Server Protocol. The LSP client uses JSON-RPC 2.0 over stdio with Content-Length framing.

## Implemented

| Method | Description |
|--------|-------------|
| `initialize` / `initialized` / `shutdown` / `exit` | Server lifecycle |
| `textDocument/didOpen` | Notify server when a file is opened |
| `textDocument/didChange` | Notify server of file changes (full document sync) |
| `textDocument/didClose` | Notify server when a file is closed |
| `textDocument/didSave` | Save notifications to trigger server re-analysis |
| `textDocument/publishDiagnostics` | Error/warning squiggles, problems panel, hover popup, status bar |
| `textDocument/completion` | Auto-completion with live filtering and debounce |
| `completionItem/resolve` | Additional details and auto-import via `additionalTextEdits` |
| `textDocument/signatureHelp` | Parameter hints on `(` and `,` |
| `textDocument/hover` | Type information and documentation popup |
| `textDocument/definition` | Jump to definition |
| `textDocument/implementation` | Jump to implementation |
| `textDocument/typeDefinition` | Jump to type definition |
| `textDocument/references` | Find all references (results in bottom panel) |
| `textDocument/rename` | Rename symbol across files via workspace edits |
| `textDocument/formatting` | Format entire document |
| `textDocument/rangeFormatting` | Format selected range |
| `textDocument/codeAction` | Source actions (organize imports, fix all) on save and via command palette |

## Not Implemented

### Medium Impact

| Method | Description |
|--------|-------------|
| `textDocument/documentSymbol` | Outline view, go-to-symbol within file |
| `workspace/symbol` | Search symbols across the project |
| `textDocument/documentHighlight` | Highlight other occurrences of symbol under cursor |
| `textDocument/foldingRange` | Code folding |

### Low Impact

| Method | Description |
|--------|-------------|
| `textDocument/selectionRange` | Smart expand/shrink selection |
| `textDocument/codeLens` | Inline actions above functions |
| `textDocument/inlayHint` | Inline type annotations |
| `textDocument/linkedEditingRange` | Linked editing (e.g. rename HTML tag pairs) |
