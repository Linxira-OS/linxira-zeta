/**
 * Host-supplied settings pages for the IM runtime and two-factor auth.
 *
 * Both pages are pure `prefs` models: the SettingsWindow draws the same rows
 * (and the same pointer hits) in the ANSI TUI and in a Tern terminal. The
 * pages own their navigation stack and every async read/write; they never read
 * or print stored credentials, and enrollment secrets/recovery codes live only
 * in transient rows that leave with the page.
 */
import { type Accessor, computed, signal, type KeyEvent, type UiEvent } from "@linxiraos/pi-tui";
import type { TspPrefsControl, TspPrefsRow } from "@linxiraos/pi-wire";
import { targetKey, type ChannelInstanceConfig, type ImAgentProfile } from "../../../channels/im-config";
import { getKeybindings } from "../../../config/keybindings/keybindings";
import { listKeyId } from "../../../config/keybindings/matchers";
import {
	RuntimeSettingsClient,
	type BindingDraft,
	type ImRuntimeSnapshot,
	type RuntimeConversation,
} from "../../../modes/components/runtime-settings-client";
import type { EnrollmentResult } from "../../../server/auth/two-factor-store";
import { editLine, type LineState } from "./line-edit";
import { RUNTIME_SETTINGS_PAGE_ID, type SettingsPageRequest } from "./page-request";
import type { SettingsHostPage, SettingsPluginsPrefs, SettingsRuntimePage } from "./settings";
import {
	bindingDraftFrom,
	imRuntimeOverview,
	runtimeErrorMessage,
	twoFactorStatusRows,
	type RuntimeRowSpec,
} from "./runtime-settings-view";

/** A row with the page-private actions the prefs control cannot carry. */
interface RuntimeRow extends RuntimeRowSpec {
	run?(): void | Promise<void>;
	change?(value: boolean | string): void | Promise<void>;
	edit?(value: string): void | Promise<void>;
}

interface RuntimeSection {
	readonly id: string;
	readonly title: string;
	readonly rows: RuntimeRow[];
}

interface RuntimeView {
	readonly title: string;
	readonly lead: string;
	readonly sections: RuntimeSection[];
}

type Editor =
	| {
			readonly kind: "text";
			readonly row: string;
			readonly line: LineState;
			readonly secret: boolean;
			submit(value: string): void | Promise<void>;
	  }
	| {
			readonly kind: "choice";
			readonly row: string;
			readonly option: string;
			readonly options: readonly { readonly value: string; readonly label: string }[];
			pick(value: string): void | Promise<void>;
	  };

