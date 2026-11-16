import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clipboard, ClipboardItem, dialog, ipcMain, nativeImage, type WebContents } from "electron";

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
export interface ImageInput { mime: ImageMime; bytes: Uint8Array; suggestedName?: string }
export interface AvatarBytes { mime: "image/png"; bytes: Uint8Array }
export type ImageResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; message: string };

const EXTENSION: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
export function imageInput(value: unknown, avatar = false): ImageInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid image input");
	const input = value as Record<string, unknown>;
	if (typeof input.mime !== "string" || !Object.hasOwn(EXTENSION, input.mime) || avatar && !["image/png", "image/jpeg", "image/webp"].includes(input.mime)) throw new Error("Invalid image type");
	const bytes = input.bytes instanceof Uint8Array ? input.bytes : input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : ArrayBuffer.isView(input.bytes) ? new Uint8Array(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength) : undefined;
	if (!bytes || bytes.byteLength < 12 || bytes.byteLength > (avatar ? 200_000 : 64 * 1024 * 1024)) throw new Error("Invalid image bytes");
	const magic = input.mime === "image/png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
		: input.mime === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
		: input.mime === "image/gif" ? String.fromCharCode(...bytes.subarray(0, 6)) === "GIF87a" || String.fromCharCode(...bytes.subarray(0, 6)) === "GIF89a"
		: input.mime === "image/webp" ? String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
		: bytes[0] === 0x3c || bytes[0] === 0x1f && bytes[1] === 0x8b;
	if (!magic) throw new Error("Image encoding does not match its type");
	return { mime: input.mime as ImageMime, bytes, ...(typeof input.suggestedName === "string" ? { suggestedName: input.suggestedName } : {}) };
}

/** Native chrome actions stay independent of Runtime auth and filesystem paths stay in Main. */
export function registerChromeMedia(options: { root: string; trusted(sender: WebContents): boolean }): void {
	let writes: Promise<unknown> = Promise.resolve();
	const avatar = join(options.root, "profile", "avatar.png");
	const register = (name: string, action: (value: unknown) => unknown) => ipcMain.handle(`pi:${name}`, ({ sender, senderFrame }, value: unknown) => {
		if (sender.isDestroyed() || senderFrame !== sender.mainFrame || !options.trusted(sender)) throw new Error("Untrusted image request");
		return action(value);
	});
	register("image-copy", async (value): Promise<ImageResult> => {
		try {
			const input = imageInput(value), image = nativeImage.createFromBuffer(Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength));
			if (image.isEmpty()) return { ok: false, message: "The native clipboard cannot decode this image" };
			await clipboard.write([new ClipboardItem({ "image/png": new Blob([Uint8Array.from(image.toPNG())], { type: "image/png" }) })]);
			return { ok: true };
		} catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Image copy failed" }; }
	});
	register("image-save", async (value): Promise<ImageResult> => {
		try {
			const input = imageInput(value), extension = EXTENSION[input.mime];
			const name = (input.suggestedName ?? "image").replaceAll("\\", "/").split("/").pop()!.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "image";
			const picked = await dialog.showSaveDialog({ defaultPath: `${name}.${extension}`, filters: [{ name: "Image", extensions: [extension] }] });
			if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
			await writeFile(picked.filePath, input.bytes);
			return { ok: true };
		} catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Image save failed" }; }
	});
	register("avatar-save", (value): Promise<ImageResult> => {
		const input = imageInput(value, true), decoded = nativeImage.createFromBuffer(Buffer.from(input.bytes));
		if (decoded.isEmpty()) return Promise.resolve({ ok: false, message: "Avatar cannot be decoded" });
		const size = decoded.getSize();
		const bytes = size.width > 512 || size.height > 512 ? decoded.resize(size.width >= size.height ? { width: 512 } : { height: 512 }).toPNG() : decoded.toPNG();
		const operation = writes.catch(() => {}).then(async (): Promise<ImageResult> => {
			await mkdir(join(options.root, "profile"), { recursive: true });
			const temporary = `${avatar}.${randomUUID()}.tmp`;
			try { await writeFile(temporary, bytes); await rename(temporary, avatar); }
			finally { await unlink(temporary).catch(() => {}); }
			return { ok: true };
		});
		writes = operation;
		return operation;
	});
	register("avatar-load", async (): Promise<AvatarBytes | null> => {
		await writes.catch(() => {});
		try { return { mime: "image/png", bytes: new Uint8Array(await readFile(avatar)) }; }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
	});
	register("avatar-clear", () => {
		const operation = writes.catch(() => {}).then(() => unlink(avatar).catch(error => { if (error.code !== "ENOENT") throw error; }));
		writes = operation;
		return operation;
	});
}
