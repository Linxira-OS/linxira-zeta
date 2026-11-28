import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import type { KeyEvent } from "@linxiraos/pi-tui";
import type { TspPrefsRow, TspPrefsSection } from "@linxiraos/pi-wire";
import type { ChannelInstanceConfig, ImAgentProfile, ImBinding } from "../src/channels/im-config";
import type { InteractiveModeContext } from "../src/modes/types";
import { getKeybindings, KeybindingsManager, setKeybindings } from "../src/config/keybindings/keybindings";
import {
	RuntimeSettingsClient,
	type BindingDraft,
	type ImRuntimeSnapshot,
	type RuntimeConversation,
} from "../src/modes/components/runtime-settings-client";
import type { EnrollmentResult, TwoFactorStatus } from "../src/server/auth/two-factor-store";
import { BUILTIN_CHANNELS_SLASH_COMMAND } from "../src/slash-commands/builtin-channels";
import { BUILTIN_TWO_FACTOR_SLASH_COMMAND } from "../src/slash-commands/builtin-two-factor";
import { clearSettingsPageRequest, takeSettingsPageRequest } from "../src/ui/overlays/settings/page-request";
import {
	createImRuntimeSettingsPage,
	createRuntimeSettingsPage,
	createRuntimeSettingsPages,
	createTwoFactorRuntimeSettingsPage,
} from "../src/ui/overlays/settings/runtime-pages";
import {
	bindingDraftFrom,
	imRuntimeOverview,
	runtimeErrorMessage,
	twoFactorStatusRows,
	type RuntimeRowSpec,
} from "../src/ui/overlays/settings/runtime-settings-view";
import type { SettingsHostPage } from "../src/ui/overlays/settings/settings";
import { settingsScreen, setupSettingsWindow } from "./helpers/settings-window";

const STATUS: TwoFactorStatus = {
	enrolled: false,
	required: false,
	enrolledAt: null,
	pending: false,
	recoveryCodesRemaining: 0,
};
const SECRET = "JBSWY3DPEHPK3PXP";
const ENROLLMENT: EnrollmentResult = {
	secret: SECRET,
	otpauthUrl: `otpauth://totp/Zeta:fixture?secret=${SECRET}`,
	recoveryCodes: ["fixture-recovery-one", "fixture-recovery-two"],
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
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
	allow: { peers: ["chat-a"] },
	credentials: { botToken: "fixture-saved-token" },
};
const CONVERSATION: RuntimeConversation = {
	id: "native-existing",
	name: "Existing review",
	attached: true,
	available: true,
	targetKey: "workspace:main",
	targetDisplay: "Default workspace",
	agentProfileId: PROFILE.id,
	entrances: 1,
	model: { provider: "fixture", model: "locked-model" },
};
const BINDING: ImBinding = {
	id: "b_0123456789abcdef",
	instanceId: INSTANCE.id,
	platform: INSTANCE.platform,
	chatId: "chat-a",
	agentProfileId: PROFILE.id,
	sessionId: CONVERSATION.id,
	target: PROFILE.location,
	role: "mention",
	createdAt: "2026-01-01T00:00:00.000Z",
};
const SNAPSHOT: ImRuntimeSnapshot = {
	instances: [INSTANCE],
	profiles: [PROFILE],
	bindings: [BINDING],
	conversations: [CONVERSATION],
	statuses: [{ id: INSTANCE.id, state: "running" }],
};

function press(id: string, text?: string): KeyEvent {
	return { id, kind: "press", raw: text ?? "", ...(text === undefined ? {} : { text }) };
}

afterEach(() => vi.useRealTimers());

function rowsOf(sections: readonly TspPrefsSection[]): TspPrefsRow[] {
	return sections.flatMap(section => [...section.rows]);
}

function rowById(page: SettingsHostPage, id: string): TspPrefsRow {
	const row = rowsOf(page.prefs().sections).find(candidate => candidate.id === id);
	if (!row) throw new Error(`Missing row ${id}`);
	return row;
}

function labelOf(row: RuntimeRowSpec): string {
	return row.control.k === "action" ? row.control.label : "";
}

async function settle(page: SettingsHostPage): Promise<void> {
	await page.settled;
}

class FakeClient extends RuntimeSettingsClient {
	status: TwoFactorStatus = { ...STATUS };
	enrollment: EnrollmentResult = structuredClone(ENROLLMENT);
	lastRecoveryCode = "";
	lastConfirmCode = "";
	snapshot: ImRuntimeSnapshot = structuredClone(SNAPSHOT);
	instanceSaves: ChannelInstanceConfig[] = [];