/** Trim a row string to one line; a gateway may echo control characters. */
function rowLine(text: string): string {
	return text
		.replace(/\x1b\[[0-9;:]*m/g, "")
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** The shared navigation/loading/editor machinery. */
abstract class RuntimePage implements SettingsHostPage {
	protected readonly client: RuntimeSettingsClient;
	protected readonly onClose: () => void;
	readonly prefs: Accessor<SettingsPluginsPrefs>;
	#stack = signal<RuntimeView[]>([]);
	#editor = signal<Editor | null>(null);
	#selected = signal<string | undefined>(undefined);
	#notice = signal<string | undefined>(undefined);
	#busy = signal(false);
	#revision = 0;
	#disposed = false;
	#timers = new Set<NodeJS.Timeout>();
	#root: (() => Promise<RuntimeView>) | undefined;
	#active: Promise<void> = Promise.resolve();

	constructor(client: RuntimeSettingsClient, onClose: () => void) {
		this.client = client;
		this.onClose = onClose;
		this.prefs = computed((): SettingsPluginsPrefs => {
			const view = this.#current() ?? { title: "Loading", lead: "Reading runtime settings…", sections: [] };
			const notice = this.#notice();
			const busy = this.#busy();
			const editor = this.#editor();
			return {
				lead: [view.lead, notice, busy ? "Working…" : undefined].filter(Boolean).join(" · "),
				sections: view.sections.map(section => ({
					id: section.id,
					title: rowLine(section.title),
					rows: section.rows.map(row => this.#prefsRow(row)),
				})),
				focus: this.#selectedId() ?? null,
				editing:
					editor === null
						? null
						: editor.kind === "choice"
							? { row: editor.row, option: editor.option }
							: {
									row: editor.row,
									draft: editor.secret ? "•".repeat([...editor.line.text].length) : editor.line.text,
									cursor: editor.line.cursor,
								},
			};
		});
	}

	get settled(): Promise<void> {
		return this.#active;
	}

	protected start(root: () => Promise<RuntimeView>): void {
		this.#root = root;
		this.#active = this.open(root);
	}

	/** Capture the navigation revision so an async read can tell it was left. */
	protected revision(): number {
		return this.#revision;
	}

	protected left(revision: number): boolean {
		return this.#disposed || revision !== this.#revision;
	}

	protected setNotice(error: unknown): void {
		this.#notice.set(runtimeErrorMessage(error));
	}

	/** Push a loading view, then replace it with the builder's view or an error page. */
	protected async open(build: () => Promise<RuntimeView>): Promise<void> {
		if (this.#disposed) return;
		const loading: RuntimeView = { title: "Loading", lead: "Reading runtime settings…", sections: [] };
		this.#stack.update(list => [...list, loading]);
		this.#editor.set(null);
		this.#selected.set(undefined);
		this.#notice.set(undefined);
		const revision = this.#revision;
		try {
			const view = await build();
			if (this.left(revision)) return;
			if (this.#current() !== loading) return;
			this.#stack.update(list => [...list.slice(0, -1), view]);
		} catch (error) {
			if (this.left(revision)) return;
			if (this.#current() !== loading) return;
			this.#stack.update(list => [...list.slice(0, -1), this.#errorView(build, error)]);
		}
	}

	/** Replace the current view without a loading flash (an edit refreshing its own detail). */
	protected async refresh(build: () => Promise<RuntimeView>): Promise<void> {
		const revision = this.#revision;
		try {
			const view = await build();
			if (this.left(revision)) return;
			this.setTop(view);
			this.#notice.set(undefined);
		} catch (error) {
			if (this.left(revision)) return;
			this.setNotice(error);
		}
	}

	protected setTop(view: RuntimeView): void {
		if (this.#disposed) return;
		this.#stack.update(list => (list.length === 0 ? [view] : [...list.slice(0, -1), view]));
		this.#selected.set(undefined);
	}

	protected push(view: RuntimeView): void {
		if (this.#disposed) return;
		this.#revision++;
		this.#stack.update(list => [...list, view]);
		this.#editor.set(null);
		this.#selected.set(undefined);
		this.#notice.set(undefined);
	}

	protected hasView(view: RuntimeView): boolean {
		return this.#stack().some(entry => entry === view);
	}

	protected back(): void {
		if (this.#editor() !== null) {
			this.#editor.set(null);
			return;
		}
		if (this.#stack().length <= 1) {
			this.dispose();
			this.onClose();
			return;
		}
		this.#revision++;
		this.#stack.update(list => list.slice(0, -1));
		this.#editor.set(null);
		this.#selected.set(undefined);
		this.#notice.set(undefined);
	}

	/** Return to the page root, discarding detail views and one-time material. */
	protected async reset(): Promise<void> {
		this.#revision++;
		this.#stack.set([]);
		this.#editor.set(null);
		this.#selected.set(undefined);
		this.#notice.set(undefined);
		this.clearTimers();
		if (this.#root) {
			const active = this.open(this.#root);
			this.#active = active;
			await active;
		}
	}

	protected schedule(delayMs: number, action: () => void): void {
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			if (!this.#disposed) action();
		}, delayMs);
		timer.unref?.();
		this.#timers.add(timer);
	}

	protected clearTimers(): void {
		for (const timer of this.#timers) clearTimeout(timer);
		this.#timers.clear();
	}

	protected action(
		id: string,
		label: string,
		run: () => void | Promise<void>,
		options: { hint?: string; warning?: string; disabled?: string; shown?: string } = {},
	): RuntimeRow {
		return {
			id,
			label,
			...(options.hint ? { hint: options.hint } : {}),
			...(options.warning ? { warning: options.warning } : {}),
			...(options.disabled ? { disabled: options.disabled } : {}),
			control: { k: "action", label: options.shown ?? "Open", act: "open" },
			run,
		};
	}

	protected text(
		id: string,
		label: string,
		value: string,
		edit: (value: string) => void | Promise<void>,
		options: { hint?: string; secret?: boolean } = {},
	): RuntimeRow {
		return {
			id,
			label,
			...(options.hint ? { hint: options.hint } : {}),
			control: { k: "text", value, ...(options.secret ? { secret: true } : {}) },
			edit,
		};
	}

	protected choice(
		id: string,
		label: string,
		value: string,
		options: readonly { readonly value: string; readonly label: string; readonly detail?: string }[],
		pick: (value: string) => void | Promise<void>,
		hint?: string,
	): RuntimeRow {
		if (options.length === 0)
			return {
				id,
				label,
				...(hint ? { hint } : {}),
				warning: "No choices available",
				control: { k: "action", label: "None available", act: "none" },
			};
		return {
			id,
			label,
			...(hint ? { hint } : {}),
			control: { k: "choice", value, options, style: "menu" },
			change: pick,
		};
	}

	protected toggle(
		id: string,
		label: string,
		on: boolean,
		change: (value: boolean) => void | Promise<void>,
		hint?: string,
	): RuntimeRow {
		return { id, label, ...(hint ? { hint } : {}), control: { k: "switch", on }, change };
	}

	protected readonlyRow(spec: RuntimeRowSpec): RuntimeRow {
		return { ...spec };
	}

	#prefsRow(row: RuntimeRow): TspPrefsRow {
		return {
			id: row.id,
			label: rowLine(row.label),
			...(row.hint ? { hint: rowLine(row.hint) } : {}),
			...(row.warning ? { warning: rowLine(row.warning) } : {}),
			...(row.disabled ? { disabled: rowLine(row.disabled) } : {}),
			control: row.control as TspPrefsControl,
		};
	}

	#current(): RuntimeView | undefined {
		const stack = this.#stack();
		return stack[stack.length - 1];
	}

	#rows(): RuntimeRow[] {
		return this.#current()?.sections.flatMap(section => section.rows) ?? [];
	}

	#selectedId(): string | undefined {
		const selected = this.#selected();
		const rows = this.#rows();
		return selected !== undefined && rows.some(row => row.id === selected) ? selected : rows[0]?.id;
	}

	#errorView(build: () => Promise<RuntimeView>, error: unknown): RuntimeView {
		return {
			title: "Runtime settings",
			lead: runtimeErrorMessage(error),
			sections: [
				{
					id: "error",
					title: "Error",
					rows: [
						this.action("retry", "Retry", async () => {
							this.#stack.update(list => list.slice(0, -1));
							await this.open(build);
						}),
					],
				},
			],
		};
	}

	#apply(work: () => void | Promise<void>): Promise<void> {
		const active = (async () => {
			this.#busy.set(true);
			this.#notice.set(undefined);
			try {
				await work();
			} catch (error) {
				this.#notice.set(runtimeErrorMessage(error));
			} finally {
				this.#busy.set(false);
			}
		})();
		this.#active = active;
		return active;
	}

	#pickChoice(editor: Extract<Editor, { kind: "choice" }>, value: string): void {
		if (!editor.options.some(option => option.value === value)) return;
		this.#editor.set(null);
		const row = this.#rows().find(candidate => candidate.id === editor.row);
		if (row?.change) void this.#apply(() => row.change!(value));
	}

	#submitText(editor: Extract<Editor, { kind: "text" }>): void {
		const value = editor.line.text;
		this.#editor.set(null);
		void this.#apply(() => editor.submit(value));
	}

	key(key: KeyEvent): boolean {
		if (key.kind === "release") return false;
		const nav = listKeyId(key);
		const editor = this.#editor();
		if (editor?.kind === "text") {
			if (nav === "escape") {
				this.#editor.set(null);
				return true;
			}
			if (nav === "enter" || getKeybindings().matches(key, "tui.input.submit")) {
				this.#submitText(editor);
				return true;
			}
			const line = editLine(editor.line, key);
			if (line) this.#editor.set({ ...editor, line });
			return true;
		}
		if (editor?.kind === "choice") {
			const options = editor.options;
			if (options.length === 0) {
				this.#editor.set(null);
				return true;
			}
			const at = Math.max(
				0,
				options.findIndex(option => option.value === editor.option),
			);
			if (nav === "escape") {
				this.#editor.set(null);
				return true;
			}
			if (nav === "up") {
				this.#editor.set({ ...editor, option: options[(at - 1 + options.length) % options.length]!.value });
				return true;
			}
			if (nav === "down") {
				this.#editor.set({ ...editor, option: options[(at + 1) % options.length]!.value });
				return true;
			}
			if (nav === "enter" || getKeybindings().matches(key, "tui.input.submit")) {
				this.#pickChoice(editor, editor.option);
				return true;
			}
			return false;
		}
		if (nav === "escape") {
			this.back();
			return true;
		}
		return false;
	}

	event(event: UiEvent): void {
		switch (event.type) {
			case "select": {
				const eq = event.item.indexOf("=");
				if (eq >= 0) {
					const row = event.item.slice(0, eq);
					const editor = this.#editor();
					if (editor?.kind === "choice" && editor.row === row) {
						const option = event.item.slice(eq + 1);
						if (editor.options.some(candidate => candidate.value === option))
							this.#editor.set({ ...editor, option });
					}
					return;
				}
				if (this.#rows().some(row => row.id === event.item)) this.#selected.set(event.item);
				return;
			}
			case "activate": {
				const row = this.#rows().find(candidate => candidate.id === event.item);
				if (!row) return;
				this.#selected.set(row.id);
				if (row.control.k === "text") {
					this.#editor.set({
						kind: "text",
						row: row.id,
						line: { text: row.control.value, cursor: row.control.value.length },
						secret: row.control.secret === true,
						submit: value => row.edit?.(value) ?? undefined,
					});
					return;
				}
				if (row.control.k === "choice" && row.control.options.length > 0) {
					this.#editor.set({
						kind: "choice",
						row: row.id,
						option: row.control.value,
						options: row.control.options.map(option => ({ value: option.value, label: option.label })),
						pick: value => row.change?.(value) ?? undefined,
					});
				}
				return;
			}
			case "change": {
				const row = this.#rows().find(candidate => candidate.id === event.item);
				if (!row) return;
				if (row.control.k === "choice" && typeof event.value === "string") {
					const editor = this.#editor();
					if (editor?.kind === "choice" && editor.row === row.id) this.#pickChoice(editor, event.value);
					else if (row.change) void this.#apply(() => row.change!(event.value as string));
					return;
				}
				if (row.control.k === "switch" && typeof event.value === "boolean" && row.change) {
					void this.#apply(() => row.change!(event.value as boolean));
				}
				return;
			}
			case "action": {
				if (event.act === "close") {
					if (event.value === this.#editor()?.row) this.#editor.set(null);
					return;
				}
				const row = this.#rows().find(candidate => candidate.id === event.value);
				if (!row) return;
				this.#selected.set(row.id);
				if (row.control.k === "action" && row.control.act === "none") return;
				if (row.run) void this.#apply(row.run);
				return;
			}
			default:
				return;
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#revision++;
		this.clearTimers();
		this.#editor.set(null);
		this.#stack.set([]);
		this.client.dispose();
	}
}

