/**
 * Web Gateway — the user board (`.zeta/board/`), the long-lived layer a user
 * keeps by hand while the agent's own `todo` stays inside a session.
 *
 * Routes (registered in `../web-gateway.ts`):
 *
 *   GET    /api/board?cwd=…          list cards + skipped-file warnings
 *   POST   /api/board                create a card (id = slug of the title)
 *   GET    /api/board/<id>           read one card
 *   PATCH  /api/board/<id>           update fields (id never changes)
 *   POST   /api/board/<id>/move      { column } — rewrite the file's column
 *   POST   /api/board/<id>/handoff   card + the brief; **starts no session**
 *   DELETE /api/board/<id>           delete the card file
 *
 * `cwd` names the project (query string, `x-zeta-cwd` header, or the process
 * cwd); the board lives at `<cwd>/.zeta/board/`. Ids are the file stems and
 * are validated twice — the route pattern and {@link isValidId} — because a
 * request must never be able to name a file outside that directory.
 *
 * The store (parsing, validation, file writes) lives in
 * `../../tools/board-store` so the built-in `board` tool shares one
 * implementation with these routes; this module owns HTTP only. The store's
 * public surface is re-exported here for existing callers.
 */

import * as path from "node:path";
import {
	BoardFormatError,
	BoardInputError,
	createCard,
	deleteCard,
	getCard,
	handoffCard,
	isValidId,
	loadBoard,
	moveCard,
	NotFoundError,
	updateCard,
} from "../../tools/board-store";

export * from "../../tools/board-store";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/**
 * Resolve the project root: an explicit `cwd` wins, then the UI's
 * `x-zeta-cwd` header, then the process directory.
 */
export async function resolveRoot(req: Request, bodyCwd?: unknown): Promise<string> {
	if (typeof bodyCwd === "string" && bodyCwd.trim() !== "") return path.resolve(bodyCwd.trim());
	const fromQuery = new URL(req.url).searchParams.get("cwd")?.trim();
	if (fromQuery) return path.resolve(fromQuery);
	const fromHeader = req.headers.get("x-zeta-cwd")?.trim();
	if (fromHeader) return path.resolve(fromHeader);
	return path.resolve(process.cwd());
}

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	return body && typeof body === "object" ? body : {};
}

/** GET /api/board?cwd=… → `{ cwd, cards, warnings }`. */
export async function handleBoardList(req: Request): Promise<Response> {
	const root = await resolveRoot(req);
	try {
		const { cards, warnings } = await loadBoard(root);
		return json({ cwd: root, cards, warnings });
	} catch (error) {
		return failure(error);
	}
}

/** GET /api/board/<id> → `{ cwd, card }`. */
export async function handleBoardGet(req: Request, id: string): Promise<Response> {
	if (!isValidId(id)) return json({ error: "invalid card id" }, 400);
	const root = await resolveRoot(req);
	try {
		const card = await getCard(root, id);
		return json({ cwd: root, card });
	} catch (error) {
		return failure(error);
	}
}

/** POST /api/board → 201 `{ cwd, card }`. */
export async function handleBoardCreate(req: Request): Promise<Response> {
	const body = await bodyOf(req);
	const root = await resolveRoot(req, body.cwd);
	try {
		const card = await createCard(root, body);
		return json({ cwd: root, card }, 201);
	} catch (error) {
		return failure(error);
	}
}

/** PATCH /api/board/<id> → `{ cwd, card }`. */
export async function handleBoardUpdate(req: Request, id: string): Promise<Response> {
	if (!isValidId(id)) return json({ error: "invalid card id" }, 400);
	const body = await bodyOf(req);
	const root = await resolveRoot(req, body.cwd);
	try {
		const card = await updateCard(root, id, body);
		return json({ cwd: root, card });
	} catch (error) {
		return failure(error);
	}
}

/** POST /api/board/<id>/move → `{ cwd, card }`. */
export async function handleBoardMove(req: Request, id: string): Promise<Response> {
	if (!isValidId(id)) return json({ error: "invalid card id" }, 400);
	const body = await bodyOf(req);
	const root = await resolveRoot(req, body.cwd);
	try {
		const card = await moveCard(root, id, body.column);
		return json({ cwd: root, card });
	} catch (error) {
		return failure(error);
	}
}

/**
 * POST /api/board/<id>/handoff → `{ cwd, card, brief }`.
 *
 * Returns the card's body as the brief a caller starts an agent session from.
 * Deliberately does not start one: session creation owns its own auth,
 * workspace and history rules, and a board write must not become a session
 * spawn by side effect.
 */
export async function handleBoardHandoff(req: Request, id: string): Promise<Response> {
	if (!isValidId(id)) return json({ error: "invalid card id" }, 400);
	const body = await bodyOf(req);
	const root = await resolveRoot(req, body.cwd);
	try {
		const { card, brief } = await handoffCard(root, id, body.assign === true);
		return json({ cwd: root, card, brief });
	} catch (error) {
		return failure(error);
	}
}

/** DELETE /api/board/<id> → `{ ok: true, id }`. */
export async function handleBoardDelete(req: Request, id: string): Promise<Response> {
	if (!isValidId(id)) return json({ error: "invalid card id" }, 400);
	const root = await resolveRoot(req);
	try {
		await deleteCard(root, id);
		return json({ ok: true, id });
	} catch (error) {
		return failure(error);
	}
}

/** Map storage errors onto the gateway's `{ error }` contract. */
function failure(error: unknown): Response {
	if (error instanceof BoardInputError) return json({ error: error.message }, 400);
	if (error instanceof BoardFormatError) return json({ error: "not a card", reason: error.message }, 422);
	if (error instanceof NotFoundError) return json({ error: "card not found" }, 404);
	return json({ error: error instanceof Error ? error.message : String(error) }, 500);
}
