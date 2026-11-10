/**
 * The one conversation-deletion path shared by the TUI resume picker and the
 * Work Studio gateway.
 *
 * Both surfaces describe the same user intent ("delete this conversation") and
 * must reach the same storage semantics: by default the transcript, its
 * artifacts and stale backups move to the shared trash (`~/.zeta/trash`), and
 * the permanent mode removes them outright. Either way this drops the
 * conversation's shared metadata (hidden flag, pin) so a later session id
 * reuse or a stale listing cannot resurrect state for a deleted file.
 */
import { logger } from "@linxiraos/pi-utils";

import { readSessionHeaderId } from "./session-loader";
import { unpinSession } from "./session-pins";
import { FileSessionStorage, type SessionStorage } from "./session-storage";
import { moveSessionToTrash } from "./session-trash";
import { forgetSessionVisibility } from "./session-visibility";

export type SessionDeleteMode = "trash" | "permanent";

export interface DeleteSessionFilesOptions {
	/** `trash` (default) keeps the transcript recoverable; `permanent` erases it. */
	mode?: SessionDeleteMode;
	/** Storage override for custom session backends (tests, remote stores). */
	storage?: SessionStorage;
	/** Agent/config dir owning pins and visibility metadata. */
	agentDir?: string;
}

export interface DeleteSessionFilesResult {
	/** False only when a trash move found no file; metadata cleanup still ran. */
	deleted: boolean;
	sessionId?: string;
}

/**
 * Delete one conversation by transcript path. Missing files are a successful
 * no-op, matching the picker's ENOENT-is-success behavior.
 */
export async function deleteSessionFiles(
	sessionPath: string,
	options: DeleteSessionFilesOptions = {},
): Promise<DeleteSessionFilesResult> {
	const sessionId = await readSessionHeaderId(sessionPath).catch(() => undefined);
	let deleted = true;
	if ((options.mode ?? "trash") === "permanent") {
		await (options.storage ?? new FileSessionStorage()).deleteSessionWithArtifacts(sessionPath);
	} else {
		const moved = await moveSessionToTrash(sessionPath);
		deleted = moved.moved || moved.entry === null;
	}
	if (sessionId) {
		await Promise.all([
			forgetSessionVisibility(sessionId, options.agentDir).catch(error =>
				logger.warn("Failed to clear hidden state for a deleted session", { sessionId, error }),
			),
			unpinSession(sessionId, options.agentDir).catch(error =>
				logger.warn("Failed to clear the pin for a deleted session", { sessionId, error }),
			),
		]);
	}
	return { deleted, ...(sessionId ? { sessionId } : {}) };
}
