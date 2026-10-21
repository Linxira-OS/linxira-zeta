import { existsSync } from "node:fs";
import { YAML } from "bun";

const YAML_MAPPING_HEADER_TRAILING_SPACE = /: +$/gm;

/**
 * Resolve a canonical `.yml` config path for reading: the canonical path wins
 * when it exists, otherwise a present `.yaml` sibling is used. Writes must keep
 * targeting the canonical path — the sibling is a read-only compatibility
 * fallback, matching `ConfigFile`.
 */
export function resolveYamlConfigReadPath(canonicalPath: string): string {
	if (!canonicalPath.endsWith(".yml")) return canonicalPath;
	const sibling = `${canonicalPath.slice(0, -4)}.yaml`;
	return existsSync(canonicalPath) || !existsSync(sibling) ? canonicalPath : sibling;
}

/** Serialize config YAML without Bun's trailing space on block mapping headers. */
export function stringifyYamlConfig(value: unknown): string {
	return YAML.stringify(value, null, 2).replace(YAML_MAPPING_HEADER_TRAILING_SPACE, ":");
}
