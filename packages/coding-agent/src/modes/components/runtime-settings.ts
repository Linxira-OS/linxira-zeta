import {
	getKeybindings,
	SelectList,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type SelectItem,
	type SgrMouseEvent,
} from "@linxiraos/pi-tui";
import { TextFormField, SelectFormField } from "@linxiraos/pi-tui/components/form";
import { ScrollView } from "@linxiraos/pi-tui/components/scroll-view";
import { getSelectListTheme, theme } from "@linxiraos/pi-tui/theme";
import { formTheme } from "@linxiraos/pi-tui/chrome/form-theme";
import { editorKey } from "@linxiraos/pi-tui/chrome/keybinding-hints";
import { col, text } from "@linxiraos/pi-tui/native/describe";
import type { DescribeContext, NativeNode, NativeUiEvent } from "@linxiraos/pi-tui/native/node";
import { actionButton } from "@linxiraos/pi-tui/native/overlay";
import { currentLanguage } from "../../i18n";
import { renderTerminalQr } from "../../channels/qr-terminal";
import { targetKey, type ChannelInstanceConfig, type ImAgentProfile, type ImBinding } from "../../channels/im-config";
import { RuntimeSettingsClient, type BindingDraft } from "./runtime-settings-client";

const label = (zh: string, en: string): string => (currentLanguage() === "zh" ? zh : en);
const safe = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, " ");
interface Action extends SelectItem {
	run(): void | Promise<void>;
}
interface View {
	title: string;
	open(): void | Promise<void>;
	leave?(): void;
}

