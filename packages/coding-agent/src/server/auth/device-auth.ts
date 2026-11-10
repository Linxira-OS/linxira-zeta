/**
 * HTTP surface for device credentials — `GET /api/remote/devices`,
 * `DELETE /api/remote/devices/:id`, `POST /api/remote/devices/revoke-all`.
 *
 * These routes sit behind the gateway's existing access gate (loopback, or a
 * valid `remote.token` / device token) and its Origin guard, so they add no
 * second entry point. What they add is the ability to see and revoke one
 * device instead of rotating the one machine-wide token.
 *
 * A `read`-only device may list; revoking needs `write`. Nothing here ever
 * returns a token or its hash: the plaintext exists only in the response to
 * the pairing call that minted it (see `studio-host/server.ts`).
 */

import { WebConfig } from "../../config/web-config";
import { deviceRegistry, type DeviceRegistry, type DeviceRecord } from "./device-registry";

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Who is asking: the legacy machine token, one device, or nobody identifiable. */
export interface CallerIdentity {
	readonly kind: "legacy" | "device" | "none";
	readonly device?: DeviceRecord;
}

/**
 * Identify the caller from the presented credential. A device token resolves
 * to its record; the legacy `remote.token` resolves to `legacy`; a loopback
 * caller with no credential is `none` (trusted by socket, as everywhere else).
 *
 * Uses the non-touching lookup: listing devices must not write `lastSeenAt`.
 */
export async function identifyCaller(
	req: Request,
	registry: DeviceRegistry = deviceRegistry(),
): Promise<CallerIdentity> {
	const provided = req.headers.get("authorization") ?? req.headers.get("x-zeta-token") ?? "";
	const device = await registry.findByToken(provided);
	if (device !== undefined) return { kind: "device", device };
	return { kind: "none" };
}

/** `GET /api/remote/devices` — active devices plus the caller's own id. */
export async function handleDevicesGet(req: Request, registry: DeviceRegistry = deviceRegistry()): Promise<Response> {
	if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
	const caller = await identifyCaller(req, registry);
	const config = await WebConfig.load();
	return json({
		devices: await registry.list(),
		currentDeviceId: caller.device?.id ?? null,
		legacyTokenActive: config.getRemoteToken() !== undefined,
	});
}

/**
 * `DELETE /api/remote/devices/:id` — revoke one device.
 *
 * Idempotent: a repeated delete of a known id answers 200 with
 * `revoked: false`; an unknown id answers 404 so a typo is distinguishable
 * from an already-revoked row without leaking whether arbitrary ids exist.
 * Self-revocation is allowed on purpose: this response is the last one that
 * device's token authorizes.
 */
export async function handleDeviceDelete(
	req: Request,
	id: string,
	registry: DeviceRegistry = deviceRegistry(),
): Promise<Response> {
	if (req.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
	const caller = await identifyCaller(req, registry);
	// Only a resolved device token can be scope-limited; loopback and the
	// legacy machine token keep the machine-wide rights they have today.
	if (caller.kind === "device" && !(caller.device?.scopes.includes("write") ?? false)) {
		return json({ error: "insufficient_scope" }, 403);
	}
	const trimmed = id.trim();
	if (trimmed === "") return json({ error: "unknown_device" }, 404);
	const outcome = await registry.revoke(trimmed);
	if (!outcome.found) return json({ error: "unknown_device" }, 404);
	return json({ ok: true, revoked: outcome.revoked, current: caller.device?.id === trimmed });
}

/**
 * `POST /api/remote/devices/revoke-all` — revoke every active device.
 *
 * `keepCurrent` (default false) spares the calling device. The legacy
 * `remote.token` is deliberately untouched: it has its own revoke route, and
 * conflating the two would make "revoke all devices" silently break machines
 * that never paired one.
 */
export async function handleDevicesRevokeAllPost(
	req: Request,
	registry: DeviceRegistry = deviceRegistry(),
): Promise<Response> {
	if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
	const caller = await identifyCaller(req, registry);
	if (caller.kind === "device" && !(caller.device?.scopes.includes("write") ?? false)) {
		return json({ error: "insufficient_scope" }, 403);
	}
	let keepCurrent = false;
	try {
		const body: unknown = await req.json();
		if (body !== null && typeof body === "object" && "keepCurrent" in body) {
			const value = body.keepCurrent;
			if (typeof value !== "boolean") return json({ error: "Expected { keepCurrent?: boolean }" }, 400);
			keepCurrent = value;
		}
	} catch {
		// An empty body is a valid "revoke everything".
	}
	const keepId = keepCurrent && caller.device !== undefined ? caller.device.id : undefined;
	const result = await registry.revokeAll(keepId !== undefined ? { keepId } : {});
	return json({ ok: true, revoked: result.revoked });
}
