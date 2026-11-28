// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { base64ToBytes, formatHexDump } from "./preview-hex";
import { buildZetaIdeBlockDef, zetaIdeFileArg } from "./preview-handoff";
import { classifyPreview, isBinaryMimeType, isFileReadOnly, MaxFileSize } from "./preview-type";

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
    return {
        path: "~/repo/file.bin",
        dir: "~/repo",
        name: "file.bin",
        isdir: false,
        ...overrides,
    };
}

describe("preview classification", () => {
    it.each([
        ["image/png", 2048, "streaming"],
        ["application/pdf", 20 * 1024 * 1024, "streaming"],
        ["video/mp4", 2048, "streaming"],
        ["directory", 4096, "directory"],
        ["text/plain", 12, "codeedit"],
        ["application/json", 12, "codeedit"],
        ["text/markdown", 12, "markdown"],
        ["text/mdx", 12, "markdown"],
        ["text/csv", 12, "csv"],
    ])("routes %s to %s", (mimeType, size, expectedView) => {
        expect(classifyPreview(mimeType, size, false)).toEqual({ kind: "view", view: expectedView });
    });

    it("routes every binary payload to the bounded hex view", () => {
        expect(classifyPreview("application/zip", 1024, false)).toEqual({ kind: "view", view: "binary" });
        expect(classifyPreview("application/vnd.microsoft.portable-executable", 1024, false)).toEqual({
            kind: "view",
            view: "binary",
        });
        expect(classifyPreview("application/octet-stream", 1024, false)).toEqual({ kind: "view", view: "binary" });
        expect(classifyPreview("", 1024, false)).toEqual({ kind: "view", view: "binary" });
        expect(classifyPreview(undefined, 1024, false)).toEqual({ kind: "view", view: "binary" });
        expect(classifyPreview("application/x-unknown", undefined, false)).toEqual({
            kind: "view",
            view: "binary",
        });
    });

    it("keeps an empty binary file on the binary route with size zero", () => {
        expect(classifyPreview("application/zip", 0, false)).toEqual({ kind: "view", view: "binary" });
        expect(classifyPreview("", undefined, false)).toEqual({ kind: "view", view: "binary" });
    });

    it("reports oversized binary and text files explicitly", () => {
        expect(classifyPreview("application/zip", MaxFileSize + 1, false)).toEqual({
            kind: "error",
            error: "file-too-large",
        });
        expect(classifyPreview("text/plain", MaxFileSize + 1, false)).toEqual({
            kind: "error",
            error: "file-too-large",
        });
        const twoMegabytes = 2 * 1024 * 1024;
        expect(classifyPreview("text/csv", twoMegabytes, false)).toEqual({
            kind: "error",
            error: "csv-too-large",
        });
    });

    it("does not try to read special files as binaries", () => {
        expect(classifyPreview("pipe", 0, false)).toEqual({ kind: "error", error: "unsupported" });
        expect(classifyPreview("character-special", 0, false)).toEqual({ kind: "error", error: "unsupported" });
    });

    it("switches csv and markdown to the editor in edit mode", () => {
        expect(classifyPreview("text/csv", 12, true)).toEqual({ kind: "view", view: "codeedit" });
        expect(classifyPreview("text/markdown", 12, true)).toEqual({ kind: "view", view: "codeedit" });
    });

    it("treats unknown mimetypes as binary but not text or special files", () => {
        expect(isBinaryMimeType(null)).toBe(true);
        expect(isBinaryMimeType("")).toBe(true);
        expect(isBinaryMimeType("application/zip")).toBe(true);
        expect(isBinaryMimeType("text/plain")).toBe(false);
        expect(isBinaryMimeType("application/pdf")).toBe(false);
        expect(isBinaryMimeType("directory")).toBe(false);
        expect(isBinaryMimeType("pipe")).toBe(false);
    });
});

describe("binary hex preview", () => {
    it("formats offsets, hex bytes, and printable ASCII", () => {
        const bytes = new Uint8Array(17);
        bytes[0] = 0x41;
        bytes[15] = 0x42;
        bytes[16] = 0x43;
        const lines = formatHexDump(bytes).split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0].startsWith("00000000  41 00")).toBe(true);
        expect(lines[0].endsWith("|A..............B|")).toBe(true);
        expect(lines[1].startsWith("00000010  43")).toBe(true);
        expect(lines[1].endsWith("|C|")).toBe(true);
    });

    it("bounds the rendered dump to the requested byte window", () => {
        const dump = formatHexDump(new Uint8Array(64).fill(0x41), 16);
        expect(dump.split("\n")).toHaveLength(1);
        expect(dump).not.toContain("00000010");
    });

    it("decodes base64 into the raw bytes shown by the dump", () => {
        expect(Array.from(base64ToBytes("QUJD"))).toEqual([0x41, 0x42, 0x43]);
        expect(base64ToBytes("").length).toBe(0);
        expect(Array.from(base64ToBytes("QUJDREVGRw==", 3))).toEqual([0x41, 0x42, 0x43]);
    });
});

describe("read-only edit mode", () => {
    it("recognizes read-only files so saves are refused", () => {
        expect(isFileReadOnly({ readonly: true })).toBe(true);
        expect(isFileReadOnly({ readonly: false })).toBe(false);
        expect(isFileReadOnly(null)).toBe(false);
        expect(isFileReadOnly(undefined)).toBe(false);
    });
});

describe("zetaide handoff", () => {
    it("passes the file as a separate shell-quoted arg in the file directory", () => {
        const blockDef = buildZetaIdeBlockDef(
            makeFileInfo({ path: "~/my repo/a b.ts", dir: "~/my repo", name: "a b.ts" })
        );
        expect(blockDef).not.toBeNull();
        expect(blockDef.meta).toMatchObject({
            view: "term",
            controller: "cmd",
            cmd: "zetaide",
            "cmd:args": ["a b.ts"],
            "cmd:shell": false,
            "cmd:cwd": "~/my repo",
        });
        expect(blockDef.meta.cmd).toBe("zetaide");
    });

    it("never interpolates the path into the command string", () => {
        const blockDef = buildZetaIdeBlockDef(
            makeFileInfo({ name: "it's here.txt", path: "~/repo/it's here.txt" })
        );
        expect(blockDef.meta.cmd).toBe("zetaide");
        expect(blockDef.meta["cmd:args"]).toEqual(["it's here.txt"]);
    });

    it("falls back to the basename when FileInfo has no name", () => {
        const fileInfo = makeFileInfo({ name: undefined, path: "/tmp/a b.txt", dir: "/tmp" });
        expect(zetaIdeFileArg(fileInfo)).toBe("a b.txt");
        expect(buildZetaIdeBlockDef(fileInfo).meta["cmd:args"]).toEqual(["a b.txt"]);
    });

    it("does not build a handoff for directories or a missing directory", () => {
        expect(buildZetaIdeBlockDef(makeFileInfo({ isdir: true }))).toBeNull();
        expect(buildZetaIdeBlockDef(makeFileInfo({ dir: undefined }))).toBeNull();
    });
});
