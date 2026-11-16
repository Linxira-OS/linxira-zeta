import type { ImageContent } from "@linxiraos/pi-ai";
import type { AgentSession } from "../../../session/agent-session.js";
import type { RestoredQueuedMessage, StudioQueueSnapshotEntry } from "../../../session/agent-session-types.js";
import { invalid, unavailable } from "../errors.js";
import type {
	QueueImageAsset,
	QueueTakeback,
	SessionQueueItem,
	SessionQueueSnapshot,
} from "../protocol/contracts/session-gui.js";

/** The exact artifact helper the Studio host provides for takeback images. */
export interface RuntimeViewArtifactPort {
	writeSessionMediaArtifact(
		sessionId: string,
		meta: { name: string; kind: "image"; mimeType: string },
		bytes: Uint8Array,
	): Promise<QueueImageAsset> | QueueImageAsset;
	/** Optional companion that discards staged images after an ack/failed takeback/dispose. */
	removeSessionMediaArtifacts?(sessionId: string, assets: readonly QueueImageAsset[]): Promise<void> | void;
}

const MAX_RECOVERIES = 100;
const MAX_PAGE = 100;
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 28 * 1024 * 1024;

interface Recovery {
	sessionId: string;
	item: SessionQueueItem;
	result: QueueTakeback;
}

/** The exact native session surface this queue view needs. */
export interface RuntimeViewQueueHost {
	readonly sessionId: string;
	readonly followUpMode: "all" | "one-at-a-time";
	readonly steeringMode: "all" | "one-at-a-time";
	getStudioQueueSnapshot(): readonly StudioQueueSnapshotEntry[];
	getStudioQueueDraft(id: string): RestoredQueuedMessage | undefined;
	removeStudioQueuedMessage(id: string): boolean;
	steerStudioQueuedMessage(id: string): boolean;
}

let configuredArtifacts: RuntimeViewArtifactPort | undefined;

/** Host assembly registers the session media helper once; tests can inject a fake port. */
export function configureRuntimeViewArtifacts(port: RuntimeViewArtifactPort | undefined): void {
	configuredArtifacts = port;
}

/**
 * Ports the queue switch of the official `studio/services/session-gui-service.ts`
 * (the official `runtime-view-service.ts` owns shell/live views instead) over
 * the exact native session:
 * prepared message identities, recovery drafts held until ack, and opaque
 * image artifacts instead of base64 in the public result. A recovery is
 * replayed by id until acknowledged, so a disconnected renderer can restore
 * the same draft without staging or removing anything twice.
 *
 * Every mutation runs on one service-local tail. Concurrent takebacks therefore
 * observe the first recovery, ack cannot delete a recovery before the takeback
 * that publishes it settles, and dispose marks the service closed synchronously
 * before waiting for in-flight staging/removals to settle.
 */
