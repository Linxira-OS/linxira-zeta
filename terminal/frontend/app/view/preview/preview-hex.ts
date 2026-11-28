// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MaxBinaryPreviewBytes } from "./preview-type";

export const HexBytesPerRow = 16;

export function base64ToBytes(data64: string | null | undefined, maxBytes = MaxBinaryPreviewBytes): Uint8Array {
    if (!data64) {
        return new Uint8Array(0);
    }
    const maxBase64Chars = Math.ceil(maxBytes / 3) * 4;
    const encoded = data64.length > maxBase64Chars ? data64.slice(0, maxBase64Chars) : data64;
    const binary = atob(encoded);
    const bytes = new Uint8Array(Math.min(binary.length, maxBytes));
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function formatHexDump(bytes: Uint8Array, maxBytes = MaxBinaryPreviewBytes): string {
    const limit = Math.min(bytes.length, maxBytes);
    const lines: string[] = [];
    for (let offset = 0; offset < limit; offset += HexBytesPerRow) {
        const chunk = bytes.subarray(offset, Math.min(offset + HexBytesPerRow, limit));
        const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, "0"))
            .join(" ")
            .padEnd(HexBytesPerRow * 3 - 1, " ");
        const ascii = Array.from(chunk, (byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join(
            "",
        );
        lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
    }
    return lines.join("\n");
}
