/**
 * Resident media runtime and the exact-session artifact binding.
 *
 * Tasks belong to the native AgentSession, not to a view: a closed Studio view
 * leaves running work alone, while session disposal, identity replacement and
 * Host shutdown abort it. The runtime knows no transport path, endpoint or
 * storage location; the three fixed helpers in `ops/files.ts` own every byte.
 */
import * as path from "node:path";
import { getAgentDir, isRecord } from "@linxiraos/pi-utils";
import type { AgentSession } from "../../../session/agent-session.js";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, unavailable } from "../errors.js";
import type { StudioHostContext } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import { MediaServiceError, StudioMediaService } from "./media-service.js";
import { StudioMediaJobStore, type SessionMediaArtifactPort, STUDIO_MEDIA_ARTIFACT_MAX_BYTES } from "./media-files.js";
import { readSessionMediaArtifact, removeSessionMediaArtifact, writeSessionMediaArtifact } from "../ops/files.js";

export interface StudioMediaRuntime {
	readonly session: AgentSession;
	readonly sessionId: string;
	readonly service: StudioMediaService;
	/** Reassert the live view and the exact native session after every await. */
	assertCurrent(): void;
}

interface Resident {
	readonly session: AgentSession;
	readonly service: StudioMediaService;
	unregister: () => void;
}

const residents = new Map<string, Resident>();

function sessionIdOf(input: unknown): string {
	const value = isRecord(input) ? input.sessionId : undefined;
	if (typeof value !== "string" || value.trim() === "" || value.length > 512 || value.includes("\u0000")) {
		throw invalid("sessionId must be a non-blank string");
	}
	return value;
}

function viewLive(context: StudioHostContext, sessionId: string): void {
	const selected = currentStudioSelection()?.sessionId;
	if (selected === undefined || selected !== sessionId) {
		throw unavailable("Media requires the current conversation session");
	}
	const owner = context.privateOwner;
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now() || context.selection?.closed) {
		throw unavailable("Media requires a live authenticated view");
	}
}

function jobDirectory(): string {
	return path.resolve(getAgentDir(), "studio", "media-jobs");
}

/** Native call order is session-bound; every call reasserts the exact session. */
function sessionPort(sessionId: string, current: () => boolean): SessionMediaArtifactPort {
	const assert = () => {
		if (!current()) throw new MediaServiceError("COMMAND_BLOCKED", "Media session is no longer current");
	};
	return {
		async read(artifactId, kind) {
			assert();
			const value = await readSessionMediaArtifact(sessionId, artifactId, kind);
			assert();
			if (
				value.bytes.byteLength === 0 ||
				value.bytes.byteLength > STUDIO_MEDIA_ARTIFACT_MAX_BYTES ||
				value.meta.artifactId !== artifactId ||
				value.meta.bytes !== value.bytes.byteLength ||
				(kind !== undefined && value.meta.kind !== kind)
			) {
				throw new MediaServiceError("INVALID_ARGUMENT", "Media input is unavailable in this session");
			}
			return value;
		},
		async write(meta, bytes) {
			assert();
			const data =
				bytes.buffer instanceof ArrayBuffer
					? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
					: Uint8Array.from(bytes);
			const output = await writeSessionMediaArtifact(sessionId, meta, data);
			try {
				assert();
			} catch (error) {
				await removeSessionMediaArtifact(sessionId, output.artifactId).catch(() => {});
				throw error;
			}
			return output;
		},
		async remove(artifactId) {
			assert();
			await removeSessionMediaArtifact(sessionId, artifactId);
			assert();
		},
	};
}

function retire(sessionId: string, resident: Resident): void {
	if (residents.get(sessionId) !== resident) return;
	residents.delete(sessionId);
	resident.unregister();
	resident.service.dispose();
	void resident.service.settle();
}

/**
 * Resolve the exact resident session and its media service.
 *
 * Never starts or resumes a session: only a live AgentSession reachable from
 * `getRpcSession(sessionId)` qualifies, and every later call reasserts the
 * authenticated view plus that same session object.
 */
export async function studioMediaRuntime(input: unknown, context: StudioHostContext): Promise<StudioMediaRuntime> {
	const sessionId = sessionIdOf(input);
	viewLive(context, sessionId);
	const session = getRpcSession(sessionId)?.getSession();
	if (!session || session.isDisposed || session.sessionId !== sessionId) {
		throw unavailable("Media session is not resident");
	}
	const current = () =>
		!session.isDisposed && session.sessionId === sessionId && getRpcSession(sessionId)?.getSession() === session;
	if (!current()) throw unavailable("Media session changed while attaching");

	let resident = residents.get(sessionId);
	if (resident && (resident.session !== session || resident.session.isDisposed)) {
		retire(sessionId, resident);
		resident = undefined;
	}
	if (!resident) {
		const service = new StudioMediaService(session, {
			port: sessionPort(sessionId, current),
			jobs: new StudioMediaJobStore(jobDirectory()),
			isCurrent: current,
		});
		const created: Resident = { session, service, unregister: () => {} };
		const dispose = () => retire(sessionId, created);
		created.unregister = session.registerSessionChangeCallback(() => {
			if (!current()) dispose();
		});
		session.addDisposer(dispose);
		residents.set(sessionId, created);
		resident = created;
	}
	const attached = resident;
	const assertCurrent = () => {
		viewLive(context, sessionId);
		if (!current()) throw unavailable("Media session changed");
		if (residents.get(sessionId) !== attached) throw unavailable("Media runtime changed");
	};
	assertCurrent();
	return { session, sessionId, service: attached.service, assertCurrent };
}

/** Host shutdown: abort every worker and wait for its metadata persistence. */
export async function shutdownStudioMedia(): Promise<void> {
	const all = [...residents.values()];
	residents.clear();
	for (const resident of all) {
		resident.unregister();
		resident.service.dispose();
	}
	await Promise.allSettled(all.map(resident => resident.service.settle()));
}
