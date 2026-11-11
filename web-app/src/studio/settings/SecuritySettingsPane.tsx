/**
 * Settings → 身份与设备 (identity, devices and remote access).
 *
 * This is the discoverable home for everything that used to sit at the bottom
 * of the IM channels pane: the machine-wide remote token and its pairing QR,
 * paired devices, and the TOTP second factor. It also states, per action,
 * what the *current surface* can honestly do (see `surfaces.ts`) so a remote
 * browser or a phone never shows a desktop-only control as if it worked.
 *
 * Server rules this pane relies on (auth/two-factor-auth.ts):
 * - first TOTP enrollment is local-only; a remote caller needs an existing
 *   enrollment plus a recent step-up;
 * - device and token mutations need a step-up when the policy requires TOTP;
 * - reads stay open so this pane can render the code prompt.
 */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { usePreviewMode } from "../preview/PreviewContext";
import { SettingSection, Switch } from "./SettingRow";
import {
	confirmTwoFactor,
	disableTwoFactor,
	enrollTwoFactor,
	fetchDesktopHostInfo,
	fetchPairedDevices,
	fetchPairingQr,
	fetchRemoteAccess,
	fetchTwoFactorStatus,
	isTwoFactorRequired,
	putTwoFactorPolicy,
	regenerateRecoveryCodes,
	revokeAllPairedDevices,
	revokePairedDevice,
	revokeRemoteToken,
	rotateRemoteToken,
	verifyTwoFactor,
	type DeviceInventory,
	type PairingQr,
	type RemoteAccessView,
	type TwoFactorEnrollment,
	type TwoFactorStatus,
} from "./securityApi";
import {
	SURFACE_ACTIONS,
	accessFor,
	detectSurface,
	type SurfaceAccess,
	type SurfaceAction,
	type SurfaceId,
} from "../surfaces";
import "./security.css";

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The access legend + the full action matrix for one surface. */
export function SurfaceMatrixTable({ surface }: { surface: SurfaceId }) {
	const { t } = useI18n();
	return (
		<div className="sec-matrix-wrap">
			<table className="sec-table sec-matrix">
				<thead>
					<tr>
						<th>{t("settings.security.matrixAction")}</th>
						<th>{t("settings.security.matrixAccess")}</th>
						<th>{t("settings.security.matrixWhy")}</th>
					</tr>
				</thead>
				<tbody>
					{SURFACE_ACTIONS.map(action => {
						const decision = accessFor(surface, action);
						return (
							<tr key={action} data-action={action} data-access={decision.access}>
								<td>{t(`settings.security.action.${action}`)}</td>
								<td>
									<span className={`chip sm ${accessTone(decision.access)}`} data-access={decision.access}>
										{t(`settings.security.access.${decision.access}`)}
									</span>
								</td>
								<td className="sec-matrix-why">
									{decision.reason === undefined ? "—" : t(`settings.security.reason.${decision.reason}`)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function accessTone(access: SurfaceAccess): string {
	if (access === "show" || access === "pass-through") return "green";
	if (access === "read-only") return "amber";
	if (access === "unavailable") return "red";
	return "gray";
}

export interface TotpPanelProps {
	status: TwoFactorStatus | null;
	enrollment: TwoFactorEnrollment | null;
	recoveryCodes: readonly string[];
	code: string;
	error: string | null;
	pending: string | null;
	/** Enrollment/disable/policy stay on the machine; verification is allowed anywhere. */
	readOnly: boolean;
	/** Whether a verification input is offered (enrolled + policy required). */
	canVerify?: boolean;
	onCode: (value: string) => void;
	onEnroll: () => void;
	onConfirm: () => void;
	onPolicy: (required: boolean) => void;
	onDisable: () => void;
	onRegenerate: () => void;
	onVerify: () => void;
	t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Two-factor (TOTP) for remote device access. The toggle is only rendered once
 * the store reports enrollment, so it can never claim "on" without a secret a
 * code can match; recovery codes appear exactly once per issuance.
 */
export function TotpPanel({
	status,
	enrollment,
	recoveryCodes,
	code,
	error,
	pending,
	readOnly,
	onCode,
	onConfirm,
	onPolicy,
	onDisable,
	onRegenerate,
	onEnroll,
	onVerify,
	canVerify = false,
	t,
}: TotpPanelProps) {
	const state = status === null ? "loading" : !status.enrolled ? "off" : status.required ? "required" : "enrolled";
	return (
		<div className="sec-totp" data-totp-state={state} data-read-only={readOnly}>
			<div className="sec-totp-head">
				<div>
					<strong>{t("settings.security.totp.title")}</strong>
					<p className="sec-hint">{t("settings.security.totp.desc")}</p>
				</div>
				{status?.enrolled === true && !readOnly ? (
					<Switch
						checked={status.required}
						disabled={pending !== null}
						label={t("settings.security.totp.require")}
						onChange={onPolicy}
					/>
				) : null}
			</div>
			{error !== null ? (
				<p className="sec-error" role="alert">
					{error}
				</p>
			) : null}
			{status === null ? (
				<p className="sec-empty">{t("settings.security.loading")}</p>
			) : status.enrolled ? (
				<>
					<p className="sec-hint">
						{status.required ? t("settings.security.totp.requiredNote") : t("settings.security.totp.optionalNote")}
					</p>
					<p className="sec-hint" data-totp-remaining>
						{t("settings.security.totp.remaining", { count: status.recoveryCodesRemaining })}
					</p>
					{canVerify ? (
						<div className="sec-actions sec-totp-verify">
							<input
								className="input"
								inputMode="numeric"
								autoComplete="one-time-code"
								aria-label={t("settings.security.totp.code")}
								placeholder={t("settings.security.totp.codePlaceholder")}
								value={code}
								onChange={event => onCode(event.target.value)}
							/>
							<button
								type="button"
								className="btn small"
								disabled={pending !== null || code.trim() === ""}
								onClick={onVerify}
							>
								{t("settings.security.totp.verify")}
							</button>
						</div>
					) : null}
					{!readOnly ? (
						<div className="sec-actions">
							<button type="button" className="btn small danger" disabled={pending !== null} onClick={onDisable}>
								{t("settings.security.totp.disable")}
							</button>
							<button
								type="button"
								className="btn small"
								disabled={pending !== null || code.trim() === ""}
								onClick={onRegenerate}
							>
								{t("settings.security.totp.regenerate")}
							</button>
						</div>
					) : null}
				</>
			) : (
				<>
					{!readOnly ? (
						<div className="sec-actions">
							<button type="button" className="btn small" disabled={pending !== null} onClick={onEnroll}>
								{t("settings.security.totp.enroll")}
							</button>
						</div>
					) : null}
					<p className="sec-hint">{t("settings.security.totp.localOnly")}</p>
				</>
			)}
			{enrollment !== null ? (
				<div className="sec-totp-enroll">
					{enrollment.qrSvg !== "" ? (
						<div className="sec-qr-svg" dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }} />
					) : null}
					<p className="sec-qr-state">{t("settings.security.totp.scan")}</p>
					<code className="sec-mono" data-totp-secret>
						{enrollment.secret}
					</code>
					<div className="sec-actions sec-totp-confirm">
						<button
							type="button"
							className="btn small"
							disabled={pending !== null || code.trim() === ""}
							onClick={onConfirm}
						>
							{t("settings.security.totp.confirm")}
						</button>
					</div>
				</div>
			) : null}
			{recoveryCodes.length > 0 ? (
				<div className="sec-totp-recovery" data-recovery-codes={recoveryCodes.length}>
					<p>{t("settings.security.totp.recoveryCodes")}</p>
					<ul className="sec-codes">
						{recoveryCodes.map(entry => (
							<li key={entry}>
								<code>{entry}</code>
							</li>
						))}
					</ul>
					<p className="sec-hint">{t("settings.security.totp.recoveryHint")}</p>
				</div>
			) : null}
			{status?.enrolled === true || enrollment !== null ? (
				<div className="sec-totp-code-row">
					<label className="sec-field">
						<span>{t("settings.security.totp.code")}</span>
						<input
							className="input"
							inputMode="numeric"
							autoComplete="one-time-code"
							placeholder={t("settings.security.totp.codePlaceholder")}
							value={code}
							onChange={event => onCode(event.target.value)}
						/>
					</label>
				</div>
			) : null}
		</div>
	);
}

type StepUpAction =
	| { kind: "revoke"; id: string }
	| { kind: "revoke-all" }
	| { kind: "token-rotate" }
	| { kind: "token-revoke" };

export function SecuritySettingsPane({
	visible,
	runtimeConnected = false,
}: {
	visible: boolean;
	runtimeConnected?: boolean;
}) {
	const { t } = useI18n();
	const { preview } = usePreviewMode();
	const surface = detectSurface();
	const totpAccess = accessFor(surface, "totp");
	// "read-only" now means enrollment/disable/policy are local; verification is
	// still offered because a remote user must be able to answer `totp_required`.
	const totpReadOnly = totpAccess.access === "read-only" || surface === "mobile";
	const [hostDesktop, setHostDesktop] = useState<boolean | null>(null);
	const [remoteAccess, setRemoteAccess] = useState<RemoteAccessView | null>(null);
	const [remoteError, setRemoteError] = useState<string | null>(null);
	const [devices, setDevices] = useState<DeviceInventory | null>(null);
	const [deviceError, setDeviceError] = useState<string | null>(null);
	const [pairing, setPairing] = useState<PairingQr | null>(null);
	const [totp, setTotp] = useState<TwoFactorStatus | null>(null);
	const [totpError, setTotpError] = useState<string | null>(null);
	const [totpEnrollment, setTotpEnrollment] = useState<TwoFactorEnrollment | null>(null);
	const [totpRecoveryCodes, setTotpRecoveryCodes] = useState<readonly string[]>([]);
	const [totpCode, setTotpCode] = useState("");
	const [stepUp, setStepUp] = useState<StepUpAction | null>(null);
	const [stepUpCode, setStepUpCode] = useState("");
	const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const loadDevices = useCallback(async () => {
		try {
			setDevices(await fetchPairedDevices());
			setDeviceError(null);
		} catch (error) {
			setDeviceError(errorText(error));
		}
	}, []);

	const loadTwoFactor = useCallback(async () => {
		try {
			setTotp(await fetchTwoFactorStatus());
			setTotpError(null);
		} catch (error) {
			setTotpError(errorText(error));
		}
	}, []);

	const loadRemoteAccess = useCallback(async () => {
		try {
			setRemoteAccess(await fetchRemoteAccess());
			setRemoteError(null);
		} catch (error) {
			setRemoteError(errorText(error));
		}
	}, []);

	const reload = useCallback(async () => {
		setBusy(true);
		try {
			await Promise.all([loadDevices(), loadTwoFactor(), loadRemoteAccess()]);
		} finally {
			setBusy(false);
		}
	}, [loadDevices, loadTwoFactor, loadRemoteAccess]);

	useEffect(() => {
		if (!visible || preview) return;
		let alive = true;
		void reload();
		void fetchDesktopHostInfo()
			.then(desktop => {
				if (alive) setHostDesktop(desktop);
			})
			.catch(() => {
				if (alive) setHostDesktop(null);
			});
		return () => {
			alive = false;
		};
	}, [visible, preview, reload]);

	const run = async (key: string, action: () => Promise<string>): Promise<void> => {
		setPending(key);
		setNotice(null);
		try {
			setNotice({ kind: "ok", text: await action() });
		} catch (error) {
			setNotice({ kind: "error", text: `${t("settings.security.actionFailed")}${errorText(error)}` });
		} finally {
			setPending(null);
		}
	};

	/** A 403 totp_required opens the prompt instead of reading as a failure. */
	const withStepUp = async (action: StepUpAction, work: () => Promise<string>): Promise<string> => {
		try {
			return await work();
		} catch (error) {
			if (isTwoFactorRequired(error)) {
				setStepUp(action);
				setStepUpCode("");
				return t("settings.security.totp.stepUpNeeded");
			}
			throw error;
		}
	};

	const performStepUpAction = async (action: StepUpAction): Promise<string> => {
		if (action.kind === "revoke-all") {
			const count = await revokeAllPairedDevices(fetch, true);
			await loadDevices();
			return t("settings.security.devices.revokedAll", { count });
		}
		if (action.kind === "revoke") {
			await revokePairedDevice(fetch, action.id);
			await loadDevices();
			return t("settings.security.devices.revoked");
		}
		if (action.kind === "token-rotate") {
			await rotateRemoteToken(fetch);
			setPairing(null);
			await loadRemoteAccess();
			return t("settings.security.remote.rotateDone");
		}
		await revokeRemoteToken(fetch);
		setPairing(null);
		await loadRemoteAccess();
		return t("settings.security.remote.revokeDone");
	};

	const verifyStepUp = (): void => {
		if (stepUp === null) return;
		const action = stepUp;
		void run("stepup", async () => {
			await verifyTwoFactor(fetch, { code: stepUpCode.trim() });
			setStepUp(null);
			setStepUpCode("");
			return performStepUpAction(action);
		});
	};

	const revokeDevice = (id: string, label: string): void => {
		if (!window.confirm(t("settings.security.devices.revokeConfirm", { label }))) return;
		void run(`revoke:${id}`, () => withStepUp({ kind: "revoke", id }, () => performStepUpAction({ kind: "revoke", id })));
	};

	const revokeAllDevices = (): void => {
		if (!window.confirm(t("settings.security.devices.revokeAllConfirm"))) return;
		void run("revoke-all", () => withStepUp({ kind: "revoke-all" }, () => performStepUpAction({ kind: "revoke-all" })));
	};

	const showPairing = (): void => {
		if (pairing !== null) {
			setPairing(null);
			return;
		}
		void run("pairing", async () => {
			try {
				setPairing(await fetchPairingQr());
				return t("settings.security.remote.pairingReady");
			} catch (error) {
				throw new Error(errorText(error));
			}
		});
	};

	const rotateToken = (): void => {
		if (!window.confirm(t("settings.security.remote.rotateConfirm"))) return;
		void run("token-rotate", () =>
			withStepUp({ kind: "token-rotate" }, () => performStepUpAction({ kind: "token-rotate" })),
		);
	};

	const revokeToken = (): void => {
		if (!window.confirm(t("settings.security.remote.revokeConfirm"))) return;
		void run("token-revoke", () =>
			withStepUp({ kind: "token-revoke" }, () => performStepUpAction({ kind: "token-revoke" })),
		);
	};

	const enrollTotp = (): void => {
		void run("totp-enroll", async () => {
			try {
				const enrollment = await enrollTwoFactor(fetch);
				setTotpEnrollment(enrollment);
				setTotpRecoveryCodes(enrollment.recoveryCodes);
				setTotpCode("");
				return t("settings.security.totp.enrollReady");
			} catch (error) {
				if (error instanceof Error && error.message === "local_required") {
					throw new Error(t("settings.security.reason.totpLocalEnroll"));
				}
				throw error;
			}
		});
	};

	const confirmTotp = (): void => {
		void run("totp-confirm", async () => {
			await confirmTwoFactor(fetch, totpCode.trim());
			setTotpEnrollment(null);
			setTotpRecoveryCodes([]);
			setTotpCode("");
			await loadTwoFactor();
			return t("settings.security.totp.confirmed");
		});
	};

	const verifyTotp = (): void => {
		void run("totp-verify", async () => {
			const result = await verifyTwoFactor(fetch, { code: totpCode.trim() });
			setTotpCode("");
			await loadTwoFactor();
			return result.method === "recovery"
				? t("settings.security.totp.verifiedRecovery")
				: t("settings.security.totp.verified");
		});
	};

	const applyTotpPolicy = (required: boolean): void => {
		void run("totp-policy", async () => {
			await putTwoFactorPolicy(fetch, required);
			await loadTwoFactor();
			return required ? t("settings.security.totp.enabled") : t("settings.security.totp.disabledNotice");
		});
	};

	const disableTotp = (): void => {
		if (!window.confirm(t("settings.security.totp.disableConfirm"))) return;
		void run("totp-disable", async () => {
			await disableTwoFactor(fetch);
			setTotpEnrollment(null);
			setTotpRecoveryCodes([]);
			setTotpCode("");
			await loadTwoFactor();
			return t("settings.security.totp.disabledNotice");
		});
	};

	const regenerateTotp = (): void => {
		void run("totp-regenerate", async () => {
			const codes = await regenerateRecoveryCodes(fetch, totpCode.trim());
			setTotpRecoveryCodes(codes);
			setTotpCode("");
			await loadTwoFactor();
			return t("settings.security.totp.regenerated");
		});
	};

	if (preview) {
		return (
			<>
				<h3>{t("settings.security.title")}</h3>
				<p className="desc">{t("settings.security.desc")}</p>
				<p className="sec-note">{t("settings.security.previewNote")}</p>
			</>
		);
	}

	const remoteTokenAccess = accessFor(surface, "remote-token");
	const pairingAccess = accessFor(surface, "remote-pairing");
	const deviceAccess = accessFor(surface, "device-list");
	// Listing and revoking are separate decisions: a phone sees its own paired
	// devices but cannot drop one (revocation stays a machine-side action).
	const revokeAccess = accessFor(surface, "device-revoke");

	return (
		<>
			<h3>{t("settings.security.title")}</h3>
			<p className="desc">{t("settings.security.desc")}</p>
			{notice !== null ? (
				<p className={notice.kind === "ok" ? "sec-notice" : "sec-error"} role="status">
					{notice.text}
				</p>
			) : null}

			<SettingSection title={t("settings.security.surfaceTitle")} desc={t("settings.security.surfaceDesc")}>
				<div className="sec-facts">
					<span className="chip sm blue" data-surface={surface}>
						{t(`settings.security.surfaceName.${surface}`)}
					</span>
					<span className={`chip sm ${hostDesktop === true ? "green" : "gray"}`} data-host-desktop={hostDesktop === true}>
						{hostDesktop === true
							? t("settings.security.surfaceHostDesktop")
							: t("settings.security.surfaceHostServe")}
					</span>
					<span className={`chip sm ${runtimeConnected ? "green" : "red"}`} data-runtime-connected={runtimeConnected}>
						{runtimeConnected ? t("settings.security.surfaceRuntimeOn") : t("settings.security.surfaceRuntimeOff")}
					</span>
					{busy ? <span className="sec-hint">{t("settings.security.loading")}</span> : null}
				</div>
				<SurfaceMatrixTable surface={surface} />
			</SettingSection>

			<SettingSection title={t("settings.security.remote.title")} desc={t("settings.security.remote.desc")}>
				{remoteError !== null ? (
					<p className="sec-error" role="alert">
						{t("settings.security.remote.failed")}
						{remoteError}
					</p>
				) : remoteAccess === null ? (
					<p className="sec-empty">{t("settings.security.loading")}</p>
				) : (
					<>
						<div className="sec-facts">
							<span className={`chip sm ${remoteAccess.tokenActive ? "green" : "gray"}`}>
								{remoteAccess.tokenActive
									? t("settings.security.remote.tokenActive")
									: t("settings.security.remote.tokenInactive")}
							</span>
							{remoteAccess.publicUrl !== null ? (
								<code className="sec-mono">{remoteAccess.publicUrl}</code>
							) : null}
							<span className="chip sm gray">
								{remoteAccess.tlsEnabled
									? t("settings.security.remote.tlsOn")
									: t("settings.security.remote.tlsOff")}
							</span>
							{remoteAccess.allowPlainHttp ? (
								<span className="chip sm amber">{t("settings.security.remote.plainHttpOn")}</span>
							) : null}
						</div>
						<p className="sec-hint">{t("settings.security.remote.tokenHint")}</p>
						<div className="sec-actions">
							<button
								type="button"
								className="btn small"
								disabled={pending === "pairing" || !remoteAccess.tokenActive || pairingAccess.access === "hidden"}
								onClick={showPairing}
							>
								{t("settings.security.remote.pairing")}
							</button>
							<button
								type="button"
								className="btn small"
								disabled={pending === "token-rotate" || remoteTokenAccess.access === "read-only"}
								onClick={rotateToken}
							>
								{t("settings.security.remote.rotate")}
							</button>
							<button
								type="button"
								className="btn small danger"
								disabled={pending === "token-revoke" || !remoteAccess.tokenActive || remoteTokenAccess.access === "read-only"}
								onClick={revokeToken}
							>
								{t("settings.security.remote.revoke")}
							</button>
						</div>
						{pairing !== null ? (
							<div className="sec-pairing">
								<div className="sec-qr-svg" dangerouslySetInnerHTML={{ __html: pairing.svg }} />
								<div className="sec-qr-copy">
									<p className="sec-qr-state">{t("settings.security.remote.pairingDesc")}</p>
									<p className="sec-pair-code" data-pair-code>
										<code className="sec-mono">{pairing.code}</code>
										{pairing.expiresAt !== null ? (
											<span className="sec-hint">
												{new Date(pairing.expiresAt).toLocaleTimeString()}
											</span>
										) : null}
									</p>
									<code className="sec-mono">{pairing.url}</code>
								</div>
							</div>
						) : null}
						{!remoteAccess.tokenActive ? (
							<p className="sec-hint">{t("settings.security.remote.pairingNeedsToken")}</p>
						) : null}
					</>
				)}
			</SettingSection>

			<SettingSection
				title={t("settings.security.devices.title")}
				desc={
					deviceAccess.access === "unavailable"
						? t(`settings.security.reason.${deviceAccess.reason ?? "desktopOnly"}`)
						: t("settings.security.devices.desc")
				}
			>
				{revokeAccess.access !== "hidden" ? (
					<div className="sec-actions">
						<button
							type="button"
							className="btn small danger"
							disabled={pending === "revoke-all" || devices === null}
							onClick={revokeAllDevices}
						>
							{t("settings.security.devices.revokeAll")}
						</button>
					</div>
				) : null}
				{deviceError !== null ? (
					<p className="sec-error" role="alert">
						{t("settings.security.devices.failed")}
						{deviceError}
					</p>
				) : devices === null ? (
					<p className="sec-empty">{t("settings.security.loading")}</p>
				) : devices.devices.length === 0 ? (
					<p className="sec-empty">{t("settings.security.devices.none")}</p>
				) : (
					<div className="sec-table-wrap">
						<table className="sec-table">
							<thead>
								<tr>
									<th>{t("settings.security.devices.label")}</th>
									<th>{t("settings.security.devices.platform")}</th>
									<th>{t("settings.security.devices.scopes")}</th>
									<th>{t("settings.security.devices.lastSeen")}</th>
									<th aria-label={t("settings.security.devices.actions")} />
								</tr>
							</thead>
							<tbody>
								{devices.devices.map(device => (
									<tr key={device.id} data-device={device.id} data-revoked={device.revokedAt !== null}>
										<td>
											{device.label !== "" ? device.label : device.id}
											{device.id === devices.currentDeviceId ? (
												<span className="chip xs blue sec-preserved">
													{t("settings.security.devices.current")}
												</span>
											) : null}
										</td>
										<td>{device.platform}</td>
										<td>{device.scopes.join(", ")}</td>
										<td>
											{device.revokedAt !== null
												? t("settings.security.devices.revokedRow")
												: device.lastSeenAt !== null
													? device.lastSeenAt.replace("T", " ").slice(0, 16)
													: t("settings.security.devices.never")}
										</td>
										<td className="sec-row-actions">
											{revokeAccess.access !== "hidden" ? (
												<button
													type="button"
													className="btn small danger"
													disabled={device.revokedAt !== null || pending === `revoke:${device.id}`}
													onClick={() => revokeDevice(device.id, device.label !== "" ? device.label : device.id)}
												>
													{t("settings.security.devices.revoke")}
												</button>
											) : null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{devices?.legacyTokenActive === true ? (
					<p className="sec-hint">{t("settings.security.devices.legacyToken")}</p>
				) : null}
				{stepUp !== null ? (
					<div className="sec-stepup" role="dialog" aria-label={t("settings.security.totp.stepUpTitle")}>
						<p>
							<strong>{t("settings.security.totp.stepUpTitle")}</strong>
						</p>
						<p className="sec-hint">{t("settings.security.totp.stepUpDesc")}</p>
						<div className="sec-actions">
							<input
								className="input"
								inputMode="numeric"
								autoComplete="one-time-code"
								placeholder={t("settings.security.totp.codePlaceholder")}
								value={stepUpCode}
								onChange={event => setStepUpCode(event.target.value)}
							/>
							<button
								type="button"
								className="btn small"
								disabled={pending !== null || stepUpCode.trim() === ""}
								onClick={verifyStepUp}
							>
								{t("settings.security.totp.verify")}
							</button>
							<button
								type="button"
								className="btn small"
								disabled={pending !== null}
								onClick={() => {
									setStepUp(null);
									setStepUpCode("");
								}}
							>
								{t("settings.security.totp.cancel")}
							</button>
						</div>
					</div>
				) : null}
			</SettingSection>

			<SettingSection
				title={t("settings.security.totp.title")}
				desc={
					totpReadOnly && totpAccess.reason !== undefined
						? t(`settings.security.reason.${totpAccess.reason}`)
						: t("settings.security.totp.sectionDesc")
				}
			>
				<TotpPanel
					status={totp}
					enrollment={totpEnrollment}
					recoveryCodes={totpRecoveryCodes}
					code={totpCode}
					error={totpError}
					pending={pending}
					readOnly={totpReadOnly}
					canVerify={totp?.enrolled === true && totp.required}
					onCode={setTotpCode}
					onEnroll={enrollTotp}
					onConfirm={confirmTotp}
					onPolicy={applyTotpPolicy}
					onDisable={disableTotp}
					onRegenerate={regenerateTotp}
					onVerify={verifyTotp}
					t={t}
				/>
			</SettingSection>
		</>
	);
}
