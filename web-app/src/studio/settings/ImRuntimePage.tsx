/**
 * Settings → IM runtime (ADR-IM-0007, contract-frozen).
 *
 * The page is exported for the Studio shell to mount; this module does not
 * touch App.tsx. It covers the contract's four objects:
 *   - instances (per-platform, multi-instance, credentials keep/set/clear,
 *     enable/disable, validate, WeChat QR/reconnect/unbind),
 *   - imBindings (target = workspace / team PM / engineer, answer vs observe,
 *     needs-review and unknown-target states),
 *   - imAgents profiles (persona, model, location, tool allowlists, memory),
 *   - bot commands (current binding/session/model/role/voice/examples).
 *
 * Nothing is fabricated: every row comes from the gateway, every mutation
 * re-reads it, and a missing backend route renders the gateway's error instead
 * of a success state.
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import {
	CHANNEL_PLATFORMS,
	CREDENTIAL_FIELDS,
	SECRET_MASK,
	buildCredentialDraft,
	bindingKey,
	emptyProfile,
	fetchBotCommands,
	fetchChannelInstances,
	fetchChannelStatus,
	fetchImAgents,
	fetchImBindings,
	fetchInstanceQr,
	isValidInstanceId,
	isValidBindingId,
	isValidProfileId,
	hasControlChars,
	joinedLines,
	putChannelInstances,
	putImAgents,
	putImBindings,
	runInstanceWechatAction,
	sendInstanceMessage,
	secretDraftFor,
	setInstanceEnabled,
	splitLines,
	suggestInstanceId,
	targetState,
	validateInstance,
	type AgentsEnvelope,
	type BotCommands,
	type ChannelInstance,
	type ChannelPlatform,
	type ChannelStatus,
	type CredentialBag,
	type ImAgentProfile,
	type ImBinding,
	type SecretDraft,
} from "./imRuntimeApi";
import { SettingSection, Switch } from "./SettingRow";
import "./imRuntime.css";

export type ImRuntimeTab = "instances" | "bindings" | "profiles" | "bots";

export interface ImRuntimePageProps {
	/** Studio may keep the page mounted while the settings tab is hidden. */
	visible?: boolean;
	initialTab?: ImRuntimeTab;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function statusWord(status: ChannelStatus | undefined, zh: boolean): string {
	if (status === undefined) return zh ? "未启动" : "not started";
	if (status.running) return zh ? "运行中" : "running";
	return status.state ?? (zh ? "已停止" : "stopped");
}

function statusTone(status: ChannelStatus | undefined): string {
	if (status === undefined) return "gray";
	if (status.running) return "green";
	if (status.lastError !== undefined && status.lastError !== "") return "red";
	return "amber";
}

