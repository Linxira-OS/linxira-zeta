import { createHash } from "node:crypto";
import { findScopedSettings, Settings, withActiveSettings } from "../../config/settings.js";
import { currentRuntimeIdentity } from "../../session/runtime-identity.js";
import { BUILTIN_SLASH_COMMANDS_INTERNAL } from "../../slash-commands/builtin-registry.js";
import { resolveCommandDescription } from "../../slash-commands/helpers/description.js";
import { canonicalJson } from "./protocol/canonical-json.js";
import { currentStudioSelection } from "./selection.js";
import type { OperatorCommandManifest, OperatorCommandManifestEntry } from "./protocol/contracts/manifests.js";

type Classification = Pick<OperatorCommandManifestEntry, "risk" | "effect">;
const classifications = new Map<string, Classification>();
function classify(risk: Classification["risk"], effect: Classification["effect"], names: string): void {
	for (const name of names.split(" ")) classifications.set(name, { risk, effect });
}

// A row covers every supported subcommand, not only the bare/status invocation.
classify("normal", "read", "changelog tools context dirs team hotkeys extensions agents hub tree sidebar");
classify(
	"normal",
	"session",
	"plan plan-ultra plan-review vibe lead goal guided-goal queue model switch fast slow effort computer ratchet prewalk advisor fresh compact shake handoff seance retry rename new resume branch fork btw teamworker",
);
classify("normal", "workspace", "add-dir remove-dir git local tracking");
classify("normal", "process", "language record pause quit exit restart");
classify(
	"sensitive",
	"process",
	"settings setup skillful extended-context browser modelpreset tool time forget-approvals jobs stats reload-plugins reload-skills live channels",
);
classify("sensitive", "workspace", "security export dump copy open todo cd move wt design initzetateam");
classify("sensitive", "external", "ssh share login logout mcp marketplace plugins skills force loop tan omfg cleanse");
classify("sensitive", "read", "trace debug");
classify("destructive", "session", "session clear delete");
classify("destructive", "workspace", "memory edits");
classify("destructive", "process", "usage");
classify("normal", "session", "pin unpin");

/** One projection for bootstrap identity and the slash/capability catalog. */
export function buildOperatorCommandManifest(instance?: Settings): OperatorCommandManifest {
	let effective = instance ?? findScopedSettings();
	const commands: OperatorCommandManifestEntry[] = [];
	const unclassifiedBuiltins: string[] = [];
	for (const spec of BUILTIN_SLASH_COMMANDS_INTERNAL) {
		if (spec.hidden) continue;
		if (spec.enabled) {
			effective ??= Settings.isolated();
			if (!spec.enabled(effective)) continue;
		}
		const classification = classifications.get(spec.name);
		if (classification === undefined) unclassifiedBuiltins.push(spec.name);
		const description = withActiveSettings(effective, () =>
			resolveCommandDescription(spec.acpDescription ?? spec.description),
		);
		commands.push({
			id: `builtin.${spec.name}`,
			name: spec.name,
			aliases: [...(spec.aliases ?? [])],
			description,
			source: "builtin",
			implementation: spec.handle === undefined ? "tui-compatibility" : "headless-handle",
			...(spec.allowArgs ? { argumentSchema: { type: "string" } } : {}),
			interactionKinds: [],
			presentation: spec.handle === undefined ? "terminal" : "generic-form",
			availability: classification === undefined ? "blocked" : "available",
			...(classification ?? { risk: "sensitive", effect: "process" }),
			contractTestId: "studio-host-command-manifest",
		});
	}
	commands.sort((a, b) => a.id.localeCompare(b.id));
	unclassifiedBuiltins.sort();
	const identity = currentRuntimeIdentity();
	const upstreamCommit = identity.commit ?? `zeta/${identity.version}`;
	return {
		generatedAt: new Date().toISOString(),
		upstreamCommit,
		hash: createHash("sha256")
			.update(canonicalJson({ upstreamCommit, commands, unclassifiedBuiltins }))
			.digest("hex"),
		commands,
		unclassifiedBuiltins,
	};
}

/** Drafts resolve project settings without creating or selecting a Runtime. */
export async function readOperatorCommandManifest(): Promise<OperatorCommandManifest> {
	const selection = currentStudioSelection();
	if (selection === undefined) return buildOperatorCommandManifest();
	const { resolveWorkspacePath } = await import("./ops/workspace.js");
	const cwd = await resolveWorkspacePath(selection.workspaceId);
	const instance = await Settings.loadReadOnly({ cwd });
	return buildOperatorCommandManifest(instance);
}
