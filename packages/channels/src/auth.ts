/**
 * Inbound peer authorization for IM channels.
 *
 * Two layers exist because the platforms differ:
 *
 * - `channels.allowedPeers` is the historical, channel-agnostic allowlist. An
 *   empty list keeps the old open behavior; every existing WeChat / Feishu /
 *   Telegram config relies on it.
 * - `channels.<id>.allowed*` is the per-platform list added for Discord and
 *   QQ. These channels are **deny-by-default**: an enabled channel with an
 *   empty list must not start, because a public Discord guild or a QQ group is
 *   reachable by strangers who could otherwise open workspaces and start turns.
 *
 * The check MUST run before any inbound dispatch — command router,
 * workspace/direct session, bot session or relay — because every one of those
 * can open a workspace or start a turn on the operator's machine.
 */

import type { ChannelId } from "./channel";

/** Sent back to a peer that is not in the channel's allowlist. */
export const CHANNEL_PEER_REFUSED_TEXT =
	"⛔ 未授权：该账号不在 channels.allowedPeers 中。/ Not authorized: this chat is not listed in channels.allowedPeers.";

/** Who sent one inbound message, as far as authorization is concerned. */
export interface PeerIdentity {
	/** Conversation id (`peer`). */
	peer: string;
	senderId?: string;
	/** Extra identities a rule may match, e.g. `guild:<id>`. */
	allowKeys?: readonly string[];
}

/** One platform's allow rule. */
export interface ChannelAllowRule {
	/** Conversation ids (or `allowKeys`) allowed. Empty denies when `denyWhenEmpty`. */
	peers?: readonly string[];
	/** Sender ids allowed inside an allowed conversation; empty = anyone. */
	users?: readonly string[];
	/** `true` for platforms that must never fall back to "everyone". */
	denyWhenEmpty?: boolean;
}

export interface ChannelAllowlists {
	/** Historic global list; empty/absent means every peer is allowed. */
	legacy?: readonly string[];
	/** Per-platform rule; absent means the legacy semantics apply. */
	perChannel?: Partial<Record<ChannelId, ChannelAllowRule>>;
}

/**
 * Whether `peer` may reach the agent. An empty/absent legacy allowlist keeps
 * the historical open behavior (every peer allowed).
 */
export function isPeerAllowed(peer: string, allowedPeers: readonly string[] | null | undefined): boolean {
	if (!allowedPeers || allowedPeers.length === 0) return true;
	return allowedPeers.includes(peer);
}

/**
 * Channel-aware authorization. A per-channel rule always wins: an empty peer
 * list denies (for deny-by-default platforms), and a non-empty user list
 * narrows an allowed conversation to those senders.
 */
export function isPeerAllowedFor(
	channelId: ChannelId,
	identity: PeerIdentity,
	allow: ChannelAllowlists | null | undefined,
): boolean {
	const rule = allow?.perChannel?.[channelId];
	if (!rule) return isPeerAllowed(identity.peer, allow?.legacy);

	const peers = rule.peers ?? [];
	if (peers.length === 0) {
		if (rule.denyWhenEmpty) return false;
		return isPeerAllowed(identity.peer, allow?.legacy);
	}

	const keys = new Set<string>([identity.peer, ...(identity.allowKeys ?? [])]);
	if (!peers.some(peer => keys.has(peer))) return false;

	const users = rule.users ?? [];
	if (users.length === 0) return true;
	if (!identity.senderId) return false;
	return users.includes(identity.senderId);
}

/** True when the platform's rule is empty, i.e. the channel must not start. */
export function isAllowlistEmpty(channelId: ChannelId, allow: ChannelAllowlists | null | undefined): boolean {
	const rule = allow?.perChannel?.[channelId];
	if (!rule) return false;
	return (rule.peers ?? []).length === 0;
}
