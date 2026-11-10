/**
 * `POST /api/channels/send` — the IM write entry.
 *
 * The channel runtime (`@linxiraos/pi-channels`' `startChannels`) lives inside
 * the `zeta serve` process and its only outbound sink used to be the in-process
 * `channel_send` tool: `GET /api/channels*` was read-only, so anything *outside*
 * the process — the desktop shell, a GUI's notification fallback, a script —
 * could see channel state but not send anything. This route is that seam.
 *
 * Body: `{ channelId: "wechat"|"feishu"|"telegram", to: "<peer id>", text: "<message>" }`
 * — exactly the three arguments of the runtime's `ChannelRuntime.sendText`, and
 * of `ChannelSendFn` (`packages/channels/src/host.ts`), so nothing is invented
 * on either side. The gateway needs all three: it has no chat of its own to
 * default to, and guessing a recipient is how a notification reaches the wrong
 * person.
 *
 * Answers, in the runtime's own vocabulary rather than by sniffing error text at
 * the HTTP edge:
 *
 * | status | meaning |
 * |---|---|
 * | 200 | the channel took it; the body carries the receipt (channel, peer, length, time) |
 * | 400 | a field is missing/blank, or the peer is not paired with that channel |
 * | 404 | no such channel is running in this process |
 * | 500 | the channel reached the platform and the platform refused |
 *
 * Access control is the gateway's, unchanged: loopback passes, a non-loopback
 * caller must present `remote.token` (see `webGatewayFetch`). This route can
 * send messages as the user, so it deliberately does not open a second door —
 * it rides the same {@link authorizedForAccess} gate as `/api/channels/status`.
 *
 * The runtime sink is a module-level registration, the same seam
 * `running-sessions.ts` and `packages/channels/src/index.ts` use: the gateway
 * dispatches in-process, so `zeta-server` (which owns `startChannels`) wires
 * {@link registerChannelSend} and clears it when the runtime stops.
 */

import { logger } from "@linxiraos/pi-utils";
import type { ChannelId } from "../../channels";
import { triggerRestartChannels } from "../../channels";
import { runCredentialLogin } from "../../channels/credential-login";
import { WebConfig } from "../../config/web-config";
import { renderQrSvg } from "../pairing";

/** Why a send did not happen, in the runtime's terms. */
export type ChannelSendFailure =
	/** No such channel is enabled in this process. */
	| "unknown-channel"
	/** The channel is running but has no binding for that peer. */
	| "unpaired"
	/** The channel accepted the call and the platform rejected it. */
	| "failed";

/** A runtime push's result: the receipt, or the reason there is none. */
export type ChannelSendOutcome =
	| { ok: true; channelId: ChannelId; to: string }
	| { ok: false; kind: ChannelSendFailure; message: string };

/** The runtime sink: one channel send, resolved against the live runtime. */
export type ChannelSendSink = (channelId: ChannelId, to: string, text: string) => Promise<ChannelSendOutcome>;

let sink: ChannelSendSink | null = null;

/** Register the live channel runtime's send path (`null` when it stops). */
export function registerChannelSend(fn: ChannelSendSink | null): void {
	sink = fn;
}

/**
 * Which failure a channel's own error describes.
 *
 * A channel reports an unreachable peer two different ways: WeChat refuses
 * before it sends (its outbound path needs the peer's `context_token`, which
 * only an inbound message creates, and the token map is private to the
 * adapter), while Telegram/Feishu learn it from the platform during the send.
 * WeChat's refusal is a caller error — that peer was never paired — so it maps
 * to 400; everything else reached the platform and is a delivery failure (500).
 */
export function classifySendError(message: string): ChannelSendFailure {
	return /no context token for peer/i.test(message) ? "unpaired" : "failed";
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

/** A required body field: the trimmed text when it carries one, else `null`. */
function requiredText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/** Image payloads (`data:image/…` or an image URL) are shown as images, not re-encoded. */
const QR_IMAGE_PAYLOAD = /^(data:image\/|https?:\/\/[^\s]*\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$))/i;

/**
 * The WeChat login QR as SVG, for surfaces that must draw a scannable symbol
 * without a QR library of their own (Work Studio, the desktop shell).
 *
 * `qrcodeUrl` is the content WeChat expects a phone to read, so encoding it
 * locally is what the terminal login does with block characters. Image
 * payloads and payloads too large for a version-40 symbol are left to the
 * caller: the route still returns `qrcodeUrl`, and the surface renders it as
 * an image instead of pretending to have a symbol.
 */