/** The two-factor page. */
class TwoFactorRuntimePage extends RuntimePage {
	constructor(onClose: () => void, client = new RuntimeSettingsClient()) {
		super(client, onClose);
		this.start(() => this.#root());
	}

	async #root(): Promise<RuntimeView> {
		const status = await this.client.twoFactorStatus();
		return {
			title: "Two-factor authentication",
			lead: status.enrolled
				? "The authenticator is enrolled. Secrets and recovery codes appear once, only while their page is open."
				: "Enroll an authenticator to require a code for remote writes. Nothing is written to the transcript.",
			sections: [
				{ id: "status", title: "Status", rows: twoFactorStatusRows(status).map(spec => ({ ...spec })) },
				{
					id: "actions",
					title: "Actions",
					rows: [
						this.action(
							"enroll",
							status.enrolled ? "Re-enroll authenticator…" : "Start enrollment",
							() => this.#enroll(),
							{
								hint: "Shows the manual secret, otpauth URL and recovery codes once",
								warning: status.enrolled ? "Re-enrollment replaces the current authenticator" : undefined,
								shown: "Start",
							},
						),
						this.action("confirm", "Confirm pending enrollment…", () => this.#code("confirm"), {
							hint: "Enter the 6-digit code from the authenticator",
							disabled: status.pending ? undefined : "No pending enrollment",
							shown: "Enter code",
						}),
						this.action("recovery", "Regenerate recovery codes…", () => this.#code("recovery"), {
							hint: "Replaces every existing recovery code",
							disabled: status.enrolled ? undefined : "Enroll the authenticator first",
							shown: "Enter code",
						}),
						this.action("refresh", "Refresh status", () => this.reset(), { shown: "Refresh" }),
					],
				},
			],
		};
	}

	async #enroll(): Promise<void> {
		const revision = this.revision();
		const enrollment = await this.client.enroll();
		if (this.left(revision)) return;
		this.#showEnrollment(enrollment);
	}

	#showEnrollment(enrollment: EnrollmentResult): void {
		const view: RuntimeView = {
			title: "Authenticator enrollment",
			lead: `Scan or enter the otpauth URL, then save the recovery codes. ${enrollment.otpauthUrl}`,
			sections: [
				{
					id: "enrollment",
					title: "Shown once",
					rows: [
						this.readonlyRow({
							id: "secret",
							label: "Manual secret",
							hint: "Type this into an authenticator that cannot scan the URL",
							control: { k: "action", label: enrollment.secret, act: "none" },
						}),
						...enrollment.recoveryCodes.map((code, index) =>
							this.readonlyRow({
								id: `recovery-${index + 1}`,
								label: `Recovery code ${index + 1}`,
								control: { k: "action", label: code, act: "none" },
							}),
						),
						this.readonlyRow({
							id: "expires",
							label: "Expires",
							control: { k: "action", label: enrollment.expiresAt, act: "none" },
						}),
					],
				},
				{
					id: "actions",
					title: "Actions",
					rows: [
						this.action("confirm-now", "Confirm enrollment…", () => this.#code("confirm"), {
							hint: "Enter the first code from the authenticator",
							shown: "Enter code",
						}),
						this.action("done", "Done", () => this.reset(), { shown: "Done" }),
					],
				},
			],
		};
		this.push(view);
		const expires = Date.parse(enrollment.expiresAt);
		if (Number.isFinite(expires))
			this.schedule(Math.max(0, expires - Date.now()), () => {
				if (this.hasView(view)) void this.reset();
			});
	}

	#code(kind: "confirm" | "recovery"): void {
		const view: RuntimeView = {
			title: kind === "confirm" ? "Confirm enrollment" : "Regenerate recovery codes",
			lead: "The value is held only while this field is open. It is never written to the transcript.",
			sections: [
				{
					id: "code",
					title: "Verification",
					rows: [
						this.text("code", "Code", "", value => this.#submitCode(kind, value), {
							hint:
								kind === "recovery"
									? "6-digit authenticator code or a current recovery code"
									: "6-digit authenticator code",
							secret: true,
						}),
					],
				},
				{
					id: "actions",
					title: "Actions",
					rows: [this.action("cancel", "Cancel", () => this.back(), { shown: "Back" })],
				},
			],
		};
		this.push(view);
	}

	async #submitCode(kind: "confirm" | "recovery", value: string): Promise<void> {
		if (value.trim() === "") throw new Error("Enter a code first");
		const revision = this.revision();
		if (kind === "confirm") {
			await this.client.request("/api/auth/2fa/confirm", "POST", { code: value.trim() });
			if (this.left(revision)) return;
			await this.reset();
			return;
		}
		const codes = await this.client.recovery(value);
		if (this.left(revision)) return;
		this.back();
		this.#showRecoveryCodes(codes);
	}

	#showRecoveryCodes(codes: readonly string[]): void {
		const view: RuntimeView = {
			title: "Recovery codes",
			lead: "Shown once. Store these somewhere safe; every older recovery code is now dead.",
			sections: [
				{
					id: "codes",
					title: "Shown once",
					rows: codes.map((code, index) =>
						this.readonlyRow({
							id: `new-recovery-${index + 1}`,
							label: `Recovery code ${index + 1}`,
							control: { k: "action", label: code, act: "none" },
						}),
					),
				},
				{
					id: "actions",
					title: "Actions",
					rows: [this.action("done", "Done", () => this.reset(), { shown: "Done" })],
				},
			],
		};
		this.push(view);
		this.schedule(5 * 60_000, () => {
			if (this.hasView(view)) void this.reset();
		});
	}
}

