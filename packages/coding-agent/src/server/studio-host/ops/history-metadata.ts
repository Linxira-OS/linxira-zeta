/**
 * Studio operations — saved-history metadata: rename and pin.
 *
 * Both target a **saved** session that belongs to the same workspace as the
 * caller's conversation; they never resume or start that saved session.
 * Rename uses the gateway's existing `PATCH /api/sessions/:id` writer; pin
 * uses the native `session-pins.json` writer. Both survive a restart and
 * remain consistent with the TUI.
 */
import { isRecord } from "@linxiraos/pi-utils";
import { getAgentDir } from "@linxiraos/pi-utils/dirs";
import { setSessionPinned } from "../../../session/session-pins.js";
import { getRpcSession } from "../../web-gateway/agents.js";
import { invalid, unavailable } from "../errors.js";
import { callGateway, requiredString, segment } from "../gateway.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { currentStudioSelection } from "../selection.js";
import { sessionWorkspaceId, snapshotFor } from "./session.js";
import { workspaceIdFor } from "./workspace-id.js";

const MAX_TITLE = 1024;

interface HistoryView {
	sessionId: string;
	workspaceId: string;
	assertCurrent(): void;
}

function liveView(context: StudioHostContext, sessionId: string): HistoryView {
	const owner = context.privateOwner;
	const selection = currentStudioSelection();
	if (!owner || !owner.isLive() || owner.expiresAt <= Date.now())
		throw unavailable("History metadata requires a live authenticated conversation");
	if (!selection || selection !== context.selection || selection.closed || selection.sessionId !== sessionId)
		throw unavailable("History metadata requires the selected conversation");
	const id = selection.sessionId;
	const rpc = getRpcSession(id);
	const session = rpc?.getSession();
	if (
		!rpc?.isAlive() ||
		!session ||
		session.isDisposed ||
		session.sessionId !== id ||
		session.sessionManager.getSessionId() !== id ||
		workspaceIdFor(session.sessionManager.getCwd()) !== selection.workspaceId
	)
		throw unavailable("The selected session is not resident in this conversation");
	return {
		sessionId: id,
		workspaceId: selection.workspaceId,
		assertCurrent() {
			if (
				!owner.isLive() ||
				owner.expiresAt <= Date.now() ||
				selection.closed ||
				selection.sessionId !== id ||
				session.isDisposed ||
				session.sessionId !== id ||
				currentStudioSelection() !== selection ||
				getRpcSession(id) !== rpc ||
				!rpc.isAlive() ||
				session.sessionManager.getSessionId() !== id ||
				getRpcSession(id)?.getSession() !== session
			)
				throw unavailable("History metadata view changed");
		},
	};
}

/** The named saved session must resolve to the caller's own workspace. */
async function assertTarget(view: HistoryView, targetSessionId: string): Promise<void> {
	const workspace = await sessionWorkspaceId(targetSessionId);
	view.assertCurrent();
	if (workspace === undefined) throw invalid("History target session is unavailable");
	if (workspace !== view.workspaceId) throw invalid("History target session belongs to another workspace");
}

async function rename(
	input: Record<string, unknown>,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: { targetSessionId: string; title: string } }> {
	const view = liveView(context, requiredString(input, "sessionId"));
	view.assertCurrent();
	const targetSessionId = requiredString(input, "targetSessionId");
	if (targetSessionId.length > 512 || targetSessionId.includes("\0")) throw invalid("Invalid history target session");
	const raw = input.title;
	if (typeof raw !== "string") throw invalid("Invalid history title");
	const title = raw.trim();
	if (title === "" || title.length > MAX_TITLE || /[\u0000-\u001f\u007f]/u.test(title))
		throw invalid("Invalid history title");
	await assertTarget(view, targetSessionId);
	const reply = await callGateway(`/api/sessions/${segment(targetSessionId)}`, {
		method: "PATCH",
		body: { name: title },
	});
	view.assertCurrent();
	if (reply.status === 404) throw invalid("History target session is unavailable");
	if (reply.status < 200 || reply.status >= 300) throw unavailable("The session title could not be saved");
	const saved = await callGateway(`/api/sessions/${segment(targetSessionId)}`, { query: "window=tail&limit=1" });
	view.assertCurrent();
	const savedTitle =
		saved.status === 200 &&
		isRecord(saved.body) &&
		isRecord(saved.body.info) &&
		typeof saved.body.info.name === "string"
			? saved.body.info.name
			: undefined;
	if (savedTitle === undefined) throw unavailable("The saved session title could not be read");
	const snapshot = await snapshotFor(view.sessionId);
	view.assertCurrent();
	return { snapshot, result: { targetSessionId, title: savedTitle } };
}

async function pin(
	input: Record<string, unknown>,
	context: StudioHostContext,
): Promise<{ snapshot: OperatorStateSnapshot; result: { targetSessionId: string; pinned: boolean } }> {
	const view = liveView(context, requiredString(input, "sessionId"));
	view.assertCurrent();
	const targetSessionId = requiredString(input, "targetSessionId");
	if (targetSessionId.length > 512 || targetSessionId.includes("\0")) throw invalid("Invalid history target session");
	if (typeof input.pinned !== "boolean") throw invalid("Invalid history pin state");
	await assertTarget(view, targetSessionId);
	await setSessionPinned(targetSessionId, input.pinned, getAgentDir());
	view.assertCurrent();
	const snapshot = await snapshotFor(view.sessionId);
	view.assertCurrent();
	return { snapshot, result: { targetSessionId, pinned: input.pinned } };
}

/** Closed field sets: the command name already fixes the operation kind. */
function closed(input: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Invalid history metadata input");
	const row = input as Record<string, unknown>;
	if (Object.keys(row).some(key => !fields.includes(key))) throw invalid("Unknown history metadata field");
	return row;
}

export const historyMetadataOps: StudioFamily = {
	id: "history-metadata",
	commands: {
		"session.history.rename": (input, context) =>
			rename(closed(input, ["sessionId", "targetSessionId", "title"]), context),
		"session.history.pin": (input, context) =>
			pin(closed(input, ["sessionId", "targetSessionId", "pinned"]), context),
	},
};
