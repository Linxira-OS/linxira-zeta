/**
 * Where a conversation came from, when it is not a personal coding session.
 *
 * An IM/bot/relay conversation is still an ordinary transcript: the agent can
 * be used through it exactly like a personal session. What distinguishes it is
 * this header stamp, not a separate store, so Studio, the resume picker and the
 * gateway can keep it out of the personal lists while still offering it in an
 * "IM / Bot" group.
 *
 * The default workspace is a first-class Personal Harness workspace, not a
 * relay fallback: it may host several main agents at once (personal, WeChat,
 * Feishu, …), each owning its own session and channel/chat binding. The
 * optional {@link ImSessionOrigin.agentId} and {@link ImSessionOrigin.bindingId}
 * identify that pair; a relay conversation is simply the agent with no binding.
 * A mobile client scoped to one binding filters by these fields.
 *
 * A Team conversation (`kind: "team"`) is stamped when a session is created
 * inside a resolved Team location (a PM workspace, an engineer home worktree,
 * a task worktree, or a team base repository). Team sessions are ordinary
 * transcripts stored in the same per-cwd buckets; the stamp only lets the
 * resume picker keep them out of the personal scopes and group them as
 * Team → PM → engineer → repo → conversation.
 *
 * The stamp is optional and additive: sessions written before it existed (or
 * by an older build) carry no origin, and their `relay`/`bot`/`draft` web.yml
 * tag remains the fallback signal. A malformed stamp always reads as absent,
 * so a corrupt field can never hide a personal session.
 */
export type SessionOriginKind = "im" | "team";

export interface ImSessionOrigin {
	readonly kind: "im";
	/** Platform the chat arrived on (e.g. `telegram`), when known. */
	readonly channel?: string;
	/** Chat id bound to the session, when known. */
	readonly chatId?: string;
	/** Registry id of the bot session (`relay`, a short id, …). */
	readonly botSessionId?: string;
	/**
	 * Main agent that owns this conversation when the default workspace hosts
	 * several of them. Optional and additive: a single-agent deployment leaves
	 * it absent, and readers that predate it ignore it.
	 */
	readonly agentId?: string;
	/**
	 * Channel/chat binding identity of the main agent's conversation in the
	 * default workspace. A mobile client scoped to one binding filters by this
	 * field; the local Studio list instead groups by {@link kind}.
	 */
	readonly bindingId?: string;
	/**
	 * Workspace alias the session is bound to. Displayed instead of the
	 * absolute working directory so an IM row never leaks a host path.
	 */
	readonly workspaceAlias?: string;
}

/**
 * Team provenance of a session created inside a Team checkout.
 *
 * The ids are the Team database's deterministic row ids (`<team>:<name>`,
 * `<team>:<pm>:<engineer>`), so a stamp keeps matching the DB after a rename
 * of a display label. Every field except `teamId` is optional: a session
 * created at the Team root, or one whose location the DB could not enrich,
 * still carries its Team id. {@link workspaceAlias} is a display label built
 * from names only — a Team row never shows an absolute path.
 */
export interface TeamSessionOrigin {
	readonly kind: "team";
	readonly teamId: string;
	readonly pmId?: string;
	readonly engineerId?: string;
	readonly repoId?: string;
	readonly roomId?: string;
	readonly workspaceAlias?: string;
}

export type SessionOrigin = ImSessionOrigin | TeamSessionOrigin;

export interface SessionLocationLabelOptions {
	/** Label for an IM session with no workspace alias (defaults to `IM`). */
	readonly defaultWorkspaceLabel?: string;
}

/**
 * Validate an origin read off a header (or a client DTO). Anything that is not
 * a well-formed `im` or `team` origin — including malformed pre-release shapes,
 * an unknown kind, or a team stamp without a `teamId` — reads as absent, so a
 * corrupt field can never hide a personal session.
 */