/** The IM runtime page. */
class ImRuntimePage extends RuntimePage {
	constructor(onClose: () => void, client = new RuntimeSettingsClient()) {
		super(client, onClose);
		this.start(() => this.#root());
	}

	async #root(): Promise<RuntimeView> {
		const snapshot = await this.client.im();
		const overview = imRuntimeOverview(snapshot);
		const sections: RuntimeSection[] = overview.sections.map(section => ({
			id: section.id,
			title: section.title,
			rows: section.rows.map(spec => {
				if (spec.id.startsWith("instance:"))
					return { ...spec, run: () => this.#openInstance(spec.id.slice("instance:".length)) };
				if (spec.id.startsWith("profile:"))
					return { ...spec, run: () => this.#openProfile(spec.id.slice("profile:".length)) };
				if (spec.id.startsWith("binding:"))
					return { ...spec, run: () => this.#openBinding(spec.id.slice("binding:".length)) };
				if (spec.id.startsWith("conversation:"))
					return { ...spec, run: () => this.#openConversation(spec.id.slice("conversation:".length), snapshot) };
				return this.readonlyRow(spec);
			}),
		}));
		sections.push({
			id: "actions",
			title: "Actions",
			rows: [this.action("refresh", "Refresh runtime", () => this.reset(), { shown: "Refresh" })],
		});
		return { title: "IM runtime", lead: overview.lead, sections };
	}

	async #openInstance(id: string): Promise<void> {
		await this.open(async () => {
			const snapshot = await this.client.im();
			const instance = snapshot.instances.find(row => row.id === id);
			if (!instance) throw new Error(`Instance ${id} was removed; refresh the IM page.`);
			return this.#instanceView(snapshot, instance);
		});
	}

	#instanceView(snapshot: ImRuntimeSnapshot, instance: ChannelInstanceConfig): RuntimeView {
		const save = async (patch: Partial<ChannelInstanceConfig>): Promise<void> => {
			await this.client.saveInstance({ ...instance, ...patch });
			await this.refresh(async () => {
				const latest = await this.client.im();
				const row = latest.instances.find(candidate => candidate.id === instance.id);
				if (!row) throw new Error(`Instance ${instance.id} was removed; refresh the IM page.`);
				return this.#instanceView(latest, row);
			});
		};
		return {
			title: instance.label,
			lead: "Instance metadata only. Platform credentials are never read or shown here.",
			sections: [
				{
					id: "instance",
					title: "Bot instance",
					rows: [
						this.readonlyRow({
							id: "id",
							label: "Instance ID",
							hint: "Immutable after creation",
							control: { k: "action", label: instance.id, act: "none" },
						}),
						this.text(
							"label",
							"Display name",
							instance.label,
							value => save({ label: value.trim() || instance.id }),
							{ hint: "Shown in bindings and the runtime list" },
						),
						this.text("note", "Note", instance.note ?? "", value => save({ note: value.trim() || undefined }), {
							hint: "Optional operator note",
						}),
						this.toggle("enabled", "Enabled", instance.enabled, value => save({ enabled: value })),
						this.choice(
							"profile",
							"Agent Profile",
							instance.agentProfile,
							snapshot.profiles.map(profile => ({
								value: profile.id,
								label: profile.label,
								detail: `${profile.id} · ${targetKey(profile.location)}`,
							})),
							value => save({ agentProfile: value }),
							"Profile that answers for this instance",
						),
						this.text(
							"peers",
							"Allowed chat IDs",
							instance.allow.peers.join(", "),
							value =>
								save({
									allow: {
										...instance.allow,
										peers: value
											.split(",")
											.map(entry => entry.trim())
											.filter(Boolean),
									},
								}),
							{ hint: "Comma separated; empty allows nobody" },
						),
					],
				},
				{
					id: "actions",
					title: "Actions",
					rows: [
						this.action("refresh", "Refresh instance", () => this.open(() => this.#loadInstance(instance.id)), {
							shown: "Refresh",
						}),
						this.action("back", "Back", () => this.back(), { shown: "Back" }),
					],
				},
			],
		};
	}

	async #loadInstance(id: string): Promise<RuntimeView> {
		const snapshot = await this.client.im();
		const instance = snapshot.instances.find(row => row.id === id);
		if (!instance) throw new Error(`Instance ${id} was removed; refresh the IM page.`);
		return this.#instanceView(snapshot, instance);
	}

	async #openProfile(id: string): Promise<void> {
		await this.open(() => this.#loadProfile(id));
	}

	async #loadProfile(id: string): Promise<RuntimeView> {
		const snapshot = await this.client.im();
		const profile = snapshot.profiles.find(row => row.id === id);
		if (!profile) throw new Error(`Agent Profile ${id} was removed; refresh the IM page.`);
		return this.#profileView(profile);
	}

