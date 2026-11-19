import { afterEach, beforeAll, describe, expect, test, vi } from "bun:test";
import { getKeybindings, KeybindingsManager, SelectList, setKeybindings, TUI_KEYBINDINGS } from "@linxiraos/pi-tui";
import { TextFormField } from "@linxiraos/pi-tui/components/form";
import { getThemeByName, setThemeInstance } from "@linxiraos/pi-tui/theme";
import type { DescribeContext } from "@linxiraos/pi-tui/native/node";
import type { ChannelInstanceConfig, ImAgentProfile, ImBinding } from "../src/channels/im-config";
import { RuntimeSettingsPage } from "../src/modes/components/runtime-settings";
import {
	RuntimeSettingsClient,
	type BindingDraft,
	type RuntimeConversation,
} from "../src/modes/components/runtime-settings-client";
import type { EnrollmentResult, TwoFactorStatus } from "../src/server/auth/two-factor-store";

const PROFILE: ImAgentProfile = {
	id: "companion",
	label: "Companion",
	persona: { mode: "workspace" },
	location: { kind: "workspace", workspace: "main" },
	tools: { builtin: [], extensions: [], customTools: [], mcpServers: [], skills: [], commands: [] },
	memory: { backend: "off" },
};
const INSTANCE: ChannelInstanceConfig = {
	id: "telegram-work",
	label: "Work",
	platform: "telegram",
	enabled: false,
	agentProfile: PROFILE.id,
	allow: { peers: ["chat-a", "chat-b"] },
	credentials: { botToken: "fixture-saved-token" },
	options: { peerTokens: { "chat-a": "fixture-peer-token" } },
};
const CONVERSATION: RuntimeConversation = {
	id: "native-existing",
	name: "Existing review",
	attached: false,
	available: true,
	targetKey: "workspace:main",
	targetDisplay: "Default workspace",
	entrances: 0,
	model: { provider: "fixture", model: "locked-model" },
};
const STATUS: TwoFactorStatus = {
	enrolled: false,
	required: false,
	enrolledAt: null,
	pending: false,
	recoveryCodesRemaining: 0,
};
const NATIVE: DescribeContext = {
	cols: 100,
	reduceMotion: false,
	dark: true,
	supports: () => true,
	feature: () => true,
};

/** State boundary only: production parsing, validation, navigation and lifetime handling remain in use. */
class GatewayState extends RuntimeSettingsClient {
	instances = [structuredClone(INSTANCE)];
	profiles = [structuredClone(PROFILE), { ...structuredClone(PROFILE), id: "analyst", label: "Analyst" }];
	bindings: ImBinding[] = [];
	conversations = [structuredClone(CONVERSATION)];
	status = { ...STATUS };
	enrollment: EnrollmentResult = {
		secret: "JBSWY3DPEHPK3PXP",
		otpauthUrl: "otpauth://totp/Zeta:fixture?secret=JBSWY3DPEHPK3PXP",
		recoveryCodes: ["fixture-recovery-one", "fixture-recovery-two"],
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	};
	statusRead: (() => Promise<TwoFactorStatus>) | undefined;
	enrollmentRead: (() => Promise<EnrollmentResult>) | undefined;
	bindingWrites = 0;
	attachments = 0;
	credentialAttempts: unknown[] = [];
	override async twoFactorStatus(): Promise<TwoFactorStatus> {
		return this.statusRead ? this.statusRead() : this.status;
	}
	override async devices() {
		return [];
	}
	override async enroll(): Promise<EnrollmentResult> {
		return this.enrollmentRead ? this.enrollmentRead() : this.enrollment;
	}
	override async recovery(): Promise<string[]> {
		return ["fixture-new-recovery"];
	}
	override async request(route: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
		if (route === "/api/channels/status") return { instances: [] };
		if (route === "/api/im/conversations") return { conversations: this.conversations };
		if (route === "/api/im/conversations/attach") {
			this.attachments++;
			const attached = {
				...this.conversations[0]!,
				id: "canonical-existing",
				attached: true,
				agentProfileId: PROFILE.id,
			};
			this.conversations = [attached];
			return { conversation: attached };
		}
		if (route === "/api/channels/instances/telegram-work/validate") {
			this.credentialAttempts.push(structuredClone(body));
			return {};
		}
		const payload = body as Record<string, unknown> | undefined;
		if (route === "/api/channels/instances") {
			if (method === "PUT") this.instances = structuredClone(payload?.instances as ChannelInstanceConfig[]);
			return { instances: this.instances };
		}
		if (route === "/api/im/agents") return { profiles: this.profiles };
		if (route === "/api/im/bindings") {
			if (method === "PUT") {
				this.bindingWrites++;
				this.bindings = structuredClone(payload?.bindings as ImBinding[]);
			}
			return { bindings: this.bindings };
		}
		throw new Error(`Unexpected fixture route: ${method} ${route}`);
	}
}

