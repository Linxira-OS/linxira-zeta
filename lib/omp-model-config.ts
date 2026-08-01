import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import yaml from "yaml";
import { getOmpAgentDir } from "./file-paths";

export interface OmpModelsConfig {
  providers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export function getOmpModelsConfigPath(agentDir: string = getOmpAgentDir()): string {
  return join(agentDir, "models.yml");
}

export function readOmpModelsConfig(agentDir: string = getOmpAgentDir()): OmpModelsConfig {
  const yamlPath = getOmpModelsConfigPath(agentDir);
  const candidates = [
    { path: yamlPath, parse: (content: string) => yaml.parse(content) },
    // Compatibility fallback for installations that have not saved through the web editor yet.
    { path: join(agentDir, "models.json"), parse: (content: string) => JSON.parse(content) },
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    try {
      const parsed = candidate.parse(readFileSync(candidate.path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const config = parsed as OmpModelsConfig;
        if (config.providers === undefined || (config.providers && typeof config.providers === "object" && !Array.isArray(config.providers))) {
          return config;
        }
      }
    } catch {
      // Try the next configuration format.
    }
  }
  return {};
}

export function writeOmpModelsConfig(data: Record<string, unknown>, agentDir: string = getOmpAgentDir()): string {
  const path = getOmpModelsConfigPath(agentDir);
  const current = readOmpModelsConfig(agentDir);
  const providers = data.providers && typeof data.providers === "object" && !Array.isArray(data.providers)
    ? data.providers as Record<string, Record<string, unknown>>
    : current.providers ?? {};
  const next: OmpModelsConfig = { ...current, ...data, providers };
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, yaml.stringify(next), "utf8");
  return path;
}