	#profileView(profile: ImAgentProfile): RuntimeView {
		const save = async (next: ImAgentProfile): Promise<void> => {
			await this.client.saveProfile(next);
			await this.refresh(() => this.#loadProfile(profile.id));
		};
		const modelValue = profile.model ? `${profile.model.provider}/${profile.model.model}` : "";
		return {
			title: profile.label,
			lead: `Agent Profile ${profile.id}. Changes save to the serve runtime.`,
			sections: [
				{
					id: "profile",
					title: "Profile",
					rows: [
						this.readonlyRow({
							id: "id",
							label: "Agent Profile ID",
							hint: "Immutable after creation",
							control: { k: "action", label: profile.id, act: "none" },
						}),
						this.text(
							"label",
							"Display name",
							profile.label,
							value => save({ ...profile, label: value.trim() || profile.id }),
							{
								hint: "Shown in bindings and the runtime list",
							},
						),
						this.text(
							"model",
							"Model provider/model",
							modelValue,
							value => {
								const slash = value.indexOf("/");
								if (value !== "" && (slash <= 0 || slash === value.length - 1))
									throw new Error("Expected provider/model");
								const { model: _model, ...rest } = profile;
								return save(
									value === ""
										? rest
										: {
												...rest,
												model: {
													provider: value.slice(0, slash),
													model: value.slice(slash + 1),
												},
											},
								);
							},
							{ hint: "Blank inherits the conversation model" },
						),
						this.choice(
							"persona-mode",
							"Persona source",
							profile.persona.mode,
							[
								{ value: "workspace", label: "Workspace" },
								{ value: "file", label: "File" },
								{ value: "inline", label: "Inline text" },
							],
							value => {
								const persona =
									value === "file"
										? { mode: "file" as const, file: profile.persona.file ?? "" }
										: value === "inline"
											? { mode: "inline" as const, text: profile.persona.text ?? "" }
											: { mode: "workspace" as const };
								return save({ ...profile, persona });
							},
							"Where this profile reads its persona from",
						),
						...(profile.persona.mode === "file"
							? [
									this.text(
										"persona-file",
										"Persona file",
										profile.persona.file ?? "",
										value =>
											save({
												...profile,
												persona: { mode: "file", file: value.trim() },
											}),
										{ hint: "Path to the persona file" },
									),
								]
							: profile.persona.mode === "inline"
								? [
										this.text(
											"persona-text",
											"Persona text",
											profile.persona.text ?? "",
											value =>
												save({
													...profile,
													persona: { mode: "inline", text: value },
												}),
											{ hint: "The persona instructions" },
										),
									]
								: []),
						this.readonlyRow({
							id: "target",
							label: "Execution target",
							hint: "Set in the serve gateway; the target decides where this profile works",
							control: { k: "action", label: targetKey(profile.location), act: "none" },
						}),
					],
				},
				{
					id: "actions",
					title: "Actions",
					rows: [
						this.action("refresh", "Refresh profile", () => this.open(() => this.#loadProfile(profile.id)), {
							shown: "Refresh",
						}),
						this.action("back", "Back", () => this.back(), { shown: "Back" }),
					],
				},
			],
		};
	}

