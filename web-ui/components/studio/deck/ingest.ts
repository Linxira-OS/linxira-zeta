/**
 * Image ingestion for deck answer fields.
 *
 * Ported from OMP Studio (MIT) `composer/ingest.ts` — only the two functions the
 * deck needs. The composer keeps its own copy: the deck must not depend on the
 * composer module, which owns chip state and its own pickers.
 */

import type { AskImage } from "@/lib/studio-protocol/protocol";

const IMAGE_MIME: Record<string, true> = {
	"image/png": true,
	"image/jpeg": true,
	"image/gif": true,
	"image/webp": true,
	"image/svg+xml": true,
};

export function isImageMimeType(mime: string): boolean {
	return IMAGE_MIME[mime] === true;
}

function mimeFromFile(file: File): AskImage["mimeType"] | null {
	if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/gif" || file.type === "image/webp") {
		return file.type;
	}
	const lower = file.name.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	return null;
}

/** `File` → the protocol's base64 image payload. `null` for a non-image or an SVG. */
export async function fileToPromptImage(file: File): Promise<AskImage | null> {
	const mimeType = mimeFromFile(file);
	if (mimeType === null) return null;
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return { type: "image", mimeType, data: btoa(binary) };
}

export function imagePreviewUrl(image: AskImage): string {
	return `data:${image.mimeType};base64,${image.data}`;
}
