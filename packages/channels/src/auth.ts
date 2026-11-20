/**
 * Inbound authorization for IM channel instances.
 *
 * Every instance is deny-by-default: an enabled instance with an empty peer
 * list must not start. The instance id (not the platform) is the namespace, so
 * two accounts of the same platform never share a rule.
 */

import type { ChannelInstanceId, ChannelPlatform } from "./channel";

export const CHANNEL_PEER_REFUSED_TEXT =
	"⛔ 未授权：该账号不在本渠道实例的白名单中。/ Not authorized: this chat is not listed in the channel instance allowlist.";

export interface PeerIdentity {
	peer: string;
	senderId?: string;
	/** Extra identities a rule may match, e.g. Discord `guild:<id>`. */
	allowKeys?: readonly string[];
}

export interface ChannelAllowRule {
	peers: readonly string[];
	users?: readonly string[];
}

export interface ChannelAllowlists {
	perInstance: Partial<Record<ChannelInstanceId, ChannelAllowRule>>;
}

/** True when this instance has no peers and no QQ user allowlist (it must refuse to start). */
export function isAllowlistEmpty(
	instanceId: ChannelInstanceId,
	allow: ChannelAllowlists,
	platform?: ChannelPlatform,
): boolean {
	const rule = allow.perInstance[instanceId];
	if (!rule) return true;
	if (rule.peers.length > 0) return false;
	// QQ direct messages are authorized by allowedUsers, so a users-only rule is
	// a real allowlist even when no group/channel peer is listed.
	return !(platform === "qq" && (rule.users?.length ?? 0) > 0);
}

/** Instance-scoped authorization; an unknown instance denies. */
export function isPeerAllowedFor(
	instanceId: ChannelInstanceId,
	identity: PeerIdentity,
	allow: ChannelAllowlists | null | undefined,
	platform?: ChannelPlatform,
): boolean {
	const rule = allow?.perInstance?.[instanceId];
	if (!rule) return false;
	const keys = new Set<string>([identity.peer, ...(identity.allowKeys ?? [])]);
	const users = rule.users ?? [];
	// QQ's user list scopes direct messages; group conversations are governed by
	// the group peer list alone (matching the pre-instance adapter behavior).
	// A listed DM user is authorized even when only group peers are configured:
	// legacy web.yml stored `allowedGroups` in peers and `allowedUsers` apart.
	if (platform === "qq" && identity.peer.startsWith("user:")) {
		const userId = identity.peer.slice("user:".length);
		if (users.includes(userId) || (identity.senderId !== undefined && users.includes(identity.senderId))) {
			return true;
		}
	}
	if (rule.peers.length === 0) return false;
	if (!rule.peers.some(peer => keys.has(peer))) return false;
	if (users.length === 0) return true;
	if (platform === "qq") {
		if (identity.peer.startsWith("group:")) return true;
		if (identity.peer.startsWith("user:")) {
			return (
				users.includes(identity.peer.slice("user:".length)) ||
				(identity.senderId !== undefined && users.includes(identity.senderId))
			);
		}
	}
	if (!identity.senderId) return false;
	return users.includes(identity.senderId);
}
