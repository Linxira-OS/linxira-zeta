/**
 * `/join` link resolution against this install's own relay.
 *
 * The wire grammar accepts a host-less `<roomId>.<key>` link and resolves it
 * against the canonical relay — infrastructure upstream operates. Zeta ships no
 * relay, so before a guest dials anything the link is resolved against
 * `collab.relayUrl`: a bare link means "the relay this install is configured
 * for", and with none configured the join is refused instead of connecting to a
 * host the user never chose. Full links carry their own host and pass through.
 */
import { isBareCollabLink } from "./protocol";
import { COLLAB_RELAY_MISSING_MESSAGE } from "./settings";

export function resolveCollabJoinLink(link: string, relayUrl: string): string {
	if (!isBareCollabLink(link)) return link;
	const relay = relayUrl.trim();
	if (!relay) throw new Error(COLLAB_RELAY_MISSING_MESSAGE);
	// Scheme-less relays dial over wss, matching the hosting path.
	return `${relay.includes("://") ? relay : `wss://${relay}`}/r/${link.trim()}`;
}
