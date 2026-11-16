/**
 * Studio operation — `btw.images.resolve`.
 *
 * The BTW composer forwards pasted text; this operation turns image paths in
 * that text into image payloads using the same native helpers the TUI editor
 * uses (`extractImagePastePathsFromText` + `loadImageInput`). It never reads a
 * path the pasted text does not name, never returns the resolved path, and
 * runs only on the caller's live selected resident session so the cwd used to
 * resolve relative paths is the conversation's own.
 */
import { ImageInputTooLargeError } from "@linxiraos/pi-tui/chat/image-loading";
import { extractImagePastePathsFromText } from "@linxiraos/pi-tui/prompt/custom-editor";
import { getRpcSession } from "../../web-gateway/agents.js";
import { loadImageInput, type LoadedImageInput } from "../../../utils/image-loading.js";
import { invalid, unavailable } from "../errors.js";
import type { BtwImage } from "../protocol/contracts/runtime-upgrade.js";
import type { StudioFamily } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import { snapshotFor } from "./session.js";
import { workspaceIdFor } from "./workspace-id.js";

const MAX_TEXT = 64 * 1024;
const MAX_IMAGES = 16;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;

export const btwImagesOps: StudioFamily = {
	id: "btw-images",
	commands: {
		"btw.images.resolve": async (input, context) => {
			if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Invalid BTW image request");
			const row = input as Record<string, unknown>;
			if (Object.keys(row).some(key => key !== "text")) throw invalid("Unknown BTW image field");
			if (typeof row.text !== "string" || row.text.length > MAX_TEXT) throw invalid("Invalid BTW image text");
			const owner = context.privateOwner;
			const selection = currentStudioSelection();
			if (!owner || !owner.isLive() || owner.expiresAt <= Date.now())
				throw unavailable("BTW images require a live authenticated conversation");
			if (!selection || selection !== context.selection || selection.closed || !selection.sessionId)
				throw unavailable("BTW images require a live authenticated conversation");
			const sessionId = selection.sessionId;
			const rpc = getRpcSession(sessionId);
			const session = rpc?.getSession();
			if (
				!rpc?.isAlive() ||
				!session ||
				session.isDisposed ||
				session.sessionId !== sessionId ||
				session.sessionManager.getSessionId() !== sessionId ||
				workspaceIdFor(session.sessionManager.getCwd()) !== selection.workspaceId
			)
				throw unavailable("The BTW session is not resident in this conversation");
			const assert = () => {
				if (
					!owner.isLive() ||
					owner.expiresAt <= Date.now() ||
					selection.closed ||
					selection.sessionId !== sessionId ||
					session.isDisposed ||
					session.sessionId !== sessionId ||
					currentStudioSelection() !== selection ||
					getRpcSession(sessionId) !== rpc ||
					!rpc.isAlive() ||
					session.sessionManager.getSessionId() !== sessionId ||
					getRpcSession(sessionId)?.getSession() !== session
				)
					throw unavailable("BTW image view changed");
			};
			assert();
			const paths = extractImagePastePathsFromText(row.text) ?? [];
			if (paths.length > MAX_IMAGES) throw invalid("Too many pasted images");
			const images: BtwImage[] = [];
			let total = 0;
			for (const path of paths) {
				assert();
				let image: LoadedImageInput | null;
				try {
					image = await loadImageInput({ path, cwd: session.sessionManager.getCwd(), autoResize: false });
				} catch (error) {
					if (error instanceof ImageInputTooLargeError) throw invalid("A pasted image is too large");
					throw unavailable("A pasted image could not be read");
				}
				assert();
				if (!image) throw invalid("A pasted path is not a readable image");
				const mimeType = image.mimeType;
				if (
					mimeType !== "image/png" &&
					mimeType !== "image/jpeg" &&
					mimeType !== "image/gif" &&
					mimeType !== "image/webp" &&
					mimeType !== "image/svg+xml"
				)
					throw invalid("A pasted image has an unsupported format");
				total += image.bytes;
				if (total > MAX_TOTAL_BYTES) throw invalid("Pasted images exceed the transfer limit");
				images.push({ type: "image", mimeType, data: image.data });
			}
			const snapshot = await snapshotFor(sessionId);
			assert();
			return { snapshot, result: { images } };
		},
	},
};
