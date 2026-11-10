/**
 * Settings → IM channels.
 *
 * One page for the three messaging channels, the chat bindings the router
 * consults, and the remote devices that can reach this machine. Every value is
 * read from the gateway on open and re-read after a write; nothing is cached
 * across visits and no control shows a state the gateway did not report.
 *
 * Boundaries worth keeping:
 * - the channel runtime's words (`运行中`/`已停止`/`错误`) come from
 *   `/api/channels/status` plus `channels.<id>.enabled`; "enabled but not in
 *   the runtime" is shown as an error, not smoothed into either neighbour;
 * - secrets are write-only (`••••` on read) and an empty field means "keep the
 *   stored value" — the same rule `POST /api/channels/credentials` applies;
 * - bindings rewrite the whole `remote.sessionMappings` array, so a row edit
 *   copies the row and patches only the fields this page owns;
 * - `agentId` / PM is PLANNED: the table shows it as unavailable and never
 *   writes that key.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { usePreviewMode } from "../preview/PreviewContext";
import { SettingSection, Switch } from "./SettingRow";
import {
	MASKED_SECRET,
	CHANNEL_IDS,
	bindingKey,
	bindingProblem,
	botSessionViews,
	channelConfigured,
	channelRuntimeState,
	chatBindings,
	conflictingBinding,
	confirmTwoFactor,
	disableTwoFactor,
	enrollTwoFactor,
	fetchChannelStatus,
	fetchPairingQr,
	fetchPairedDevices,
	fetchTwoFactorStatus,
	fetchWechatQr,
	fetchWebConfig,
	isAbsolutePath,
	isTwoFactorRequired,
	putTwoFactorPolicy,
	putWebConfigValue,
	regenerateRecoveryCodes,
	removeBinding,
	revokeAllPairedDevices,
	revokePairedDevice,
	runningFor,
	runWechatAction,
	sendChannelTest,
	unknownBindingKeys,
	upsertBinding,
	validateChannelCredentials,
	verifyTwoFactor,
	wechatLoginStage,
	workspaceAliases,
	type BindingDraft,
	type BindingProblem,
	type ChannelId,
	type ChannelRuntimeState,
	type ChannelStatusEntry,
	type ChatBinding,
	type CredentialRequest,
	type DeviceInventory,
	type PairingQr,
	type TwoFactorEnrollment,
	type TwoFactorStatus,
	type WechatQr,
	type WechatLoginStage,
	type WebConfigPath,
	type WebConfigView,
} from "./imChannelsApi";
import "./imChannels.css";

const CHANNEL_PATHS: Record<ChannelId, { enabled: WebConfigPath; workspaceRoot: WebConfigPath }> = {
	wechat: { enabled: "channels.wechat.enabled", workspaceRoot: "channels.wechat.workspaceRoot" },
	feishu: { enabled: "channels.feishu.enabled", workspaceRoot: "channels.feishu.workspaceRoot" },
	telegram: { enabled: "channels.telegram.enabled", workspaceRoot: "channels.telegram.workspaceRoot" },
	discord: { enabled: "channels.discord.enabled", workspaceRoot: "channels.discord.workspaceRoot" },
	qq: { enabled: "channels.qq.enabled", workspaceRoot: "channels.qq.workspaceRoot" },
};

const EMPTY_DRAFT: BindingDraft = { platform: "wechat", chatId: "", workspaceAlias: "", sessionId: "" };

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The QR frame: the gateway's own `svg` when it sent one, the raw image when
 * WeChat returned an image payload, the payload text as a last resort, and the
 * stage word when there is no pending login at all.
 */
