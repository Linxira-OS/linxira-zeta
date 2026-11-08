/**
 * Inbound peer authorization for IM channels.
 *
 * `channels.allowedPeers` is the operator's allowlist: when it is non-empty,
 * only those platform peer ids (Telegram chat id, Feishu chat id, WeChat user
 * id) may reach the agent. The check MUST run before any inbound dispatch —
 * command router, workspace/direct session, bot session or relay — because
 * every one of those can open a workspace or start a turn on the operator's
 * machine.
 */

/** Sent back to a peer that is not in `channels.allowedPeers`. */
export const CHANNEL_PEER_REFUSED_TEXT =
	"⛔ 未授权：该账号不在 channels.allowedPeers 中。/ Not authorized: this chat is not listed in channels.allowedPeers.";

/**
 * Whether `peer` may reach the agent. An empty/absent allowlist keeps the
 * historical open behavior (every peer allowed).
 */
export function isPeerAllowed(peer: string, allowedPeers: readonly string[] | null | undefined): boolean {
	if (!allowedPeers || allowedPeers.length === 0) return true;
	return allowedPeers.includes(peer);
}
