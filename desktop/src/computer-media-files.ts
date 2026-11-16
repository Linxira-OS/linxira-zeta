import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";

export const COMPUTER_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
export const COMPUTER_HASH = /^[a-f0-9]{64}$/u;
export const COMPUTER_MEDIA_UNAVAILABLE = "Computer frame is unavailable, expired, or belongs to a released view.";
export function computerRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
	return value as Record<string, unknown>;
}
export function computerSession(value: unknown): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0")) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
}
/** No pathname-supplied size can make a renderer read allocate above its producer budget. */
export async function readComputerFile(root: string, target: string, maximum: number, valid: () => boolean): Promise<Buffer> {
	if (!valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
	const [base, actual, metadata] = await Promise.all([realpath(root), realpath(target), lstat(target)]);
	const rel = relative(base, actual);
	if (!rel || rel.startsWith("..") || isAbsolute(rel) || !metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
	const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const stat = await file.stat();
		if (!stat.isFile() || stat.size !== metadata.size || stat.ino !== metadata.ino || stat.dev !== metadata.dev || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		const bytes = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < bytes.length) {
			const chunk = await file.read(bytes, offset, bytes.length - offset, offset);
			if (!chunk.bytesRead || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			offset += chunk.bytesRead;
		}
		const final = await file.stat(), current = await realpath(target);
		if (final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || current !== actual || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		return bytes;
	} finally { await file.close(); }
}
export async function readComputerJson(root: string, target: string, maximum: number, valid: () => boolean): Promise<unknown> {
	return JSON.parse((await readComputerFile(root, target, maximum, valid)).toString("utf8"));
}