export function WechatQrFrame({ qr, stage }: { qr: WechatQr | null; stage: WechatLoginStage }) {
	const { t } = useI18n();
	const qrImage =
		qr?.pending === true &&
		qr.qrcodeUrl !== undefined &&
		/^(data:image\/|https?:\/\/.*\.(png|jpe?g|gif|webp|svg)(\?|#|$))/i.test(qr.qrcodeUrl);
	return (
		<div className="im-qr-frame">
			{qr?.pending === true && qr.svg !== undefined ? (
				// The gateway renders this symbol from the payload WeChat issued; it is
				// our own markup (no script, no external reference).
				<div className="im-qr-svg" data-qr="svg" dangerouslySetInnerHTML={{ __html: qr.svg }} />
			) : qrImage && qr?.qrcodeUrl !== undefined ? (
				<img className="im-qr-image" src={qr.qrcodeUrl} alt={t("settings.imChannels.wechatLogin")} width={168} height={168} />
			) : qr?.pending === true && qr.qrcodeUrl !== undefined ? (
				<code className="im-qr-payload">{qr.qrcodeUrl}</code>
			) : (
				<span className="im-qr-placeholder">{t(`settings.imChannels.qr.${stage}`)}</span>
			)}
		</div>
	);
}

/** The runtime word chip; `data-state` is the stable hook the tests read. */
export function RuntimeChip({ state }: { state: ChannelRuntimeState }) {
	const { t } = useI18n();
	const tone = state === "running" ? "green" : state === "error" ? "red" : "gray";
	return (
		<span className={`chip sm ${tone}`} data-state={state}>
			{t(`settings.imChannels.state.${state}`)}
		</span>
	);
}

/**
 * The bindings table. Presentational on purpose: the page owns the write and
 * the draft, so this can be statically rendered (and tested) without a client.
 */
export function BindingsTable({
	rows,
	onEdit,
	onRemove,
	disabled = false,
}: {
	rows: readonly ChatBinding[];
	onEdit: (row: ChatBinding) => void;
	onRemove: (row: ChatBinding) => void;
	disabled?: boolean;
}) {
	const { t } = useI18n();
	if (rows.length === 0) {
		return <p className="im-empty">{t("settings.imChannels.bindingsEmpty")}</p>;
	}
	return (
		<div className="im-table-wrap">
			<table className="im-table">
				<thead>
					<tr>
						<th>{t("settings.imChannels.bindingPlatform")}</th>
						<th>{t("settings.imChannels.bindingChatId")}</th>
						<th>{t("settings.imChannels.bindingWorkspace")}</th>
						<th>{t("settings.imChannels.bindingSession")}</th>
						<th>{t("settings.imChannels.bindingAgent")}</th>
						<th aria-label={t("settings.imChannels.bindingActions")} />
					</tr>
				</thead>
				<tbody>
					{rows.map(row => {
						const preserved = unknownBindingKeys(row);
						return (
							<tr key={bindingKey(row)}>
								<td>{row.platform}</td>
								<td className="im-mono">{row.chatId}</td>
								<td>
									{row.workspaceAlias !== undefined ? <code>{row.workspaceAlias}</code> : <span className="im-muted">{t("settings.imChannels.bindingNone")}</span>}
									{preserved.length > 0 ? (
										<span className="chip xs gray im-preserved" title={preserved.join(", ")}>
											{t("settings.imChannels.bindingPreserved", { count: preserved.length })}
										</span>
									) : null}
								</td>
								<td>{row.sessionId !== undefined ? <code>{row.sessionId}</code> : <span className="im-muted">{t("settings.imChannels.bindingNone")}</span>}</td>
								<td>
									<span className="chip xs gray" data-unavailable="agent">
										{t("settings.imChannels.bindingAgentUnavailable")}
									</span>
								</td>
								<td className="im-row-actions">
									<button type="button" className="btn small" disabled={disabled} onClick={() => onEdit(row)}>
										{t("settings.imChannels.bindingEdit")}
									</button>
									<button type="button" className="btn small danger" disabled={disabled} onClick={() => onRemove(row)}>
										{t("settings.imChannels.bindingRemove")}
									</button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

/** One channel row: runtime word, credential word, and the enable switch. */
function ChannelRow({
	id,
	label,
	desc,
	enabled,
	running,
	configured,
	pending,
	onToggle,
}: {
	id: ChannelId;
	label: string;
	desc: string;
	enabled: boolean;
	running: boolean;
	configured: boolean;
	pending: boolean;
	onToggle: (next: boolean) => void;
}) {
	const { t } = useI18n();
	const state = channelRuntimeState(enabled, running);
	return (
		<div className="set-row im-channel-row" data-channel={id} data-enabled={enabled}>
			<div className="im-channel-main">
				<div className="sr-label">
					{label} <RuntimeChip state={state} />{" "}
					<span className={`chip sm ${configured ? "blue" : "gray"}`} data-configured={configured}>
						{configured ? t("settings.imChannels.configured") : t("settings.imChannels.notConfigured")}
					</span>
				</div>
				<div className="sr-desc">{desc}</div>
			</div>
			<div className="sr-control">
				<Switch checked={enabled} disabled={pending} label={label} onChange={onToggle} />
			</div>
		</div>
	);
}

export interface TotpPanelProps {
	status: TwoFactorStatus | null;
	enrollment: TwoFactorEnrollment | null;
	recoveryCodes: readonly string[];
	code: string;
	error: string | null;
	pending: string | null;
	onCode: (value: string) => void;
	onEnroll: () => void;
	onConfirm: () => void;
	onPolicy: (required: boolean) => void;
	onDisable: () => void;
	onRegenerate: () => void;
	t: (key: string, params?: Record<string, string | number>) => string;
}

/**
 * Two-factor (TOTP) for remote device access. The toggle is only rendered once
 * the store reports enrollment, so it can never claim "on" without a secret
 * that a code can match; recovery codes appear exactly once per issuance.
 */
export function TotpPanel({
	status,
	enrollment,
	recoveryCodes,
	code,
	error,
	pending,
	onCode,
	onEnroll,
	onConfirm,
	onPolicy,
	onDisable,
	onRegenerate,
	t,
}: TotpPanelProps) {
	const state = status === null ? "loading" : !status.enrolled ? "off" : status.required ? "required" : "enrolled";
	return (
		<div className="im-totp" data-totp-state={state}>
			<div className="im-totp-head">
				<div>
					<strong>{t("settings.imChannels.totpTitle")}</strong>
					<p className="im-hint">{t("settings.imChannels.totpDesc")}</p>
				</div>
				{status?.enrolled === true ? (
					<Switch
						checked={status.required}
						disabled={pending !== null}
						label={t("settings.imChannels.totpRequire")}
						onChange={onPolicy}
					/>
				) : null}
			</div>
			{error !== null ? (
				<p className="im-error" role="alert">
					{error}
				</p>
			) : null}
			{status === null ? (
				<p className="im-empty">{t("settings.imChannels.loading")}</p>
			) : status.enrolled ? (
				<>
					<p className="im-hint">
						{status.required
							? t("settings.imChannels.totpRequiredNote")
							: t("settings.imChannels.totpOptionalNote")}
					</p>
					<p className="im-hint" data-totp-remaining>
						{t("settings.imChannels.totpRemaining", { count: status.recoveryCodesRemaining })}
					</p>
					<div className="im-actions">
						<button type="button" className="btn small danger" disabled={pending !== null} onClick={onDisable}>
							{t("settings.imChannels.totpDisable")}
						</button>
						<button
							type="button"
							className="btn small"
							disabled={pending !== null || code.trim() === ""}
							onClick={onRegenerate}
						>
							{t("settings.imChannels.totpRegenerate")}
						</button>
					</div>
				</>
			) : (
				<>
					<div className="im-actions">
						<button type="button" className="btn small" disabled={pending !== null} onClick={onEnroll}>
							{t("settings.imChannels.totpEnroll")}
						</button>
					</div>
					<p className="im-hint">{t("settings.imChannels.totpLocalOnly")}</p>
				</>
			)}
			{enrollment !== null ? (
				<div className="im-totp-enroll">
					{enrollment.qrSvg !== "" ? (
						<div className="im-qr-svg" dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }} />
					) : null}
					<p className="im-qr-state">{t("settings.imChannels.totpScan")}</p>
					<code className="im-mono" data-totp-secret>
						{enrollment.secret}
					</code>
					<div className="im-actions im-totp-confirm">
						<button
							type="button"
							className="btn small"
							disabled={pending !== null || code.trim() === ""}
							onClick={onConfirm}
						>
							{t("settings.imChannels.totpConfirm")}
						</button>
					</div>
				</div>
			) : null}
			{recoveryCodes.length > 0 ? (
				<div className="im-totp-recovery" data-recovery-codes={recoveryCodes.length}>
					<p>{t("settings.imChannels.totpRecoveryCodes")}</p>
					<ul className="im-totp-codes">
						{recoveryCodes.map(entry => (
							<li key={entry}>
								<code>{entry}</code>
							</li>
						))}
					</ul>
					<p className="im-hint">{t("settings.imChannels.totpRecoveryHint")}</p>
				</div>
			) : null}
			{status?.enrolled === true || enrollment !== null ? (
				<div className="im-totp-code-row">
					<label className="im-field">
						<span>{t("settings.imChannels.totpCode")}</span>
						<input
							className="input"
							inputMode="numeric"
							autoComplete="one-time-code"
							placeholder={t("settings.imChannels.totpCodePlaceholder")}
							value={code}
							onChange={event => onCode(event.target.value)}
						/>
					</label>
				</div>
			) : null}
		</div>
	);
}

export function ImChannelsPane({ visible }: { visible: boolean }) {
	const { t } = useI18n();
	const { preview } = usePreviewMode();
	const [config, setConfig] = useState<WebConfigView | null>(null);
	const [status, setStatus] = useState<readonly ChannelStatusEntry[] | null>(null);
	const [qr, setQr] = useState<WechatQr | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const [devices, setDevices] = useState<DeviceInventory | null>(null);
	const [deviceError, setDeviceError] = useState<string | null>(null);
	const [totp, setTotp] = useState<TwoFactorStatus | null>(null);
	const [totpError, setTotpError] = useState<string | null>(null);
	const [totpEnrollment, setTotpEnrollment] = useState<TwoFactorEnrollment | null>(null);
	const [totpRecoveryCodes, setTotpRecoveryCodes] = useState<readonly string[]>([]);
	const [totpCode, setTotpCode] = useState("");
	const [stepUp, setStepUp] = useState<{ kind: "revoke"; id: string } | { kind: "revoke-all" } | null>(null);
	const [stepUpCode, setStepUpCode] = useState("");
	const [pairing, setPairing] = useState<PairingQr | null>(null);
	const [testChannel, setTestChannel] = useState<ChannelId>("wechat");
	const [testTo, setTestTo] = useState("");
	const [testText, setTestText] = useState("");
	const [bindingDraft, setBindingDraft] = useState<BindingDraft>(EMPTY_DRAFT);
	const [bindingTarget, setBindingTarget] = useState<ChatBinding | null>(null);

	const wechatEnabled = config?.channels.wechat.enabled === true;
	const wechatEnabledRef = useRef(false);
	wechatEnabledRef.current = wechatEnabled;

	const loadConfig = useCallback(async (): Promise<WebConfigView> => {
		const next = await fetchWebConfig();
		setConfig(next);
		return next;
	}, []);

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

	const refreshAll = useCallback(async () => {
		const [nextStatus, nextConfig] = await Promise.all([fetchChannelStatus(), fetchWebConfig()]);
		setStatus(nextStatus);
		setConfig(nextConfig);
		setLoadError(null);
		setQr(nextConfig.channels.wechat.enabled ? await fetchWechatQr().catch(() => null) : null);
	}, []);

	useEffect(() => {
		if (!visible || preview) return;
		let alive = true;
		const poll = async () => {
			try {
				const next = await fetchChannelStatus();
				if (!alive) return;
				setStatus(next);
				if (wechatEnabledRef.current) {
					const nextQr = await fetchWechatQr();
					if (alive) setQr(nextQr);
				} else if (alive) {
					setQr(null);
				}
			} catch {
				// A transient poll failure keeps the last honest snapshot; the next
				// tick (or a write) replaces it. It never clears the page.
			}
		};
		void refreshAll().catch(error => {
			if (alive) setLoadError(errorText(error));
		});
		void loadDevices();
		void loadTwoFactor();
		const fast = window.setInterval(() => void poll(), 2000);
		const slow = window.setInterval(() => {
			void loadConfig().catch(() => undefined);
		}, 60_000);
		return () => {
			alive = false;
			window.clearInterval(fast);
			window.clearInterval(slow);
		};
	}, [visible, preview, refreshAll, loadConfig, loadDevices, loadTwoFactor]);

	/** Run one write: pending key, one notice, refresh on success. */
	const run = async (key: string, action: () => Promise<string>): Promise<void> => {
		setPending(key);
		setNotice(null);
		try {
			const message = await action();
			setNotice({ kind: "ok", text: message });
		} catch (error) {
			setNotice({ kind: "error", text: `${t("settings.imChannels.actionFailed")}${errorText(error)}` });
		} finally {
			setPending(null);
		}
	};

	const enrollTotp = (): void => {
		void run("totp-enroll", async () => {
			const enrollment = await enrollTwoFactor(fetch);
			setTotpEnrollment(enrollment);
			setTotpRecoveryCodes(enrollment.recoveryCodes);
			setTotpCode("");
			return t("settings.imChannels.totpEnrollReady");
		});
	};

	const confirmTotp = (): void => {
		void run("totp-confirm", async () => {
			await confirmTwoFactor(fetch, totpCode.trim());
			setTotpEnrollment(null);
			setTotpRecoveryCodes([]);
			setTotpCode("");
			await loadTwoFactor();
			return t("settings.imChannels.totpConfirmed");
		});
	};

	const applyTotpPolicy = (required: boolean): void => {
		void run("totp-policy", async () => {
			await putTwoFactorPolicy(fetch, required);
			await loadTwoFactor();
			return required ? t("settings.imChannels.totpEnabled") : t("settings.imChannels.totpDisabledNotice");
		});
	};

	const disableTotp = (): void => {
		if (!window.confirm(t("settings.imChannels.totpDisableConfirm"))) return;
		void run("totp-disable", async () => {
			await disableTwoFactor(fetch);
			setTotpEnrollment(null);
			setTotpRecoveryCodes([]);
			setTotpCode("");
			await loadTwoFactor();
			return t("settings.imChannels.totpDisabledNotice");
		});
	};

	const regenerateTotp = (): void => {
		void run("totp-regenerate", async () => {
			const codes = await regenerateRecoveryCodes(fetch, totpCode.trim());
			setTotpRecoveryCodes(codes);
			setTotpCode("");
			await loadTwoFactor();
			return t("settings.imChannels.totpRegenerated");
		});
	};

	/** A 403 `totp_required` is not a failure: it opens the step-up prompt. */
	const askStepUp = (action: { kind: "revoke"; id: string } | { kind: "revoke-all" }): void => {
		setStepUp(action);
		setStepUpCode("");
	};

	const revokeDevice = (id: string): void => {
		void run(`revoke:${id}`, async () => {
			try {
				await revokePairedDevice(fetch, id);
			} catch (error) {
				if (isTwoFactorRequired(error)) {
					askStepUp({ kind: "revoke", id });
					return t("settings.imChannels.totpStepUpNeeded");
				}
				throw error;
			}
			await loadDevices();
			return t("settings.imChannels.revoked");
		});
	};

	const revokeAllDevices = (): void => {
		if (!window.confirm(t("settings.imChannels.revokeAllConfirm"))) return;
		void run("revoke-all", async () => {
			let count: number;
			try {
				count = await revokeAllPairedDevices(fetch, true);
			} catch (error) {
				if (isTwoFactorRequired(error)) {
					askStepUp({ kind: "revoke-all" });
					return t("settings.imChannels.totpStepUpNeeded");
				}
				throw error;
			}
			await loadDevices();
			return t("settings.imChannels.revokedAll", { count });
		});
	};

	const verifyStepUp = (): void => {
		if (stepUp === null) return;
		const action = stepUp;
		void run("totp-stepup", async () => {
			await verifyTwoFactor(fetch, { code: stepUpCode.trim() });
			setStepUp(null);
			setStepUpCode("");
			if (action.kind === "revoke-all") {
				const count = await revokeAllPairedDevices(fetch, true);
				await loadDevices();
				return t("settings.imChannels.revokedAll", { count });
			}
			await revokePairedDevice(fetch, action.id);
			await loadDevices();
			return t("settings.imChannels.revoked");
		});
	};

	if (preview) {
		return (
			<>
				<h3>{t("settings.imChannels.title")}</h3>
				<p className="desc">{t("settings.imChannels.desc")}</p>
				<p className="im-note">{t("settings.imChannels.previewNote")}</p>
			</>
		);
	}

	const aliases = workspaceAliases(config?.remote.workspaces);
	const sessions = botSessionViews(config?.remote.botSessions);
	const rows = chatBindings(config?.remote.sessionMappings);
	const draftProblem = bindingProblem(bindingDraft, aliases);
	const draftConflict = conflictingBinding(rows, bindingDraft, bindingTarget);

	const toggleChannel = (id: ChannelId, next: boolean): void => {
		void run(`toggle:${id}`, async () => {
			await putWebConfigValue(fetch, CHANNEL_PATHS[id].enabled, next);
			await refreshAll();
			return next ? t("settings.imChannels.enabledNotice") : t("settings.imChannels.disabledNotice");
		});
	};

	const validateCredentials = async (body: CredentialRequest): Promise<boolean> => {
		setPending(`credentials:${body.channel}`);
		setNotice(null);
		try {
			const result = await validateChannelCredentials(fetch, body);
			await loadConfig();
			const who = result.identity?.name ?? result.identity?.username ?? result.identity?.id ?? "";
			setNotice({ kind: "ok", text: t("settings.imChannels.credentialsVerified", { name: who }) });
			return true;
		} catch (error) {
			setNotice({ kind: "error", text: `${t("settings.imChannels.credentialsFailed")}${errorText(error)}` });
			return false;
		} finally {
			setPending(null);
		}
	};

	const saveWorkspaceRoot = (id: ChannelId, value: string): void => {
		void run(`workspaceRoot:${id}`, async () => {
			await putWebConfigValue(fetch, CHANNEL_PATHS[id].workspaceRoot, value);
			await loadConfig();
			return t("settings.imChannels.saved");
		});
	};

	const saveBinding = (): void => {
		void run("bindings", async () => {
			const problem = bindingProblem(bindingDraft, aliases);
			if (problem !== null) throw new Error(problemText(problem, t, aliases));
			if (conflictingBinding(rows, bindingDraft, bindingTarget)) {
				throw new Error(t("settings.imChannels.bindingConflict"));
			}
			const next = upsertBinding(rows, bindingTarget, bindingDraft);
			await putWebConfigValue(fetch, "remote.sessionMappings", next);
			await loadConfig();
			setBindingTarget(null);
			setBindingDraft(EMPTY_DRAFT);
			return t("settings.imChannels.bindingsSaved");
		});
	};

	const removeRow = (row: ChatBinding): void => {
		void run("bindings", async () => {
			await putWebConfigValue(fetch, "remote.sessionMappings", removeBinding(rows, row));
			await loadConfig();
			if (bindingTarget !== null && bindingKey(bindingTarget) === bindingKey(row)) {
				setBindingTarget(null);
				setBindingDraft(EMPTY_DRAFT);
			}
			return t("settings.imChannels.bindingsSaved");
		});
	};

	const editRow = (row: ChatBinding): void => {
		setBindingTarget(row);
		setBindingDraft({
			platform: row.platform,
			chatId: row.chatId,
			workspaceAlias: row.workspaceAlias ?? "",
			sessionId: row.sessionId ?? "",
		});
	};

	const sendTest = (event: FormEvent): void => {
		event.preventDefault();
		const to = testTo.trim();
		const text = testText.trim();
		if (to === "" || text === "") return;
		void run("test", async () => {
			await sendChannelTest(fetch, { channelId: testChannel, to, text });
			return t("settings.imChannels.sent");
		});
	};

	const stage = wechatLoginStage(qr, config?.channels.wechat.botToken !== undefined);
	return (
		<>
			<h3>{t("settings.imChannels.title")}</h3>
			<p className="desc">{t("settings.imChannels.desc")}</p>
			{loadError !== null ? (
				<p className="im-error" role="alert">
					{t("settings.imChannels.loadFailed")}
					{loadError}
				</p>
			) : null}
			{notice !== null ? (
				<p className={notice.kind === "ok" ? "im-notice" : "im-error"} role="status">
					{notice.text}
				</p>
			) : null}

			<SettingSection title={t("settings.imChannels.channelRows")} desc={t("settings.imChannels.channelsDesc")}>
				{config === null || status === null ? (
					<p className="im-empty">{t("settings.imChannels.loading")}</p>
				) : (
					CHANNEL_IDS.map(id => (
						<ChannelRow
							key={id}
							id={id}
							label={t(`settings.imChannels.channel.${id}`)}
							desc={t(`settings.imChannels.channelDesc.${id}`)}
							enabled={config.channels[id].enabled}
							running={runningFor(status, id)}
							configured={channelConfigured(id, config)}
							pending={pending === `toggle:${id}`}
							onToggle={next => toggleChannel(id, next)}
						/>
					))
				)}
			</SettingSection>

			<SettingSection title={t("settings.imChannels.wechatLogin")} desc={t("settings.imChannels.wechatLoginDesc")}>
				<div className="im-qr" data-stage={stage}>
					<WechatQrFrame qr={qr} stage={stage} />
					<div className="im-qr-copy">
						<p className="im-qr-state">{t(`settings.imChannels.qr.${stage}`)}</p>
						{!wechatEnabled ? <p className="im-hint">{t("settings.imChannels.qr.disabled")}</p> : null}
						<div className="im-actions">
							<button
								type="button"
								className="btn small"
								disabled={pending === "wechat:reconnect" || !wechatEnabled || (status !== null && !runningFor(status, "wechat"))}
								onClick={() => {
									void run("wechat:reconnect", async () => {
										await runWechatAction(fetch, "reconnect");
										await refreshAll();
										return t("settings.imChannels.reconnected");
									});
								}}
							>
								{t("settings.imChannels.reconnect")}
							</button>
							<button
								type="button"
								className="btn small danger"
								disabled={pending === "wechat:unbind" || !wechatEnabled || (status !== null && !runningFor(status, "wechat"))}
								onClick={() => {
									if (!window.confirm(t("settings.imChannels.unbindConfirm"))) return;
									void run("wechat:unbind", async () => {
										await runWechatAction(fetch, "unbind");
										await refreshAll();
										return t("settings.imChannels.unbound");
									});
								}}
							>
								{t("settings.imChannels.unbind")}
							</button>
						</div>
					</div>
				</div>
			</SettingSection>

			{config !== null ? (
				<SettingSection title={t("settings.imChannels.credentials")} desc={t("settings.imChannels.credentialsDesc")}>
					<FeishuCredentialForm
						key={`feishu:${config.channels.feishu.appId ?? ""}:${config.channels.feishu.domain ?? ""}`}
						appId={config.channels.feishu.appId ?? ""}
						secretSaved={config.channels.feishu.appSecret !== undefined}
						domain={config.channels.feishu.domain ?? "feishu"}
						pending={pending === "credentials:feishu"}
						onValidate={validateCredentials}
					/>
					<TelegramCredentialForm
						tokenSaved={config.channels.telegram.botToken !== undefined}
						pending={pending === "credentials:telegram"}
						onValidate={validateCredentials}
					/>
					<p className="im-hint" data-unavailable="credentials:discord,qq">
						{t("settings.imChannels.unsupportedCredentials")}
					</p>
				</SettingSection>
			) : null}

			{config !== null ? (
				<SettingSection title={t("settings.imChannels.workspaceRoot")} desc={t("settings.imChannels.workspaceRootDesc")}>
					{CHANNEL_IDS.map(id => (
						<WorkspaceRootField
							key={id}
							id={id}
							label={t(`settings.imChannels.channel.${id}`)}
							value={config.channels[id].workspaceRoot ?? ""}
							pending={pending === `workspaceRoot:${id}`}
							onSave={value => saveWorkspaceRoot(id, value)}
						/>
					))}
				</SettingSection>
			) : null}

			<SettingSection title={t("settings.imChannels.bindings")} desc={t("settings.imChannels.bindingsDesc")}>
				<BindingsTable rows={rows} onEdit={editRow} onRemove={removeRow} disabled={pending === "bindings"} />
				<form
					className="im-binding-form"
					onSubmit={event => {
						event.preventDefault();
						saveBinding();
					}}
				>
					<label className="im-field">
						<span>{t("settings.imChannels.bindingPlatform")}</span>
						<select
							className="select"
							value={bindingDraft.platform}
							onChange={event => setBindingDraft({ ...bindingDraft, platform: event.target.value as ChannelId })}
						>
							{CHANNEL_IDS.map(id => (
								<option key={id} value={id}>
									{t(`settings.imChannels.channel.${id}`)}
								</option>
							))}
						</select>
					</label>
					<label className="im-field">
						<span>{t("settings.imChannels.bindingChatId")}</span>
						<input
							className="input"
							value={bindingDraft.chatId}
							onChange={event => setBindingDraft({ ...bindingDraft, chatId: event.target.value })}
							placeholder="oc_…"
						/>
					</label>
					<label className="im-field">
						<span>{t("settings.imChannels.bindingWorkspace")}</span>
						<select
							className="select"
							value={bindingDraft.workspaceAlias}
							onChange={event => setBindingDraft({ ...bindingDraft, workspaceAlias: event.target.value })}
						>
							<option value="">{t("settings.imChannels.bindingNone")}</option>
							{aliases.map(alias => (
								<option key={alias} value={alias}>
									{alias}
								</option>
							))}
						</select>
					</label>
					<label className="im-field">
						<span>{t("settings.imChannels.bindingSession")}</span>
						<select
							className="select"
							value={bindingDraft.sessionId}
							onChange={event => setBindingDraft({ ...bindingDraft, sessionId: event.target.value })}
						>
							<option value="">{t("settings.imChannels.bindingNone")}</option>
							{sessions.map(session => (
								<option key={session.id} value={session.id}>
									{session.name}
								</option>
							))}
						</select>
					</label>
					<div className="im-actions">
						<button type="submit" className="btn small primary" disabled={pending === "bindings" || draftProblem !== null || draftConflict}>
							{bindingTarget === null ? t("settings.imChannels.bindingAdd") : t("settings.imChannels.bindingSave")}
						</button>
						{bindingTarget !== null ? (
							<button
								type="button"
								className="btn small"
								onClick={() => {
									setBindingTarget(null);
									setBindingDraft(EMPTY_DRAFT);
								}}
							>
								{t("settings.imChannels.bindingCancel")}
							</button>
						) : null}
					</div>
					{draftProblem !== null ? <p className="im-hint">{problemText(draftProblem, t, aliases)}</p> : null}
					{draftProblem === null && draftConflict ? <p className="im-hint">{t("settings.imChannels.bindingConflict")}</p> : null}
					<p className="im-hint">{t("settings.imChannels.agentNote")}</p>
					{aliases.length === 0 ? <p className="im-hint">{t("settings.imChannels.noWorkspaces")}</p> : null}
					{sessions.length === 0 ? <p className="im-hint">{t("settings.imChannels.noBotSessions")}</p> : null}
				</form>
			</SettingSection>

			<SettingSection title={t("settings.imChannels.sendTest")} desc={t("settings.imChannels.sendTestDesc")}>
				<form className="im-test-form" onSubmit={sendTest}>
					<label className="im-field">
						<span>{t("settings.imChannels.bindingPlatform")}</span>
						<select className="select" value={testChannel} onChange={event => setTestChannel(event.target.value as ChannelId)}>
							{CHANNEL_IDS.map(id => (
								<option key={id} value={id}>
									{t(`settings.imChannels.channel.${id}`)}
								</option>
							))}
						</select>
					</label>
					<label className="im-field">
						<span>{t("settings.imChannels.testTo")}</span>
						<input className="input" value={testTo} onChange={event => setTestTo(event.target.value)} />
					</label>
					<label className="im-field im-field-wide">
						<span>{t("settings.imChannels.testText")}</span>
						<input className="input" value={testText} onChange={event => setTestText(event.target.value)} />
					</label>
					<div className="im-actions">
						<button type="submit" className="btn small" disabled={pending === "test" || testTo.trim() === "" || testText.trim() === ""}>
							{t("settings.imChannels.send")}
						</button>
					</div>
				</form>
			</SettingSection>

			<SettingSection title={t("settings.imChannels.devices")} desc={t("settings.imChannels.devicesDesc")}>
				<div className="im-actions">
					<button
						type="button"
						className="btn small"
						disabled={pending === "pairing"}
						onClick={() => {
							if (pairing !== null) {
								setPairing(null);
								return;
							}
							void run("pairing", async () => {
								setPairing(await fetchPairingQr());
								return t("settings.imChannels.pairingReady");
							});
						}}
					>
						{t("settings.imChannels.pair")}
					</button>
					<button
						type="button"
						className="btn small danger"
						disabled={pending === "revoke-all" || devices === null}
						onClick={revokeAllDevices}
					>
						{t("settings.imChannels.revokeAll")}
					</button>
				</div>
				{pairing !== null ? (
					<div className="im-pairing">
						<div className="im-qr-svg" dangerouslySetInnerHTML={{ __html: pairing.svg }} />
						<div className="im-qr-copy">
							<p className="im-qr-state">{t("settings.imChannels.pairingDesc")}</p>
							<code className="im-mono">{pairing.url}</code>
						</div>
					</div>
				) : null}
				{deviceError !== null ? (
					<p className="im-error" role="alert">
						{t("settings.imChannels.devicesFailed")}
						{deviceError}
					</p>
				) : devices === null ? (
					<p className="im-empty">{t("settings.imChannels.loading")}</p>
				) : devices.devices.length === 0 ? (
					<p className="im-empty">{t("settings.imChannels.deviceNone")}</p>
				) : (
					<div className="im-table-wrap">
						<table className="im-table">
							<thead>
								<tr>
									<th>{t("settings.imChannels.deviceLabel")}</th>
									<th>{t("settings.imChannels.devicePlatform")}</th>
									<th>{t("settings.imChannels.deviceScopes")}</th>
									<th>{t("settings.imChannels.deviceLastSeen")}</th>
									<th aria-label={t("settings.imChannels.bindingActions")} />
								</tr>
							</thead>
							<tbody>
								{devices.devices.map(device => (
									<tr key={device.id} data-device={device.id} data-revoked={device.revokedAt !== null}>
										<td>
											{device.label !== "" ? device.label : device.id}
											{device.id === devices.currentDeviceId ? (
												<span className="chip xs blue im-preserved">{t("settings.imChannels.deviceCurrent")}</span>
											) : null}
										</td>
										<td>{device.platform}</td>
										<td>{device.scopes.join(", ")}</td>
										<td>
											{device.revokedAt !== null
												? t("settings.imChannels.deviceRevoked")
												: device.lastSeenAt !== null
													? device.lastSeenAt.replace("T", " ").slice(0, 16)
													: t("settings.imChannels.deviceNever")}
										</td>
										<td className="im-row-actions">
											<button
												type="button"
												className="btn small danger"
												disabled={device.revokedAt !== null || pending === `revoke:${device.id}`}
												onClick={() => {
													const label = device.label !== "" ? device.label : device.id;
													if (!window.confirm(t("settings.imChannels.revokeConfirm", { label }))) return;
													revokeDevice(device.id);
												}}
											>
												{t("settings.imChannels.revoke")}
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{devices?.legacyTokenActive === true ? <p className="im-hint">{t("settings.imChannels.legacyToken")}</p> : null}
				{stepUp !== null ? (
					<div className="im-totp-stepup" role="dialog" aria-label={t("settings.imChannels.totpStepUpTitle")}>
						<p>
							<strong>{t("settings.imChannels.totpStepUpTitle")}</strong>
						</p>
						<p className="im-hint">{t("settings.imChannels.totpStepUpDesc")}</p>
						<div className="im-actions">
							<input
								className="input"
								inputMode="numeric"
								autoComplete="one-time-code"
								placeholder={t("settings.imChannels.totpCodePlaceholder")}
								value={stepUpCode}
								onChange={event => setStepUpCode(event.target.value)}
							/>
							<button
								type="button"
								className="btn small"
								disabled={pending !== null || stepUpCode.trim() === ""}
								onClick={verifyStepUp}
							>
								{t("settings.imChannels.totpVerify")}
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
								{t("settings.imChannels.totpCancel")}
							</button>
						</div>
					</div>
				) : null}
				<TotpPanel
					status={totp}
					enrollment={totpEnrollment}
					recoveryCodes={totpRecoveryCodes}
					code={totpCode}
					error={totpError}
					pending={pending}
					onCode={setTotpCode}
					onEnroll={enrollTotp}
					onConfirm={confirmTotp}
					onPolicy={applyTotpPolicy}
					onDisable={disableTotp}
					onRegenerate={regenerateTotp}
					t={t}
				/>
			</SettingSection>
		</>
	);
}

function problemText(problem: BindingProblem, t: (key: string, params?: Record<string, string | number>) => string, aliases: readonly string[]): string {
	if (problem === "chatId") return t("settings.imChannels.bindingProblem.chatId");
	if (problem === "alias") return t("settings.imChannels.bindingProblem.alias");
	return aliases.length === 0 ? t("settings.imChannels.noWorkspaces") : t("settings.imChannels.bindingProblem.target");
}

function FeishuCredentialForm({
	appId,
	secretSaved,
	domain,
	pending,
	onValidate,
}: {
	appId: string;
	secretSaved: boolean;
	domain: "feishu" | "lark";
	pending: boolean;
	onValidate: (body: CredentialRequest) => Promise<boolean>;
}) {
	const { t } = useI18n();
	const [draftAppId, setDraftAppId] = useState(appId);
	const [draftSecret, setDraftSecret] = useState("");
	const [draftDomain, setDraftDomain] = useState<"feishu" | "lark">(domain);
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		const base = { channel: "feishu" as const, appId: draftAppId.trim(), domain: draftDomain };
		const body: CredentialRequest = draftSecret === "" ? base : { ...base, appSecret: draftSecret };
		void onValidate(body).then(ok => {
			if (ok) setDraftSecret("");
		});
	};
	return (
		<form className="im-credential-form" onSubmit={submit} data-channel="feishu">
			<label className="im-field">
				<span>{t("settings.imChannels.feishuAppId")}</span>
				<input className="input" value={draftAppId} onChange={event => setDraftAppId(event.target.value)} />
			</label>
			<label className="im-field">
				<span>{t("settings.imChannels.feishuAppSecret")}</span>
				<input
					className="input"
					type="password"
					autoComplete="new-password"
					value={draftSecret}
					placeholder={secretSaved ? MASKED_SECRET : ""}
					onChange={event => setDraftSecret(event.target.value)}
				/>
				{secretSaved ? <small className="im-hint">{t("settings.imChannels.secretSaved")}</small> : null}
			</label>
			<label className="im-field">
				<span>{t("settings.imChannels.feishuDomain")}</span>
				<select className="select" value={draftDomain} onChange={event => setDraftDomain(event.target.value === "lark" ? "lark" : "feishu")}>
					<option value="feishu">{t("settings.imChannels.domainFeishu")}</option>
					<option value="lark">{t("settings.imChannels.domainLark")}</option>
				</select>
			</label>
			<div className="im-actions">
				<button type="submit" className="btn small primary" disabled={pending}>
					{pending ? t("settings.imChannels.validating") : t("settings.imChannels.validateSave")}
				</button>
			</div>
		</form>
	);
}

function TelegramCredentialForm({
	tokenSaved,
	pending,
	onValidate,
}: {
	tokenSaved: boolean;
	pending: boolean;
	onValidate: (body: CredentialRequest) => Promise<boolean>;
}) {
	const { t } = useI18n();
	const [draftToken, setDraftToken] = useState("");
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		const body: CredentialRequest = draftToken === "" ? { channel: "telegram" } : { channel: "telegram", botToken: draftToken };
		void onValidate(body).then(ok => {
			if (ok) setDraftToken("");
		});
	};
	return (
		<form className="im-credential-form" onSubmit={submit} data-channel="telegram">
			<label className="im-field">
				<span>{t("settings.imChannels.telegramToken")}</span>
				<input
					className="input"
					type="password"
					autoComplete="new-password"
					value={draftToken}
					placeholder={tokenSaved ? MASKED_SECRET : ""}
					onChange={event => setDraftToken(event.target.value)}
				/>
				{tokenSaved ? <small className="im-hint">{t("settings.imChannels.secretSaved")}</small> : null}
			</label>
			<div className="im-actions">
				<button type="submit" className="btn small primary" disabled={pending}>
					{pending ? t("settings.imChannels.validating") : t("settings.imChannels.validateSave")}
				</button>
			</div>
		</form>
	);
}

function WorkspaceRootField({
	id,
	label,
	value,
	pending,
	onSave,
}: {
	id: ChannelId;
	label: string;
	value: string;
	pending: boolean;
	onSave: (value: string) => void;
}) {
	const { t } = useI18n();
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const trimmed = draft.trim();
	const invalid = trimmed !== "" && !isAbsolutePath(trimmed);
	const changed = trimmed !== value;
	return (
		<form
			className="set-row im-root-row"
			data-channel={id}
			onSubmit={event => {
				event.preventDefault();
				if (invalid || !changed) return;
				onSave(trimmed);
			}}
		>
			<div className="im-channel-main">
				<div className="sr-label">{label}</div>
				<input
					className="input"
					value={draft}
					placeholder={t("settings.imChannels.workspaceRootPlaceholder")}
					onChange={event => setDraft(event.target.value)}
					aria-label={`${label} ${t("settings.imChannels.workspaceRoot")}`}
				/>
				{invalid ? <small className="im-hint im-error">{t("settings.imChannels.invalidPath")}</small> : null}
			</div>
			<div className="sr-control">
				<button type="submit" className="btn small" disabled={pending || invalid || !changed}>
					{t("settings.imChannels.save")}
				</button>
			</div>
		</form>
	);
}