	override async twoFactorStatus(): Promise<TwoFactorStatus> {
		return { ...this.status };
	}
	override async enroll(): Promise<EnrollmentResult> {
		return structuredClone(this.enrollment);
	}
	override async recovery(code: string): Promise<string[]> {
		this.lastRecoveryCode = code;
		return ["new-recovery-code"];
	}
	override async request(path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
		if (path === "/api/auth/2fa/confirm" && method === "POST") {
			const code = (body as { code?: string } | undefined)?.code;
			this.lastConfirmCode = code ?? "";
			return {};
		}
		throw new Error(`Unexpected fixture route: ${method} ${path}`);
	}
	override async im(): Promise<ImRuntimeSnapshot> {
		return structuredClone(this.snapshot);
	}
	override async saveInstance(instance: ChannelInstanceConfig): Promise<void> {
		this.instanceSaves.push(structuredClone(instance));
		this.snapshot.instances = this.snapshot.instances.map(row => (row.id === instance.id ? instance : row));
	}
	override async saveProfile(profile: ImAgentProfile): Promise<void> {
		this.snapshot.profiles = this.snapshot.profiles.map(row => (row.id === profile.id ? profile : row));
	}
	override async saveBinding(draft: BindingDraft): Promise<void> {
		const binding = this.snapshot.bindings.find(row => row.id === draft.id);
		if (!binding) throw new Error("Binding removed; reload before editing");
		this.snapshot.bindings = this.snapshot.bindings.map(row =>
			row.id === draft.id
				? {
						...row,
						chatId: draft.chatId.trim(),
						threadId: draft.threadId.trim() || undefined,
						userId: draft.userId.trim() || undefined,
						agentProfileId: draft.agentProfileId,
						sessionId: draft.conversationId,
						role: draft.role,
						...(draft.lang ? { lang: draft.lang } : {}),
					}
				: row,
		);
	}
	override async unbind(id: string): Promise<void> {
		this.snapshot.bindings = this.snapshot.bindings.filter(row => row.id !== id);
	}
}

describe("runtime settings state mapper", () => {
	it("maps every 2FA status field to a row", () => {
		const rows = twoFactorStatusRows({
			enrolled: true,
			required: true,
			pending: true,
			enrolledAt: "2026-01-01T00:00:00.000Z",
			recoveryCodesRemaining: 7,
		});
		const byId = new Map(rows.map(row => [row.id, row]));
		expect(labelOf(byId.get("status")!)).toBe("Enrolled");
		expect(labelOf(byId.get("required")!)).toBe("Required");
		expect(labelOf(byId.get("pending")!)).toBe("Awaiting confirmation");
		expect(labelOf(byId.get("recovery-count")!)).toBe("7");
		expect(labelOf(byId.get("enrolled-at")!)).toBe("2026-01-01T00:00:00.000Z");
	});

	it("maps an empty IM runtime to explicit empty rows", () => {
		const overview = imRuntimeOverview({
			instances: [],
			profiles: [],
			bindings: [],
			conversations: [],
			statuses: [],
		});
		expect(overview.lead).toContain("No IM runtime is configured");
		const ids = overview.sections.map(section => section.rows.map(row => row.id));
		expect(ids).toEqual([["instances-empty"], ["profiles-empty"], ["bindings-empty"], ["conversations-empty"]]);
	});

	it("maps populated IM state without exposing credentials", () => {
		const overview = imRuntimeOverview(SNAPSHOT);
		const rows = overview.sections.flatMap(section => section.rows);
		expect(rows.map(row => row.id)).toEqual([
			`instance:${INSTANCE.id}`,
			`profile:${PROFILE.id}`,
			`binding:${BINDING.id}`,
			`conversation:${CONVERSATION.id}`,
		]);
		expect(rows[0]?.hint).toContain("running");
		expect(rows[1]?.hint).toContain("workspace:main");
		expect(rows[2]?.hint).toContain(CONVERSATION.name);
		expect(JSON.stringify(rows)).not.toContain("fixture-saved-token");
	});

	it("copies a binding into an editable draft", () => {
		expect(bindingDraftFrom(BINDING)).toEqual({
			id: BINDING.id,
			instanceId: BINDING.instanceId,
			chatId: BINDING.chatId,
			threadId: "",
			userId: "",
			agentProfileId: BINDING.agentProfileId,
			conversationId: BINDING.sessionId,
			role: BINDING.role,
		});
	});

	it("keeps the serve guidance in a sanitized error message", () => {
		const message = runtimeErrorMessage(new Error("Start zetacode serve\n\tretry\u0000"));
		expect(message).toBe("Start zetacode serve retry");
		expect(runtimeErrorMessage("")).toBe("Unknown runtime error");
	});
});

