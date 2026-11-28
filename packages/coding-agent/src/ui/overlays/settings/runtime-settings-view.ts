/**
 * Pure view state for the host-supplied runtime settings pages.
 *
 * The pages themselves own navigation, loading and writes; this module turns a
 * gateway snapshot into rows a `prefs` widget can draw and hit-test. Nothing
 * here logs, stores or redacts a secret: enrollment material is only carried in
 * transient rows the page clears when it leaves.
 */
import type { TspPrefsControl } from "@linxiraos/pi-wire";
import {
	targetKey,
	type ChannelInstanceConfig,
	type ImAgentProfile,
	type ImBinding,
} from "../../../channels/im-config";
import type {
	BindingDraft,
	ImRuntimeSnapshot,
	RuntimeConversation,
} from "../../../modes/components/runtime-settings-client";
import type { TwoFactorStatus } from "../../../server/auth/two-factor-store";

/** One row a runtime page draws: the prefs row plus the page's private intent. */
export interface RuntimeRowSpec {
	readonly id: string;
	readonly label: string;
	readonly hint?: string;
	readonly warning?: string;
	readonly disabled?: string;
	readonly control: TspPrefsControl;
}

/** A titled group of runtime rows. */
export interface RuntimeSectionSpec {
	readonly id: string;
	readonly title: string;
	readonly rows: readonly RuntimeRowSpec[];
}

/** The IM page's overview snapshot. */
export interface ImOverview {
	readonly lead: string;
	readonly sections: readonly RuntimeSectionSpec[];
}

/** A message from a gateway or client error, safe to draw in one row. */
export function runtimeErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 500) || "Unknown runtime error"
	);
}

function readOnly(value: string): TspPrefsControl {
	return { k: "action", label: value, act: "none" };
}

function emptyRow(id: string, label: string, hint: string): RuntimeRowSpec {
	return { id, label, hint, control: readOnly("None") };
}

/** The 2FA page's status rows, before the page attaches its actions. */
export function twoFactorStatusRows(status: TwoFactorStatus): RuntimeRowSpec[] {
	const rows: RuntimeRowSpec[] = [
		{
			id: "status",
			label: "Authenticator",
			hint: "Enrollment state of this host's second factor",
			control: readOnly(status.enrolled ? "Enrolled" : "Not enrolled"),
		},
		{
			id: "required",
			label: "Remote write policy",
			hint: "Whether remote writes require a fresh code",
			control: readOnly(status.required ? "Required" : "Optional"),
		},
		{
			id: "pending",
			label: "Pending enrollment",
			hint: "A secret is waiting to be confirmed; it expires on its own",
			control: readOnly(status.pending ? "Awaiting confirmation" : "None"),
		},
		{
			id: "recovery-count",
			label: "Recovery codes",
			hint: "Each code works once",
			control: readOnly(String(status.recoveryCodesRemaining)),
		},
	];
	if (status.enrolledAt) {
		rows.push({
			id: "enrolled-at",
			label: "Enrolled at",
			control: readOnly(status.enrolledAt),
		});
	}
	return rows;
}

function instanceState(instance: ChannelInstanceConfig, statuses: readonly Record<string, unknown>[]): string {
	const status = statuses.find(row => row.id === instance.id);
	const state = status?.state;
	return typeof state === "string" && state !== "" ? state : "stopped";
}

function instanceRow(instance: ChannelInstanceConfig, statuses: readonly Record<string, unknown>[]): RuntimeRowSpec {
	return {
		id: `instance:${instance.id}`,
		label: `${instance.label} · ${instance.platform}`,
		hint: `${instance.id} · ${instance.enabled ? "enabled" : "disabled"} · ${instanceState(instance, statuses)} · profile ${instance.agentProfile}`,
		control: { k: "action", label: "Open", act: "open" },
	};
}

function profileRow(profile: ImAgentProfile): RuntimeRowSpec {
	return {
		id: `profile:${profile.id}`,
		label: profile.label,
		hint: `${profile.id} · ${targetKey(profile.location)}${profile.model ? ` · ${profile.model.provider}/${profile.model.model}` : ""}`,
		control: { k: "action", label: "Open", act: "open" },
	};
}

function bindingRow(binding: ImBinding, conversations: readonly RuntimeConversation[]): RuntimeRowSpec {
	const conversation = conversations.find(row => row.id === binding.sessionId);
	return {
		id: `binding:${binding.id}`,
		label: `${binding.instanceId} · ${binding.chatId}`,
		hint: `${binding.role} · ${conversation?.name ?? binding.sessionId} · ${targetKey(binding.target)}${binding.needsReview ? ` · needs review: ${binding.needsReviewReason ?? "unresolved"}` : ""}`,
		control: { k: "action", label: "Open", act: "open" },
	};
}

function conversationRow(conversation: RuntimeConversation): RuntimeRowSpec {
	return {
		id: `conversation:${conversation.id}`,
		label: conversation.name,
		hint: `${conversation.targetDisplay} · ${conversation.attached ? "attached" : "not attached"} · ${conversation.available ? "available" : "unavailable"} · ${conversation.entrances} entrances${conversation.reason ? ` · ${conversation.reason}` : ""}`,
		control: { k: "action", label: "View", act: "open" },
	};
}

/** The IM page overview: every runtime family with a clear empty row when unset. */
export function imRuntimeOverview(snapshot: ImRuntimeSnapshot): ImOverview {
	const empty = snapshot.instances.length + snapshot.profiles.length + snapshot.bindings.length;
	const lead =
		empty === 0
			? "No IM runtime is configured. Add bot instances and Agent Profiles in the serve gateway, then refresh."
			: `${snapshot.instances.length} instances · ${snapshot.profiles.length} profiles · ${snapshot.bindings.length} bindings · ${snapshot.conversations.length} conversations. Secrets stay out of this page.`;
	return {
		lead,
		sections: [
			{
				id: "instances",
				title: "Bot instances",
				rows:
					snapshot.instances.length > 0
						? snapshot.instances.map(instance => instanceRow(instance, snapshot.statuses))
						: [emptyRow("instances-empty", "No bot instances configured", "Add one in the serve gateway")],
			},
			{
				id: "profiles",
				title: "Agent Profiles",
				rows:
					snapshot.profiles.length > 0
						? snapshot.profiles.map(profileRow)
						: [emptyRow("profiles-empty", "No Agent Profiles configured", "Add one in the serve gateway")],
			},
			{
				id: "bindings",
				title: "Chat bindings",
				rows:
					snapshot.bindings.length > 0
						? snapshot.bindings.map(binding => bindingRow(binding, snapshot.conversations))
						: [
								emptyRow(
									"bindings-empty",
									"No chat bindings configured",
									"Bindings attach a chat to an existing native conversation",
								),
							],
			},
			{
				id: "conversations",
				title: "Native conversations",
				rows:
					snapshot.conversations.length > 0
						? snapshot.conversations.map(conversationRow)
						: [
								emptyRow(
									"conversations-empty",
									"No native conversations available",
									"Start a session in zetacode serve first",
								),
							],
			},
		],
	};
}

/** The editable draft a binding starts from. */
export function bindingDraftFrom(binding: ImBinding): BindingDraft {
	return {
		id: binding.id,
		instanceId: binding.instanceId,
		chatId: binding.chatId,
		threadId: binding.threadId ?? "",
		userId: binding.userId ?? "",
		agentProfileId: binding.agentProfileId,
		conversationId: binding.sessionId,
		role: binding.role,
		...(binding.lang ? { lang: binding.lang } : {}),
	};
}
