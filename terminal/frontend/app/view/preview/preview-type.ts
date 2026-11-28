// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure preview classification. Kept free of React/atoms so the viewer matrix
// can be tested directly and so the route decisions live in one place.

export const MaxFileSize = 1024 * 1024 * 10; // 10MB
export const MaxCSVSize = 1024 * 1024 * 1; // 1MB
export const MaxBinaryPreviewBytes = 1024 * 4; // 4KB, the bounded hex preview window

const textApplicationMimetypes = [
    "application/sql",
    "application/x-php",
    "application/x-pem-file",
    "application/x-httpd-php",
    "application/liquid",
    "application/graphql",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/x-typescript",
    "application/dart",
    "application/vnd.dart",
    "application/x-ruby",
    "application/sql",
    "application/wasm",
    "application/x-latex",
    "application/x-sh",
    "application/x-python",
    "application/x-awk",
];

const specialFileMimetypes: Record<string, true> = {
    pipe: true,
    "character-special": true,
    "block-special": true,
};

export type PreviewSpecializedView = "streaming" | "binary" | "codeedit" | "csv" | "markdown" | "directory";
export type PreviewClassificationError = "file-too-large" | "csv-too-large" | "unsupported";
export type PreviewClassification =
    | { kind: "view"; view: PreviewSpecializedView }
    | { kind: "error"; error: PreviewClassificationError };

export function isTextFile(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("text/") ||
        textApplicationMimetypes.includes(mimeType) ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType.includes("xml")
    );
}

export function isStreamingType(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    );
}

export function isMarkdownLike(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx");
}

export function isCsvMimeType(mimeType: string): boolean {
    return mimeType != null && mimeType.startsWith("text/csv");
}

export function isSpecialFileMime(mimeType: string): boolean {
    return mimeType != null && specialFileMimetypes[mimeType] === true;
}

/**
 * Any non-text, non-streaming, non-directory payload gets the bounded hex view.
 * An empty mimetype is a detection failure (the backend deliberately returns ""
 * instead of application/octet-stream), which is binary as far as previewing goes.
 */
export function isBinaryMimeType(mimeType: string | null | undefined): boolean {
    if (mimeType == null || mimeType === "") {
        return true;
    }
    if (mimeType === "directory") {
        return false;
    }
    return (
        !isTextFile(mimeType) &&
        !isStreamingType(mimeType) &&
        !isMarkdownLike(mimeType) &&
        !isSpecialFileMime(mimeType)
    );
}

export function isFileReadOnly(fileInfo: { readonly?: boolean } | null | undefined): boolean {
    return fileInfo?.readonly === true;
}

function view(viewName: PreviewSpecializedView): PreviewClassification {
    return { kind: "view", view: viewName };
}

function error(errorName: PreviewClassificationError): PreviewClassification {
    return { kind: "error", error: errorName };
}

export function classifyPreview(
    mimeTypeInput: string | null | undefined,
    sizeInput: number | null | undefined,
    editMode: boolean,
): PreviewClassification {
    const mimeType = mimeTypeInput ?? "";
    const size = typeof sizeInput === "number" && Number.isFinite(sizeInput) ? sizeInput : 0;
    if (mimeType === "directory") {
        return view("directory");
    }
    if (isSpecialFileMime(mimeType)) {
        return error("unsupported");
    }
    if (isStreamingType(mimeType)) {
        return view("streaming");
    }
    if (size > MaxFileSize) {
        return error("file-too-large");
    }
    if (isCsvMimeType(mimeType)) {
        if (size > MaxCSVSize) {
            return error("csv-too-large");
        }
        return view(editMode ? "codeedit" : "csv");
    }
    if (isMarkdownLike(mimeType)) {
        return view(editMode ? "codeedit" : "markdown");
    }
    if (isTextFile(mimeType)) {
        return view("codeedit");
    }
    return view("binary");
}
