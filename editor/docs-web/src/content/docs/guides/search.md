---
title: Search
description: Searching across files with ripgrep.
---

## Workspace Search

The sidebar search panel (**Ctrl+K F**) is powered by [ripgrep](https://github.com/BurntSushi/ripgrep). Results are grouped by file with match counts.

- **Smart-case** matching by default
- **Include/Exclude glob filters**: click the toggle arrow to reveal filter inputs (e.g. `*.go`, `vendor/**`)
- Tab between search, include, and exclude inputs
- Searches across all workspace folders simultaneously
- Click a result to jump to the file and line
- Search debounce is configurable (default 350ms, setting: `search.debounce`)

### Search and Replace Across Files

Use **Ctrl+K R** to open the sidebar search and replace panel. This lets you find and replace text across all files in the workspace.

## Find in File

- **Ctrl+F** opens the inline find bar
- **Ctrl+R** opens find and replace
- **F3 / Shift+F3** to jump to next/previous match
- **Alt+C** toggles case sensitivity
- **Alt+R** / **Alt+X** toggles regex matching
- Replace-one and replace-all support