const pages: RuntimeSettingsPage[] = [];
const clients: RuntimeSettingsClient[] = [];
const savedKeybindings = getKeybindings();
beforeAll(async () => {
	const dark = await getThemeByName("dark");
	if (!dark) throw new Error("Dark theme unavailable");
	setThemeInstance(dark);
});
afterEach(() => {
	for (const page of pages.splice(0)) page.dispose();
	for (const client of clients.splice(0)) client.dispose();
	setKeybindings(savedKeybindings);
	vi.useRealTimers();
});
function client(): GatewayState {
	const api = new GatewayState();
	clients.push(api);
	return api;
}
function page(kind: "identity" | "im", api: GatewayState, back = () => {}): RuntimeSettingsPage {
	const view = new RuntimeSettingsPage(kind, back, () => {}, api);
	pages.push(view);
	return view;
}
async function settle(view: RuntimeSettingsPage): Promise<void> {
	for (let n = 0; n < 20; n++) {
		const pending = view.settled;
		await pending;
		if (pending === view.settled && !view.debugState().busy) return;
	}
	throw new Error("Settings page failed to settle");
}
async function activate(view: RuntimeSettingsPage, item: string): Promise<void> {
	view.handleNativeEvent({ type: "activate", key: "", item });
	await settle(view);
}
function draft(overrides: Partial<BindingDraft> = {}): BindingDraft {
	return {
		instanceId: INSTANCE.id,
		chatId: "chat-a",
		threadId: "thread-a",
		userId: "sender-a",
		agentProfileId: PROFILE.id,
		conversationId: CONVERSATION.id,
		role: "mention",
		...overrides,
	};
}
function visible(view: RuntimeSettingsPage): string {
	return Bun.stripANSI(view.render(100).join("\n"));
}

describe("runtime settings lifetime", () => {
	test("leaving during enrollment prevents late secrets from returning to the page", async () => {
		const api = client();
		const pending = Promise.withResolvers<EnrollmentResult>();
		const entered = Promise.withResolvers<void>();
		api.enrollmentRead = () => {
			entered.resolve();
			return pending.promise;
		};
		const back = vi.fn();
		const view = page("identity", api, back);
		await settle(view);
		view.handleNativeEvent({ type: "activate", key: "", item: "enroll" });
		await entered.promise;
		const enrollmentRequest = view.settled;
		view.handleInput("\x1b");
		pending.resolve(api.enrollment);
		await enrollmentRequest;
		expect(back).toHaveBeenCalledTimes(1);
		expect(view.debugState()).toMatchObject({ disposed: true, depth: 0 });
		expect(visible(view)).not.toContain(api.enrollment.secret);
		expect(view.debugChildren).toEqual([]);
		view.handleNativeEvent({ type: "action", key: "", act: "retry", mods: [] });
		view.handleNativeEvent({ type: "action", key: "", act: "back", mods: [] });
		view.handleInput("\x1b");
		expect(back).toHaveBeenCalledTimes(1);
	});

	test("retry recovers a failed read and preserves a usable back stack", async () => {
		const api = client();
		let reads = 0;
		api.statusRead = async () => {
			if (++reads === 1) throw new Error("fixture-gateway-unavailable");
			return STATUS;
		};
		const view = page("identity", api);
		await settle(view);
		expect(visible(view)).toContain("fixture-gateway-unavailable");
		view.handleNativeEvent({ type: "action", key: "", act: "retry", mods: [] });
		await settle(view);
		expect(visible(view)).not.toContain("fixture-gateway-unavailable");
		await activate(view, "policy");
		expect(view.debugState().depth).toBe(2);
		view.handleInput("\x1b");
		await settle(view);
		expect(view.debugState()).toMatchObject({ depth: 1, disposed: false });
		expect(view.debugChildren[0]).toBeInstanceOf(SelectList);
	});

	test("expiry removes QR and recovery text, including the retained document", async () => {
		vi.useFakeTimers();
		const api = client();
		api.enrollment.expiresAt = new Date(Date.now() + 1_000).toISOString();
		const view = page("identity", api);
		await settle(view);
		await activate(view, "enroll");
		const document = view.describe(NATIVE).c?.find(child => "render" in child);
		expect(document && "render" in document).toBe(true);
		view.handleInput("\x1b[F");
		expect(visible(view)).toContain(api.enrollment.secret);
		expect(view.debugChildren).toEqual([]);
		vi.advanceTimersByTime(1_001);
		await settle(view);
		expect(view.debugState().depth).toBe(1);
		expect(visible(view)).not.toContain(api.enrollment.secret);
		if (!document || !("render" in document)) throw new Error("Missing private document");
		expect(Bun.stripANSI(document.render(100).join("\n"))).not.toContain("fixture-recovery");
	});

	test("narrow scrolling preserves every manual-secret and recovery character", async () => {
		const api = client();
		api.enrollment.secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
		api.enrollment.recoveryCodes = ["RECOVERY123-4567890"];
		const view = page("identity", api);
		await settle(view);
		await activate(view, "enroll");
		const document = view.describe(NATIVE).c?.find(child => "render" in child);
		if (!document || !("render" in document)) throw new Error("Missing private document");
		const seen = new Set<string>();
		for (let n = 0; n < 160; n++) {
			for (const row of document.render(18))
				seen.add(
					Bun.stripANSI(row)
						.replace(/[│┃▐▌▎▍▏█░▒▓]/g, "")
						.trim(),
				);
			document.handleInput?.("\x1b[B");
		}
		const complete = [...seen].join("");
		expect(complete).toContain(api.enrollment.secret);
		expect(complete).toContain(api.enrollment.recoveryCodes[0]!);
		expect(complete).not.toContain("…");
	});

	test("configured keys submit a masked field and return from one-time recovery without an extra pop", async () => {
		setKeybindings(
			new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "ctrl+y", "tui.select.cancel": "ctrl+g" }),
		);
		const api = client();
		const view = page("identity", api);
		await settle(view);
		await activate(view, "recovery");
		const field = view.debugChildren[0];
		if (!(field instanceof TextFormField)) throw new Error("Missing code field");
		view.handleInput("fixture-old-recovery");
		expect(visible(view)).not.toContain("fixture-old-recovery");
		expect(JSON.stringify(field.input.debugState())).not.toContain("fixture-old-recovery");
		expect(JSON.stringify(field.input.describe(NATIVE))).not.toContain("fixture-old-recovery");
		view.handleInput("\x19");
		await settle(view);
		expect(visible(view)).toContain("fixture-new-recovery");
		expect(field.getValue()).toBe("");
		expect(view.debugState().depth).toBe(2);
		view.handleInput("\x07");
		await settle(view);
		expect(view.debugState().depth).toBe(1);
		expect(visible(view)).not.toContain("fixture-new-recovery");
	});

	test("cancelling credentials clears the field and draft without changing saved credentials", async () => {
		const api = client();
		const view = page("im", api);
		await settle(view);
		await activate(view, "instances");
		await activate(view, INSTANCE.id);
		await activate(view, "credentials");
		await activate(view, "botToken");
		const field = view.debugChildren[0];
		if (!(field instanceof TextFormField)) throw new Error("Missing credential field");
		view.handleInput("fixture-unsaved-token");
		view.handleInput("\n");
		await settle(view);
		expect(field.getValue()).toBe("");
		view.handleInput("\x1b");
		await settle(view);
		await activate(view, "credentials");
		await activate(view, "validate");
		expect(api.credentialAttempts).toEqual([{}]);
		expect(api.instances[0]?.credentials).toEqual(INSTANCE.credentials);
		expect(visible(view)).not.toContain("fixture-unsaved-token");
	});
});

