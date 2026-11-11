import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
	AgentProfilePersona,
	ImAgentProfileConfig,
	ImAgentProfileRuntimeContext,
	ImAgentProfileRuntimeOptions,
} from "./types";

/**
 * Reversible, injective path segment.
 *
 * Lowercasing/collapsing separators would map `a:b`, `a-b`, and `A:B` to one
 * directory, letting distinct instances/profile/bindings share state. Every
 * byte outside `[A-Za-z0-9._-]` is percent-style encoded as `~HH`; `~` itself is
 * encoded, so the mapping is injective and case-preserving.
 */
export function agentProfileSegment(value: string): string {
	let out = "";
	for (const byte of new TextEncoder().encode(value)) {
		const ch = String.fromCharCode(byte);
		const safe =
			(byte >= 48 && byte <= 57) ||
			(byte >= 65 && byte <= 90) ||
			(byte >= 97 && byte <= 122) ||
			byte === 46 ||
			byte === 95 ||
			byte === 45;
		out += safe ? ch : `~${byte.toString(16).padStart(2, "0").toUpperCase()}`;
	}
	if (out.length === 0) return "_";
	if (out === "." || out === "..") return `_${out}`;
	return out;
}

/** Runtime identity for one conversation binding. */
export function imAgentRuntimeId(instanceId: string, profileId: string, bindingId: string): string {
	return `im:${instanceId}:${profileId}:${bindingId}`;
}

function expandHome(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "~") return os.homedir();
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return path.join(os.homedir(), trimmed.slice(2));
	return path.resolve(trimmed);
}

function dedupeNames(values: readonly string[] | undefined): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of values ?? []) {
		const name = raw.trim();
		if (name.length === 0 || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

/**
 * Read the profile's persona once, at session creation.
 *
 * `workspace` deliberately returns `undefined`: that mode means "use the
 * workspace's own PERSONA.md", which the system prompt already loads only when
 * `workspaceContext` is on. A missing `file` is an error, not a silent empty
 * persona, because the operator asked for that exact document.
 */
export async function loadImAgentProfilePersona(
	profile: ImAgentProfileConfig,
	options: { cwd: string },
): Promise<string | undefined> {
	const persona = profile.persona;
	if (!persona || persona.mode === "workspace") return undefined;
	if (persona.mode === "inline") {
		const text = persona.text?.trim();
		return text && text.length > 0 ? text : undefined;
	}
	if (!persona.file?.trim()) throw new Error(`Agent profile "${profile.id}" persona.mode is "file" but file is empty`);
	const file = expandHome(persona.file);
	try {
		const text = (await fs.readFile(file, "utf8")).trim();
		return text.length > 0 ? text : undefined;
	} catch (error) {
		throw new Error(
			`Agent profile "${profile.id}" persona file is unreadable: ${file} (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}

/**
 * Compile a profile into the exact SDK options for one runtime.
 *
 * Every optional add-on list becomes an explicit `[]` here. That is the
 * difference between "profile says none" and "nothing was configured, so keep
 * yesterday's ambient behavior" — the latter must never happen for a profile.
 */
export function resolveImAgentProfileRuntime(
	profile: ImAgentProfileConfig,
	context: ImAgentProfileRuntimeContext,
): ImAgentProfileRuntimeOptions {
	if (profile.id !== context.profileId) {
		throw new Error(`Agent profile id mismatch: config "${profile.id}" vs context "${context.profileId}"`);
	}
	const runtimeId = imAgentRuntimeId(context.instanceId, context.profileId, context.bindingId);
	const agentHome = path.join(
		context.agentDir,
		"im-agents",
		agentProfileSegment(context.instanceId),
		agentProfileSegment(context.profileId),
		agentProfileSegment(context.bindingId),
	);
	const explicitNamespace = profile.memory?.namespace?.trim();
	// `namespace` is a user-visible label; it is never authoritative on its own.
	// The binding suffix keeps two chats apart even when a profile or a hand-
	// edited config repeats the same label.
	const memoryNamespace = explicitNamespace
		? `${explicitNamespace}@${context.bindingId}`
		: `im:${context.instanceId}:${context.profileId}:${context.bindingId}`;
	const persona: AgentProfilePersona | undefined = context.personaText?.trim()
		? { appendSystemPrompt: context.personaText.trim() }
		: undefined;
	const toolPolicy = {
		builtin: dedupeNames(profile.tools.builtin),
		extensions: dedupeNames(profile.tools.extensions),
		customTools: dedupeNames(profile.tools.customTools),
		mcpServers: dedupeNames(profile.tools.mcpServers),
		...(profile.tools.mcpTools === undefined ? {} : { mcpTools: dedupeNames(profile.tools.mcpTools) }),
		skills: dedupeNames(profile.tools.skills),
		commands: dedupeNames(profile.tools.commands),
		...(profile.tools.approvalMode === undefined ? {} : { approvalMode: profile.tools.approvalMode }),
	};
	const pluginHome = path.join(agentHome, "plugins");
	const approvalCacheDir = path.join(agentHome, "approvals");
	const options: ImAgentProfileRuntimeOptions = {
		profileId: context.profileId,
		agentRuntimeId: runtimeId,
		toolPolicy,
		...(persona === undefined ? {} : { persona }),
		memoryNamespace,
		...(profile.memory?.backend === undefined ? {} : { memoryBackend: profile.memory.backend }),
		pluginHome,
		approvalCacheDir,
		workspaceContext: profile.memory?.workspaceContext === true,
		...(profile.model === undefined ? {} : { model: `${profile.model.provider}/${profile.model.model}` }),
		agentHome,
		cwd: context.cwd,
	};
	return options;
}
