"use client";

/**
 * StudioRuntimeBanner — the disconnect strip above the workbench.
 *
 * Ported from OMP Studio (`apps/renderer/src/RuntimeLossBanner.tsx`, MIT).
 * Studio's banner owned the reconnect itself (`ensureRuntimeConnection` over the
 * Studio protocol). Zeta's gateway *is* the runtime, so there is nothing to
 * spawn: the banner is pure presentation over a `RuntimeConnection` the shell
 * already holds (from `StudioClient.bootstrap()` / `session.state`), and the
 * retry is a callback the shell wires to re-opening the event stream.
 *
 * The two copy builders Studio used (`formatRuntimeDisconnectCopy`, …) live in
 * its diagnostics module and map OMP's closed reason codes; here the reason
 * sentence the gateway pre-redacted is printed verbatim, which is all the
 * contract guarantees anyway.
 */

import type { RuntimeConnection } from "@/lib/studio-protocol/contract";
import { useI18n } from "@/hooks/useI18n";
import { Icon } from "../primitives/icons";

export interface StudioRuntimeBannerProps {
	runtime?: RuntimeConnection;
	/** `hub` swaps the workbench banner row for the Agent Hub's inline strip. */
	variant?: "workbench" | "hub";
	busy?: boolean;
	/** Extra line under the reason (a failed retry's message). */
	message?: string | null;
	onReconnect?: () => void;
}

export function StudioRuntimeBanner({
	runtime,
	variant = "workbench",
	busy = false,
	message = null,
	onReconnect,
}: StudioRuntimeBannerProps) {
	const { t } = useI18n();
	const status = runtime?.status ?? "unavailable";
	if (status !== "disconnected" && status !== "unavailable") return null;

	const title = t(
		status === "disconnected" ? "studio.chrome.runtime.disconnected" : "studio.chrome.runtime.unavailable",
	);
	const detail = status === "disconnected" ? runtime?.disconnectReason : runtime?.unavailableReason;

	return (
		<div className={`${variant === "hub" ? "hub-conn red" : "banner red"}${busy ? " is-busy" : ""}`} role="alert" aria-busy={busy || undefined}>
			<Icon name="alert" extra="sm" />
			<span>
				<b>{title}</b>
				{detail ? (
					<>
						{" · "}
						<span className={variant === "hub" ? "hc-detail" : "banner-detail"}>{detail}</span>
					</>
				) : null}
				{message ? <span className="banner-detail"> {message}</span> : null}
			</span>
			{onReconnect ? (
				<span className={variant === "hub" ? "hc-actions" : "banner-actions"}>
					<button type="button" className="btn small outline" disabled={busy} onClick={onReconnect}>
						{busy ? t("studio.chrome.runtime.retrying") : t("studio.chrome.runtime.retry")}
					</button>
				</span>
			) : null}
		</div>
	);
}
