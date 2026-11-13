import { BUILTIN_TOOL_NAMES } from "./builtin-names";
import { cfgToolsDisabled, cfgToolsProfile } from "./settings";
import type { Settings } from "../config/settings";

const BUILTINS = new Set<string>(BUILTIN_TOOL_NAMES);

/** Documented preset expansion. `full` is handled separately (no upper bound). */
const TIER_TOOLS: Record<"super-minimal" | "minimal" | "standard", ReadonlySet<string>> = {
	"super-minimal": new Set(["read", "write", "edit", "bash"]),
	minimal: new Set(["read", "write", "edit", "bash", "web_search"]),
	standard: new Set([
		"read",
		"write",
		"edit",
		"bash",
		"web_search",
		"glob",
		"grep",
		"find",
		"task",
		"wait",
		"todo",
		"ask",
	]),
};

/** `tools.disabled` is absolute for every tool family. */
export function isToolDisabledBySettings(name: string, settings: Settings): boolean {
	return cfgToolsDisabled.get(settings).includes(name);
}

/**
 * Built-in admission for the configured tier. Hidden/internal names (`yield`,
 * `goal`, `think`) and non-built-in tools are not tier-limited; `tools.disabled`
 * still subtracts them.
 */
export function isBuiltinAllowedByToolProfile(name: string, settings: Settings): boolean {
	if (isToolDisabledBySettings(name, settings)) return false;
	const profile = cfgToolsProfile.get(settings);
	if (profile === "full") return true;
	if (!BUILTINS.has(name)) return true;
	return TIER_TOOLS[profile].has(name);
}
