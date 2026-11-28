// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// "Open in zetaide" block construction.
//
// The file is passed as a separate `cmd:args` entry (with `cmd:shell: false`)
// instead of being concatenated into a command string. The shell controller
// quotes each argument for the target shell, so names with spaces, quotes or
// shell metacharacters never become shell syntax. The block starts in the
// file's directory and opens `zetaide <quoted path>` there.

export const ZetaIdeCommand = "zetaide";

export function zetaIdeFileArg(fileInfo: FileInfo): string | null {
    if (fileInfo == null || fileInfo.isdir) {
        return null;
    }
    const name = fileInfo.name?.trim();
    if (name) {
        return name;
    }
    const path = fileInfo.path?.trim();
    if (!path) {
        return null;
    }
    const parts = path.split(/[\\/]/).filter((part) => part.length > 0 && part !== "~");
    return parts.length > 0 ? parts[parts.length - 1] : null;
}

export function buildZetaIdeBlockDef(fileInfo: FileInfo): BlockDef | null {
    const fileArg = zetaIdeFileArg(fileInfo);
    const cwd = fileInfo?.dir?.trim();
    if (!fileArg || !cwd) {
        return null;
    }
    return {
        meta: {
            view: "term",
            controller: "cmd",
            cmd: ZetaIdeCommand,
            "cmd:args": [fileArg],
            "cmd:shell": false,
            "cmd:cwd": cwd,
        },
    };
}
