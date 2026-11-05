"use client";

/**
 * The native approval host is shared by workspaces; its card must remain
 * answerable off the conversation route.
 *
 * Ported from OMP Studio (MIT) `deck/SecondaryInteractionDeck.tsx`. Studio's
 * version called `client.command("interaction.respond")` and awaited a Host
 * receipt; Zeta answers the same prompt with a plain
 * `POST /api/extension-ui/response`, so the responder arrives as a prop and
 * this file stays transport-free.
 */

import { useEffect, useRef, useState } from "react";
import type { ClientInteraction, InteractionResponseValue } from "@/lib/studio-protocol/contract";
import { InteractionDeck } from "./InteractionDeck";
import { hostErrorMessage } from "../primitives/hostError";
import { useI18n } from "../i18n";
import { interactionDeckDisabled } from "./interactionGate";

export function SecondaryInteractionDeck({
	interaction,
	onRespond,
	runtimeConnected,
	resyncRequired,
}: {
	interaction: ClientInteraction | null;
	/** Resolves `false` when the answer did not reach the session, so the card stays up. */
	onRespond: (decision: "submit" | "cancel", value?: InteractionResponseValue) => boolean | Promise<boolean>;
	runtimeConnected: boolean;
	resyncRequired: boolean;
}) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const current = useRef(interaction);
	current.current = interaction;
	useEffect(() => {
		setError("");
		setBusy(false);
	}, [interaction?.interactionId, interaction?.leaseGeneration]);
	if (!interaction) return null;
	const respond = async (
		decision: "submit" | "cancel",
		value?: InteractionResponseValue,
	): Promise<boolean> => {
		const target = interaction;
		if (busy || current.current !== target) return false;
		setBusy(true);
		setError("");
		try {
			const ok = await onRespond(decision, value);
			return ok !== false;
		} catch (cause) {
			if (current.current?.interactionId === target.interactionId) {
				setError(
					hostErrorMessage(
						cause,
						zh ? "响应失败，请检查连接后重试。" : "Response failed. Check the connection and retry.",
					),
				);
			}
			return false;
		} finally {
			if (current.current?.interactionId === target.interactionId) setBusy(false);
		}
	};
	return (
		<div
			className="secondary-interactions"
			role="dialog"
			aria-label={zh ? "待处理的审批与提问" : "Pending approval or question"}
		>
			<InteractionDeck
				interaction={interaction}
				onRespond={respond}
				disabled={busy || interactionDeckDisabled({ runtimeConnected, resyncRequired })}
			/>
			{error ? (
				<p role="alert" className="session-options-error">
					{error}
				</p>
			) : null}
		</div>
	);
}
