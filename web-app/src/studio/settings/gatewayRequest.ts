/**
 * One JSON-over-gateway request, shared by the settings panes.
 *
 * The gateway owns every fact these panes show; this module only turns a
 * non-2xx answer into an `Error` carrying the gateway's own message, so a pane
 * can display the real reason instead of inventing one. The `fetcher` seam
 * keeps the response-shape tests free of a live server.
 */
import { isRecord } from "../typeGuards";
import { authFetch } from "../../host/authFetch";

export type GatewayFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Default fetcher: the host's authenticated fetch, which carries the
 * device-bound cookie and (for a native shell) an in-memory bearer token.
 * Imported directly rather than injected through a global, so there is exactly
 * one fetcher type and no aliasing.
 */
export const defaultGatewayFetch: GatewayFetch = (input, init) => authFetch(input, init);

async function readPayload(response: Response): Promise<unknown> {
	try {
		return (await response.json()) as unknown;
	} catch {
		return null;
	}
}

export async function gatewayJson(
	fetcher: GatewayFetch,
	input: string,
	init?: RequestInit,
): Promise<unknown> {
	const response = await fetcher(input, init);
	const payload = await readPayload(response);
	if (!response.ok) {
		const detail = isRecord(payload) && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
		throw new Error(detail);
	}
	return payload;
}