	async #openBinding(id: string): Promise<void> {
		await this.open(() => this.#loadBinding(id));
	}

	async #loadBinding(id: string): Promise<RuntimeView> {
		const snapshot = await this.client.im();
		const binding = snapshot.bindings.find(row => row.id === id);
		if (!binding) throw new Error(`Binding ${id} was removed; refresh the IM page.`);
		return this.#bindingView(snapshot, bindingDraftFrom(binding));
	}

	#bindingView(snapshot: ImRuntimeSnapshot, draft: BindingDraft): RuntimeView {
		const conversation = snapshot.conversations.find(row => row.id === draft.conversationId);
		const profile = snapshot.profiles.find(row => row.id === draft.agentProfileId);
		const missing = [
			draft.instanceId === "" ? "instance" : undefined,
			draft.chatId.trim() === "" ? "chat ID" : undefined,
			draft.conversationId === "" ? "conversation" : undefined,
			draft.agentProfileId === "" ? "Agent Profile" : undefined,
		].filter(Boolean);
		const update = (): void => {
			this.setTop(this.#bindingView(snapshot, draft));
		};
		const save = async (): Promise<void> => {
			await this.client.saveBinding(draft);
			if (draft.id) await this.refresh(() => this.#loadBinding(draft.id!));
			else await this.reset();
		};
		return {
			title: draft.id ? "Binding details" : "New binding",
			lead: conversation?.reason
				? `Conversation unavailable: ${conversation.reason}`
				: "Bind a chat entrance to an existing native conversation. The conversation locks the target and model.",
			sections: [
				{
					id: "binding",
					title: "Binding",
					rows: [
						this.choice(
							"instance",
							"Bot instance",
							draft.instanceId,
							snapshot.instances.map(row => ({
								value: row.id,
								label: row.label,
								detail: `${row.id} · ${row.platform}`,
							})),
							value => {
								draft.instanceId = value;
								update();
							},
							"Receives messages for this chat",
						),
						this.text(
							"chat",
							"Chat ID",
							draft.chatId,
							value => {
								draft.chatId = value;
								update();
							},
							{ hint: "Required; the platform's chat identifier" },
						),
						this.text(
							"thread",
							"Thread ID",
							draft.threadId,
							value => {
								draft.threadId = value;
								update();
							},
							{ hint: "Optional" },
						),
						this.text(
							"user",
							"Sender ID",
							draft.userId,
							value => {
								draft.userId = value;
								update();
							},
							{ hint: "Optional; restricts the entrance to one sender" },
						),
						this.choice(
							"conversation",
							"Native conversation",
							draft.conversationId,
							snapshot.conversations.map(row => ({
								value: row.id,
								label: row.available ? row.name : `${row.name} (unavailable)`,
								detail: `${row.targetDisplay} · ${row.attached ? "attached" : "not attached"} · ${row.entrances} entrances${row.reason ? ` · ${row.reason}` : ""}`,
							})),
							value => {
								draft.conversationId = value;
								const selected = snapshot.conversations.find(row => row.id === value);
								if (selected?.agentProfileId) draft.agentProfileId = selected.agentProfileId;
								update();
							},
							"Existing conversation that owns history and model",
						),
						this.choice(
							"profile",
							"Agent Profile",
							draft.agentProfileId,
							snapshot.profiles.map(row => ({
								value: row.id,
								label: row.label,
								detail: `${row.id} · ${targetKey(row.location)}`,
							})),
							value => {
								draft.agentProfileId = value;
								update();
							},
							profile ? `Target ${targetKey(profile.location)}` : "Required",
						),
						this.choice(
							"role",
							"Reply role",
							draft.role,
							[
								{ value: "mention", label: "Mention" },
								{ value: "answer", label: "Answer" },
								{ value: "observe", label: "Observe" },
							],
							value => {
								if (value === "answer" || value === "mention" || value === "observe") draft.role = value;
								update();
							},
							"How the bot responds in this chat",
						),
						this.choice(
							"lang",
							"Language",
							draft.lang ?? "",
							[
								{ value: "", label: "Inherit" },
								{ value: "zh", label: "Chinese" },
								{ value: "en", label: "English" },
							],
							value => {
								if (value === "") delete draft.lang;
								else if (value === "zh" || value === "en") draft.lang = value;
								update();
							},
							"Reply language for this entrance",
						),
						this.readonlyRow({
							id: "target",
							label: "Conversation target and model",
							hint: "Locked by the selected conversation",
							control: {
								k: "action",
								label: conversation
									? `${conversation.targetDisplay}${conversation.model ? ` · ${conversation.model.provider}/${conversation.model.model}` : ""}`
									: "Select a conversation first",
								act: "none",
							},
						}),
					],
				},
				{
					id: "actions",
					title: "Actions",
					rows: [
						this.action(
							"save",
							"Save binding",
							async () => {
								if (missing.length > 0) return;
								await save();
							},
							missing.length > 0
								? { disabled: `Missing ${missing.join(", ")}`, shown: "Save" }
								: { hint: "Writes the binding to the serve runtime", shown: "Save" },
						),
						...(draft.id
							? [
									this.action(
										"unbind",
										"Unbind this entrance",
										async () => {
											await this.client.unbind(draft.id!);
											await this.reset();
										},
										{ warning: "Leaves the conversation itself intact", shown: "Unbind" },
									),
								]
							: []),
						this.action("back", "Back", () => this.back(), { shown: "Back" }),
					],
				},
			],
		};
	}

	#openConversation(id: string, snapshot?: ImRuntimeSnapshot): void {
		const conversation = snapshot?.conversations.find(row => row.id === id);
		if (conversation) this.#showConversation(conversation);
		else
			void this.open(async () => {
				const latest = await this.client.im();
				const row = latest.conversations.find(candidate => candidate.id === id);
				if (!row) throw new Error(`Conversation ${id} is no longer available`);
				return this.#conversationView(row);
			});
	}

	#showConversation(conversation: RuntimeConversation): void {
		this.push(this.#conversationView(conversation));
	}

	#conversationView(conversation: RuntimeConversation): RuntimeView {
		return {
			title: conversation.name,
			lead: "A native conversation owned by the serve runtime. This page is read-only.",
			sections: [
				{
					id: "conversation",
					title: "Conversation",
					rows: [
						this.readonlyRow({
							id: "id",
							label: "Conversation ID",
							control: { k: "action", label: conversation.id, act: "none" },
						}),
						this.readonlyRow({
							id: "target",
							label: "Target",
							control: { k: "action", label: conversation.targetDisplay, act: "none" },
						}),
						this.readonlyRow({
							id: "attachment",
							label: "Attachment",
							control: {
								k: "action",
								label: conversation.attached ? "Attached" : "Not attached",
								act: "none",
							},
						}),
						this.readonlyRow({
							id: "availability",
							label: "Availability",
							hint: conversation.reason,
							control: {
								k: "action",
								label: conversation.available ? "Available" : "Unavailable",
								act: "none",
							},
						}),
						this.readonlyRow({
							id: "entrances",
							label: "Entrances",
							control: { k: "action", label: String(conversation.entrances), act: "none" },
						}),
						...(conversation.agentProfileId
							? [
									this.readonlyRow({
										id: "profile",
										label: "Agent Profile",
										control: { k: "action", label: conversation.agentProfileId, act: "none" },
									}),
								]
							: []),
						...(conversation.model
							? [
									this.readonlyRow({
										id: "model",
										label: "Model",
										control: {
											k: "action",
											label: `${conversation.model.provider}/${conversation.model.model}`,
											act: "none",
										},
									}),
								]
							: []),
					],
				},
				{
					id: "actions",
					title: "Actions",
					rows: [this.action("back", "Back", () => this.back(), { shown: "Back" })],
				},
			],
		};
	}
}

