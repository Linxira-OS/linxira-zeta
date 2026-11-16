import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PrivateIpcMain, PrivateSender } from "./private-ipc";
import { COMPUTER_FRAME_CHANNELS, type ComputerFrameReadResult, type ComputerViewResult } from "./computer-frames-shared";
import { DesktopComputerViews, type ComputerViewGuard } from "./computer-views";
import { COMPUTER_HASH, COMPUTER_UUID, COMPUTER_MEDIA_UNAVAILABLE, computerRecord, computerSession, readComputerFile, readComputerJson } from "./computer-media-files";

const FRAME_BYTES = 16 * 1024 * 1024;
const READ_BUDGET = 64 * 1024 * 1024;
interface FrameMetadata { frameId: string; sessionId: string; source: "execution" | "observation"; width: number; height: number; capturedAt: number; expiresAt: number; availability: "available" }
function frameMetadata(value: unknown): FrameMetadata {
	const row = computerRecord(value, ["frameId", "sessionId", "source", "capturedAt", "targetId", "targetName", "runId", "actionId", "toolCallId", "agentId", "width", "height", "coordinateWidth", "coordinateHeight", "sourceWidth", "sourceHeight", "region", "screenLocked", "delivered", "availability", "expiresAt", "artifactId"]);
	computerSession(row.sessionId);
	if (typeof row.frameId !== "string" || !COMPUTER_UUID.test(row.frameId) || !["execution", "observation"].includes(String(row.source)) || row.availability !== "available" || typeof row.width !== "number" || typeof row.height !== "number" || !Number.isSafeInteger(row.width) || !Number.isSafeInteger(row.height) || row.width < 1 || row.height < 1 || row.width * row.height > 4_000_000 || typeof row.capturedAt !== "number" || !Number.isSafeInteger(row.capturedAt) || row.capturedAt < 0 || row.capturedAt > Date.now() + 5000 || typeof row.expiresAt !== "number" || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= Date.now() || row.expiresAt > row.capturedAt + (row.source === "observation" ? 125_000 : 30 * 24 * 60 * 60 * 1000)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
	return row as unknown as FrameMetadata;
}
/** Reads copies registered by the owning Host. It never opens native screenshot paths or promotes artifacts. */
export class ComputerFrameStore {
	#readingBytes = 0;
	readonly #claims = new Set<string>();
	#disposed = false;
	constructor(readonly views: DesktopComputerViews) {}
	async read(sender: PrivateSender, raw: unknown): Promise<ComputerFrameReadResult> {
		const request = computerRecord(raw, ["scopeSessionId", "leaseId", "frameId", "origin"]);
		computerSession(request.scopeSessionId);
		if (request.origin !== "local" || typeof request.leaseId !== "string" || !COMPUTER_UUID.test(request.leaseId) || typeof request.frameId !== "string" || !COMPUTER_UUID.test(request.frameId)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		const guard = await this.views.guard(sender, request.scopeSessionId, request.leaseId);
		return this.readFrame(guard, request.frameId);
	}
	async readFrame(guard: ComputerViewGuard, frameId: string): Promise<ComputerFrameReadResult> {
		const key = guard.senderId + ":" + frameId;
		if (this.#disposed || this.#claims.has(key) || this.#claims.size >= 4) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		this.#claims.add(key);
		try { return await this.#readFrame(guard, frameId); }
		finally { this.#claims.delete(key); }
	}
	async #readFrame(guard: ComputerViewGuard, frameId: string): Promise<ComputerFrameReadResult> {
		if (!COMPUTER_UUID.test(frameId)) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		const valid = () => !this.#disposed && guard.valid();
		const scope = createHash("sha256").update(guard.scopeSessionId).digest("hex");
		const descriptorFile = join(guard.directory, "computer-workspace", scope, frameId + ".json");
		const descriptor = computerRecord(await readComputerJson(guard.directory, descriptorFile, 32 * 1024, valid), ["version", "scopeSessionId", "frame", "bytes", "sha256", "leaseId", "runFinished"]);
		const frame = frameMetadata(descriptor.frame);
		if (descriptor.version !== 1 || descriptor.scopeSessionId !== guard.scopeSessionId || frame.frameId !== frameId || typeof descriptor.bytes !== "number" || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 33 || descriptor.bytes > FRAME_BYTES || typeof descriptor.sha256 !== "string" || !COMPUTER_HASH.test(descriptor.sha256) || (frame.source === "observation" && descriptor.leaseId !== guard.leaseId) || this.#readingBytes + descriptor.bytes > READ_BUDGET) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
		this.#readingBytes += descriptor.bytes;
		try {
			const file = join(guard.directory, "outputs", createHash("sha256").update(frame.sessionId).digest("hex"), frameId + ".bin");
			const bytes = await readComputerFile(guard.directory, file, descriptor.bytes, valid);
			if (bytes.byteLength !== descriptor.bytes || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== frame.width || bytes.readUInt32BE(20) !== frame.height || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			await guard.confirm();
			const current = computerRecord(await readComputerJson(guard.directory, descriptorFile, 32 * 1024, valid), ["version", "scopeSessionId", "frame", "bytes", "sha256", "leaseId", "runFinished"]);
			const currentFrame = frameMetadata(current.frame);
			if (current.version !== 1 || current.scopeSessionId !== guard.scopeSessionId || current.sha256 !== descriptor.sha256 || current.bytes !== descriptor.bytes || current.leaseId !== descriptor.leaseId || currentFrame.frameId !== frameId || currentFrame.sessionId !== frame.sessionId || currentFrame.source !== frame.source || currentFrame.width !== frame.width || currentFrame.height !== frame.height || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			return { ok: true, data: bytes.buffer as ArrayBuffer, width: frame.width, height: frame.height, mimeType: "image/png" };
		} finally { this.#readingBytes -= descriptor.bytes; }
	}
	dispose(): void { this.#disposed = true; }
}
export function registerComputerFrameIpc(options: { ipcMain: PrivateIpcMain; store: ComputerFrameStore; views: DesktopComputerViews; isTrustedSender(sender: PrivateSender): boolean; isVisible(sender: PrivateSender): boolean }): { dispose(): void } {
	let disposed = false;
	const owners = new Map<number, () => void>();
	const allowed = (sender: PrivateSender, senderFrame: unknown) => !disposed && senderFrame === sender.mainFrame && !sender.isDestroyed() && options.isTrustedSender(sender) && options.isVisible(sender);
	for (const kind of ["adopt", "release", "read"] as const) options.ipcMain.handle(COMPUTER_FRAME_CHANNELS[kind], async ({ sender, senderFrame }, raw): Promise<ComputerFrameReadResult | ComputerViewResult> => {
		if (!allowed(sender, senderFrame)) { options.views.releaseWindow(sender.id); return { ok: false, message: COMPUTER_MEDIA_UNAVAILABLE }; }
		if (!owners.has(sender.id)) {
			const dispose = () => { options.views.releaseWindow(sender.id); owners.delete(sender.id); sender.removeListener("destroyed", dispose); sender.removeListener("did-navigate", dispose); sender.removeListener("render-process-gone", dispose); sender.removeListener("did-start-navigation", navigate); };
			const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) dispose(); };
			owners.set(sender.id, dispose); sender.on("destroyed", dispose); sender.on("did-navigate", dispose); sender.on("render-process-gone", dispose); sender.on("did-start-navigation", navigate);
		}
		try {
			if (kind === "release") { options.views.release(sender, raw); return { ok: true }; }
			if (kind === "adopt") { await options.views.adopt(sender, raw); if (!allowed(sender, senderFrame)) { options.views.releaseWindow(sender.id); return { ok: false, message: COMPUTER_MEDIA_UNAVAILABLE }; } return { ok: true }; }
			const result = await options.store.read(sender, raw);
			return allowed(sender, senderFrame) ? result : { ok: false, message: COMPUTER_MEDIA_UNAVAILABLE };
		} catch { return { ok: false, message: COMPUTER_MEDIA_UNAVAILABLE }; }
	});
	return { dispose() { disposed = true; for (const off of [...owners.values()]) off(); options.store.dispose(); options.views.dispose(); for (const channel of Object.values(COMPUTER_FRAME_CHANNELS)) options.ipcMain.removeHandler(channel); } };
}
