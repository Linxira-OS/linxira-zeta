/**
 * Map the gateway's `GET /api/update/check` reply onto the shape the Studio
 * diagnostics UI consumes (`zetaStudioChrome.checkUpdates`).
 *
 * The desktop shell has no updater of its own: the shipped `zetacode`/service
 * owns runtime updates (`/api/update/*`), and the Electron bundle updates
 * through the release installer, which cannot replace a running app. So an
 * app-side "full" plan is never advertised here — only the runtime artifact
 * the gateway reports. Returning the raw service answer keeps the UI honest
 * instead of promising a download path this build does not have.
 */
import { isRecord } from "./json";

export interface DesktopUpdateCheck {
	readonly checkedAt: string;
	readonly app: {
		readonly currentVersion?: string;
		readonly plan: "none";
	};
	readonly runtime: {
		readonly plan: "none" | "available" | "blocked";
		readonly runtimeVersion?: string;
		readonly reason?: string;
	};
	readonly error?: string;
}

/** `GET /api/update/check` (`{ current, latest, available }`) → UI snapshot. */
export function mapUpdateCheck(
	payload: unknown,
	currentVersion: string,
	checkedAt: string = new Date().toISOString(),
): DesktopUpdateCheck {
	const app = { currentVersion, plan: "none" as const };
	if (!isRecord(payload)) {
		return { checkedAt, app, runtime: { plan: "none", reason: "The update service returned no data." } };
	}
	if (typeof payload.error === "string" && payload.error !== "") {
		return { checkedAt, app, runtime: { plan: "none" }, error: payload.error };
	}
	const latest = typeof payload.latest === "string" ? payload.latest : undefined;
	if (payload.available === true && latest !== undefined) {
		return { checkedAt, app, runtime: { plan: "available", runtimeVersion: latest } };
	}
	if (payload.available === false) {
		return { checkedAt, app, runtime: { plan: "none" } };
	}
	return { checkedAt, app, runtime: { plan: "none", reason: "The update service returned no version." } };
}