describe("existing native conversation settings", () => {
	test("canonical attachment keeps the model and history ownership across independent entrances", async () => {
		const api = client();
		await api.saveBinding(draft());
		const first = api.bindings[0]!;
		expect(first).toMatchObject({
			sessionId: "canonical-existing",
			model: CONVERSATION.model,
			target: PROFILE.location,
			agentProfileId: PROFILE.id,
		});
		await api.saveBinding(draft({ conversationId: "canonical-existing", chatId: "chat-b" }));
		expect(api.attachments).toBe(1);
		await api.unbind(first.id);
		expect(api.bindings).toMatchObject([
			{ chatId: "chat-b", sessionId: "canonical-existing", model: CONVERSATION.model },
		]);
		expect(api.conversations[0]).toMatchObject({ id: "canonical-existing", agentProfileId: PROFILE.id });
	});

	test("rejected ownership and deleted edits do not attach or recreate a binding", async () => {
		const api = client();
		api.conversations[0]!.agentProfileId = PROFILE.id;
		await expect(api.saveBinding(draft({ agentProfileId: "analyst" }))).rejects.toThrow(/locks/);
		api.conversations[0]!.targetKey = "workspace:elsewhere";
		await expect(api.saveBinding(draft())).rejects.toThrow(/targets differ/);
		api.conversations[0]!.targetKey = CONVERSATION.targetKey;
		await expect(api.saveBinding(draft({ id: "b_0123456789abcdef" }))).rejects.toThrow(/removed/);
		expect(api.attachments).toBe(0);
		expect(api.bindingWrites).toBe(0);
		expect(api.bindings).toEqual([]);
	});

	test("metadata edits preserve stored credentials, platform options and unrelated instances", async () => {
		const api = client();
		const sibling = { ...structuredClone(INSTANCE), id: "telegram-other", label: "Other" };
		api.instances.push(sibling);
		await api.saveInstance({ ...INSTANCE, label: "Renamed", credentials: {}, options: undefined });
		expect(api.instances.find(row => row.id === INSTANCE.id)).toEqual({ ...INSTANCE, label: "Renamed" });
		expect(api.instances.find(row => row.id === sibling.id)).toEqual(sibling);
	});
});
