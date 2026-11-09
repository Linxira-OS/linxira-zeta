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
 * optional {@link SessionOrigin.agentId} and {@link SessionOrigin.bindingId}
 * identify that pair; a relay conversation is simply the agent with no binding.
 * A mobile client scoped to one binding filters by these fields.
 *
 * The stamp is optional and additive: sessions written before it existed (or
 * by an older build) carry no origin, and their `relay`/`bot`/`draft` web.yml
 * tag remains the fallback signal.
 */
export type SessionOriginKind = "im";

export interface SessionOrigin {
	readonly kind: SessionOriginKind;
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

export interface SessionLocationLabelOptions {
	/** Label for an IM session with no workspace alias (defaults to `IM`). */
	readonly defaultWorkspaceLabel?: string;
}

/**
 * Validate an origin read off a header (or a client DTO). Anything that is not
 * an `im` origin — including malformed pre-release shapes — reads as absent, so
 * a corrupt field can never hide a personal session.
 */
export function normalizeSessionOrigin(value: unknown): SessionOrigin | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (record.kind !== "im") return undefined;
	const field = (key: string): string | undefined => {
		const fieldValue = record[key];
		return typeof fieldValue === "string" && fieldValue.trim() ? fieldValue.trim() : undefined;
	};
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

/** True when two origin stamps carry the same fields (order-insensitive). */
export function sameSessionOrigin(a: SessionOrigin | undefined, b: SessionOrigin | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.kind === b.kind &&
		a.channel === b.channel &&
		a.chatId === b.chatId &&
		a.botSessionId === b.botSessionId &&
		a.workspaceAlias === b.workspaceAlias &&
		a.agentId === b.agentId &&
		a.bindingId === b.bindingId
	);
}

/** True when the origin marks an IM/bot/relay conversation. */
export function isImSession(origin: SessionOrigin | undefined | null): boolean {
	return origin?.kind === "im";
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
	const alias = origin?.workspaceAlias?.trim();
	if (alias) return alias;
	const channel = origin?.channel?.trim();
	if (channel) return `IM · ${channel}`;
	return options.defaultWorkspaceLabel ?? "IM";
}
