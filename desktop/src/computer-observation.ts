import { rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrivateIpcMain, PrivateSender, StudioPrivatePaths } from "./private-ipc";
import { COMPUTER_CAPTURE_CHANNEL, type ComputerCaptureResult } from "./computer-observation-shared";
import { ComputerFrameStore } from "./computer-frames";
import { DesktopComputerViews } from "./computer-views";
import { COMPUTER_UUID, COMPUTER_HASH, COMPUTER_MEDIA_UNAVAILABLE, computerRecord, computerSession, readComputerJson } from "./computer-media-files";

/** A one-use prepare receipt adopts only its own Host view before delivering its bounded frame. */
export function registerComputerCaptureIpc(options: { ipcMain: PrivateIpcMain; paths(): Promise<StudioPrivatePaths>; views: DesktopComputerViews; store: ComputerFrameStore; isTrustedSender(sender: PrivateSender): boolean; isVisible(sender: PrivateSender): boolean }): { dispose(): void } {
	const claims = new Set<string>(); let disposed = false;
	const owners = new Map<number, () => void>();
	options.ipcMain.handle(COMPUTER_CAPTURE_CHANNEL, async ({ sender, senderFrame }, value): Promise<ComputerCaptureResult> => {
		const frame = sender.mainFrame;
		const valid = () => !disposed && senderFrame === frame && sender.mainFrame === frame && !sender.isDestroyed() && options.isTrustedSender(sender) && options.isVisible(sender);
		if (!valid()) return { ok: false, message: COMPUTER_MEDIA_UNAVAILABLE };
		if (!owners.has(sender.id)) {
			const off = () => { options.views.releaseWindow(sender.id); owners.delete(sender.id); sender.removeListener("destroyed", off); sender.removeListener("render-process-gone", off); sender.removeListener("did-start-navigation", navigate); };
			const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) off(); };
			owners.set(sender.id, off); sender.on("destroyed", off); sender.on("render-process-gone", off); sender.on("did-start-navigation", navigate);
		}
		let claim: string | undefined, id: string | undefined;
		let adopted: { scopeSessionId: string; leaseId: string; origin: "local" } | undefined;
		try {
			const request = computerRecord(value, ["captureId", "sessionId", "targetId"]);
			computerSession(request.sessionId);
			if (typeof request.targetId !== "string" || !request.targetId || request.targetId.length > 1024 || request.targetId.includes("\0") || typeof request.captureId !== "string" || !COMPUTER_UUID.test(request.captureId) || claims.has(request.captureId) || claims.size >= 4) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			id = request.captureId; claims.add(id);
			const paths = await options.paths();
			const metadata = join(paths.mediaDirectory, "computer", id + ".json");
			const raw = computerRecord(await readComputerJson(paths.mediaDirectory, metadata, 4096, valid), ["version", "captureId", "sessionId", "targetId", "width", "height", "expiresAt", "scopeSessionId", "frameId", "leaseId", "owner"]);
			if (raw.version !== 1 || raw.captureId !== id || raw.sessionId !== request.sessionId || raw.scopeSessionId !== request.sessionId || raw.targetId !== request.targetId || typeof raw.frameId !== "string" || !COMPUTER_UUID.test(raw.frameId) || typeof raw.leaseId !== "string" || !COMPUTER_UUID.test(raw.leaseId) || typeof raw.owner !== "string" || !COMPUTER_HASH.test(raw.owner) || typeof raw.expiresAt !== "number" || !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= Date.now() || raw.expiresAt > Date.now() + 30_000 || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			claim = metadata + "." + randomUUID() + ".claim";
			await rename(metadata, claim);
			if (!valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			adopted = { scopeSessionId: request.sessionId, leaseId: raw.leaseId, origin: "local" };
			await options.views.adopt(sender, adopted);
			const guard = await options.views.guard(sender, request.sessionId, raw.leaseId);
			if (guard.directory !== paths.mediaDirectory || guard.owner !== raw.owner || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			const result = await options.store.readFrame(guard, raw.frameId);
			if (!result.ok || result.width !== raw.width || result.height !== raw.height || !valid()) throw new Error(COMPUTER_MEDIA_UNAVAILABLE);
			return { ok: true, data: result.data, width: result.width, height: result.height };
		} catch { return { ok: false, message: COMPUTER_MEDIA_UNAVAILABLE }; }
		finally { if (adopted) options.views.release(sender, adopted); if (claim) await unlink(claim).catch(() => {}); if (id) claims.delete(id); }
	});
	return { dispose() { disposed = true; for (const off of [...owners.values()]) off(); options.ipcMain.removeHandler(COMPUTER_CAPTURE_CHANNEL); } };
}