export class StudioRuntimeViewService {
	#recoveries = new Map<string, Recovery>();
	#artifacts: RuntimeViewArtifactPort | undefined;
	#disposed = false;
	#tail: Promise<void> = Promise.resolve();
	#disposePromise: Promise<void> | undefined;
	constructor(
		readonly session: RuntimeViewQueueHost,
		artifacts?: RuntimeViewArtifactPort,
	) {
		this.#artifacts = artifacts ?? configuredArtifacts;
	}
	setArtifacts(port: RuntimeViewArtifactPort | undefined): void {
		this.#artifacts = port ?? configuredArtifacts;
	}
	list(sessionId: string, offset = 0): SessionQueueSnapshot {
		this.#assertSession(sessionId);
		const items: SessionQueueItem[] = [
			...this.session.getStudioQueueSnapshot(),
			...Array.from(this.#recoveries.values())
				.filter(row => row.sessionId === sessionId)
				.map(row => row.item),
		];
		const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
		return {
			sessionId,
			items: items.slice(start, start + MAX_PAGE),
			total: items.length,
			followUpMode: this.session.followUpMode,
			steeringMode: this.session.steeringMode,
		};
	}
	takeback(sessionId: string, id: string, assertCurrent: () => void): Promise<QueueTakeback> {
		return this.#runMutation(async () => {
			assertCurrent();
			this.#assertSession(sessionId);
			const recovery = this.#recoveries.get(id);
			if (recovery?.sessionId === sessionId) return structuredClone(recovery.result);
			if (this.#recoveries.size >= MAX_RECOVERIES)
				throw unavailable("Restore or discard pending recovered drafts first");
			const item = this.session.getStudioQueueSnapshot().find(candidate => candidate.id === id);
			const draft = this.session.getStudioQueueDraft(id);
			if (!draft || !item || item.state !== "pending") return { removed: false, images: [] };
			const images = await this.#stageImages(sessionId, draft.images);
			try {
				// The invoking view can be revoked while the staged image write is in flight.
				assertCurrent();
				this.#assertSession(sessionId);
				if (sessionId !== this.session.sessionId || !this.session.removeStudioQueuedMessage(id)) {
					await this.#removeImages(sessionId, images);
					return { removed: false, images: [] };
				}
				const result: QueueTakeback = { removed: true, recoveryId: id, text: draft.text, images };
				this.#recoveries.set(id, {
					sessionId,
					item: { ...item, state: "recovering" },
					result,
				});
				return structuredClone(result);
			} catch (error) {
				await this.#removeImages(sessionId, images);
				throw error;
			}
		});
	}
	ack(sessionId: string, id: string, assertCurrent: () => void): Promise<{ removed: boolean }> {
		return this.#runMutation(async () => {
			assertCurrent();
			this.#assertSession(sessionId);
			const recovery = this.#recoveries.get(id);
			if (recovery?.sessionId !== sessionId) return { removed: false };
			await this.#removeImages(sessionId, recovery.result.images);
			this.#recoveries.delete(id);
			return { removed: true };
		});
	}
	remove(sessionId: string, id: string, assertCurrent: () => void): Promise<{ removed: boolean }> {
		return this.#runMutation(async () => {
			assertCurrent();
			this.#assertSession(sessionId);
			const recovery = this.#recoveries.get(id);
			if (recovery?.sessionId === sessionId) {
				await this.#removeImages(sessionId, recovery.result.images);
				this.#recoveries.delete(id);
				return { removed: true };
			}
			return { removed: this.session.removeStudioQueuedMessage(id) };
		});
	}
	steer(sessionId: string, id: string, assertCurrent: () => void): Promise<{ removed: boolean }> {
		return this.#runMutation(() => {
			assertCurrent();
			this.#assertSession(sessionId);
			return { removed: this.session.steerStudioQueuedMessage(id) };
		});
	}
	/** Marks the view closed immediately, then settles mutations and cleans recoveries. */
	dispose(): Promise<void> {
		if (this.#disposePromise) return this.#disposePromise;
		this.#disposed = true;
		this.#disposePromise = (async () => {
			await this.#tail;
			const recoveries = [...this.#recoveries.values()];
			this.#recoveries.clear();
			for (const recovery of recoveries) {
				try {
					await this.#removeImages(recovery.sessionId, recovery.result.images);
				} catch {
					// Disposal is terminal; a media-store failure must not skip the rest.
				}
			}
		})();
		return this.#disposePromise;
	}
	#runMutation<T>(action: () => T | Promise<T>): Promise<T> {
		const run = this.#tail.then(action);
		this.#tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
	#assertSession(sessionId: string): void {
		if (this.#disposed) throw unavailable("The Runtime view service is disposed");
		if (sessionId !== this.session.sessionId) throw invalid("Session changed; refresh before retrying");
	}
	async #stageImages(sessionId: string, images: readonly ImageContent[] | undefined): Promise<QueueImageAsset[]> {
		if (!images?.length) return [];
		if (images.length > MAX_IMAGES) throw unavailable("Too many queued images to take back");
		const artifacts = this.#artifacts;
		if (!artifacts) throw unavailable("Private attachment channel unavailable");
		const staged: QueueImageAsset[] = [];
		try {
			for (const [index, image] of images.entries()) {
				if (!image.mimeType.startsWith("image/")) throw unavailable("Unsupported recovered image type");
				if (image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
					throw unavailable("Recovered image exceeds 28 MiB or is empty");
				const bytes = Buffer.from(image.data, "base64");
				if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES)
					throw unavailable("Recovered image exceeds 28 MiB or is empty");
				const asset = await artifacts.writeSessionMediaArtifact(
					sessionId,
					{ name: `image-${index + 1}`, kind: "image", mimeType: image.mimeType },
					bytes,
				);
				if (
					asset.kind !== "image" ||
					typeof asset.artifactId !== "string" ||
					!asset.artifactId ||
					typeof asset.name !== "string" ||
					typeof asset.mimeType !== "string" ||
					!Number.isSafeInteger(asset.bytes) ||
					asset.bytes !== bytes.byteLength ||
					typeof asset.sha256 !== "string" ||
					!asset.sha256
				)
					throw unavailable("The media artifact store returned an invalid image record");
				staged.push(asset);
				// Disposal or a transcript switch during the write must not reach removal.
				this.#assertSession(sessionId);
			}
			this.#assertSession(sessionId);
			return staged;
		} catch (error) {
			await this.#removeImages(sessionId, staged);
			throw error;
		}
	}
	async #removeImages(sessionId: string, images: readonly QueueImageAsset[]): Promise<void> {
		if (images.length === 0 || !this.#artifacts?.removeSessionMediaArtifacts) return;
		await this.#artifacts.removeSessionMediaArtifacts(sessionId, images);
	}
}

const residents = new WeakMap<AgentSession, StudioRuntimeViewService>();

/** One recovery table per native session; it outlives renderer disconnects until ack/dispose. */
export function runtimeViewForSession(
	session: AgentSession,
	artifacts?: RuntimeViewArtifactPort,
): StudioRuntimeViewService {
	let service = residents.get(session);
	if (!service) {
		service = new StudioRuntimeViewService(session, artifacts);
		residents.set(session, service);
		const resident = service;
		session.addDisposer(() => {
			if (residents.get(session) === resident) residents.delete(session);
			void resident.dispose();
		});
	} else service.setArtifacts(artifacts);
	return service;
}
