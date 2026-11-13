/**
 * Which client initiated a session or a run.
 *
 * This is durable provenance metadata only: it is never an authorization
 * signal, never grants a role, and is never inferred from a cwd, a URL, or the
 * process shape. A writer stamps the kind it actually is; a reader that finds
 * nothing must report "unknown" rather than guess (the earlier behaviour of
 * treating an absent stamp as CLI is deliberately not repeated).
 *
 * Two levels share this one field name, so there is no parallel `initiatedBy`
 * authority:
 * - `SessionHeader.client` — the client that created the session.
 * - `SessionRunInitEntry.client` — the client that started a later run of that
 *   session (resume/attach), leaving the creator's header untouched.
 * - `SessionInitEntry.client` — the client that initiated a subagent run.
 *
 * IM/Team `origin` remains a separate, orthogonal dimension: a session can be
 * created by the web client inside an IM chat, and each run can still be
 * initiated by another client.
 */
export type SessionClient = "cli" | "web" | "desktop" | "automation";

export const SESSION_CLIENTS: readonly SessionClient[] = ["cli", "web", "desktop", "automation"];

/** HTTP header a transport may use to declare the client it actually is. */
export const SESSION_CLIENT_HEADER = "x-zeta-client";

/**
 * Validate a persisted/client-supplied kind. Anything outside the closed set —
 * including a missing field on a legacy transcript — reads as absent (unknown),
 * so a corrupt or unknown value can never be mistaken for a real client.
 */
export function normalizeSessionClient(value: unknown): SessionClient | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return SESSION_CLIENTS.find(client => client === normalized);
}

/** Validate the `x-zeta-client` header value. Metadata only; never used for auth. */
export function clientFromHeaderValue(value: string | null | undefined): SessionClient | undefined {
	return normalizeSessionClient(value ?? undefined);
}

/** Read-side pair: who created the session, and who initiated its latest run. */
export interface SessionProvenance {
	/** Creator, from the header. Absent on legacy transcripts (unknown, never guessed). */
	readonly client?: SessionClient;
	/** Latest run initiator, from the newest durable `run_init` entry. */
	readonly runClient?: SessionClient;
}