/** Owns temporary QR/code rows; deliberately exposes neither text nor children to the debug tree. */
class PrivateDocument implements Component {
	#rows: string[];
	#qr: string | undefined;
	#view = new ScrollView([], { height: 12, scrollbar: "auto" });
	#memoWidth = -1;
	#memoHeight = -1;
	#height = 12;
	#memo: readonly string[] = [];
	constructor(rows: string[], qr?: string) {
		this.#rows = rows;
		this.#qr = qr;
	}
	setHeight(height: number): void {
		this.#height = height;
		this.#view.setHeight(height);
	}
	render(width: number): readonly string[] {
		const height = this.#height;
		if (this.#memoWidth !== width || this.#memoHeight !== height) {
			const contentWidth = Math.max(1, width - 1);
			const lines: string[] = [];
			if (this.#qr) {
				const qr = renderTerminalQr(this.#qr, { columns: contentWidth, color: true });
				if (qr.kind === "qr" && qr.lines.length <= height) lines.push(...qr.lines, "");
				else
					lines.push(
						...wrapTextWithAnsi(
							label(
								"终端空间不足或二维码是图片；使用下方完整文本。",
								"QR does not fit, or is an image; use the complete text below.",
							),
							contentWidth,
						),
						...wrapTextWithAnsi(this.#qr, contentWidth),
						"",
					);
			}
			for (const value of this.#rows) lines.push(...wrapTextWithAnsi(value, contentWidth));
			this.#view.setLines(lines);
			this.#memoWidth = width;
			this.#memoHeight = height;
		}
		this.#memo = this.#view.render(width);
		return this.#memo;
	}
	describe(cx: DescribeContext): NativeNode {
		this.render(cx.cols);
		return this.#view.describe(cx);
	}
	handleInput(data: string): void {
		this.#view.handleScrollKey(data);
	}
	routeMouse(event: SgrMouseEvent): void {
		if (event.wheel !== null) this.#view.scroll(event.wheel * 3);
	}
	invalidate(): void {
		this.#memoWidth = -1;
		this.#view.invalidate();
	}
	dispose(): void {
		this.#rows.fill("");
		this.#rows = [];
		this.#qr = undefined;
		this.#memo = [];
		this.#view.dispose();
	}
}

/** Runtime child page: one navigation stack, shared keyboard/native/SGR actions, no transcript writes. */
export class RuntimeSettingsPage implements Component {
	#stack: View[] = [];
	#body: Component | undefined;
	#menu: SelectList | undefined;
	#actions: readonly Action[] = [];
	#busy = false;
	#error = "";
	#disposed = false;
	#revision = 0;
	#expiry: NodeJS.Timeout | undefined;
	#backRow = 0;
	#bodyRow = 2;
	#submitRow = -1;
	#retryRow = -1;
	#documentContinue: (() => void) | undefined;
	#activeRequest: Promise<void> = Promise.resolve();
	readonly #client: RuntimeSettingsClient;

	constructor(
		readonly kind: "identity" | "im",
		private readonly onBack: () => void,
		private readonly requestRender: () => void,
		client = new RuntimeSettingsClient(),
	) {
		this.#client = client;
		this.#push(
			label(
				kind === "identity" ? "身份与设备" : "IM 运行时",
				kind === "identity" ? "Identity & devices" : "IM runtime",
			),
			() => (kind === "identity" ? this.#identity() : this.#im()),
		);
	}
	get settled(): Promise<void> {
		return this.#activeRequest;
	}
	debugState(): Record<string, unknown> {
		return { page: this.kind, depth: this.#stack.length, busy: this.#busy, disposed: this.#disposed };
	}
	get debugChildren(): readonly Component[] {
		return this.#body instanceof PrivateDocument ? [] : this.#body ? [this.#body] : [];
	}
	invalidate(): void {
		this.#body?.invalidate?.();
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#revision++;
		this.#clear();
		for (const view of this.#stack) view.leave?.();
		this.#stack = [];
		this.#client.dispose();
	}
	#clear(): void {
		clearTimeout(this.#expiry);
		this.#expiry = undefined;
		if (this.#body instanceof TextFormField) this.#body.setValue("");
		this.#body?.dispose?.();
		this.#body = undefined;
		this.#menu = undefined;
		this.#actions = [];
		this.#documentContinue = undefined;
		this.#error = "";
	}
	#run(work: () => void | Promise<void>): void {
		if (this.#disposed || this.#busy) return;
		const revision = this.#revision;
		this.#busy = true;
		this.#error = "";
		this.#activeRequest = Promise.resolve()
			.then(() => {
				if (!this.#disposed && revision === this.#revision) return work();
			})
			.catch(error => {
				if (!this.#disposed && revision === this.#revision)
					this.#error = safe(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (!this.#disposed && revision === this.#revision) {
					this.#busy = false;
					this.requestRender();
				}
			});
		this.requestRender();
	}
	#push(title: string, open: () => void | Promise<void>, leave?: () => void): void {
		if (this.#disposed) return;
		this.#clear();
		this.#revision++;
		this.#busy = false;
		this.#stack.push({ title, open, ...(leave ? { leave } : {}) });
		this.#run(open);
	}
	#back(): void {
		this.#clear();
		this.#revision++;
		this.#busy = false;
		const departed = this.#stack.pop();
		departed?.leave?.();
		if (this.#stack.length === 0) {
			this.dispose();
			this.onBack();
			return;
		}
		const view = this.#stack.at(-1)!;
		this.#run(view.open);
	}
	#reload(): void {
		this.#clear();
		this.#revision++;
		this.#busy = false;
		this.#run(this.#stack.at(-1)!.open);
	}
	async #apply(work: () => Promise<unknown>, next: "back" | "reload" = "back"): Promise<void> {
		const revision = this.#revision;
		await work();
		if (!this.#disposed && revision === this.#revision) {
			if (next === "back") this.#back();
			else this.#reload();
		}
	}
	#showMenu(actions: Action[]): void {
		if (this.#disposed) return;
		this.#body?.dispose?.();
		this.#actions = actions;
		const menu = new SelectList(actions, 14, getSelectListTheme());
		menu.onCancel = () => this.#back();
		menu.onSelect = item => {
			const action = this.#actions.find(row => row.value === item.value);
			if (action) this.#run(action.run);
		};
		this.#body = this.#menu = menu;
	}
	#action(value: string, title: string, run: Action["run"], description?: string, confirmation?: string): Action {
		return {
			value,
			label: title,
			run,
			...(description ? { description: safe(description) } : {}),
			...(confirmation ? { confirmation } : {}),
		};
	}
	#field(
		title: string,
		initial: string,
		submit: (value: string) => void | Promise<void>,
		options: { secret?: boolean; required?: boolean } = {},
	): void {
		this.#push(
			title,
			() => {
				this.#body = new TextFormField({
					theme: formTheme,
					label: title,
					initialValue: initial,
					secret: options.secret,
					empty: options.required ? "reject" : "submit",
					onSubmit: value => {
						const revision = this.#revision;
						this.#run(async () => {
							await submit(value.trim());
							if (!this.#disposed && revision === this.#revision) this.#back();
						});
					},
					onCancel: () => this.#back(),
					requestRender: this.requestRender,
				});
			},
			options.secret
				? () => {
						initial = "";
						submit = () => {};
					}
				: undefined,
		);
	}
	#choose(
		title: string,
		items: readonly SelectItem[],
		current: string | undefined,
		submit: (value: string) => void | Promise<void>,
	): void {
		this.#push(title, () => {
			this.#body = new SelectFormField({
				theme: formTheme,
				selectTheme: getSelectListTheme(),
				label: title,
				items,
				currentValue: current,
				onSubmit: value => {
					const revision = this.#revision;
					this.#run(async () => {
						await submit(value);
						if (!this.#disposed && revision === this.#revision) this.#back();
					});
				},
				onCancel: () => this.#back(),
				requestRender: this.requestRender,
			});
		});
	}
	#document(
		title: string,
		rows: string[],
		options: { qr?: string; expiresAt?: string | null; next?: () => void; clear?: () => void } = {},
	): void {
		this.#push(title, () => {
			// The open closure is never retained with plaintext after the view is left.
			this.#body = new PrivateDocument(rows.splice(0), options.qr);
			options.qr = undefined;
			this.#documentContinue = options.next;
			if (options.expiresAt) {
				const timeout = Date.parse(options.expiresAt) - Date.now();
				if (!Number.isFinite(timeout)) throw new Error("Invalid QR expiry");
				if (timeout <= 0) {
					this.#back();
					return;
				}
				this.#expiry = setTimeout(() => {
					options.clear?.();
					this.#back();
				}, timeout);
			}
			this.#stack[this.#stack.length - 1] = {
				title,
				open: () => {
					options.clear?.();
					this.#back();
				},
			};
			options.next = undefined;
		});
	}

	async #identity(): Promise<void> {
		const revision = this.#revision;
		const [status, devices] = await Promise.all([this.#client.twoFactorStatus(), this.#client.devices()]);
		if (this.#disposed || revision !== this.#revision) return;
		this.#showMenu([
			this.#action(
				"enroll",
				label("绑定验证器 / 显示临时二维码", "Enroll authenticator / temporary QR"),
				() => this.#enroll(),
				label(
					status.enrolled ? "已绑定；重新绑定会替换现有验证器" : "尚未绑定",
					status.enrolled ? "Enrolled; re-enrollment replaces the factor" : "Not enrolled",
				),
				status.enrolled ? label("再次确认以重新绑定", "Confirm again to replace enrollment") : undefined,
			),
			this.#action(
				"confirm",
				label("确认待绑定验证码", "Confirm pending enrollment"),
				() => this.#code("confirm"),
				status.pending
					? label("存在待确认绑定", "Pending enrollment")
					: label("尚无待确认绑定", "No pending enrollment"),
			),
			this.#action("verify", label("验证动态码 / 恢复码", "Verify code / recovery code"), () =>
				this.#code("verify"),
			),
			this.#action(
				"policy",
				label("远程写入二次验证策略", "Remote write verification policy"),
				() =>
					this.#choose(
						label("二次验证策略", "Verification policy"),
						[
							{ value: "true", label: label("要求二次验证", "Require verification") },
							{ value: "false", label: label("不要求二次验证", "Do not require verification") },
						],
						String(status.required),
						async value => {
							await this.#client.request("/api/auth/2fa/policy", "PUT", { required: value === "true" });
						},
					),
				status.required ? label("已要求", "Required") : label("未要求", "Not required"),
			),
			this.#action(
				"recovery",
				label("重新生成恢复码", "Regenerate recovery codes"),
				() => this.#code("recovery"),
				`${label("剩余", "Remaining")}: ${status.recoveryCodesRemaining}`,
			),
			this.#action(
				"disable",
				label("停用二次验证", "Disable two-factor authentication"),
				() => this.#apply(() => this.#client.request("/api/auth/2fa/disable", "POST"), "reload"),
				undefined,
				label("再次确认停用并删除验证器", "Confirm again to disable and erase the factor"),
			),
			this.#action("pair", label("设备配对二维码", "Device pairing QR"), async () => {
				const rev = this.#revision;
				const pair = await this.#client.pairing();
				if (!this.#disposed && rev === this.#revision)
					this.#document(
						label("设备配对", "Device pairing"),
						[
							`${label("一次性配对码", "One-time pairing code")}: ${pair.code}`,
							`${label("有效期", "Expires")}: ${pair.expiresAt ?? "—"}`,
						],
						{ qr: pair.payload, expiresAt: pair.expiresAt },
					);
			}),
			...devices.map(device =>
				this.#action(
					`device:${device.id}`,
					`${device.label} · ${device.scopes.join(",")} · ${device.revoked ? label("已撤销", "revoked") : label("已配对", "paired")}`,
					() =>
						this.#push(device.label, () =>
							this.#showMenu([
								this.#action(
									"revoke",
									label("撤销此设备", "Revoke this device"),
									() =>
										this.#apply(() =>
											this.#client.request(`/api/remote/devices/${encodeURIComponent(device.id)}`, "DELETE"),
										),
									undefined,
									label("再次确认撤销", "Confirm again to revoke"),
								),
							]),
						),
				),
			),
			this.#action("refresh", label("刷新状态", "Refresh status"), () => this.#reload()),
		]);
	}
	async #enroll(): Promise<void> {
		const revision = this.#revision;
		const enrollment = await this.#client.enroll();
		if (this.#disposed || revision !== this.#revision) return;
		this.#document(
			label("扫描验证器二维码并安全保存恢复码", "Scan authenticator QR and save recovery codes"),
			[
				`${label("手动密钥", "Manual secret")}: ${enrollment.secret}`,
				...enrollment.recoveryCodes.map((code, i) => `${i + 1}. ${code}`),
				`${label("有效期", "Expires")}: ${enrollment.expiresAt}`,
			],
			{
				qr: enrollment.otpauthUrl,
				expiresAt: enrollment.expiresAt,
				next: () => {
					this.#back();
					this.#code("confirm");
				},
			},
		);
	}
	#code(action: "confirm" | "verify" | "recovery"): void {
		this.#field(
			label("输入动态码或恢复码", "Enter code or recovery code"),
			"",
			async value => {
				if (action === "recovery") {
					const revision = this.#revision;
					const codes = await this.#client.recovery(value);
					if (!this.#disposed && revision === this.#revision) {
						this.#back();
						this.#document(label("仅本次显示：安全保存恢复码", "Shown once: save recovery codes"), codes, {
							expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
						});
					}
				} else
					await this.#client.request(
						`/api/auth/2fa/${action}`,
						"POST",
						action === "confirm" ? { code: value } : this.#client.credential(value),
					);
			},
			{ secret: true, required: true },
		);
	}

	async #im(): Promise<void> {
		const revision = this.#revision;
		const snapshot = await this.#client.im();
		if (this.#disposed || revision !== this.#revision) return;
		this.#showMenu([
			this.#action(
				"instances",
				label("机器人实例", "Bot instances"),
				() => this.#instances(),
				`${snapshot.instances.length}`,
			),
			this.#action(
				"profiles",
				label("Agent Profile / 身份与目标", "Agent profiles / identity and target"),
				() => this.#profiles(),
				`${snapshot.profiles.length}`,
			),
			this.#action(
				"bindings",
				label("聊天与已有会话绑定", "Chat / existing conversation bindings"),
				() => this.#bindings(),
				`${snapshot.bindings.length}`,
			),
			this.#action("refresh", label("刷新运行时", "Refresh runtime"), () => this.#reload()),
		]);
	}
	#instances(): void {
		this.#push(label("机器人实例", "Bot instances"), async () => {
			const revision = this.#revision;
			const current = await this.#client.im();
			if (this.#disposed || revision !== this.#revision) return;
			this.#showMenu([
				...current.instances.map(instance =>
					this.#action(
						instance.id,
						`${instance.label} · ${instance.platform}`,
						() => this.#instance(instance),
						`${instance.id} · ${current.statuses.find(row => row.id === instance.id)?.state ?? "stopped"}`,
					),
				),
				this.#action("new", label("新增机器人实例", "Add bot instance"), () =>
					this.#choose(
						label("选择平台", "Select platform"),
						["wechat", "feishu", "telegram", "discord"].map(value => ({ value, label: value })),
						undefined,
						platform => {
							this.#field(
								label("实例 ID（创建后固定）", "Instance ID (immutable after creation)"),
								"",
								async id => {
									const latest = await this.#client.im();
									if (latest.instances.some(row => row.id === id)) throw new Error("ID already exists");
									const profile = latest.profiles[0];
									if (!profile)
										throw new Error(label("请先创建 Agent Profile", "Create an Agent Profile first"));
									if (
										platform !== "wechat" &&
										platform !== "feishu" &&
										platform !== "telegram" &&
										platform !== "discord"
									)
										throw new Error("Unsupported platform");
									await this.#client.saveInstance({
										id,
										label: id,
										platform,
										agentProfile: profile.id,
										enabled: false,
										allow: { peers: [] },
										credentials: {},
									});
								},
								{ required: true },
							);
						},
					),
				),
			]);
		});
	}
	#instance(initial: ChannelInstanceConfig): void {
		this.#push(initial.label, async () => {
			const revision = this.#revision;
			const current = await this.#client.im();
			if (this.#disposed || revision !== this.#revision) return;
			const instance = current.instances.find(row => row.id === initial.id);
			if (!instance) throw new Error("Instance removed");
			const edit = (key: "label" | "note", title: string) =>
				this.#field(title, instance[key] ?? "", value => this.#client.saveInstance({ ...instance, [key]: value }));
			this.#showMenu([
				this.#action("id", `ID: ${instance.id}`, () =>
					this.#document("ID", [instance.id, label("创建后不可改名", "Immutable after creation")]),
				),
				this.#action(
					"label",
					label("显示名", "Display name"),
					() => edit("label", label("显示名", "Display name")),
					instance.label,
				),
				this.#action("note", label("备注", "Note"), () => edit("note", label("备注", "Note")), instance.note),
				this.#action(
					"enabled",
					label(
						instance.enabled ? "停用实例" : "启用实例",
						instance.enabled ? "Disable instance" : "Enable instance",
					),
					() =>
						this.#apply(
							() =>
								this.#client.request(
									`/api/channels/instances/${encodeURIComponent(instance.id)}/${instance.enabled ? "disable" : "enable"}`,
									"POST",
								),
							"reload",
						),
				),
				this.#action(
					"profile",
					"Agent Profile",
					() =>
						this.#choose(
							"Agent Profile",
							current.profiles.map(profile => ({
								value: profile.id,
								label: profile.label,
								description: `${profile.id} · ${targetKey(profile.location)}`,
							})),
							instance.agentProfile,
							value => this.#client.saveInstance({ ...instance, agentProfile: value }),
						),
					instance.agentProfile,
				),
				this.#action(
					"peers",
					label("允许的聊天 ID（逗号分隔）", "Allowed chat IDs (comma separated)"),
					() =>
						this.#field(label("允许的聊天 ID", "Allowed chat IDs"), instance.allow.peers.join(","), value =>
							this.#client.saveInstance({
								...instance,
								allow: {
									...instance.allow,
									peers: value
										.split(",")
										.map(row => row.trim())
										.filter(Boolean),
								},
							}),
						),
					instance.allow.peers.join(","),
				),
				this.#action("credentials", label("平台登录 / 凭据", "Platform login / credentials"), () =>
					this.#credentials(instance),
				),
				...(instance.platform === "wechat"
					? [
							this.#action("qr", label("微信登录二维码", "WeChat login QR"), () => this.#wechatQr(instance)),
							this.#action("reconnect", label("重新连接微信", "Reconnect WeChat"), () =>
								this.#apply(
									() =>
										this.#client.request(
											`/api/channels/instances/${encodeURIComponent(instance.id)}/wechat/reconnect`,
											"POST",
										),
									"reload",
								),
							),
							this.#action(
								"logout",
								label("退出微信登录", "Unbind WeChat login"),
								() =>
									this.#apply(
										() =>
											this.#client.request(
												`/api/channels/instances/${encodeURIComponent(instance.id)}/wechat/unbind`,
												"POST",
											),
										"reload",
									),
								undefined,
								label("再次确认退出", "Confirm again to unbind"),
							),
						]
					: []),
			]);
		});
	}
	async #credentials(instance: ChannelInstanceConfig): Promise<void> {
		if (instance.platform === "wechat") {
			await this.#wechatQr(instance);
			return;
		}
		if (instance.platform === "qq") {
			this.#document("QQ", [label("QQ/企业微信开发已暂停", "QQ/WeCom development is paused")]);
			return;
		}
		const fields = instance.platform === "feishu" ? ["appId", "appSecret", "domain"] : ["botToken"];
		const credentials: Record<string, unknown> = {};
		this.#push(
			label("平台凭据（仅临时输入）", "Platform credentials (temporary input)"),
			() =>
				this.#showMenu([
					...fields.map(key =>
						this.#action(
							key,
							key,
							() =>
								this.#field(
									key,
									"",
									value => {
										if (value) credentials[key] = value;
									},
									{ secret: key !== "domain" },
								),
							credentials[key]
								? label("已输入", "Entered")
								: label("留空保留已保存值", "Blank keeps saved value"),
						),
					),
					this.#action("validate", label("验证并保存", "Validate and save"), async () => {
						try {
							await this.#apply(() =>
								this.#client.request(
									`/api/channels/instances/${encodeURIComponent(instance.id)}/validate`,
									"POST",
									credentials,
								),
							);
						} catch {
							throw new Error(
								label(
									"平台验证失败；请检查凭据和网络",
									"Platform validation failed; check credentials and network",
								),
							);
						}
					}),
				]),
			() => {
				for (const key of Object.keys(credentials)) delete credentials[key];
			},
		);
	}
	async #wechatQr(instance: ChannelInstanceConfig): Promise<void> {
		const revision = this.#revision;
		const qr = await this.#client.request(`/api/channels/instances/${encodeURIComponent(instance.id)}/wechat/qrcode`);
		if (this.#disposed || revision !== this.#revision) return;
		if (qr.pending !== true || typeof qr.qrcodeUrl !== "string") {
			this.#document(label("微信登录", "WeChat login"), [
				label(
					"没有待扫描二维码；返回实例页启用并重新连接，然后刷新。",
					"No pending QR. Enable and reconnect this instance, then refresh.",
				),
			]);
			return;
		}
		this.#document(
			label("微信登录", "WeChat login"),
			[
				`${label("状态", "State")}: ${String(qr.status ?? "wait")}`,
				label("扫码后返回并刷新状态", "After scanning, go back and refresh status"),
			],
			{ qr: qr.qrcodeUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() },
		);
	}
	#profiles(): void {
		this.#push("Agent Profiles", async () => {
			const revision = this.#revision;
			const current = await this.#client.im();
			if (this.#disposed || revision !== this.#revision) return;
			this.#showMenu([
				...current.profiles.map(profile =>
					this.#action(
						profile.id,
						profile.label,
						() => this.#profile(profile),
						`${profile.id} · ${targetKey(profile.location)}`,
					),
				),
				this.#action("new", label("新增 Agent Profile", "Add Agent Profile"), () =>
					this.#field(
						label("Profile ID（创建后固定）", "Profile ID (immutable after creation)"),
						"",
						async id => {
							const latest = await this.#client.im();
							if (latest.profiles.some(row => row.id === id)) throw new Error("ID already exists");
							await this.#client.saveProfile({
								id,
								label: id,
								persona: { mode: "workspace" },
								location: { kind: "workspace", workspace: "main" },
								tools: {
									builtin: [],
									extensions: [],
									customTools: [],
									mcpServers: [],
									skills: [],
									commands: [],
								},
								memory: { backend: "off" },
							});
						},
						{ required: true },
					),
				),
			]);
		});
	}
	#profile(initial: ImAgentProfile): void {
		this.#push(initial.label, async () => {
			const revision = this.#revision;
			const current = await this.#client.im();
			const profile = current.profiles.find(row => row.id === initial.id);
			if (!profile) throw new Error("Profile removed");
			if (this.#disposed || revision !== this.#revision) return;
			this.#showMenu([
				this.#action("id", `Agent Profile ID: ${profile.id}`, () => this.#document("ID", [profile.id])),
				this.#action("label", label("显示名", "Display name"), () =>
					this.#field(
						label("显示名", "Display name"),
						profile.label,
						value => this.#client.saveProfile({ ...profile, label: value }),
						{ required: true },
					),
				),
				this.#action("target", label("目标", "Target"), () => this.#target(profile), targetKey(profile.location)),
				this.#action(
					"model",
					label("模型 provider/model（留空继承）", "Model provider/model (blank inherits)"),
					() =>
						this.#field(
							"provider/model",
							profile.model ? `${profile.model.provider}/${profile.model.model}` : "",
							async value => {
								const { model: _model, ...rest } = profile;
								const slash = value.indexOf("/");
								if (value && (slash <= 0 || slash === value.length - 1))
									throw new Error("Expected provider/model");
								await this.#client.saveProfile(
									value
										? { ...rest, model: { provider: value.slice(0, slash), model: value.slice(slash + 1) } }
										: rest,
								);
							},
						),
				),
				this.#action("persona", label("人设", "Persona"), () => this.#persona(profile), profile.persona.mode),
				this.#action("tools", label("工具白名单", "Tool allowlists"), () => this.#profileTools(profile)),
				this.#action("memory", label("记忆", "Memory"), () => this.#profileMemory(profile)),
			]);
		});
	}
	#target(profile: ImAgentProfile): void {
		const draft = structuredClone(profile.location);
		const values =
			draft.kind === "workspace"
				? { workspace: draft.workspace, team: "", pm: "", engineer: "", repo: "" }
				: {
						workspace: "",
						team: draft.team,
						pm: draft.pm,
						engineer: draft.kind === "engineer" ? draft.engineer : "",
						repo: draft.kind === "engineer" ? (draft.repo ?? "") : "",
					};
		let kind = draft.kind;
		this.#push(label("执行目标", "Execution target"), () => {
			const edit = (key: keyof typeof values) =>
				this.#field(key, values[key], value => {
					values[key] = value;
				});
			this.#showMenu([
				this.#action(
					"kind",
					label("目标类型", "Target kind"),
					() =>
						this.#choose(
							label("目标类型", "Target kind"),
							["workspace", "team-pm", "engineer"].map(value => ({ value, label: value })),
							kind,
							value => {
								if (value === "workspace" || value === "team-pm" || value === "engineer") kind = value;
							},
						),
					kind,
				),
				...(kind === "workspace"
					? [
							this.#action(
								"workspace",
								label("工作区别名", "Workspace alias"),
								() => edit("workspace"),
								values.workspace,
							),
						]
					: [
							this.#action("team", "Team ID", () => edit("team"), values.team),
							this.#action("pm", "PM ID", () => edit("pm"), values.pm),
							...(kind === "engineer"
								? [
										this.#action("engineer", "Engineer ID", () => edit("engineer"), values.engineer),
										this.#action(
											"repo",
											label("仓库 ID（可选）", "Repository ID (optional)"),
											() => edit("repo"),
											values.repo,
										),
									]
								: []),
						]),
				this.#action("save", label("保存目标", "Save target"), () =>
					this.#apply(() =>
						this.#client.saveProfile({
							...profile,
							location:
								kind === "workspace"
									? { kind, workspace: values.workspace }
									: kind === "team-pm"
										? { kind, team: values.team, pm: values.pm }
										: {
												kind,
												team: values.team,
												pm: values.pm,
												engineer: values.engineer,
												...(values.repo ? { repo: values.repo } : {}),
											},
						}),
					),
				),
			]);
		});
	}
	#persona(profile: ImAgentProfile): void {
		const persona = { ...profile.persona };
		this.#push(label("人设", "Persona"), () =>
			this.#showMenu([
				this.#action(
					"mode",
					label("人设来源", "Persona source"),
					() =>
						this.#choose(
							label("人设来源", "Persona source"),
							["workspace", "file", "inline"].map(value => ({ value, label: value })),
							persona.mode,
							value => {
								if (value === "workspace" || value === "file" || value === "inline") persona.mode = value;
							},
						),
					persona.mode,
				),
				...(persona.mode === "file"
					? [
							this.#action(
								"file",
								label("人设文件", "Persona file"),
								() =>
									this.#field(
										label("人设文件", "Persona file"),
										persona.file ?? "",
										value => {
											persona.file = value;
										},
										{ required: true },
									),
								persona.file,
							),
						]
					: persona.mode === "inline"
						? [
								this.#action(
									"text",
									label("人设文本", "Persona text"),
									() =>
										this.#field(label("人设文本", "Persona text"), persona.text ?? "", value => {
											persona.text = value;
										}),
									persona.text,
								),
							]
						: []),
				this.#action("save", label("保存人设", "Save persona"), () =>
					this.#apply(() =>
						this.#client.saveProfile({
							...profile,
							persona:
								persona.mode === "file"
									? { mode: "file", file: persona.file ?? "" }
									: persona.mode === "inline"
										? { mode: "inline", text: persona.text ?? "" }
										: { mode: "workspace" },
						}),
					),
				),
			]),
		);
	}
	#profileTools(profile: ImAgentProfile): void {
		const tools = structuredClone(profile.tools);
		const keys = ["builtin", "extensions", "customTools", "mcpServers", "skills", "commands"] as const;
		this.#push(label("工具白名单（空列表表示不授予）", "Tool allowlists (empty grants none)"), () =>
			this.#showMenu([
				...keys.map(key =>
					this.#action(
						key,
						key,
						() =>
							this.#field(`${key} · ${label("逗号分隔", "comma separated")}`, tools[key].join(","), value => {
								tools[key] = value
									.split(",")
									.map(row => row.trim())
									.filter(Boolean);
							}),
						tools[key].join(","),
					),
				),
				this.#action(
					"preset",
					label("工具预设", "Tool preset"),
					() =>
						this.#choose(
							label("工具预设", "Tool preset"),
							["", "companion", "read-only-chat", "roleplay", "team-pm", "engineer"].map(value => ({
								value,
								label: value || label("无", "None"),
							})),
							tools.preset ?? "",
							value => {
								if (!value) delete tools.preset;
								else if (
									value === "companion" ||
									value === "read-only-chat" ||
									value === "roleplay" ||
									value === "team-pm" ||
									value === "engineer"
								)
									tools.preset = value;
							},
						),
					tools.preset,
				),
				this.#action(
					"approval",
					label("审批模式", "Approval mode"),
					() =>
						this.#choose(
							label("审批模式", "Approval mode"),
							["", "always-ask", "write", "yolo"].map(value => ({
								value,
								label: value || label("继承", "Inherit"),
							})),
							tools.approvalMode ?? "",
							value => {
								if (!value) delete tools.approvalMode;
								else if (value === "always-ask" || value === "write" || value === "yolo")
									tools.approvalMode = value;
							},
						),
					tools.approvalMode,
				),
				this.#action("save", label("保存工具策略", "Save tool policy"), () =>
					this.#apply(() => this.#client.saveProfile({ ...profile, tools })),
				),
			]),
		);
	}
	#profileMemory(profile: ImAgentProfile): void {
		const memory = { ...profile.memory };
		this.#push(label("记忆", "Memory"), () =>
			this.#showMenu([
				this.#action(
					"backend",
					label("记忆后端", "Memory backend"),
					() =>
						this.#choose(
							label("记忆后端", "Memory backend"),
							["", "off", "local", "hindsight", "mnemopi", "sharpshooter"].map(value => ({
								value,
								label: value || label("继承", "Inherit"),
							})),
							memory.backend ?? "",
							value => {
								if (!value) delete memory.backend;
								else if (
									value === "off" ||
									value === "local" ||
									value === "hindsight" ||
									value === "mnemopi" ||
									value === "sharpshooter"
								)
									memory.backend = value;
							},
						),
					memory.backend,
				),
				this.#action(
					"namespace",
					label("记忆命名空间", "Memory namespace"),
					() =>
						this.#field(label("记忆命名空间", "Memory namespace"), memory.namespace ?? "", value => {
							if (value) memory.namespace = value;
							else delete memory.namespace;
						}),
					memory.namespace,
				),
				this.#action("context", label("工作区上下文", "Workspace context"), () =>
					this.#choose(
						label("工作区上下文", "Workspace context"),
						[
							{ value: "", label: label("继承", "Inherit") },
							{ value: "true", label: label("启用", "Enabled") },
							{ value: "false", label: label("禁用", "Disabled") },
						],
						memory.workspaceContext === undefined ? "" : String(memory.workspaceContext),
						value => {
							if (!value) delete memory.workspaceContext;
							else memory.workspaceContext = value === "true";
						},
					),
				),
				this.#action("save", label("保存记忆策略", "Save memory policy"), () =>
					this.#apply(() => this.#client.saveProfile({ ...profile, memory })),
				),
			]),
		);
	}
	#bindings(): void {
		this.#push(label("聊天与已有会话绑定", "Chat / existing conversation bindings"), async () => {
			const revision = this.#revision;
			const current = await this.#client.im();
			if (this.#disposed || revision !== this.#revision) return;
			this.#showMenu([
				...current.bindings.map(binding =>
					this.#action(
						binding.id,
						`${binding.instanceId} · ${binding.chatId}`,
						() => this.#binding(binding),
						`${binding.threadId ?? ""} · ${binding.userId ?? ""} · ${binding.role} · ${current.conversations.find(row => row.id === binding.sessionId)?.name ?? binding.sessionId}`,
					),
				),
				this.#action("new", label("新增绑定（选择已有会话）", "Add binding (choose existing conversation)"), () =>
					this.#binding(),
				),
			]);
		});
	}
	#binding(existing?: ImBinding): void {
		const draft: BindingDraft = {
			...(existing ? { id: existing.id } : {}),
			instanceId: existing?.instanceId ?? "",
			chatId: existing?.chatId ?? "",
			threadId: existing?.threadId ?? "",
			userId: existing?.userId ?? "",
			agentProfileId: existing?.agentProfileId ?? "",
			conversationId: existing?.sessionId ?? "",
			role: existing?.role ?? "mention",
			...(existing?.lang ? { lang: existing.lang } : {}),
		};
		this.#push(label("绑定详情", "Binding details"), async () => {
			const revision = this.#revision;
			const current = await this.#client.im();
			if (this.#disposed || revision !== this.#revision) return;
			const selectedConversation = current.conversations.find(row => row.id === draft.conversationId);
			const edit = (key: "chatId" | "threadId" | "userId", title: string) =>
				this.#field(
					title,
					draft[key],
					value => {
						draft[key] = value;
					},
					{ required: key === "chatId" },
				);
			this.#showMenu([
				this.#action(
					"instance",
					label("机器人实例", "Bot instance"),
					() =>
						this.#choose(
							label("机器人实例", "Bot instance"),
							current.instances.map(row => ({
								value: row.id,
								label: row.label,
								description: `${row.id} · ${row.platform}`,
							})),
							draft.instanceId,
							value => {
								draft.instanceId = value;
							},
						),
					draft.instanceId || label("请选择", "Select"),
				),
				this.#action("chat", "Chat ID", () => edit("chatId", "Chat ID"), draft.chatId),
				this.#action(
					"thread",
					label("Thread ID（可选）", "Thread ID (optional)"),
					() => edit("threadId", "Thread ID"),
					draft.threadId,
				),
				this.#action(
					"user",
					label("Sender ID（可选）", "Sender ID (optional)"),
					() => edit("userId", "Sender ID"),
					draft.userId,
				),
				this.#action(
					"conversation",
					label("已有原生会话", "Existing native conversation"),
					() =>
						this.#choose(
							label("已有会话（共享历史需互相信任）", "Existing conversation (sharing exposes history)"),
							current.conversations.map(row => ({
								value: row.id,
								label: row.name,
								description: `${row.targetDisplay} · ${row.entrances} ${label("入口", "entrances")} ${row.reason ?? ""}`,
								disabled: !row.available,
							})),
							draft.conversationId,
							value => {
								draft.conversationId = value;
								const selected = current.conversations.find(row => row.id === value);
								if (selected?.agentProfileId) draft.agentProfileId = selected.agentProfileId;
							},
						),
					current.conversations.find(row => row.id === draft.conversationId)?.name ?? label("请选择", "Select"),
				),
				this.#action(
					"profile",
					"Agent Profile",
					() =>
						this.#choose(
							"Agent Profile",
							current.profiles.map(row => ({
								value: row.id,
								label: row.label,
								description: `${row.id} · ${targetKey(row.location)}`,
								disabled: Boolean(
									current.conversations.find(conversation => conversation.id === draft.conversationId)
										?.agentProfileId &&
									current.conversations.find(conversation => conversation.id === draft.conversationId)
										?.agentProfileId !== row.id,
								),
							})),
							draft.agentProfileId,
							value => {
								draft.agentProfileId = value;
							},
						),
					draft.agentProfileId || label("请选择", "Select"),
				),
				this.#action(
					"role",
					label("回复角色", "Reply role"),
					() =>
						this.#choose(
							label("回复角色", "Reply role"),
							["answer", "mention", "observe"].map(value => ({ value, label: value })),
							draft.role,
							value => {
								if (value === "answer" || value === "mention" || value === "observe") draft.role = value;
							},
						),
					draft.role,
				),
				this.#action(
					"target",
					label("会话目标与模型（由已有会话锁定）", "Conversation target and model (locked)"),
					() =>
						this.#document(label("会话归属", "Conversation ownership"), [
							selectedConversation?.targetDisplay ?? label("请先选择会话", "Select a conversation first"),
							selectedConversation?.agentProfileId ?? draft.agentProfileId,
							selectedConversation?.model
								? `${selectedConversation.model.provider}/${selectedConversation.model.model}`
								: label("继承会话模型", "Inherit conversation model"),
						]),
					selectedConversation?.targetDisplay,
				),
				this.#action("save", label("保存绑定", "Save binding"), () =>
					this.#apply(() => this.#client.saveBinding(draft)),
				),
				...(existing
					? [
							this.#action(
								"unbind",
								label("仅解除此入口", "Unbind only this entrance"),
								() => this.#apply(() => this.#client.unbind(existing.id)),
								undefined,
								label("再次确认解除此入口", "Confirm again to unbind this entrance"),
							),
						]
					: []),
			]);
		});
	}

	render(width: number): readonly string[] {
		const title = this.#stack.map(view => view.title).join(" › ");
		const height = Math.max(5, (process.stdout.rows || 40) - 9);
		this.#backRow = 0;
		this.#bodyRow = 2;
		this.#menu?.setMaxVisible(Math.max(3, height - 5));
		if (this.#body instanceof SelectFormField) this.#body.selectList.setMaxVisible(Math.max(3, height - 7));
		if (this.#body instanceof PrivateDocument) this.#body.setHeight(Math.max(3, height - 4));
		const body = this.#body?.render(width) ?? [];
		const out = [
			theme.fg("accent", truncateToWidth(`‹ ${label("返回", "Back")}   ${safe(title)}`, width)),
			"",
			...body,
		];
		this.#submitRow = -1;
		if (this.#body instanceof TextFormField || this.#documentContinue) {
			this.#submitRow = out.length;
			out.push(theme.fg("accent", `[ ${label("继续 / 提交", "Continue / submit")} ]`));
		}
		if (this.#busy) out.push(theme.fg("muted", label("正在读取 / 保存…", "Loading / saving…")));
		this.#retryRow = -1;
		if (this.#error) {
			out.push(...wrapTextWithAnsi(theme.fg("error", this.#error), width));
			this.#retryRow = out.length;
			out.push(label("[ 重试 ]", "[ Retry ]"));
		}
		out.push(
			theme.fg(
				"dim",
				`${editorKey("tui.select.confirm")} ${label("选择", "select")} · ${editorKey("tui.select.cancel")} ${label("返回", "back")} · ${label("可点击条目与返回", "Click entries or Back")}`,
			),
		);
		return out;
	}
	describe(_cx: DescribeContext): NativeNode {
		return col(
			[
				actionButton(label("返回", "Back"), "back"),
				text(this.#stack.map(view => view.title).join(" › ")),
				...(this.#body ? [this.#body] : []),
				...(this.#body instanceof TextFormField || this.#documentContinue
					? [actionButton(label("继续 / 提交", "Continue / submit"), "submit")]
					: []),
				...(this.#busy ? [text(label("正在读取 / 保存…", "Loading / saving…"))] : []),
				...(this.#error ? [text(this.#error), actionButton(label("重试", "Retry"), "retry")] : []),
			],
			{ role: "zeta.settings.runtime", gap: "sm" },
		);
	}
	handleNativeEvent(event: NativeUiEvent): void {
		if (this.#disposed) return;
		if (event.type === "action" && event.act === "retry") {
			this.#reload();
			return;
		}
		if (event.type === "action" && event.act === "back") this.#back();
		else if (event.type === "action" && event.act === "submit") this.#submit();
		else if (!this.#busy) this.#body?.handleNativeEvent?.(event);
	}
	#submit(): void {
		if (this.#busy) return;
		if (this.#body instanceof TextFormField) this.#body.submit();
		else this.#documentContinue?.();
	}
	handleInput(data: string): void {
		if (this.#disposed) return;
		if (getKeybindings().matches(data, "tui.select.cancel")) {
			this.#back();
			return;
		}
		if (this.#busy) return;
		if (this.#body instanceof TextFormField && getKeybindings().matches(data, "tui.select.confirm")) {
			this.#submit();
			return;
		}
		if (this.#documentContinue && (getKeybindings().matches(data, "tui.select.confirm") || data === "\n"))
			this.#submit();
		else this.#body?.handleInput?.(data);
		this.requestRender();
	}
	routeMouse(event: SgrMouseEvent, line: number, column: number): void {
		if (this.#disposed) return;
		if (event.leftClick && line === this.#backRow) {
			this.#back();
			return;
		}
		if (event.leftClick && line === this.#retryRow) {
			this.#reload();
			return;
		}
		if (event.leftClick && line === this.#submitRow) {
			this.#submit();
			return;
		}
		if (this.#busy || line < this.#bodyRow) return;
		const body = this.#body;
		if (body && "routeMouse" in body && typeof body.routeMouse === "function")
			body.routeMouse(event, line - this.#bodyRow, column);
		this.requestRender();
	}
}

export function createRuntimeSettingsPages(requestRender: () => void) {
	return (["identity", "im"] as const).map(id => ({
		id,
		label: label(
			id === "identity" ? "身份与设备" : "IM 运行时",
			id === "identity" ? "Identity & devices" : "IM runtime",
		),
		description: label(
			id === "identity" ? "验证器二维码、恢复码、远程策略和配对设备" : "机器人实例、Agent Profile 与已有会话绑定",
			id === "identity"
				? "Authenticator QR, recovery codes, remote policy and paired devices"
				: "Bot instances, Agent Profiles and existing conversation bindings",
		),
		create: (onBack: () => void) => new RuntimeSettingsPage(id, onBack, requestRender),
	}));
}
