/** Workspace file semantics ported from official Studio v0.2.1; Zeta owns inventory and authorization. */
import { constants, type Stats } from "node:fs";
import { access, lstat, open, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
	FileEncoding,
	WorkspaceFileTarget,
	WorkspaceFileInfo,
	WorkspaceFileWrite,
	WorkspaceFileSaveResult,
	WorkspaceFileText,
	WorkspaceFileChunkInput,
	WorkspaceFileChunk,
} from "../studio-host/contract/files.js";

export const FILE_CHUNK_BYTES = 512 * 1024;
export const EDITABLE_FILE_BYTES = 8 * 1024 * 1024;
const MIME: Readonly<Record<string, string>> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	avif: "image/avif",
	svg: "image/svg+xml",
	mp4: "video/mp4",
	m4v: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	ogv: "video/ogg",
	mkv: "video/x-matroska",
	avi: "video/x-msvideo",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	opus: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/mp4",
	aac: "audio/aac",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	rtf: "application/rtf",
	odt: "application/vnd.oasis.opendocument.text",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	odp: "application/vnd.oasis.opendocument.presentation",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	csv: "text/csv",
	md: "text/markdown",
	html: "text/html",
	htm: "text/html",
};
const versionOf = (info: Stats): string => `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;

export function createWorkspaceFileService(resolveWorkspace: (id: string) => Promise<string>) {
	async function targetFor(input: WorkspaceFileTarget): Promise<{ target: string; path: string }> {
		if (
			!input ||
			typeof input.workspaceId !== "string" ||
			!input.workspaceId ||
			typeof input.path !== "string" ||
			!input.path ||
			input.path.includes("\0")
		)
			throw new Error("workspaceId and path must name a workspace file");
		const root = await realpath(await resolveWorkspace(input.workspaceId));
		let requested = input.path;
		if (/^file:/i.test(requested)) requested = fileURLToPath(requested);
		if (process.platform === "win32" && /^\/[A-Za-z]:[\\/]/.test(requested)) requested = requested.slice(1);
		const target = await realpath(isAbsolute(requested) ? requested : resolve(root, requested));
		const escaped = relative(root, target);
		if (isAbsolute(escaped) || escaped === ".." || escaped.startsWith(`..${sep}`))
			throw new Error("文件不在当前工作区内");
		if (!(await lstat(target)).isFile()) throw new Error("此路径不是文件");
		return { target, path: escaped.split(sep).join("/") };
	}
	async function inspect(input: WorkspaceFileTarget): Promise<WorkspaceFileInfo> {
		const { target, path } = await targetFor(input);
		const info = await lstat(target);
		const writable = await access(target, constants.W_OK).then(
			() => true,
			() => false,
		);
		const identity = process.platform === "win32" ? target.toLowerCase() : target;
		return {
			workspaceId: input.workspaceId,
			path,
			id: createHash("sha256").update(identity).digest("hex"),
			name: basename(target),
			mime: MIME[extname(target).slice(1).toLowerCase()] ?? "text/plain",
			size: info.size,
			version: versionOf(info),
			writable,
		};
	}
	const writes = new Map<string, Promise<unknown>>();
	async function writeText(input: WorkspaceFileWrite): Promise<WorkspaceFileSaveResult> {
		if (
			typeof input.text !== "string" ||
			typeof input.expectedVersion !== "string" ||
			!["utf8", "utf16le", "utf16be"].includes(input.encoding) ||
			typeof input.bom !== "boolean" ||
			(input.lineEnding !== "lf" && input.lineEnding !== "crlf")
		)
			throw new Error("Invalid text file write");
		const { target } = await targetFor(input);
		const previous = writes.get(target) ?? Promise.resolve();
		const operation = previous
			.catch(() => {})
			.then(async (): Promise<WorkspaceFileSaveResult> => {
				const file = await inspect(input);
				if (file.version !== input.expectedVersion) return { saved: false, conflict: true, file };
				if (file.size > EDITABLE_FILE_BYTES)
					throw new Error("文件超过内置编辑器的 8 MiB 编辑范围，请使用外部编辑器");
				const text = input.text.replace(/\r\n/g, "\n").replace(/\n/g, input.lineEnding === "crlf" ? "\r\n" : "\n");
				let bytes = Buffer.from(text, input.encoding === "utf8" ? "utf8" : "utf16le");
				if (input.encoding === "utf16be") bytes.swap16();
				if (input.bom)
					bytes = Buffer.concat([
						Buffer.from(
							input.encoding === "utf8"
								? [239, 187, 191]
								: input.encoding === "utf16le"
									? [255, 254]
									: [254, 255],
						),
						bytes,
					]);
				if (bytes.length > EDITABLE_FILE_BYTES) throw new Error("保存内容超过 8 MiB，请使用外部编辑器");
				const temporary = resolve(dirname(target), `.zeta-save-${randomUUID()}`);
				try {
					const mode = (await lstat(target)).mode;
					await writeFile(temporary, bytes, { flag: "wx", mode });
					const current = await inspect(input);
					if (current.version !== input.expectedVersion) return { saved: false, conflict: true, file: current };
					await rename(temporary, target);
					return { saved: true, file: await inspect(input) };
				} finally {
					await unlink(temporary).catch(error => {
						if (error.code !== "ENOENT") throw error;
					});
				}
			});
		writes.set(target, operation);
		try {
			return await operation;
		} finally {
			if (writes.get(target) === operation) writes.delete(target);
		}
	}
	async function readText(input: WorkspaceFileTarget): Promise<WorkspaceFileText> {
		const { target } = await targetFor(input);
		const handle = await open(target, "r");
		try {
			const before = await handle.stat();
			if (before.size > EDITABLE_FILE_BYTES)
				throw new Error("文件超过内置编辑器的 8 MiB 编辑范围，请下载或使用外部编辑器");
			const bytes = await handle.readFile();
			if (bytes.length > EDITABLE_FILE_BYTES)
				throw new Error("文件超过内置编辑器的 8 MiB 编辑范围，请下载或使用外部编辑器");
			const encoding: FileEncoding =
				bytes[0] === 255 && bytes[1] === 254
					? "utf16le"
					: bytes[0] === 254 && bytes[1] === 255
						? "utf16be"
						: "utf8";
			const bom = encoding !== "utf8" || (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191);
			const body = bytes.subarray(bom ? (encoding === "utf8" ? 3 : 2) : 0);
			if (encoding === "utf8" && body.includes(0)) throw new Error("此文件为二进制，无法作为文本编辑");
			let text: string;
			try {
				text = new TextDecoder(encoding === "utf8" ? "utf-8" : encoding === "utf16le" ? "utf-16le" : "utf-16be", {
					fatal: true,
				}).decode(body);
			} catch {
				throw new Error("当前支持 UTF-8 和带 BOM 的 UTF-16 文本；请使用外部编辑器转换编码");
			}
			const file = await inspect(input);
			if (file.version !== versionOf(before)) throw new Error("文件在读取时发生变化，请重新加载");
			return {
				file,
				text: text.replace(/\r\n/g, "\n"),
				encoding,
				bom,
				lineEnding: text.includes("\r\n") ? "crlf" : "lf",
			};
		} finally {
			await handle.close();
		}
	}
	async function readChunk(input: WorkspaceFileChunkInput): Promise<WorkspaceFileChunk> {
		if (
			typeof input.version !== "string" ||
			!Number.isSafeInteger(input.offset) ||
			input.offset < 0 ||
			!Number.isSafeInteger(input.length) ||
			input.length < 1 ||
			input.length > FILE_CHUNK_BYTES
		)
			throw new Error("Invalid file range");
		const { target } = await targetFor(input);
		const handle = await open(target, "r");
		try {
			const info = await handle.stat();
			if (versionOf(info) !== input.version) throw new Error("文件已经变化，请重新加载");
			const buffer = Buffer.alloc(Math.min(input.length, Math.max(0, info.size - input.offset)));
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, input.offset);
			if (versionOf(await handle.stat()) !== input.version) throw new Error("文件在读取时发生变化，请重新加载");
			return { data: buffer.subarray(0, bytesRead).toString("base64"), bytes: bytesRead };
		} finally {
			await handle.close();
		}
	}
	return { inspect, readText, readChunk, writeText };
}
