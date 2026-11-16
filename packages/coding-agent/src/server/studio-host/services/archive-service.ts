/**
 * `archive.*` — read-only views over native Archive records.
 *
 * A request is scoped by the live conversation's cwd (or every project) and
 * never accepts a filename. Detail inspection accepts only a complete native
 * session id, refuses path syntax, and rechecks that the record it resolved is
 * the exact id requested. Project rows carry a basename, never an absolute
 * transcript path; text is bounded and marked truncated.
 */
import * as path from "node:path";
import {
	archivePrompts,
	archiveRecaps,
	archiveSession,
	archiveSessions,
	type ArchivePrompt,
	type ArchiveRecap,
	type ArchiveSession,
} from "../../../archive/archive.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { StudioOpError } from "../errors.js";
import type { ArchiveOperation, NativeArchiveSession, NativeArchiveText } from "../protocol/contracts/archive.js";

const PAGE = 20;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function projectName(value: string): string {
	return path.basename(value).slice(0, 80) || value.slice(0, 80);
}

function sessionRow(row: ArchiveSession): NativeArchiveSession {
	return {
		id: row.id,
		title: row.title.slice(0, 256),
		project: projectName(row.project),
		created: row.created,
		modified: row.modified,
		messages: row.messages,
		...(row.status ? { status: row.status } : {}),
		...(row.recap !== undefined ? { recap: row.recap.slice(0, 512) } : {}),
		truncated: row.title.length > 256 || (row.recap?.length ?? 0) > 512,
	};
}

function textRow(row: ArchiveRecap | ArchivePrompt): NativeArchiveText {
	return {
		text: row.text.slice(0, 512),
		at: row.at,
		...(row.session ? { sessionId: row.session } : {}),
		...(row.project ? { project: projectName(row.project) } : {}),
		...("uses" in row ? { uses: row.uses } : {}),
		truncated: row.text.length > 512,
	};
}

/** Read native Archive records without accepting filenames or changing session ownership. */
export class StudioArchiveService {
	constructor(readonly session: AgentSession) {}

	async execute(operation: ArchiveOperation): Promise<unknown> {
		const check = () => {
			if (this.session.isDisposed || operation.sessionId !== this.session.sessionId)
				throw new StudioOpError("UNAVAILABLE", "Archive request belongs to a different session");
		};
		check();
		try {
			return await this.#read(operation, check);
		} catch (cause) {
			if (cause instanceof StudioOpError) throw cause;
			throw new StudioOpError("UNAVAILABLE", "Archive is unavailable for this session");
		}
	}

	async #read(operation: ArchiveOperation, check: () => void): Promise<unknown> {
		check();
		if (operation.kind === "archive.session.inspect") {
			if (!SESSION_ID.test(operation.targetSessionId))
				throw new StudioOpError("INVALID_ARGUMENT", "Select a complete session identity from Archive");
			const native = (await archiveSession(operation.targetSessionId, 10)).records;
			check();
			if (native.id !== operation.targetSessionId)
				throw new StudioOpError("INVALID_ARGUMENT", "Select a complete session identity from Archive");
			return {
				session: sessionRow(native),
				recaps: native.recaps.slice(-10).map(textRow),
				prompts: native.prompts.slice(-10).map(textRow),
				truncated:
					native.recaps.length > 10 ||
					native.prompts.length >= 10 ||
					native.recaps.some(row => row.text.length > 512) ||
					native.prompts.some(row => row.text.length > 512),
			};
		}
		const cwd = operation.scope === "workspace" ? this.session.sessionManager.getCwd() : undefined;
		if (operation.kind === "archive.sessions.list") {
			const rows = (await archiveSessions(cwd, PAGE + 1)).records;
			check();
			return { rows: rows.slice(0, PAGE).map(sessionRow), truncated: rows.length > PAGE };
		}
		const rows =
			operation.kind === "archive.recaps.list"
				? archiveRecaps(cwd, PAGE + 1).records
				: archivePrompts(operation.query.trim() || undefined, cwd, PAGE + 1).records;
		check();
		return { rows: rows.slice(0, PAGE).map(textRow), truncated: rows.length > PAGE };
	}
}
