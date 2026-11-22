/**
 * Team chat routing contract.
 *
 * This is deliberately model-free: mentions, direct messages and group
 * broadcasts are admission rules, not a prompt the coordinator may reinterpret.
 * The Team surface calls this before creating turns or injecting ambient
 * context into a worker's next tool-call boundary.
 */

export type TeamChatSurface = "dm" | "group";

export interface TeamChatParticipant {
	readonly id: string;
	readonly name: string;
	/** Additional exact labels a user may type after `@`. */
	readonly aliases?: readonly string[];
	readonly kind: "main" | "worker";
}

export type TeamChatDeliveryMode = "direct" | "ambient" | "assigned-elsewhere";

export interface TeamChatDelivery {
	readonly participantId: string;
	/**
	 * `direct` starts a turn for this participant. `ambient` is visible context
	 * injected at the participant's next tool-call boundary, without starting a
	 * turn. `assigned-elsewhere` only tells the other participants that the user
	 * explicitly assigned the message to someone else.
	 */
	readonly mode: TeamChatDeliveryMode;
}

export interface TeamChatRouteInput {
	readonly surface: TeamChatSurface;
	readonly senderId: string;
	readonly text: string;
	/** Required for a dm; ignored for a group. */
	readonly targetId?: string;
	/** Explicit `@` targets. Names are resolved against id/name/aliases exactly. */
	readonly mentions?: readonly string[];
}

export interface TeamChatRouteResult {
	readonly deliveries: readonly TeamChatDelivery[];
	/** Mention tokens that named no participant; the surface must show them to the user. */
	readonly unknownMentions: readonly string[];
}

function normalized(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function findParticipant(participants: readonly TeamChatParticipant[], token: string): TeamChatParticipant | undefined {
	const needle = normalized(token);
	if (!needle) return undefined;
	const exactId = participants.find(participant => normalized(participant.id) === needle);
	if (exactId) return exactId;
	return participants.find(
		participant =>
			normalized(participant.name) === needle ||
			participant.aliases?.some(alias => normalized(alias) === needle) === true,
	);
}

/**
 * Route a Team message to deliveries.
 *
 * Rules:
 * - dm: exactly the target gets a direct turn.
 * - group without mentions: every participant except the sender gets ambient
 *   context; nobody gets a turn solely for being in the room.
 * - group with mentions: each mentioned participant gets a direct turn; every
 *   other participant gets only an assignment notice. A main mention remains a
 *   main decision; this function never expands it to workers.
 * - agent senders use the same rules and never receive their own message.
 */
export function routeTeamChat(
	input: TeamChatRouteInput,
	participants: readonly TeamChatParticipant[],
): TeamChatRouteResult {
	const others = participants.filter(participant => participant.id !== input.senderId);
	if (input.surface === "dm") {
		const target = input.targetId ? findParticipant(participants, input.targetId) : undefined;
		if (!target || target.id === input.senderId) return { deliveries: [], unknownMentions: [] };
		return { deliveries: [{ participantId: target.id, mode: "direct" }], unknownMentions: [] };
	}

	const unknownMentions: string[] = [];
	const mentioned = new Map<string, TeamChatParticipant>();
	for (const token of input.mentions ?? []) {
		const participant = findParticipant(participants, token);
		if (!participant || participant.id === input.senderId) {
			unknownMentions.push(token);
			continue;
		}
		mentioned.set(participant.id, participant);
	}

	if (mentioned.size === 0) {
		return {
			deliveries: others.map(participant => ({ participantId: participant.id, mode: "ambient" })),
			unknownMentions,
		};
	}

	return {
		deliveries: others.map(participant =>
			mentioned.has(participant.id)
				? ({ participantId: participant.id, mode: "direct" } as const)
				: ({ participantId: participant.id, mode: "assigned-elsewhere" } as const),
		),
		unknownMentions,
	};
}
