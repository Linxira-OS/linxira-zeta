import { createHash } from "node:crypto";
import { isRecord } from "@linxiraos/pi-utils";
import type { SessionEntry } from "../../../session/session-entries";
import { SessionEntryIndex } from "../../../session/session-manager";
import type { TimeTravelEvent, TimeTravelTimeline } from "../contract/time-travel.js";
import type { SessionId } from "../contract/ids.js";
import { invalid, StudioOpError } from "../errors.js";
import { plainText } from "../conversation-projector.js";

function event(entry: SessionEntry): TimeTravelEvent | undefined {
	const base = { id: entry.id, parentId: entry.parentId, createdAt: entry.timestamp };
	if (entry.type === "compaction") return { ...base, kind: "compaction", title: "Compaction", detail: entry.summary.slice(0, 500) };
	if (entry.type === "branch_summary") return { ...base, kind: "system", title: "Branch summary", detail: entry.summary.slice(0, 500) };
	if (entry.type === "reset_boundary") return { ...base, kind: "system", title: "Context reset", detail: "" };
	if (entry.type !== "message") return undefined;
	const message = entry.message;
	if (message.role === "toolResult") return { ...base, kind: "tool", title: message.toolName, detail: plainText(message.content).slice(0, 500) };
	if (message.role !== "user" && message.role !== "assistant") return undefined;
	const calls = Array.isArray(message.content) ? message.content.filter(isRecord).filter(block => block.type === "toolCall").map(block => typeof block.name === "string" ? block.name : "").filter(Boolean).join(", ") : "";
	return { ...base, kind: message.role, title: calls || (message.role === "user" ? "User" : "Assistant"), detail: plainText(message.content).slice(0, 500) };
}

/** Read-only native entries; cursor is fenced by session, branch and complete transcript revision. */
export function timeTravelTimeline(sessionId: string, entries: readonly SessionEntry[], activeLeafId: string | null, input: { branchLeafId?: string; cursor?: string }): Omit<TimeTravelTimeline, "points"> & { ancestors: ReadonlySet<string> } {
	const index = new SessionEntryIndex(); index.rebuild(entries);
	const selectedLeafId = input.branchLeafId ?? activeLeafId;
	if (selectedLeafId !== null && !index.has(selectedLeafId)) throw invalid("Session branch is not available");
	const branch = index.pathTo(selectedLeafId);
	const revision = createHash("sha256").update(JSON.stringify([activeLeafId, entries])).digest("hex");
	let end = branch.length;
	if (input.cursor !== undefined) {
		if (typeof input.cursor !== "string" || input.cursor.length > 2048) throw invalid("Invalid Time Travel cursor");
		let cursor: unknown;
		try { cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")); } catch { throw invalid("Invalid Time Travel cursor"); }
		if (!isRecord(cursor) || cursor.sessionId !== sessionId || cursor.revision !== revision || cursor.leafId !== selectedLeafId)
			throw new StudioOpError("CURSOR_STALE", "Timeline changed; reload the session");
		end = branch.findIndex(entry => entry.id === cursor.boundary);
		if (end < 0) throw new StudioOpError("CURSOR_STALE", "Timeline boundary is unavailable");
	}
	const start = Math.max(0, end - 120), page = branch.slice(start, end);
	const visible = entries.filter(entry => !(entry.type === "custom" && entry.customType === "zeta-active-leaf"));
	const parents = new Set(visible.map(entry => entry.parentId));
	const leaves = visible.filter(entry => !parents.has(entry.id));
	if (activeLeafId && !leaves.some(entry => entry.id === activeLeafId)) { const active = index.get(activeLeafId); if (active) leaves.push(active); }
	return {
		sessionId: sessionId as SessionId, activeLeafId, selectedLeafId,
		ancestors: new Set(branch.map(entry => entry.id)),
		branches: leaves.map(entry => ({ leafId: entry.id, createdAt: entry.timestamp, current: entry.id === activeLeafId })),
		events: page.flatMap(entry => { const projected = event(entry); return projected ? [projected] : []; }),
		...(start > 0 && page[0] ? { olderCursor: Buffer.from(JSON.stringify({ sessionId, revision, leafId: selectedLeafId, boundary: page[0].id })).toString("base64url") } : {}),
	};
}
