import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "yaml";

export function syncOmpCliModelsYaml(
  agentDir: string,
  customProviders: Record<string, Record<string, unknown>>,
): void {
  const modelsYamlPath = join(agentDir, "models.yml");
  let existing: Record<string, unknown> = {};
  if (existsSync(modelsYamlPath)) {
    try {
      const parsed = yaml.parse(readFileSync(modelsYamlPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
    } catch {
      // overwrite an invalid legacy file with the current web configuration
    }
  }

  const next = yaml.stringify({
    ...existing,
    // models.json is the web editor's source of truth. Replace the provider map
    // so deleting a provider in the web UI also deletes its CLI entry.
    providers: customProviders,
  });
  let current = "";
  try {
    current = readFileSync(modelsYamlPath, "utf8");
  } catch {
    // file will be created below
  }
  if (current !== next) writeFileSync(modelsYamlPath, next, "utf8");
}