/** The runtime page's child ids, shared with the direct `/2fa` and `/channels` routes. */
type RuntimeChildId = SettingsPageRequest;

/**
 * The `/settings → Runtime` page: a two-row menu that opens the identity and
 * IM pages, or a direct command's page with the menu underneath it.
 */
class RuntimeMenuPage implements SettingsHostPage {
	readonly prefs: Accessor<SettingsPluginsPrefs>;
	#child = signal<SettingsHostPage | null>(null);
	#selected = signal<string | undefined>("identity");
	#disposed = false;
	readonly #onClose: () => void;
	readonly #clientFactory: () => RuntimeSettingsClient;

	constructor(onClose: () => void, clientFactory: () => RuntimeSettingsClient, initial?: string) {
		this.#onClose = onClose;
		this.#clientFactory = clientFactory;
		this.prefs = computed((): SettingsPluginsPrefs => {
			const child = this.#child();
			if (child) return child.prefs();
			return {
				lead: "Runtime identity and messaging authority from the live serve. Temporarily shown secrets leave when their page closes.",
				sections: [
					{
						id: "runtime",
						title: "Runtime",
						rows: [
							{
								id: "identity",
								label: "Identity & devices",
								hint: "Authenticator enrollment, recovery codes, remote policy and devices",
								control: { k: "action", label: "Open", act: "open" },
							},
							{
								id: "im",
								label: "IM runtime",
								hint: "Bot instances, Agent Profiles and existing conversation bindings",
								control: { k: "action", label: "Open", act: "open" },
							},
						],
					},
				],
				focus: this.#selected() ?? null,
				editing: null,
			};
		});
		if (initial === "identity" || initial === "im") this.#open(initial);
	}

