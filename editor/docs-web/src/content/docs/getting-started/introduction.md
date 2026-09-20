---
title: Introduction
description: What is TTT and why use it.
sidebar:
  order: 1
---

TTT Editor (Terminal Text Tool) is a fully-featured code editor that runs in your terminal. It is not a simplified terminal editor. It is a real alternative to VS Code, Zed, and Sublime that happens to run in your terminal.

TTT is designed to feel like a GUI desktop app. You get menus, dialogs, right-click context menus, a file explorer, and full mouse support, all inside your terminal.

## Why TTT?

- **Single binary** built with Go, no runtime dependencies
- **Zero config** out of the box, but fully customizable
- **Familiar keybindings** inspired by VS Code
- **Multi-cursor editing** with Ctrl+D, Ctrl+K L, and Alt+Click
- **LSP support** with 23+ built-in language servers for completions, diagnostics with inline squiggles, hover, rename, references, and formatting
- **Integrated terminal** with true color support and multiple tabs
- **Git integration** with staging, committing, pushing, diff view (partial and full-file diffs), blame, and GitHub PR review
- **Multi-folder workspaces** for working across multiple projects
- **Built-in themes** with full JSON customization
- **Code folding** and **bracket pair colorization**
- **Ripgrep-powered search** across your workspace
- **.editorconfig support** for consistent formatting

## Prerequisites

- [Git](https://git-scm.com/) for source control features
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for workspace search