describe("runtime settings routing", () => {
	beforeEach(() => clearSettingsPageRequest());

	it("routes /2fa to the identity runtime page", async () => {
		let opened = 0;
		const ctx = { showSettingsSelector: () => void opened++ } as unknown as InteractiveModeContext;
		await (
			BUILTIN_TWO_FACTOR_SLASH_COMMAND.handleTui as (
				command: { name: string; args: string; text: string },
				runtime: { ctx: InteractiveModeContext },
			) => Promise<void>
		)({ name: "2fa", args: "", text: "/2fa" }, { ctx });
		expect(opened).toBe(1);
		expect(takeSettingsPageRequest()).toBe("identity");
	});

	it("routes /channels and its /im alias to the IM page", async () => {
		const ctx = { showSettingsSelector: () => {} } as unknown as InteractiveModeContext;
		const handler = BUILTIN_CHANNELS_SLASH_COMMAND.handleTui as (
			command: { name: string; args: string; text: string },
			runtime: { ctx: InteractiveModeContext },
		) => Promise<void>;
		await handler({ name: "channels", args: "", text: "/channels" }, { ctx });
		expect(takeSettingsPageRequest()).toBe("im");
		await handler({ name: "im", args: "", text: "/im" }, { ctx });
		expect(takeSettingsPageRequest()).toBe("im");
	});

	it("consumes a request exactly once", () => {
		clearSettingsPageRequest();
		expect(takeSettingsPageRequest()).toBeUndefined();
	});
});