	get settled(): Promise<void> {
		return this.#child()?.settled ?? Promise.resolve();
	}

	#open(id: RuntimeChildId): void {
		if (this.#disposed) return;
		this.#selected.set(id);
		const options = { onClose: () => this.#closeChild() };
		const child =
			id === "identity"
				? new TwoFactorRuntimePage(options.onClose, this.#clientFactory())
				: new ImRuntimePage(options.onClose, this.#clientFactory());
		const previous = this.#child();
		this.#child.set(child);
		previous?.dispose();
	}

	#closeChild(): void {
		const child = this.#child();
		if (!child) return;
		this.#child.set(null);
		child.dispose();
	}

	key(key: KeyEvent): boolean {
		const child = this.#child();
		if (child) return child.key(key);
		if (listKeyId(key) === "escape") {
			this.dispose();
			this.#onClose();
			return true;
		}
		return false;
	}

	event(event: UiEvent): void {
		const child = this.#child();
		if (child) {
			child.event(event);
			return;
		}
		if (event.type === "select") {
			if (event.item === "identity" || event.item === "im") this.#selected.set(event.item);
			return;
		}
		if (event.type === "activate" && (event.item === "identity" || event.item === "im")) {
			this.#open(event.item);
			return;
		}
		if (event.type === "action" && (event.value === "identity" || event.value === "im")) {
			this.#open(event.value);
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const child = this.#child();
		this.#child.set(null);
		child?.dispose();
	}
}

/** Build the IM page. */
export function createImRuntimeSettingsPage(
	options: { onClose(): void },
	client: RuntimeSettingsClient = new RuntimeSettingsClient(),
): SettingsHostPage {
	return new ImRuntimePage(options.onClose, client);
}

/** Build the 2FA page. */
export function createTwoFactorRuntimeSettingsPage(
	options: { onClose(): void },
	client: RuntimeSettingsClient = new RuntimeSettingsClient(),
): SettingsHostPage {
	return new TwoFactorRuntimePage(options.onClose, client);
}

/** Build the `/settings → Runtime` page, optionally opening a child directly. */
export function createRuntimeSettingsPage(
	options: { onClose(): void; initial?: string },
	clientFactory: () => RuntimeSettingsClient = () => new RuntimeSettingsClient(),
): SettingsHostPage {
	return new RuntimeMenuPage(options.onClose, clientFactory, options.initial);
}

/** The pages the SettingsWindow lists beside the schema tabs. */
export function createRuntimeSettingsPages(
	clientFactory: () => RuntimeSettingsClient = () => new RuntimeSettingsClient(),
): readonly SettingsRuntimePage[] {
	return [
		{
			id: RUNTIME_SETTINGS_PAGE_ID,
			label: "Runtime",
			create: options => createRuntimeSettingsPage(options, clientFactory),
		},
	];
}