export function normalizeSessionOrigin(value: unknown): SessionOrigin | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const field = (key: string): string | undefined => {
		const fieldValue = record[key];
		return typeof fieldValue === "string" && fieldValue.trim() ? fieldValue.trim() : undefined;
	};
	if (record.kind === "im") {
		const channel = field("channel");
		const chatId = field("chatId");
		const botSessionId = field("botSessionId");
		const workspaceAlias = field("workspaceAlias");
		const agentId = field("agentId");
		const bindingId = field("bindingId");
		return {
			kind: "im",
			...(channel === undefined ? {} : { channel }),
			...(chatId === undefined ? {} : { chatId }),
			...(botSessionId === undefined ? {} : { botSessionId }),
			...(workspaceAlias === undefined ? {} : { workspaceAlias }),
			...(agentId === undefined ? {} : { agentId }),
			...(bindingId === undefined ? {} : { bindingId }),
		};
	}
	if (record.kind === "team") {
		const teamId = field("teamId");
		// A Team stamp without its identity cannot be grouped or filtered; reading
		// it as absent keeps the session in the personal lists instead of hiding it.
		if (teamId === undefined) return undefined;
		const pmId = field("pmId");
		const engineerId = field("engineerId");
		const repoId = field("repoId");
		const roomId = field("roomId");
		const workspaceAlias = field("workspaceAlias");
		return {
			kind: "team",
			teamId,
			...(pmId === undefined ? {} : { pmId }),
			...(engineerId === undefined ? {} : { engineerId }),
			...(repoId === undefined ? {} : { repoId }),
			...(roomId === undefined ? {} : { roomId }),
			...(workspaceAlias === undefined ? {} : { workspaceAlias }),
		};
	}
	return undefined;
}

/** True when two origin stamps carry the same fields (order-insensitive). */
export function sameSessionOrigin(a: SessionOrigin | undefined, b: SessionOrigin | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === "im" && b.kind === "im") {
		return (
			a.channel === b.channel &&
			a.chatId === b.chatId &&
			a.botSessionId === b.botSessionId &&
			a.workspaceAlias === b.workspaceAlias &&
			a.agentId === b.agentId &&
			a.bindingId === b.bindingId
		);
	}
	if (a.kind === "team" && b.kind === "team") {
		return (
			a.teamId === b.teamId &&
			a.pmId === b.pmId &&
			a.engineerId === b.engineerId &&
			a.repoId === b.repoId &&
			a.roomId === b.roomId &&
			a.workspaceAlias === b.workspaceAlias
		);
	}
	return false;
}

/** True when the origin marks an IM/bot/relay conversation. */
export function isImSession(origin: SessionOrigin | undefined | null): origin is ImSessionOrigin {
	return origin?.kind === "im";
}

/** True when the origin marks a conversation created inside a Team checkout. */
export function isTeamSession(origin: SessionOrigin | undefined | null): origin is TeamSessionOrigin {
	return origin?.kind === "team";
}

/**
 * Where an IM session lives, for a list row, subtitle or tooltip:
 * its workspace alias, else `IM · <channel>`, else the caller's
 * default-workspace label. `undefined` for a personal session — callers keep
 * showing the workspace/cwd for those.
 */
export function sessionLocationLabel(
	origin: SessionOrigin | undefined | null,
	options: SessionLocationLabelOptions = {},
): string | undefined {
	if (!isImSession(origin)) return undefined;
	const alias = origin.workspaceAlias?.trim();
	if (alias) return alias;
	const channel = origin.channel?.trim();
	if (channel) return `IM · ${channel}`;
	return options.defaultWorkspaceLabel ?? "IM";
}

export interface TeamLocationLabelOptions {
	/** Label for a Team session with no workspace alias (defaults to `Team · <teamId>`). */
	readonly defaultTeamLabel?: string;
}

/**
 * Where a Team session lives, for a list row, subtitle or tooltip: its
 * name-based workspace alias, else `Team · <teamId>`, else the caller's
 * default label. `undefined` for a personal or IM session. The result is built
 * from names only, so a Team row never leaks an absolute host path.
 */
export function teamLocationLabel(
	origin: SessionOrigin | undefined | null,
	options: TeamLocationLabelOptions = {},
): string | undefined {
	if (!isTeamSession(origin)) return undefined;
	const alias = origin.workspaceAlias?.trim();
	if (alias) return alias;
	return options.defaultTeamLabel ?? `Team · ${origin.teamId}`;
}
