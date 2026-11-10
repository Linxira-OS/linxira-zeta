/**
 * Inbound attachment storage.
 *
 * Platforms hand out media either inline (OneBot base64) or as an expiring
 * signed URL (Discord's CDN). The agent needs a real file path, and a URL that
 * dies in 24 hours is not one. Downloads therefore stream to disk with a hard
 * size cap — never `arrayBuffer()` of an untrusted size — and a failure is
 * reported on the message instead of dropping the text.
 */

import { mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import type { AttachmentKind, InboundAttachment } from "./channel";

/** `dsh-channel-qq` measured 30 MB rejecting a 38 MB skill pack; 100 MB is the compromise. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
/** More than three files per message turns a chat message into a batch job. */
export const DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const DEFAULT_ATTACHMENT_TIMEOUT_MS = 120_000;

export interface AttachmentSource {
	url?: string;
	/** Base64 payload (OneBot `base64://` / inline images). */
	base64?: string;
	name?: string;
	mime?: string;
	kind?: AttachmentKind;
}

export interface AttachmentStoreOptions {
	/** Inbox directory; the adapter creates a per-message subdirectory. */
	dir: string;
	/** Dedupe-safe subdirectory name (platform message id or a random id). */
	messageKey: string;
	maxBytes?: number;
	maxPerMessage?: number;
	timeoutMs?: number;
	fetch?: typeof globalThis.fetch;
}

function sanitizeName(name: string | undefined, index: number, kind: AttachmentKind): string {
	const raw = (name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
	const trimmed = raw.length > 80 ? raw.slice(raw.length - 80) : raw;
	if (trimmed !== "" && trimmed !== "." && trimmed !== "..") return trimmed;
	const ext = kind === "image" ? "png" : kind === "audio" ? "ogg" : kind === "video" ? "mp4" : "bin";
	return `attachment-${index}.${ext}`;
}

function kindFor(
	mime: string | undefined,
	name: string | undefined,
	fallback: AttachmentKind | undefined,
): AttachmentKind {
	if (fallback) return fallback;
	if (mime?.startsWith("image/")) return "image";
	if (mime?.startsWith("audio/")) return "audio";
	if (mime?.startsWith("video/")) return "video";
	const ext = name?.slice(name.lastIndexOf(".") + 1).toLowerCase();
	if (ext && ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
	if (ext && ["mp3", "ogg", "wav", "silk", "amr", "m4a"].includes(ext)) return "audio";
	if (ext && ["mp4", "mov", "webm"].includes(ext)) return "video";
	return "file";
}

async function writeStream(response: Response, target: string, maxBytes: number): Promise<number> {
	const body = response.body;
	if (!body) {
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.byteLength > maxBytes) throw new Error(`attachment exceeds ${maxBytes} bytes`);
		await Bun.write(target, buffer);
		return buffer.byteLength;
	}
	const sink = Bun.file(target).writer();
	const reader = body.getReader();
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new Error(`attachment exceeds ${maxBytes} bytes`);
			}
			sink.write(value);
		}
	} finally {
		await sink.end();
	}
	return total;
}

/** Store up to `maxPerMessage` attachments; failures become URL-only entries. */
export async function storeAttachments(
	sources: readonly AttachmentSource[],
	options: AttachmentStoreOptions,
): Promise<InboundAttachment[]> {
	const maxPerMessage = options.maxPerMessage ?? DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
	const timeoutMs = options.timeoutMs ?? DEFAULT_ATTACHMENT_TIMEOUT_MS;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const selected = sources.slice(0, Math.max(0, maxPerMessage));
	if (selected.length === 0) return [];

	const directory = path.join(options.dir, sanitizeName(options.messageKey, 0, "file"));
	await mkdir(directory, { recursive: true });

	const stored: InboundAttachment[] = [];
	for (const [index, source] of selected.entries()) {
		const kind = kindFor(source.mime, source.name, source.kind);
		const name = sanitizeName(source.name, index, kind);
		const target = path.join(directory, `${index}-${name}`);
		const base: InboundAttachment = { kind, name, ...(source.mime ? { mime: source.mime } : {}) };
		try {
			if (source.base64) {
				const bytes = new Uint8Array(Buffer.from(source.base64, "base64"));
				if (bytes.byteLength > maxBytes) throw new Error(`attachment exceeds ${maxBytes} bytes`);
				await Bun.write(target, bytes);
				stored.push({ ...base, path: target, size: bytes.byteLength });
				continue;
			}
			if (!source.url) throw new Error("attachment has no download source");
			const response = await fetchImpl(source.url, {
				signal: AbortSignal.timeout(timeoutMs),
				redirect: "follow",
			});
			if (!response.ok) throw new Error(`attachment download failed (HTTP ${response.status})`);
			const declared = Number(response.headers.get("content-length") ?? "");
			if (Number.isFinite(declared) && declared > maxBytes) {
				await response.body?.cancel().catch(() => {});
				throw new Error(`attachment exceeds ${maxBytes} bytes`);
			}
			const size = await writeStream(response, target, maxBytes);
			stored.push({ ...base, path: target, size });
		} catch (error) {
			await rm(target, { force: true }).catch(() => {});
			stored.push({
				...base,
				...(source.url ? { url: source.url } : {}),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return stored;
}