describe("runtime settings pages", () => {
	it("shows 2FA status and exposes enrollment material once", async () => {
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			const client = new FakeClient();
			const page = createTwoFactorRuntimeSettingsPage({ onClose: () => {} }, client);
			await settle(page);
			expect(rowById(page, "status").control).toMatchObject({ k: "action", label: "Not enrolled" });
			expect(rowById(page, "recovery-count").control).toMatchObject({ k: "action", label: "0" });

			page.event({ type: "action", key: "", act: "open", value: "enroll", mods: [] });
			await settle(page);
			expect(labelOfRow(page, "secret")).toBe(SECRET);
			expect(labelOfRow(page, "recovery-1")).toBe("fixture-recovery-one");
			expect(page.prefs().lead).toContain(ENROLLMENT.otpauthUrl);

			page.dispose();
			expect(JSON.stringify(page.prefs())).not.toContain(SECRET);
			expect(JSON.stringify(page.prefs())).not.toContain("fixture-recovery-one");
			expect(log).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});

	it("drops enrollment material when its window expires", async () => {
		vi.useFakeTimers();
		const client = new FakeClient();
		client.enrollment.expiresAt = new Date(Date.now() + 1_000).toISOString();
		const page = createTwoFactorRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);
		page.event({ type: "action", key: "", act: "open", value: "enroll", mods: [] });
		await settle(page);
		expect(JSON.stringify(page.prefs())).toContain(SECRET);
		vi.advanceTimersByTime(1_001);
		await settle(page);
		expect(JSON.stringify(page.prefs())).not.toContain(SECRET);
		page.dispose();
	});

	it("submits a masked code with the configured confirm key", async () => {
		const previous = getKeybindings();
		setKeybindings(KeybindingsManager.inMemory({ "tui.select.confirm": "ctrl+y", "tui.select.cancel": "ctrl+g" }));
		try {
			const client = new FakeClient();
			client.status = { ...STATUS, enrolled: true, recoveryCodesRemaining: 2 };
			const page = createTwoFactorRuntimeSettingsPage({ onClose: () => {} }, client);
			await settle(page);
			page.event({ type: "action", key: "", act: "open", value: "recovery", mods: [] });
			await settle(page);
			page.event({ type: "activate", key: "", item: "code" });
			for (const digit of ["1", "2", "3", "4", "5", "6"]) page.key(press(digit, digit));
			page.key(press("ctrl+y"));
			await settle(page);
			expect(client.lastRecoveryCode).toBe("123456");
			page.dispose();
		} finally {
			setKeybindings(previous);
		}
	});

	it("regenerates recovery codes behind a masked code field", async () => {
		const client = new FakeClient();
		client.status = { ...STATUS, enrolled: true, recoveryCodesRemaining: 2 };
		const page = createTwoFactorRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);

		page.event({ type: "action", key: "", act: "open", value: "recovery", mods: [] });
		await settle(page);
		page.event({ type: "activate", key: "", item: "code" });
		expect(page.prefs().editing).toMatchObject({ row: "code", draft: "" });
		for (const digit of ["1", "2", "3", "4", "5", "6"]) page.key(press(digit, digit));
		expect(JSON.stringify(page.prefs())).not.toContain("123456");
		page.key(press("enter"));
		await settle(page);
		expect(client.lastRecoveryCode).toBe("123456");
		expect(labelOfRow(page, "new-recovery-1")).toBe("new-recovery-code");
		page.dispose();
		expect(JSON.stringify(page.prefs())).not.toContain("new-recovery-code");
	});

	it("cancels enrollment cleanly when the page closes mid-request", async () => {
		const client = new FakeClient();
		const pending = Promise.withResolvers<EnrollmentResult>();
		client.enroll = () => pending.promise;
		const onClose: boolean[] = [];
		const page = createTwoFactorRuntimeSettingsPage({ onClose: () => onClose.push(true) }, client);
		await settle(page);
		page.event({ type: "action", key: "", act: "open", value: "enroll", mods: [] });
		page.key(press("escape"));
		pending.resolve(ENROLLMENT);
		await settle(page);
		expect(onClose).toHaveLength(1);
		expect(JSON.stringify(page.prefs())).not.toContain(SECRET);
	});

	it("saves an edited instance and its enabled switch", async () => {
		const client = new FakeClient();
		const page = createImRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);
		page.event({ type: "action", key: "", act: "open", value: `instance:${INSTANCE.id}`, mods: [] });
		await settle(page);
		page.event({ type: "activate", key: "", item: "label" });
		for (let index = 0; index < INSTANCE.label.length; index++) page.key(press("backspace"));
		for (const character of "Renamed") page.key(press(character, character));
		page.key(press("enter"));
		await settle(page);
		expect(client.instanceSaves.at(-1)).toMatchObject({ id: INSTANCE.id, label: "Renamed" });
		expect(rowById(page, "label").control).toMatchObject({ k: "text", value: "Renamed" });

		page.event({ type: "change", key: "", item: "enabled", value: true });
		await settle(page);
		expect(client.instanceSaves.at(-1)).toMatchObject({ id: INSTANCE.id, enabled: true, label: "Renamed" });
	});

	it("saves an existing Agent Profile name", async () => {
		const client = new FakeClient();
		const page = createImRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);
		page.event({ type: "action", key: "", act: "open", value: `profile:${PROFILE.id}`, mods: [] });
		await settle(page);
		page.event({ type: "activate", key: "", item: "label" });
		for (let index = 0; index < PROFILE.label.length; index++) page.key(press("backspace"));
		for (const character of "Analyst") page.key(press(character, character));
		page.key(press("enter"));
		await settle(page);
		expect(client.snapshot.profiles.find(row => row.id === PROFILE.id)?.label).toBe("Analyst");
		expect(rowById(page, "label").control).toMatchObject({ k: "text", value: "Analyst" });
	});

	it("saves an existing binding after editing its chat and role", async () => {
		const client = new FakeClient();
		const page = createImRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);
		page.event({ type: "action", key: "", act: "open", value: `binding:${BINDING.id}`, mods: [] });
		await settle(page);
		page.event({ type: "activate", key: "", item: "chat" });
		for (let index = 0; index < BINDING.chatId.length; index++) page.key(press("backspace"));
		for (const character of "chat-b") page.key(press(character, character));
		page.key(press("enter"));
		await settle(page);
		page.event({ type: "activate", key: "", item: "role" });
		page.key(press("down"));
		page.key(press("enter"));
		await settle(page);
		page.event({ type: "action", key: "", act: "open", value: "save", mods: [] });
		await settle(page);
		expect(client.snapshot.bindings[0]).toMatchObject({ chatId: "chat-b", role: "answer" });
		expect(rowById(page, "chat").control).toMatchObject({ k: "text", value: "chat-b" });
	});

	it("shows the exact serve readiness error with a retry row", async () => {
		const client = new FakeClient();
		const message = "Start zetacode serve, then retry / 请先启动 zetacode serve 后重试";
		client.twoFactorStatus = async () => {
			throw new Error(message);
		};
		const page = createTwoFactorRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);
		expect(page.prefs().lead).toContain(message);
		expect(rowById(page, "retry").control).toMatchObject({ k: "action" });
	});

	it("shows the exact serve readiness error on the IM page", async () => {
		const client = new FakeClient();
		const message = "Start zetacode serve, then retry / 请先启动 zetacode serve 后重试";
		client.im = async () => {
			throw new Error(message);
		};
		const page = createImRuntimeSettingsPage({ onClose: () => {} }, client);
		await settle(page);
		expect(page.prefs().lead).toContain(message);
		expect(rowById(page, "retry").control).toMatchObject({ k: "action" });
	});
});

