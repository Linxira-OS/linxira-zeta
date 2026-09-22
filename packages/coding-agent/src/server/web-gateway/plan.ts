/**
 * Web Gateway — plan whitelist read handler.
 *
 * `GET /api/plan?session=<id>&path=<plan file>` serves the body of the
 * *current* plan file for a live session (sidebar Plan card / PlanApproval
 * preview). The whitelist is strict: `path` must equal the session's active
 * `planFilePath` from its plan-mode state — arbitrary file reads are
 * rejected with 404 without leaking whether the path exists.
 */

import { getRpcSession } from "./agents";

export async function handleGetPlan(req: Request): Promise<Response> {
	try {
		const url = new URL(req.url);
		const sessionId = url.searchParams.get("session")?.trim() ?? "";
		const planPath = url.searchParams.get("path")?.trim() ?? "";
		if (!sessionId || !planPath) {
			return Response.json({ error: "session and path query parameters are required" }, { status: 400 });
		}

		const session = getRpcSession(sessionId);
		if (!session?.isAlive()) {
			return Response.json({ error: "Session not found" }, { status: 404 });
		}

		const inner = session.getSession();
		const planState = inner.getPlanModeState();
		if (planState?.enabled !== true || planState.planFilePath !== planPath) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}

		const content = await inner.getPlanFileContent(planPath);
		if (content === null || content === undefined) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		return Response.json({ path: planPath, content });
	} catch (error) {
		return Response.json({ error: String(error instanceof Error ? error.message : error) }, { status: 500 });
	}
}