function newBindingId(): string {
	const bytes = new Uint8Array(8);
	globalThis.crypto.getRandomValues(bytes);
	return `b_${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function ImRuntimePage({ visible = true, initialTab = "instances" }: ImRuntimePageProps) {
	const { resolvedLanguage } = useI18n();
	const zh = resolvedLanguage === "zh";
	const t = (cn: string, en: string): string => (zh ? cn : en);

	const [tab, setTab] = useState<ImRuntimeTab>(initialTab);
	const [status, setStatus] = useState<readonly ChannelStatus[] | null>(null);
	const [instances, setInstances] = useState<readonly ChannelInstance[] | null>(null);
	const [agents, setAgents] = useState<AgentsEnvelope | null>(null);
	const [bindings, setBindings] = useState<readonly ImBinding[] | null>(null);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [editingInstance, setEditingInstance] = useState<ChannelInstance | "new" | null>(null);
	const [editingBinding, setEditingBinding] = useState<ImBinding | "new" | null>(null);
	const [editingProfile, setEditingProfile] = useState<ImAgentProfile | "new" | null>(null);
	const [bindingFilter, setBindingFilter] = useState("");
	const [qr, setQr] = useState<Record<string, Record<string, unknown>>>({});
	const [botInstance, setBotInstance] = useState("");
	const [botChat, setBotChat] = useState("");
	const [botCommands, setBotCommands] = useState<BotCommands | null>(null);

	const load = useCallback(async () => {
		const nextErrors: Record<string, string> = {};
		const [nextStatus, nextInstances, nextAgents, nextBindings] = await Promise.all([
			fetchChannelStatus().catch(error => {
				nextErrors.status = errorText(error);
				return null;
			}),
			fetchChannelInstances().catch(error => {
				nextErrors.instances = errorText(error);
				return null;
			}),
			fetchImAgents().catch(error => {
				nextErrors.agents = errorText(error);
				return null;
			}),
			fetchImBindings().catch(error => {
				nextErrors.bindings = errorText(error);
				return null;
			}),
		]);
		setStatus(nextStatus?.instances ?? null);
		setInstances(nextInstances);
		setAgents(nextAgents);
		setBindings(nextBindings);
		setErrors(nextErrors);
		if (nextInstances !== null && botInstance === "") setBotInstance(nextInstances[0]?.id ?? "");
	}, [botInstance]);

	useEffect(() => {
		if (!visible) return;
		void load();
	}, [visible, load]);

	const run = async (key: string, action: () => Promise<string>, reload = true): Promise<void> => {
		setBusy(key);
		setNotice(null);
		setErrors(current => {
			const { action: _action, ...rest } = current;
			return rest;
		});
		try {
			const message = await action();
			setNotice(message);
			if (reload) await load();
		} catch (error) {
			setNotice(null);
			setErrors(current => ({ ...current, action: errorText(error) }));
		} finally {
			setBusy(null);
		}
	};

	const saveInstance = (next: ChannelInstance): void => {
		if (instances === null) return;
		const exists = instances.some(instance => instance.id === next.id);
		const rows = exists ? instances.map(instance => (instance.id === next.id ? next : instance)) : [...instances, next];
		void run("instance-save", async () => {
			await putChannelInstances(fetch, rows);
			setEditingInstance(null);
			return t("实例已保存。", "Instance saved.");
		});
	};

	const removeInstance = (id: string): void => {
		if (instances === null) return;
		if (!window.confirm(t(`删除实例 ${id}？绑定不会自动删除。`, `Delete instance ${id}? Its bindings are not removed automatically.`))) return;
		void run(`instance-delete:${id}`, async () => {
			await putChannelInstances(fetch, instances.filter(instance => instance.id !== id));
			return t("实例已删除。", "Instance deleted.");
		});
	};

	const toggleInstance = (instance: ChannelInstance, enabled: boolean): void => {
		void run(`instance-toggle:${instance.id}`, async () => {
			await setInstanceEnabled(fetch, instance.id, enabled);
			return enabled ? t("已启用。", "Enabled.") : t("已停用。", "Disabled.");
		});
	};

	const loadQr = (id: string): void => {
		void run(`qr:${id}`, async () => {
			const payload = await fetchInstanceQr(fetch, id);
			setQr(current => ({ ...current, [id]: payload }));
			return t("二维码已刷新。", "QR refreshed.");
		}, false);
	};

	const wechatAction = (id: string, action: "reconnect" | "unbind"): void => {
		if (action === "unbind" && !window.confirm(t("解绑会清除该实例的 bot token 与 peer 绑定。", "Unbind clears this instance's bot token and peer bindings."))) return;
		void run(`wechat:${id}:${action}`, async () => {
			await runInstanceWechatAction(fetch, id, action);
			setQr(current => {
				const next = { ...current };
				delete next[id];
				return next;
			});
			return action === "reconnect" ? t("已重新发起登录。", "Login restarted.") : t("已解绑。", "Unbound.");
		});
	};

	const saveBinding = (next: ImBinding): void => {
		if (bindings === null) return;
		const exists = bindings.some(binding => binding.id === next.id);
		const rows = exists ? bindings.map(binding => (binding.id === next.id ? next : binding)) : [...bindings, next];
		void run("binding-save", async () => {
			await putImBindings(fetch, rows);
			setEditingBinding(null);
			return t("绑定已保存。", "Binding saved.");
		});
	};

	const removeBinding = (binding: ImBinding): void => {
		if (bindings === null) return;
		void run(`binding-delete:${binding.id}`, async () => {
			await putImBindings(fetch, bindings.filter(row => bindingKey(row) !== bindingKey(binding)));
			return t("绑定已删除。", "Binding deleted.");
		});
	};

	const saveProfile = (next: ImAgentProfile): void => {
		if (agents === null) return;
		const exists = agents.profiles.some(profile => profile.id === next.id);
		const rows = exists ? agents.profiles.map(profile => (profile.id === next.id ? next : profile)) : [...agents.profiles, next];
		void run("profile-save", async () => {
			await putImAgents(fetch, rows);
			setEditingProfile(null);
			return t("Profile 已保存。", "Profile saved.");
		});
	};

	const removeProfile = (profile: ImAgentProfile): void => {
		if (agents === null) return;
		const used = bindings?.some(binding => binding.agentProfileId === profile.id) ?? false;
		if (used) {
			setErrors(current => ({ ...current, action: t("该 Profile 仍被绑定引用，先改绑定。", "This profile is still referenced by a binding.") }));
			return;
		}
		void run(`profile-delete:${profile.id}`, async () => {
			await putImAgents(fetch, agents.profiles.filter(row => row.id !== profile.id));
			return t("Profile 已删除。", "Profile deleted.");
		});
	};

	const instanceLabel = (id: string): string =>
		instances?.find(instance => instance.id === id)?.label ?? id;
	const profileLabel = (id: string): string =>
		agents?.profiles.find(profile => profile.id === id)?.label ?? id;

	const filteredBindings = useMemo(() => {
		if (bindings === null) return null;
		return bindingFilter === "" ? bindings : bindings.filter(binding => binding.instanceId === bindingFilter);
	}, [bindings, bindingFilter]);

	if (!visible) return null;

	const tabButton = (id: ImRuntimeTab, label: string): ReactNode => (
		<button
			key={id}
			type="button"
			className={`btn small imr-tab${tab === id ? " primary" : ""}`}
			aria-pressed={tab === id}
			onClick={() => setTab(id)}
		>
			{label}
		</button>
	);

	return (
		<section className="imr" aria-label={t("IM 运行时", "IM runtime")}>
			<header className="imr-head">
				<div>
					<h3>{t("IM 运行时", "IM runtime")}</h3>
					<p className="desc">
						{t(
							"按实例管理渠道、绑定、Agent Profile 与 Bot 命令。数据来自 channels.instances / remote.imBindings / imAgents，秘密只写不读。",
							"Instances, bindings, agent profiles and bot commands. Data comes from channels.instances / remote.imBindings / imAgents; secrets are write-only.",
						)}
					</p>
				</div>
				<div className="imr-tabs">
					{tabButton("instances", t("实例", "Instances"))}
					{tabButton("bindings", t("绑定", "Bindings"))}
					{tabButton("profiles", t("Agent Profile", "Agent profiles"))}
					{tabButton("bots", t("Bot 命令", "Bot commands"))}
				</div>
			</header>

			{notice !== null ? <p className="imr-notice" role="status">{notice}</p> : null}
			{errors.action !== undefined ? <p className="imr-error" role="alert">{errors.action}</p> : null}

			{tab === "instances" ? (
				<>
					<SettingSection title={t("渠道实例", "Channel instances")} desc={t("同一平台可建多个实例；实例 id 是运行时命名空间，创建后不可改名。", "Several instances may share one platform; the instance id is the runtime namespace and is immutable after creation.")}>
						<div className="imr-actions">
							<button type="button" className="btn small primary" onClick={() => setEditingInstance("new")}>
								{t("新增实例", "New instance")}
							</button>
						</div>
						{errors.instances !== undefined ? (
							<p className="imr-error" role="alert">{t("读取实例失败：", "Could not read instances: ")}{errors.instances}</p>
						) : instances === null ? (
							<p className="imr-empty">{t("加载中…", "Loading…")}</p>
						) : instances.length === 0 ? (
							<p className="imr-empty">{t("还没有渠道实例。", "No channel instances yet.")}</p>
						) : (
							<div className="imr-table-wrap">
								<table className="imr-table">
									<thead>
										<tr>
											<th>{t("实例", "Instance")}</th>
											<th>{t("平台", "Platform")}</th>
											<th>{t("运行时", "Runtime")}</th>
											<th>{t("目标", "Target")}</th>
											<th>{t("Agent Profile", "Agent profile")}</th>
											<th>{t("启用", "Enabled")}</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{instances.map(instance => {
											const live = status?.find(entry => entry.id === instance.id);
											return (
												<Fragment key={instance.id}>
													<tr data-instance={instance.id}>
														<td>
															<strong>{instance.label}</strong>
															<div className="imr-mono">{instance.id}</div>
															{instance.note !== undefined ? <div className="imr-hint">{instance.note}</div> : null}
														</td>
														<td>{instance.platform}</td>
														<td>
															<span className={`chip sm ${statusTone(live)}`}>{statusWord(live, zh)}</span>
															{live?.configured === false ? <span className="chip sm amber">{t("未配置", "not configured")}</span> : null}
															{live?.lastError !== undefined ? <div className="imr-error">{live.lastError}</div> : null}
															{live?.detail !== undefined ? <div className="imr-hint">{live.detail}</div> : null}
														</td>
														<td>
															{live?.targetDisplay !== undefined && live.targetDisplay !== null
																? live.targetDisplay
																: <span className="imr-muted">{t("未解析", "unresolved")}</span>}
															{live?.targetAvailable === false ? (
																<div className="imr-error">{live.targetReason ?? t("目标不可用", "target unavailable")}</div>
															) : null}
														</td>
														<td>{live?.agentProfileLabel ?? profileLabel(instance.agentProfile)}</td>
														<td>
															<Switch
																checked={instance.enabled}
																label={instance.label}
																disabled={busy === `instance-toggle:${instance.id}`}
																onChange={next => toggleInstance(instance, next)}
															/>
														</td>
														<td className="imr-row-actions">
															<button type="button" className="btn small" onClick={() => setEditingInstance(instance)}>
																{t("编辑", "Edit")}
															</button>
															{instance.platform === "wechat" ? (
																<button type="button" className="btn small" onClick={() => loadQr(instance.id)} disabled={busy === `qr:${instance.id}`}>
																	{t("二维码", "QR")}
																</button>
															) : null}
															<button type="button" className="btn small danger" onClick={() => removeInstance(instance.id)}>
																{t("删除", "Delete")}
															</button>
														</td>
													</tr>
													{instance.platform === "wechat" && qr[instance.id] !== undefined ? (
														<tr className="imr-qr-row">
															<td colSpan={7}>
																<WechatQrBlock payload={qr[instance.id]!} onReconnect={() => wechatAction(instance.id, "reconnect")} onUnbind={() => wechatAction(instance.id, "unbind")} busy={busy} zh={zh} />
															</td>
														</tr>
													) : null}
												</Fragment>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</SettingSection>
					{editingInstance !== null && instances !== null ? (
						<InstanceEditor
							initial={editingInstance === "new" ? null : editingInstance}
							instances={instances}
							profiles={agents?.profiles ?? []}
							busy={busy !== null}
							zh={zh}
							onCancel={() => setEditingInstance(null)}
							onSave={saveInstance}
							onValidate={async (credentials, id) => {
								await validateInstance(fetch, id, credentials);
							}}
						/>
					) : null}
				</>
			) : null}

			{tab === "bindings" ? (
				<>
					<SettingSection title={t("聊天绑定", "Chat bindings")} desc={t("一个绑定 = 实例 + 聊天 + Agent Profile + 目标 + 会话。answer 与 observe 同一聊天只能有一个 answer。", "A binding = instance + chat + profile + target + session. Only one answer binding is allowed per chat.")}>
						<div className="imr-actions">
							<label className="imr-field">
								<span>{t("按实例过滤", "Filter by instance")}</span>
								<select className="select" value={bindingFilter} onChange={event => setBindingFilter(event.target.value)}>
									<option value="">{t("全部", "All")}</option>
									{(instances ?? []).map(instance => (
										<option key={instance.id} value={instance.id}>{instance.label}</option>
									))}
								</select>
							</label>
							<button type="button" className="btn small primary" onClick={() => setEditingBinding("new")}>
								{t("新增绑定", "New binding")}
							</button>
						</div>
						{errors.bindings !== undefined ? (
							<p className="imr-error" role="alert">{t("读取绑定失败：", "Could not read bindings: ")}{errors.bindings}</p>
						) : filteredBindings === null ? (
							<p className="imr-empty">{t("加载中…", "Loading…")}</p>
						) : filteredBindings.length === 0 ? (
							<p className="imr-empty">{t("还没有绑定。", "No bindings yet.")}</p>
						) : (
							<div className="imr-table-wrap">
								<table className="imr-table">
									<thead>
										<tr>
											<th>{t("实例", "Instance")}</th>
											<th>{t("聊天", "Chat")}</th>
											<th>{t("目标", "Target")}</th>
											<th>{t("Profile", "Profile")}</th>
											<th>{t("会话", "Session")}</th>
											<th>{t("模型", "Model")}</th>
											<th>{t("角色", "Role")}</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{filteredBindings.map(binding => {
											const target = targetState(binding);
											return (
												<tr key={bindingKey(binding)} data-binding={bindingKey(binding)} data-needs-review={binding.needsReview === true}>
													<td>{instanceLabel(binding.instanceId)}<div className="imr-mono">{binding.instanceId}</div></td>
													<td className="imr-mono">{binding.chatId}{binding.threadId ? ` / ${binding.threadId}` : ""}{binding.userId ? ` / ${binding.userId}` : ""}</td>
													<td>
														{binding.targetDisplay ?? binding.target?.display ?? t("未知目标", "unknown target")}
														{!target.available ? <div className="imr-error">{target.reason === "needsReview" ? t("待复核", "needs review") : target.reason}</div> : null}
													</td>
													<td>{binding.agentProfileLabel ?? profileLabel(binding.agentProfileId)}</td>
													<td className="imr-mono">{binding.sessionId}</td>
													<td>{binding.model ? `${binding.model.provider} / ${binding.model.model}` : t("继承", "inherit")}</td>
													<td>
														<span className={`chip sm ${binding.role === "answer" ? "green" : binding.role === "mention" ? "blue" : "gray"}`}>
															{binding.role}
														</span>
														{binding.role === "mention" ? <div className="imr-hint">{t("仅 @ 时回复", "replies only when mentioned")}</div> : null}
													</td>
													<td className="imr-row-actions">
														<button type="button" className="btn small" onClick={() => setEditingBinding(binding)}>{t("编辑", "Edit")}</button>
														<button type="button" className="btn small danger" onClick={() => removeBinding(binding)}>{t("删除", "Delete")}</button>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</SettingSection>
					{editingBinding !== null && instances !== null ? (
						<BindingEditor
							initial={editingBinding === "new" ? null : editingBinding}
							instances={instances}
							profiles={agents?.profiles ?? []}
							targets={agents?.targets ?? []}
							bindings={bindings ?? []}
							busy={busy !== null}
							zh={zh}
							onCancel={() => setEditingBinding(null)}
							onSave={saveBinding}
						/>
					) : null}
				</>
			) : null}

			{tab === "profiles" ? (
				<>
					<SettingSection title={t("Agent Profile", "Agent profiles")} desc={t("Profile 决定 persona、模型、位置与工具白名单。工具是 allowlist：空数组表示没有，不会继承环境里的工具。", "A profile owns persona, model, location and tool allowlists. Allowlists are literal: [] means none, and ambient tools are never inherited.")}>
						<div className="imr-actions">
							<button type="button" className="btn small primary" onClick={() => setEditingProfile("new")}>{t("新增 Profile", "New profile")}</button>
						</div>
						{errors.agents !== undefined ? (
							<p className="imr-error" role="alert">{t("读取 Profile 失败：", "Could not read profiles: ")}{errors.agents}</p>
						) : agents === null ? (
							<p className="imr-empty">{t("加载中…", "Loading…")}</p>
						) : agents.profiles.length === 0 ? (
							<p className="imr-empty">{t("还没有 Agent Profile。", "No agent profiles yet.")}</p>
						) : (
							<div className="imr-table-wrap">
								<table className="imr-table">
									<thead>
										<tr>
											<th>{t("Profile", "Profile")}</th>
											<th>{t("位置", "Location")}</th>
											<th>{t("模型", "Model")}</th>
											<th>{t("工具", "Tools")}</th>
											<th>{t("记忆", "Memory")}</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{agents.profiles.map(profile => (
											<tr key={profile.id} data-profile={profile.id}>
												<td><strong>{profile.label}</strong><div className="imr-mono">{profile.id}</div></td>
												<td>{describeLocation(profile)}</td>
												<td>{profile.model ? `${profile.model.provider} / ${profile.model.model}` : t("默认", "default")}</td>
												<td className="imr-hint">
													builtin {profile.tools.builtin.length} · ext {profile.tools.extensions.length} · mcp {profile.tools.mcpServers.length} · custom {profile.tools.customTools.length} · skills {profile.tools.skills.length} · cmd {profile.tools.commands.length}
												</td>
												<td>{profile.memory?.backend ?? "off"}</td>
												<td className="imr-row-actions">
													<button type="button" className="btn small" onClick={() => setEditingProfile(profile)}>{t("编辑", "Edit")}</button>
													<button type="button" className="btn small danger" onClick={() => removeProfile(profile)}>{t("删除", "Delete")}</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</SettingSection>
					{editingProfile !== null ? (
						<ProfileEditor
							initial={editingProfile === "new" ? null : editingProfile}
							profileIds={agents?.profiles.map(profile => profile.id) ?? []}
							busy={busy !== null}
							zh={zh}
							onCancel={() => setEditingProfile(null)}
							onSave={saveProfile}
						/>
					) : null}
				</>
			) : null}

			{tab === "bots" ? (
				<SettingSection title={t("Bot 当前状态与命令", "Bot state and commands")} desc={t("显示后端解析出的绑定、会话、模型、answer/observe 与语音能力；运行身份包含 bindingId，由后端计算。", "Shows the backend-resolved binding, session, model, answer/observe role and voice capability; the runtime identity (including bindingId) is backend-computed.")}>
					<div className="imr-actions">
						<label className="imr-field">
							<span>{t("实例", "Instance")}</span>
							<select className="select" value={botInstance} onChange={event => setBotInstance(event.target.value)}>
								{(instances ?? []).map(instance => <option key={instance.id} value={instance.id}>{instance.label}</option>)}
							</select>
						</label>
						<label className="imr-field">
							<span>{t("聊天 ID", "Chat id")}</span>
							<input className="input" value={botChat} onChange={event => setBotChat(event.target.value)} />
						</label>
						<button
							type="button"
							className="btn small primary"
							disabled={botInstance === "" || botChat.trim() === "" || busy === "commands"}
							onClick={() => void run("commands", async () => {
								setBotCommands(await fetchBotCommands(fetch, botInstance, botChat.trim()));
								return t("已读取。", "Loaded.");
							}, false)}
						>
							{t("读取", "Load")}
						</button>
						<button
							type="button"
							className="btn small"
							disabled={botInstance === "" || botChat.trim() === "" || busy === "send"}
							onClick={() => {
								const text = window.prompt(t("测试消息内容", "Test message"));
								if (text === null || text.trim() === "") return;
								void run("send", async () => {
									await sendInstanceMessage(fetch, { instanceId: botInstance, to: botChat.trim(), text: text.trim() });
									return t("消息已发送。", "Message sent.");
								}, false);
							}}
						>
							{t("发送测试", "Send test")}
						</button>
					</div>
					{errors.commands !== undefined ? <p className="imr-error" role="alert">{errors.commands}</p> : null}
					{botCommands === null ? (
						<p className="imr-empty">{t("输入实例与聊天 ID 后读取。", "Pick an instance and chat id, then load.")}</p>
					) : (
						<div className="imr-bot">
							<div className="imr-facts">
								<span className="chip sm blue">{botCommands.bot?.label ?? botInstance}</span>
								<span className={`chip sm ${botCommands.binding?.role === "answer" ? "green" : botCommands.binding?.role === "mention" ? "blue" : "gray"}`}>
								{botCommands.binding?.role ?? t("未绑定", "unbound")}
							</span>
							{botCommands.binding?.role === "mention" ? <span className="chip sm gray">{t("不自动回复", "no auto-reply")}</span> : null}
								<span className="chip sm gray">{botCommands.voice.supported ? t("语音可用", "voice supported") : t("语音不可用", "voice unsupported")}</span>
							</div>
							{!botCommands.voice.supported && botCommands.voice.reason !== undefined ? <p className="imr-hint">{botCommands.voice.reason}</p> : null}
							<dl className="imr-dl">
								<dt>{t("绑定", "Binding")}</dt><dd>{botCommands.binding?.id ?? "—"}</dd>
								<dt>{t("运行身份", "Runtime id")}</dt><dd className="imr-mono">{botCommands.agentRuntimeId ?? "—"}</dd>
								<dt>{t("会话", "Session")}</dt><dd className="imr-mono">{botCommands.session?.display ?? botCommands.session?.id ?? "—"}</dd>
								<dt>{t("模型", "Model")}</dt><dd>{botCommands.model?.display ?? (botCommands.model ? `${botCommands.model.provider} / ${botCommands.model.model}` : "—")}</dd>
							</dl>
							<p className="imr-hint">{t("命令示例", "Command examples")}</p>
							<ul className="imr-examples">
								{botCommands.examples.length === 0 ? <li className="imr-muted">{t("后端没有返回示例。", "The backend returned no examples.")}</li> : botCommands.examples.map(example => <li key={example}><code>{example}</code></li>)}
							</ul>
						</div>
					)}
				</SettingSection>
			) : null}
		</section>
	);
}

function WechatQrBlock({
	payload,
	onReconnect,
	onUnbind,
	busy,
	zh,
}: {
	payload: Record<string, unknown>;
	onReconnect: () => void;
	onUnbind: () => void;
	busy: string | null;
	zh: boolean;
}) {
	const pending = payload.pending === true;
	const status = typeof payload.status === "string" ? payload.status : "";
	const url = typeof payload.qrcodeUrl === "string" ? payload.qrcodeUrl : "";
	const svg = typeof payload.svg === "string" ? payload.svg : "";
	const stage = !pending ? (zh ? "未开始" : "not started") : status === "scaned" ? (zh ? "已扫码" : "scanned") : status === "confirmed" ? (zh ? "已连接" : "connected") : status === "expired" ? (zh ? "已过期" : "expired") : (zh ? "待扫码" : "pending");
	return (
		<div className="imr-qr">
			<div className="imr-qr-frame">
				{pending && svg !== "" ? (
					<div className="imr-qr-svg" data-qr="svg" dangerouslySetInnerHTML={{ __html: svg }} />
				) : pending && /^data:image\//.test(url) ? (
					<img className="imr-qr-image" src={url} alt={zh ? "微信登录二维码" : "WeChat login QR"} />
				) : (
					<span className="imr-qr-placeholder">{stage}</span>
				)}
			</div>
			<div className="imr-qr-copy">
				<p>{stage}</p>
				{pending && url !== "" && svg === "" && !/^data:image\//.test(url) ? <code className="imr-mono">{url}</code> : null}
				<div className="imr-actions">
					<button type="button" className="btn small" onClick={onReconnect} disabled={busy !== null}>{zh ? "重新连接" : "Reconnect"}</button>
					<button type="button" className="btn small danger" onClick={onUnbind} disabled={busy !== null}>{zh ? "解绑" : "Unbind"}</button>
				</div>
			</div>
		</div>
	);
}

interface InstanceFormState {
	id: string;
	platform: ChannelPlatform;
	label: string;
	note: string;
	enabled: boolean;
	agentProfile: string;
	peers: string;
	users: string;
	plain: Record<string, string>;
	secretText: Record<string, string>;
	secretCleared: Record<string, boolean>;
}

function instanceForm(initial: ChannelInstance | null, instances: readonly ChannelInstance[]): InstanceFormState {
	const platform = initial?.platform ?? "wechat";
	const plain: Record<string, string> = {};
	const secretText: Record<string, string> = {};
	for (const field of CREDENTIAL_FIELDS[platform]) {
		const value = initial?.credentials[field.key];
		if (field.secret) {
			secretText[field.key] = "";
			continue;
		}
		plain[field.key] = typeof value === "string" ? value : Array.isArray(value) ? joinedLines(value) : "";
	}
	return {
		id: initial?.id ?? suggestInstanceId(platform, instances),
		platform,
		label: initial?.label ?? "",
		note: initial?.note ?? "",
		enabled: initial?.enabled ?? true,
		agentProfile: initial?.agentProfile ?? "",
		peers: initial?.allow.peers.join("\n") ?? "",
		users: initial?.allow.users?.join("\n") ?? "",
		plain,
		secretText,
		secretCleared: {},
	};
}

function credentialBag(form: InstanceFormState, original: CredentialBag | undefined): CredentialBag {
	const drafts: Record<string, SecretDraft | string> = {};
	for (const field of CREDENTIAL_FIELDS[form.platform]) {
		if (field.secret) drafts[field.key] = secretDraftFor(form.secretCleared[field.key] === true, form.secretText[field.key] ?? "");
		else drafts[field.key] = form.plain[field.key] ?? "";
	}
	return buildCredentialDraft(form.platform, original ?? {}, drafts);
}

function InstanceEditor({
	initial,
	instances,
	profiles,
	busy,
	zh,
	onCancel,
	onSave,
	onValidate,
}: {
	initial: ChannelInstance | null;
	instances: readonly ChannelInstance[];
	profiles: readonly ImAgentProfile[];
	busy: boolean;
	zh: boolean;
	onCancel: () => void;
	onSave: (instance: ChannelInstance) => void;
	onValidate: (credentials: CredentialBag, id: string) => Promise<void>;
}) {
	const [form, setForm] = useState<InstanceFormState>(() => instanceForm(initial, instances));
	const [validation, setValidation] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const t = (cn: string, en: string): string => (zh ? cn : en);
	const fields = CREDENTIAL_FIELDS[form.platform];
	const idValid = isValidInstanceId(form.id) && (!initial || form.id === initial.id);
	const canSave = idValid && form.label.trim() !== "" && form.agentProfile !== "" && splitLines(form.peers).length > 0;
	return (
		<SettingSection title={initial === null ? t("新增实例", "New instance") : t("编辑实例", "Edit instance")} desc={t("实例 id 是运行时命名空间；密钥留空表示保留，勾选清除才会写 null。", "The instance id is the runtime namespace; an empty secret keeps the stored value, and only an explicit clear writes null.")}>
			<form
				className="imr-form"
				onSubmit={event => {
					event.preventDefault();
					if (!canSave) return;
					setError(null);
					onSave({
						id: form.id,
						platform: form.platform,
						label: form.label.trim(),
						...(form.note.trim() !== "" ? { note: form.note.trim() } : {}),
						enabled: form.enabled,
						agentProfile: form.agentProfile,
						allow: {
							peers: splitLines(form.peers),
							...(splitLines(form.users).length > 0 ? { users: splitLines(form.users) } : {}),
						},
						credentials: credentialBag(form, initial?.credentials),
						...(initial?.options !== undefined ? { options: initial.options } : {}),
					});
				}}
			>
				<label className="imr-field">
					<span>{t("实例 ID", "Instance id")}</span>
					<input
						className="input"
						value={form.id}
						disabled={initial !== null}
						onChange={event => setForm({ ...form, id: event.target.value })}
					/>
					{!idValid ? <small className="imr-error">{t("小写字母/数字/_/-，2–32 位；创建后不可改。", "Lowercase letters/digits/_/-; 2–32 chars; immutable after creation.")}</small> : null}
				</label>
				<label className="imr-field">
					<span>{t("平台", "Platform")}</span>
					<select
						className="select"
						value={form.platform}
						disabled={initial !== null}
						onChange={event => {
							const platform = event.target.value as ChannelPlatform;
							setForm({
								...instanceForm(null, instances),
								platform,
								id: suggestInstanceId(platform, instances),
								label: form.label,
								note: form.note,
								enabled: form.enabled,
								agentProfile: form.agentProfile,
								peers: form.peers,
								users: form.users,
							});
						}}
					>
						{CHANNEL_PLATFORMS.map(platform => <option key={platform} value={platform}>{platform}</option>)}
					</select>
				</label>
				<label className="imr-field">
					<span>{t("显示名", "Label")}</span>
					<input className="input" value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("备注", "Note")}</span>
					<input className="input" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("Agent Profile", "Agent profile")}</span>
					<select className="select" value={form.agentProfile} onChange={event => setForm({ ...form, agentProfile: event.target.value })}>
						<option value="">{t("选择…", "Select…")}</option>
						{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
					</select>
				</label>
				<label className="imr-field imr-field-wide">
					<span>{t("允许的聊天（每行一个，必填）", "Allowed peers (one per line, required)")}</span>
					<textarea className="input" rows={3} value={form.peers} onChange={event => setForm({ ...form, peers: event.target.value })} />
				</label>
				<label className="imr-field imr-field-wide">
					<span>{t("允许的用户（可选，每行一个）", "Allowed users (optional, one per line)")}</span>
					<textarea className="input" rows={2} value={form.users} onChange={event => setForm({ ...form, users: event.target.value })} />
				</label>
				{fields.map(field => {
					const stored = initial?.credentials[field.key] !== undefined;
					if (!field.secret) {
						return (
							<label key={field.key} className="imr-field">
								<span>{field.label}</span>
								{field.options !== undefined ? (
									<select className="select" value={form.plain[field.key] ?? field.options[0] ?? ""} onChange={event => setForm({ ...form, plain: { ...form.plain, [field.key]: event.target.value } })}>
										{field.options.map(option => <option key={option} value={option}>{option}</option>)}
									</select>
								) : (
									<textarea className="input" rows={isArrayCredentialField(field.key) ? 2 : 1} value={form.plain[field.key] ?? ""} onChange={event => setForm({ ...form, plain: { ...form.plain, [field.key]: event.target.value } })} />
								)}
							</label>
						);
					}
					return (
						<label key={field.key} className="imr-field">
							<span>{field.label}</span>
							<input
								className="input"
								type="password"
								autoComplete="new-password"
								placeholder={stored ? SECRET_MASK : ""}
								value={form.secretText[field.key] ?? ""}
								disabled={form.secretCleared[field.key] === true}
								onChange={event => setForm({ ...form, secretText: { ...form.secretText, [field.key]: event.target.value } })}
							/>
							{stored ? (
								<label className="imr-check">
									<input
										type="checkbox"
										checked={form.secretCleared[field.key] === true}
										onChange={event => setForm({ ...form, secretCleared: { ...form.secretCleared, [field.key]: event.target.checked } })}
									/>
									<span>{t("清除已存值", "clear stored value")}</span>
								</label>
							) : null}
						</label>
					);
				})}
				<label className="imr-check">
					<input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} />
					<span>{t("创建后启用", "Enable after save")}</span>
				</label>
				<div className="imr-actions imr-field-wide">
					<button type="submit" className="btn small primary" disabled={busy || !canSave}>{t("保存实例", "Save instance")}</button>
					<button
						type="button"
						className="btn small"
						disabled={busy || (initial === null ? !idValid : false)}
						onClick={() => {
							setError(null);
							void onValidate(credentialBag(form, initial?.credentials), form.id)
								.then(() => setValidation(t("平台已接受凭据（未写盘）。", "Platform accepted the credential (nothing written).")))
								.catch(cause => setValidation(`${t("验证失败：", "Validation failed: ")}${errorText(cause)}`));
						}}
					>
						{t("验证凭据", "Validate")}
					</button>
					<button type="button" className="btn small" onClick={onCancel} disabled={busy}>{t("取消", "Cancel")}</button>
				</div>
				{validation !== null ? <p className="imr-hint">{validation}</p> : null}
				{error !== null ? <p className="imr-error">{error}</p> : null}
			</form>
		</SettingSection>
	);
}

function isArrayCredentialField(key: string): boolean {
	return key === "allowedChannels" || key === "allowedUsers" || key === "allowedGroups";
}

interface BindingFormState {
	id: string;
	instanceId: string;
	chatId: string;
	threadId: string;
	userId: string;
	agentProfileId: string;
	targetKey: string;
	sessionId: string;
	role: "answer" | "mention" | "observe";
	lang: "" | "zh" | "en";
	provider: string;
	model: string;
}

function BindingEditor({
	initial,
	instances,
	profiles,
	targets,
	bindings,
	busy,
	zh,
	onCancel,
	onSave,
}: {
	initial: ImBinding | null;
	instances: readonly ChannelInstance[];
	profiles: readonly ImAgentProfile[];
	targets: AgentsEnvelope["targets"];
	bindings: readonly ImBinding[];
	busy: boolean;
	zh: boolean;
	onCancel: () => void;
	onSave: (binding: ImBinding) => void;
}) {
	const t = (cn: string, en: string): string => (zh ? cn : en);
	const [form, setForm] = useState<BindingFormState>(() => ({
		id: initial?.id ?? newBindingId(),
		instanceId: initial?.instanceId ?? instances[0]?.id ?? "",
		chatId: initial?.chatId ?? "",
		threadId: initial?.threadId ?? "",
		userId: initial?.userId ?? "",
		agentProfileId: initial?.agentProfileId ?? profiles[0]?.id ?? "",
		targetKey: initial?.target?.key ?? targets.find(target => target.available !== false)?.key ?? "",
		sessionId: initial?.sessionId ?? "",
		role: initial?.role ?? "answer",
		lang: initial?.lang ?? "",
		provider: initial?.model?.provider ?? "",
		model: initial?.model?.model ?? "",
	}));
	const selectedTarget = targets.find(target => target.key === form.targetKey);
	const targetUsable = selectedTarget !== undefined && selectedTarget.available !== false;
	const duplicate = bindings.some(binding =>
		binding.id !== form.id &&
		binding.instanceId === form.instanceId &&
		binding.chatId === form.chatId.trim() &&
		(binding.threadId ?? "") === form.threadId.trim() &&
		(binding.userId ?? "") === form.userId.trim());
	const duplicateId = bindings.some(binding => binding.id === form.id && binding.id !== initial?.id) || !isValidBindingId(form.id);
	const controlChar = hasControlChars(form.chatId) || hasControlChars(form.threadId) || hasControlChars(form.userId);
	const partialModel = (form.provider.trim() === "") !== (form.model.trim() === "");
	const answerConflict = form.role === "answer" && bindings.some(binding =>
		binding.id !== form.id &&
		binding.role === "answer" &&
		binding.platform === instances.find(instance => instance.id === form.instanceId)?.platform &&
		binding.chatId === form.chatId.trim());
	const canSave =
		form.instanceId !== "" &&
		form.chatId.trim() !== "" &&
		form.agentProfileId !== "" &&
		targetUsable &&
		form.sessionId.trim() !== "" &&
		!duplicate &&
		!duplicateId &&
		!controlChar &&
		!partialModel &&
		!answerConflict;
	return (
		<SettingSection title={initial === null ? t("新增绑定", "New binding") : t("编辑绑定", "Edit binding")} desc={t("目标必须是后端解析出的可用 target；needsReview 的旧绑定要重新选择目标才能保存。", "The target must be a backend-resolved available target; a needs-review row must pick a target before it can be saved.")}>
			<form
				className="imr-form"
				onSubmit={event => {
					event.preventDefault();
					if (!canSave) return;
					onSave({
						id: form.id,
						instanceId: form.instanceId,
						platform: instances.find(instance => instance.id === form.instanceId)?.platform ?? "wechat",
						chatId: form.chatId.trim(),
						...(form.threadId.trim() !== "" ? { threadId: form.threadId.trim() } : {}),
						...(form.userId.trim() !== "" ? { userId: form.userId.trim() } : {}),
						agentProfileId: form.agentProfileId,
						sessionId: form.sessionId.trim(),
						...(selectedTarget !== undefined ? { target: selectedTarget } : {}),
						role: form.role,
						...(form.lang !== "" ? { lang: form.lang } : {}),
						...(form.provider.trim() !== "" && form.model.trim() !== ""
							? { model: { provider: form.provider.trim(), model: form.model.trim() } }
							: {}),
						// Omitted on create: the server stamps createdAt once.
		createdAt: initial?.createdAt ?? "",
					});
				}}
			>
				<label className="imr-field">
					<span>{t("实例", "Instance")}</span>
					<select className="select" value={form.instanceId} onChange={event => setForm({ ...form, instanceId: event.target.value })}>
						{instances.map(instance => <option key={instance.id} value={instance.id}>{instance.label}</option>)}
					</select>
				</label>
				<label className="imr-field">
					<span>{t("聊天 ID", "Chat id")}</span>
					<input className="input" value={form.chatId} onChange={event => setForm({ ...form, chatId: event.target.value })} placeholder="oc_… / group:<id>" />
				</label>
				<label className="imr-field">
					<span>{t("Thread（可选）", "Thread (optional)")}</span>
					<input className="input" value={form.threadId} onChange={event => setForm({ ...form, threadId: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("用户（可选）", "User (optional)")}</span>
					<input className="input" value={form.userId} onChange={event => setForm({ ...form, userId: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("Agent Profile", "Agent profile")}</span>
					<select className="select" value={form.agentProfileId} onChange={event => setForm({ ...form, agentProfileId: event.target.value })}>
						{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
					</select>
				</label>
				<label className="imr-field">
					<span>{t("目标", "Target")}</span>
					<select className="select" value={form.targetKey} onChange={event => setForm({ ...form, targetKey: event.target.value })}>
						<option value="">{t("选择…", "Select…")}</option>
						{targets.map(target => (
							<option key={target.key ?? target.display ?? target.kind} value={target.key ?? ""} disabled={target.available === false}>
								{target.display ?? target.key ?? target.kind}{target.available === false ? ` — ${target.reason ?? t("不可用", "unavailable")}` : ""}
							</option>
						))}
					</select>
					{selectedTarget !== undefined && selectedTarget.available === false ? <small className="imr-error">{selectedTarget.reason ?? t("目标不可用", "Target unavailable")}</small> : null}
				</label>
				<label className="imr-field">
					<span>{t("会话 ID", "Session id")}</span>
					<input className="input" value={form.sessionId} onChange={event => setForm({ ...form, sessionId: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("角色", "Role")}</span>
					<select
						className="select"
						value={form.role}
						onChange={event => setForm({
							...form,
							role: event.target.value === "observe" ? "observe" : event.target.value === "mention" ? "mention" : "answer",
						})}
					>
						<option value="answer">answer</option>
						<option value="mention">mention</option>
						<option value="observe">observe</option>
					</select>
					<small className="imr-hint">
						{t(
							"answer 自动回复该聊天；mention 只在本实例被 @ 时回复（多角色群）；observe 从不发送。",
							"answer replies to the chat automatically; mention replies only when this instance is @mentioned (multi-role groups); observe never sends.",
						)}
					</small>
				</label>
				<label className="imr-field">
					<span>{t("语言", "Language")}</span>
					<select className="select" value={form.lang} onChange={event => setForm({ ...form, lang: event.target.value === "zh" ? "zh" : event.target.value === "en" ? "en" : "" })}>
						<option value="">{t("继承", "inherit")}</option>
						<option value="zh">中文</option>
						<option value="en">English</option>
					</select>
				</label>
				<label className="imr-field">
					<span>{t("模型 provider", "Model provider")}</span>
					<input className="input" value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("模型 id", "Model id")}</span>
					<input className="input" value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} />
				</label>
				<div className="imr-actions imr-field-wide">
					<button type="submit" className="btn small primary" disabled={busy || !canSave}>{t("保存绑定", "Save binding")}</button>
					<button type="button" className="btn small" onClick={onCancel} disabled={busy}>{t("取消", "Cancel")}</button>
				</div>
				{duplicate ? <p className="imr-error">{t("同一实例/聊天/线程/用户已有绑定。", "A binding with this instance/chat/thread/user already exists.")}</p> : null}
				{duplicateId ? <p className="imr-error">{t("绑定 ID 必须是 b_ + 16 位小写十六进制，且全局唯一。", "Binding id must be b_ + 16 lowercase hex and globally unique.")}</p> : null}
				{controlChar ? <p className="imr-error">{t("聊天/线程/用户 ID 不能包含控制字符。", "Chat/thread/user ids must not contain control characters.")}</p> : null}
				{partialModel ? <p className="imr-error">{t("模型必须同时填写 provider 与 model。", "A model override needs both provider and model.")}</p> : null}
				{answerConflict ? <p className="imr-error">{t("该聊天已有一个 answer 绑定；其他行只能是 mention 或 observe。", "This chat already has an answer binding; other rows must be mention or observe.")}</p> : null}
				{initial?.needsReview === true ? <p className="imr-hint">{t("旧绑定待复核：保存时会用所选 target 重建。", "Old binding needs review: saving rebuilds it with the selected target.")}</p> : null}
			</form>
		</SettingSection>
	);
}

const TOOL_FIELDS = [
	["builtin", "Builtin tools"],
	["extensions", "Extensions"],
	["mcpServers", "MCP servers"],
	["customTools", "Custom tools"],
	["skills", "Skills"],
	["commands", "Commands"],
] as const;

interface ProfileFormState {
	id: string;
	label: string;
	personaMode: "file" | "inline" | "workspace";
	personaFile: string;
	personaText: string;
	provider: string;
	model: string;
	locationKind: "workspace" | "team-pm" | "engineer";
	workspace: string;
	team: string;
	pm: string;
	engineer: string;
	repo: string;
	preset: string;
	approvalMode: "always-ask" | "write" | "yolo";
	tools: Record<string, string>;
	memoryBackend: string;
	memoryNamespace: string;
	workspaceContext: boolean;
}

function ProfileEditor({
	initial,
	profileIds,
	busy,
	zh,
	onCancel,
	onSave,
}: {
	initial: ImAgentProfile | null;
	profileIds: readonly string[];
	busy: boolean;
	zh: boolean;
	onCancel: () => void;
	onSave: (profile: ImAgentProfile) => void;
}) {
	const t = (cn: string, en: string): string => (zh ? cn : en);
	const base = initial ?? emptyProfile(`profile-${profileIds.length + 1}`);
	const [form, setForm] = useState<ProfileFormState>(() => ({
		id: base.id,
		label: base.label,
		personaMode: base.persona.mode,
		personaFile: base.persona.file ?? "",
		personaText: base.persona.text ?? "",
		provider: base.model?.provider ?? "",
		model: base.model?.model ?? "",
		locationKind: base.location.kind,
		workspace: base.location.workspace ?? "main",
		team: base.location.team ?? "",
		pm: base.location.pm ?? "",
		engineer: base.location.engineer ?? "",
		repo: base.location.repo ?? "",
		preset: base.tools.preset ?? "",
		approvalMode: base.tools.approvalMode ?? "yolo",
		tools: Object.fromEntries(TOOL_FIELDS.map(([key]) => [key, base.tools[key].join("\n")])),
		memoryBackend: base.memory?.backend ?? "off",
		memoryNamespace: base.memory?.namespace ?? "",
		workspaceContext: base.memory?.workspaceContext === true,
	}));
	const idValid = isValidProfileId(form.id) && (!initial || form.id === initial.id);
	const locationValid =
		form.locationKind === "workspace"
			? form.workspace.trim() !== ""
			: form.team.trim() !== "" && form.pm.trim() !== "" && (form.locationKind !== "engineer" || form.engineer.trim() !== "");
	const canSave = idValid && form.label.trim() !== "" && locationValid;
	return (
		<SettingSection title={initial === null ? t("新增 Agent Profile", "New agent profile") : t("编辑 Agent Profile", "Edit agent profile")} desc={t("工具列表是白名单（每行一个）；空表示没有，绝不继承环境工具。Persona 支持 inline / file / workspace。", "Tool lists are allowlists (one per line); empty means none and ambient tools are never inherited. Persona supports inline / file / workspace.")}>
			<form
				className="imr-form"
				onSubmit={event => {
					event.preventDefault();
					if (!canSave) return;
					onSave({
						id: form.id,
						label: form.label.trim(),
						persona: {
							mode: form.personaMode,
							...(form.personaMode === "inline" ? { text: form.personaText } : {}),
							...(form.personaMode !== "inline" && form.personaFile.trim() !== "" ? { file: form.personaFile.trim() } : {}),
						},
						...(form.provider.trim() !== "" && form.model.trim() !== ""
							? { model: { provider: form.provider.trim(), model: form.model.trim() } }
							: {}),
						location:
							form.locationKind === "workspace"
								? { kind: "workspace", workspace: form.workspace.trim() }
								: form.locationKind === "team-pm"
									? { kind: "team-pm", team: form.team.trim(), pm: form.pm.trim() }
									: { kind: "engineer", team: form.team.trim(), pm: form.pm.trim(), engineer: form.engineer.trim(), ...(form.repo.trim() !== "" ? { repo: form.repo.trim() } : {}) },
						tools: {
							...(form.preset !== "" ? { preset: form.preset as NonNullable<ImAgentProfile["tools"]["preset"]> } : {}),
							builtin: splitLines(form.tools.builtin ?? ""),
							extensions: splitLines(form.tools.extensions ?? ""),
							mcpServers: splitLines(form.tools.mcpServers ?? ""),
							customTools: splitLines(form.tools.customTools ?? ""),
							skills: splitLines(form.tools.skills ?? ""),
							commands: splitLines(form.tools.commands ?? ""),
							approvalMode: form.approvalMode,
						},
						memory: {
							backend: form.memoryBackend as NonNullable<NonNullable<ImAgentProfile["memory"]>["backend"]>,
							...(form.memoryNamespace.trim() !== "" ? { namespace: form.memoryNamespace.trim() } : {}),
							workspaceContext: form.workspaceContext,
						},
					});
				}}
			>
				<label className="imr-field">
					<span>ID</span>
					<input className="input" value={form.id} disabled={initial !== null} onChange={event => setForm({ ...form, id: event.target.value })} />
					{!idValid ? <small className="imr-error">{t("小写字母/数字/_/-，2–32 位。", "Lowercase letters/digits/_/-; 2–32 chars.")}</small> : null}
				</label>
				<label className="imr-field">
					<span>{t("显示名", "Label")}</span>
					<input className="input" value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("Persona 模式", "Persona mode")}</span>
					<select className="select" value={form.personaMode} onChange={event => setForm({ ...form, personaMode: event.target.value as ProfileFormState["personaMode"] })}>
						<option value="inline">inline</option>
						<option value="file">file</option>
						<option value="workspace">workspace</option>
					</select>
				</label>
				{form.personaMode === "inline" ? (
					<label className="imr-field imr-field-wide">
						<span>{t("Persona 文本", "Persona text")}</span>
						<textarea className="input" rows={3} value={form.personaText} onChange={event => setForm({ ...form, personaText: event.target.value })} />
					</label>
				) : (
					<label className="imr-field">
						<span>{t("Persona 文件", "Persona file")}</span>
						<input className="input" value={form.personaFile} onChange={event => setForm({ ...form, personaFile: event.target.value })} />
					</label>
				)}
				<label className="imr-field">
					<span>{t("模型 provider", "Model provider")}</span>
					<input className="input" value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("模型 id", "Model id")}</span>
					<input className="input" value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} />
				</label>
				<label className="imr-field">
					<span>{t("位置类型", "Location kind")}</span>
					<select className="select" value={form.locationKind} onChange={event => setForm({ ...form, locationKind: event.target.value as ProfileFormState["locationKind"] })}>
						<option value="workspace">workspace</option>
						<option value="team-pm">team-pm</option>
						<option value="engineer">engineer</option>
					</select>
				</label>
				{form.locationKind === "workspace" ? (
					<label className="imr-field">
						<span>{t("工作区别名", "Workspace alias")}</span>
						<input className="input" value={form.workspace} onChange={event => setForm({ ...form, workspace: event.target.value })} placeholder="main" />
					</label>
				) : (
					<>
						<label className="imr-field"><span>{t("Team", "Team")}</span><input className="input" value={form.team} onChange={event => setForm({ ...form, team: event.target.value })} /></label>
						<label className="imr-field"><span>{t("PM", "PM")}</span><input className="input" value={form.pm} onChange={event => setForm({ ...form, pm: event.target.value })} /></label>
						{form.locationKind === "engineer" ? (
							<>
								<label className="imr-field"><span>{t("Engineer", "Engineer")}</span><input className="input" value={form.engineer} onChange={event => setForm({ ...form, engineer: event.target.value })} /></label>
								<label className="imr-field"><span>{t("Repo（可选）", "Repo (optional)")}</span><input className="input" value={form.repo} onChange={event => setForm({ ...form, repo: event.target.value })} /></label>
							</>
						) : null}
					</>
				)}
				<label className="imr-field">
					<span>{t("工具预设", "Tool preset")}</span>
					<select className="select" value={form.preset} onChange={event => setForm({ ...form, preset: event.target.value })}>
						<option value="">{t("不指定", "none")}</option>
						<option value="companion">companion</option>
						<option value="read-only-chat">read-only-chat</option>
						<option value="roleplay">roleplay</option>
						<option value="team-pm">team-pm</option>
						<option value="engineer">engineer</option>
					</select>
				</label>
				<label className="imr-field">
					<span>{t("审批模式", "Approval mode")}</span>
					<select className="select" value={form.approvalMode} onChange={event => setForm({ ...form, approvalMode: event.target.value as ProfileFormState["approvalMode"] })}>
						<option value="yolo">yolo</option>
						<option value="write">write</option>
						<option value="always-ask">always-ask</option>
					</select>
				</label>
				{TOOL_FIELDS.map(([key, label]) => (
					<label key={key} className="imr-field">
						<span>{label}</span>
						<textarea
							className="input"
							rows={3}
							value={form.tools[key] ?? ""}
							onChange={event => setForm({ ...form, tools: { ...form.tools, [key]: event.target.value } })}
							placeholder={t("每行一个；留空=不允许", "One per line; empty = none")}
						/>
					</label>
				))}
				<label className="imr-field">
					<span>{t("记忆后端", "Memory backend")}</span>
					<select className="select" value={form.memoryBackend} onChange={event => setForm({ ...form, memoryBackend: event.target.value })}>
						<option value="off">off</option>
						<option value="local">local</option>
						<option value="hindsight">hindsight</option>
						<option value="mnemopi">mnemopi</option>
						<option value="sharpshooter">sharpshooter</option>
					</select>
				</label>
				<label className="imr-field">
					<span>{t("记忆命名空间", "Memory namespace")}</span>
					<input className="input" value={form.memoryNamespace} onChange={event => setForm({ ...form, memoryNamespace: event.target.value })} placeholder={t("默认 im:<instance>:<profile>", "default im:<instance>:<profile>")} />
				</label>
				<label className="imr-check">
					<input type="checkbox" checked={form.workspaceContext} onChange={event => setForm({ ...form, workspaceContext: event.target.checked })} />
					<span>{t("携带工作区上下文", "Workspace context")}</span>
				</label>
				<p className="imr-note imr-field-wide">
					{t(
						"capabilities 已从 schema 删除，本页不提供权限开关，也不会宣称任何未建模的权限。custom tools 默认为空，不继承环境工具。",
						"capabilities were removed from the schema; this editor offers no permission toggles and never claims a permission that is not modelled. Custom tools default to empty and do not inherit ambient tools.",
					)}
				</p>
				<div className="imr-actions imr-field-wide">
					<button type="submit" className="btn small primary" disabled={busy || !canSave}>{t("保存 Profile", "Save profile")}</button>
					<button type="button" className="btn small" onClick={onCancel} disabled={busy}>{t("取消", "Cancel")}</button>
				</div>
			</form>
		</SettingSection>
	);
}

function describeLocation(profile: ImAgentProfile): string {
	const location = profile.location;
	if (location.kind === "workspace") return `workspace · ${location.workspace ?? "main"}`;
	if (location.kind === "team-pm") return `team-pm · ${location.team ?? "?"}/${location.pm ?? "?"}`;
	return `engineer · ${location.team ?? "?"}/${location.pm ?? "?"}/${location.engineer ?? "?"}${location.repo ? ` · ${location.repo}` : ""}`;
}