describe("settings window runtime pages", () => {
	const mountSettingsWindow = setupSettingsWindow();

	it("registers one Runtime page with the identity and IM entries", async () => {
		const pages = createRuntimeSettingsPages(() => new FakeClient());
		expect(pages.map(page => page.id)).toEqual(["runtime"]);
		const runtime = createRuntimeSettingsPage({ onClose: () => {} }, () => new FakeClient());
		await settle(runtime);
		const rows = rowsOf(runtime.prefs().sections);
		expect(rows.map(row => row.id)).toEqual(["identity", "im"]);
		expect(rows.map(row => row.label)).toEqual(["Identity & devices", "IM runtime"]);
		runtime.dispose();
	});

	it("opens the Runtime menu when initialPage is set", async () => {
		let runtime: SettingsHostPage | undefined;
		const term = mountSettingsWindow({
			runtimePages: [
				{
					id: "runtime",
					label: "Runtime",
					create: options => {
						runtime = createRuntimeSettingsPage(options, () => new FakeClient());
						return runtime;
					},
				},
			],
			initialPage: "runtime",
		});
		if (!runtime) throw new Error("Runtime page was not created");
		await settle(runtime);
		term.render();
		const screen = settingsScreen(term);
		expect(screen).toContain("Runtime");
		expect(screen).toContain("Identity & devices");
		expect(screen).toContain("IM runtime");
		runtime.dispose();
	});

	it("keeps Appearance for a plain /settings and never creates runtime pages", () => {
		let runtime: SettingsHostPage | undefined;
		const term = mountSettingsWindow({
			runtimePages: [
				{
					id: "runtime",
					label: "Runtime",
					create: options => {
						runtime = createRuntimeSettingsPage(options, () => new FakeClient());
						return runtime;
					},
				},
			],
		});
		term.render();
		const screen = settingsScreen(term);
		expect(screen).toContain("Appearance");
		expect(screen).toContain("Runtime");
		expect(screen).not.toContain("Identity & devices");
		expect(runtime).toBeUndefined();
	});

	it("lands on Runtime and opens a direct /2fa child with Back to the menu", async () => {
		const client = new FakeClient();
		client.status = { ...STATUS, enrolled: true, recoveryCodesRemaining: 3 };
		let runtime: SettingsHostPage | undefined;
		const term = mountSettingsWindow({
			runtimePages: [
				{
					id: "runtime",
					label: "Runtime",
					create: options => {
						runtime = createRuntimeSettingsPage(
							{ onClose: options.onClose, ...(options.initial ? { initial: options.initial } : {}) },
							() => client,
						);
						return runtime;
					},
				},
			],
			initialPage: "runtime",
			initialRuntimePage: "identity",
		});
		if (!runtime) throw new Error("Runtime page was not created");
		await settle(runtime);
		term.render();
		const screen = settingsScreen(term);
		expect(screen).toContain("Runtime");
		expect(screen).toContain("Authenticator");
		expect(screen).toContain("Enrolled");

		runtime.key(press("escape"));
		await settle(runtime);
		term.render();
		const backAtMenu = settingsScreen(term);
		expect(backAtMenu).toContain("IM runtime");
		expect(backAtMenu).toContain("Identity & devices");
		runtime.dispose();
	});
});

function labelOfRow(page: SettingsHostPage, id: string): string {
	const control = rowById(page, id).control;
	return control.k === "action" ? control.label : "";
}
