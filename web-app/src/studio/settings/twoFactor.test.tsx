/**
 * Settings → devices: 2FA data layer and panel rendering.
 *
 * The panel is presentational: these tests pin that it never shows a toggle
 * before enrollment, that the secret and recovery codes come from the one
 * enroll response, and that the step-up prompt is a request shape the gateway
 * actually implements.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TotpPanel, type TotpPanelProps } from "./SecuritySettingsPane";
import {
	confirmTwoFactor,
	disableTwoFactor,
	enrollTwoFactor,
	fetchTwoFactorStatus,
	isTwoFactorRequired,
	putTwoFactorPolicy,
	regenerateRecoveryCodes,
	verifyTwoFactor,
} from "./securityApi";

type Call = { url: string; init: RequestInit | undefined };

function fetcher(response: () => Response, calls: Call[] = []): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return response();
	}) as typeof fetch;
}

describe("2FA API client", () => {
	test("status reads the gateway shape and drops unknown fields", async () => {
		const status = await fetchTwoFactorStatus(
			fetcher(() =>
				Response.json({
					enrolled: true,
					required: true,
					enrolledAt: "2026-11-10T00:00:00.000Z",
					recoveryCodesRemaining: 7,
					pending: false,
					verified: true,
					verifiedUntil: "2026-11-10T12:00:00.000Z",
					secret: "must-not-leak",
				}),
			),
		);
		expect(status).toEqual({
			enrolled: true,
			required: true,
			enrolledAt: "2026-11-10T00:00:00.000Z",
			recoveryCodesRemaining: 7,
			pending: false,
			verified: true,
			verifiedUntil: "2026-11-10T12:00:00.000Z",
		});
	});

	test("enroll keeps the one-time secret, QR and recovery codes", async () => {
		const calls: Call[] = [];
		const enrollment = await enrollTwoFactor(
			fetcher(
				() =>
					Response.json({
						secret: "JBSWY3DPEHPK3PXP",
						otpauthUrl: "otpauth://totp/Zeta:remote?secret=JBSWY3DPEHPK3PXP",
						qrSvg: "<svg/>",
						recoveryCodes: ["AAAAA-AAAAA", "BBBBB-BBBBB"],
						expiresAt: "2026-11-10T00:10:00.000Z",
					}),
				calls,
			),
		);
		expect(calls[0]?.url).toBe("/api/auth/2fa/enroll");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(enrollment.recoveryCodes).toEqual(["AAAAA-AAAAA", "BBBBB-BBBBB"]);
		expect(enrollment.qrSvg).toBe("<svg/>");
	});

	test("confirm/verify/disable/regenerate send the documented bodies", async () => {
		const calls: Call[] = [];
		const reply = () =>
			Response.json({
				ok: true,
				verifiedUntil: "2026-11-10T12:00:00.000Z",
				method: "totp",
				recoveryCodesRemaining: 10,
				recoveryCodes: ["C"],
			});

		await confirmTwoFactor(fetcher(reply, calls), "123456");
		expect(calls.at(-1)?.url).toBe("/api/auth/2fa/confirm");
		expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ code: "123456" });

		const verification = await verifyTwoFactor(fetcher(reply, calls), { code: "123456" });
		expect(verification.verifiedUntil).toBe("2026-11-10T12:00:00.000Z");
		expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ code: "123456" });

		await disableTwoFactor(fetcher(reply, calls));
		expect(calls.at(-1)?.url).toBe("/api/auth/2fa/disable");
		expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({});

		const codes = await regenerateRecoveryCodes(fetcher(reply, calls), "123456");
		expect(calls.at(-1)?.url).toBe("/api/auth/2fa/recovery/regenerate");
		expect(codes).toEqual(["C"]);

		await putTwoFactorPolicy(
			fetcher(() => Response.json({ ok: true }), calls),
			true,
		);
		expect(calls.at(-1)?.url).toBe("/api/auth/2fa/policy");
		expect(calls.at(-1)?.init?.method).toBe("PUT");
		expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ required: true });
	});

	test("a step-up denial is recognisable without parsing prose", async () => {
		const failing = fetcher(() => Response.json({ error: "totp_required", stepUp: true }, { status: 403 }));
		try {
			await disableTwoFactor(failing);
			throw new Error("expected the call to fail");
		} catch (error) {
			expect(isTwoFactorRequired(error)).toBe(true);
			expect(isTwoFactorRequired(new Error("something else"))).toBe(false);
		}
	});
});

const t = (key: string, params?: Record<string, string | number>): string => {
	const last = key.slice(key.lastIndexOf(".") + 1);
	return params === undefined ? last : `${last}:${Object.values(params).join(",")}`;
};

function panelProps(overrides: Partial<TotpPanelProps> = {}): TotpPanelProps {
	return {
		status: null,
		enrollment: null,
		recoveryCodes: [],
		code: "",
		error: null,
		pending: null,
		readOnly: false,
		onCode: () => undefined,
		onEnroll: () => undefined,
		onConfirm: () => undefined,
		onPolicy: () => undefined,
		onDisable: () => undefined,
		onRegenerate: () => undefined,
		onVerify: () => undefined,
		t,
		...overrides,
	};
}

describe("TotpPanel", () => {
	test("offers enrollment and no policy toggle while unenrolled", () => {
		const html = renderToStaticMarkup(
			<TotpPanel
				{...panelProps({
					status: {
						enrolled: false,
						required: false,
						enrolledAt: null,
						recoveryCodesRemaining: 0,
						pending: false,
						verified: false,
						verifiedUntil: null,
					},
				})}
			/>,
		);
		expect(html).toContain('data-totp-state="off"');
		expect(html).toContain("enroll");
		expect(html).toContain("localOnly");
		expect(html.includes('role="switch"')).toBe(false);
	});

	test("an enrolled policy toggle reflects the gateway's required flag", () => {
		const html = renderToStaticMarkup(
			<TotpPanel
				{...panelProps({
					status: {
						enrolled: true,
						required: true,
						enrolledAt: "2026-11-10T00:00:00.000Z",
						recoveryCodesRemaining: 8,
						pending: false,
						verified: false,
						verifiedUntil: null,
					},
				})}
			/>,
		);
		expect(html).toContain('data-totp-state="required"');
		expect(html).toContain('role="switch"');
		expect(html).toContain('aria-checked="true"');
		expect(html).toContain("remaining:8");
	});

	test("a read-only surface shows status but offers no mutation", () => {
		const enrolled = renderToStaticMarkup(
			<TotpPanel
				{...panelProps({
					readOnly: true,
					status: {
						enrolled: true,
						required: true,
						enrolledAt: "2026-11-10T00:00:00.000Z",
						recoveryCodesRemaining: 3,
						pending: false,
						verified: false,
						verifiedUntil: null,
					},
				})}
			/>,
		);
		expect(enrolled).toContain('data-read-only="true"');
		expect(enrolled.includes('role="switch"')).toBe(false);
		expect(enrolled.includes("disable")).toBe(false);
		expect(enrolled.includes("regenerate")).toBe(false);

		const off = renderToStaticMarkup(
			<TotpPanel
				{...panelProps({
					readOnly: true,
					status: {
						enrolled: false,
						required: false,
						enrolledAt: null,
						recoveryCodesRemaining: 0,
						pending: false,
						verified: false,
						verifiedUntil: null,
					},
				})}
			/>,
		);
		expect(off.includes(">enroll<")).toBe(false);
		expect(off).toContain("localOnly");
	});

	test("enrollment shows the QR, secret and recovery codes once", () => {
		const html = renderToStaticMarkup(
			<TotpPanel
				{...panelProps({
					status: {
						enrolled: false,
						required: false,
						enrolledAt: null,
						recoveryCodesRemaining: 0,
						pending: true,
						verified: false,
						verifiedUntil: null,
					},
					enrollment: {
						secret: "JBSWY3DPEHPK3PXP",
						otpauthUrl: "otpauth://totp/Zeta:remote?secret=JBSWY3DPEHPK3PXP",
						qrSvg: '<svg viewBox="0 0 21 21"></svg>',
						recoveryCodes: ["AAAAA-AAAAA", "BBBBB-BBBBB"],
						expiresAt: "2026-11-10T00:10:00.000Z",
					},
					recoveryCodes: ["AAAAA-AAAAA", "BBBBB-BBBBB"],
				})}
			/>,
		);
		expect(html).toContain("<svg");
		expect(html).toContain("JBSWY3DPEHPK3PXP");
		expect(html).toContain('data-recovery-codes="2"');
		expect(html).toContain("AAAAA-AAAAA");
	});
});
