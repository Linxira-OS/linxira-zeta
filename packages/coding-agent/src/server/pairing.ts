/**
 * Phone pairing: one payload that carries both the served origin and the
 * remote token, rendered as a QR the settings panel can display.
 *
 * The payload is a URL with the token in the fragment
 * (`https://host:port/#zeta-token=…`). A fragment is never sent to the server
 * and never lands in proxy logs, and the web UI consumes it on boot into
 * `localStorage` (see `web-ui/lib/pairing.ts`), so scanning a code is the whole
 * pairing flow. The QR encoder is the dependency-free one the TUI already uses
 * for `/collab` join codes.
 */

import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import { QrCode } from "@linxiraos/pi-tui/chrome/qrcode";
import type { WebConfigData } from "../config/web-config";

/** Fragment parameter carrying the remote token. */
export const PAIRING_FRAGMENT_KEY = "zeta-token";

export interface PairingPayloadOptions {
	/** Base origin the phone should open, e.g. `https://zeta.example.com:43141`. */
	url: string;
	token: string;
}

/** Build the scanned payload; throws on a missing token or non-HTTP base. */
export function buildPairingPayload({ url, token }: PairingPayloadOptions): string {
	const trimmedToken = token.trim();
	if (trimmedToken === "") throw new Error("Cannot build a pairing payload without a remote token");
	let base: URL;
	try {
		base = new URL(url.trim());
	} catch {
		throw new Error(`Invalid pairing URL: ${url}`);
	}
	if (base.protocol !== "http:" && base.protocol !== "https:") {
		throw new Error(`Pairing URL must be http(s): ${url}`);
	}
	base.hash = "";
	base.search = "";
	return `${base.origin}${base.pathname.replace(/\/+$/, "")}/#${PAIRING_FRAGMENT_KEY}=${encodeURIComponent(trimmedToken)}`;
}

export interface ParsedPairingPayload {
	/** Origin (plus any base path) the phone should load. */
	url: string;
	token: string;
}

/** Inverse of {@link buildPairingPayload}; `null` for anything else. */
export function parsePairingPayload(payload: string): ParsedPairingPayload | null {
	let parsed: URL;
	try {
		parsed = new URL(payload.trim());
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
	const token = fragment.get(PAIRING_FRAGMENT_KEY)?.trim() ?? "";
	if (token === "") return null;
	const url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
	return { url, token };
}

/**
 * Render a payload as a self-contained SVG QR symbol. The web-ui drops the
 * markup into the settings panel; there is no script or external reference in
 * it, and module coordinates are integers so the browser can scale it crisply.
 */
export function renderPairingQrSvg(payload: string, options: { margin?: number } = {}): string {
	const qr = QrCode.encodeText(payload, "M");
	const margin = Math.max(0, Math.trunc(options.margin ?? 4));
	const size = qr.size + margin * 2;
	const segments: string[] = [];
	for (let y = 0; y < qr.size; y++) {
		for (let x = 0; x < qr.size; x++) {
			if (qr.module(x, y)) segments.push(`M${x + margin} ${y + margin}h1v1h-1z`);
		}
	}
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Zeta pairing code" shape-rendering="crispEdges">`,
		`<rect width="${size}" height="${size}" fill="#ffffff"/>`,
		`<path fill="#111827" d="${segments.join("")}"/>`,
		"</svg>",
	].join("");
}

/** First non-internal IPv4 address — the LAN address a phone can dial. */
export function firstLanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | null {
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (!entry.internal && entry.family === "IPv4" && entry.address !== "") return entry.address;
		}
	}
	return null;
}

/**
 * Pick the origin the QR should carry, most specific first:
 * 1. an explicit `url` (the settings panel asks the server to derive it, but a
 *    reverse-proxy user can override);
 * 2. `remote.publicUrl` from web.yml (proxy / tunnel / stable hostname);
 * 3. the request's own origin when it is not loopback (the phone is already
 *    using the reachable URL);
 * 4. the machine's first LAN IPv4 with the request's port;
 * 5. the request origin (last resort: useful only for same-machine pairing).
 */
export function resolvePairingBaseUrl(input: {
	requestUrl: string;
	config?: WebConfigData;
	explicitUrl?: string | null;
	lanAddress?: string | null;
}): string {
	const request = new URL(input.requestUrl);
	if (input.explicitUrl) return input.explicitUrl.trim();
	const configured = input.config?.remote?.publicUrl?.trim();
	if (configured) return configured;
	const requestHost = request.hostname;
	if (requestHost !== "127.0.0.1" && requestHost !== "localhost" && requestHost !== "::1" && requestHost !== "[::1]") {
		return `${request.origin}`;
	}
	// `undefined` asks for probe; explicit `null` means "no LAN address".
	const lan = input.lanAddress === undefined ? firstLanAddress() : input.lanAddress;
	if (lan) return `${request.protocol}//${lan}${request.port ? `:${request.port}` : ""}`;
	return `${request.origin}`;
}