export function renderWechatLoginQrSvg(qrcodeUrl: string): string | undefined {
	const payload = qrcodeUrl.trim();
	if (payload === "" || QR_IMAGE_PAYLOAD.test(payload)) return undefined;
	try {
		return renderQrSvg(payload, { label: "WeChat login QR" });
	} catch (error) {
		logger.warn("Could not encode the WeChat login QR", {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

/** `POST /api/channels/send` — see the module doc for the contract. */
export async function handleChannelSend(req: Request): Promise<Response> {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return json({ error: "Invalid JSON body: expected an object" }, 400);
	}
	const record = body as Record<string, unknown>;
	const channelId = requiredText(record.channelId);
	if (!channelId) return json({ error: "Missing channelId" }, 400);
	const to = requiredText(record.to);
	if (!to) return json({ error: "Missing to: no peer to send to" }, 400);
	const text = requiredText(record.text);
	if (!text) return json({ error: "Missing text" }, 400);

	const send = sink;
	if (!send) return json({ error: "IM channels are not started" }, 404);

	let outcome: ChannelSendOutcome;
	try {
		outcome = await send(channelId as ChannelId, to, text);
	} catch (error) {
		// A sink that throws is a wiring fault, not a caller error: report it as
		// a server failure instead of dressing it up as a bad request.
		return json({ error: error instanceof Error ? error.message : String(error) }, 500);
	}
	if (outcome.ok) {
		return json({
			ok: true,
			receipt: {
				channelId: outcome.channelId,
				to: outcome.to,
				textLength: text.length,
				sentAt: new Date().toISOString(),
			},
		});
	}
	switch (outcome.kind) {
		case "unknown-channel":
			return json({ error: outcome.message }, 404);
		case "unpaired":
			return json({ error: outcome.message }, 400);
		case "failed":
			return json({ error: outcome.message }, 500);
	}
}

/**
 * `POST /api/channels/credentials` — validate, then save, a Feishu app
 * credential, a Telegram/Discord bot token, or a QQ OneBot endpoint.
 *
 * The GUI and the CLI call the same `runCredentialLogin`: the platform must
 * accept the credential before `web.yml` changes, and the response carries the
 * bot identity the platform reported so the surface can show who was paired.
 * A rejected credential is a caller error (400); a platform timeout is 504.
 *
 * Body: `{ channel: "feishu", appId?, appSecret?, domain? }`,
 * `{ channel: "telegram" | "discord", botToken? }`, or
 * `{ channel: "qq", endpoint?, token?, mode?, port? }`. Omitted fields fall
 * back to the values already stored, so "re-validate what is saved" is the
 * same route. Nothing is written unless the platform (or, for QQ forward
 * mode, the bridge's `get_login_info`) accepted it.
 */
export async function handleChannelCredentials(req: Request): Promise<Response> {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return json({ error: "Invalid JSON body: expected an object" }, 400);
	}
	const record = body as Record<string, unknown>;
	const channel = requiredText(record.channel);
	if (channel !== "feishu" && channel !== "telegram" && channel !== "discord" && channel !== "qq") {
		return json({ error: 'channel must be "feishu", "telegram", "discord" or "qq"' }, 400);
	}
	const field = (key: string): string | undefined => requiredText(record[key]) ?? undefined;
	const port = typeof record.port === "number" && Number.isInteger(record.port) ? record.port : undefined;

	const result = await runCredentialLogin(channel, {
		webConfig: await WebConfig.shared(),
		appId: field("appId"),
		appSecret: field("appSecret"),
		domain: record.domain === "lark" ? "lark" : record.domain === "feishu" ? "feishu" : undefined,
		botToken: field("botToken"),
		endpoint: field("endpoint"),
		token: field("token"),
		mode: record.mode === "reverse" ? "reverse" : record.mode === "forward" ? "forward" : undefined,
		port,
	});
	if (result.state !== "connected") {
		return json(
			{ channel, state: result.state, error: result.error ?? "Credential validation failed" },
			result.state === "timeout" ? 504 : 400,
		);
	}
	// The running serve process binds the old credential; make it re-read the
	// config now instead of after a restart, exactly like a PUT /api/web-config.
	void triggerRestartChannels()?.catch(error => {
		// The credential is already saved; a restart failure is a log line.
		logger.warn("Channel restart after credential change failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
	return json({
		ok: true,
		channel,
		state: result.state,
		identity: result.identity,
		credentialsPersisted: result.credentialsPersisted,
	});
}
