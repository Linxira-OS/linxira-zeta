import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@linxiraos/pi-utils";
import { withFileLock } from "@linxiraos/pi-utils/file-lock";

import { replaceFileAtomically } from "../utils/atomic-file";

const VISIBILITY_FILENAME = "session-visibility.json";

function normalizeHiddenIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const id = entry.trim();
		if (id) ids.add(id);
	}
	return [...ids];
}

/**
 * Read the global set of hidden conversation ids
 * (`~/.zeta/session-visibility.json`). Hiding is metadata only: the transcript
 * stays exactly where it was, every surface reads this one file, and unhiding
 * is the inverse write. A missing file yields an empty set; a corrupt one
 * degrades to empty with a warning rather than breaking the resume picker or
 * the Work Studio sidebar.
 *
 * Keys are session ids, not file paths, so `/move` renames and project
 * relocation keep the hidden state attached to the conversation.
 */
export async function loadHiddenSessionIds(agentDir: string = getAgentDir()): Promise<Set<string>> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(path.join(agentDir, VISIBILITY_FILENAME), "utf-8"));
		const record = typeof parsed === "object" && parsed !== null ? (parsed as { hiddenSessions?: unknown }) : null;
		return new Set(normalizeHiddenIds(record?.hiddenSessions));
	} catch (err) {
		if (isEnoent(err)) return new Set();
		logger.warn("Failed to read session visibility", { error: err });
		return new Set();
	}
}

/**
 * Set one conversation's hidden flag and persist the set under the shared
 * cross-process lock. The read-modify-write is lock-protected and the file is
 * replaced atomically, matching `session-pins.ts`: two processes toggling
 * different conversations cannot lose each other's update.
 */
export async function setSessionHidden(
	sessionId: string,
	hidden: boolean,
	agentDir: string = getAgentDir(),
): Promise<void> {
	const id = sessionId.trim();
	if (!id) throw new Error("A session id is required");
	const filePath = path.join(agentDir, VISIBILITY_FILENAME);
	await fs.mkdir(agentDir, { recursive: true });
	await withFileLock(filePath, async () => {
		const ids = await loadHiddenSessionIds(agentDir);
		if (hidden) ids.add(id);
		else ids.delete(id);
		const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
		const payload = { version: 1, hiddenSessions: [...ids] };
		try {
			await fs.writeFile(tmpPath, JSON.stringify(payload, null, "\t"), { encoding: "utf-8", mode: 0o600 });
			await replaceFileAtomically(tmpPath, filePath);
		} catch (error) {
			await fs.rm(tmpPath, { force: true }).catch(() => {});
			throw error;
		}
	});
}

/** Toggle one conversation's hidden flag; returns the new hidden state. */
export async function toggleSessionHidden(sessionId: string, agentDir: string = getAgentDir()): Promise<boolean> {
	const hidden = await loadHiddenSessionIds(agentDir);
	const next = !hidden.has(sessionId.trim());
	await setSessionHidden(sessionId, next, agentDir);
	return next;
}

/** Drop hidden metadata for a session that is being permanently deleted. */
export async function forgetSessionVisibility(sessionId: string, agentDir: string = getAgentDir()): Promise<void> {
	if (!sessionId.trim()) return;
	const hidden = await loadHiddenSessionIds(agentDir);
	if (!hidden.has(sessionId)) return;
	await setSessionHidden(sessionId, false, agentDir);
}
