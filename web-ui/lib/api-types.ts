export type ResourceDiagnostic = {
  type: "error" | "warning" | "info";
  message: string;
  path?: string;
};

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: ResourceDiagnostic[];
  projectResourcesLoaded: boolean;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

// ── Models catalog / discovery (/api/models-config/*) ────────────────────────

export interface DiscoveredModel {
  id: string;
  name?: string;
}

export interface ModelCatalogCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelCatalogPreset {
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCatalogCost;
}

export type ModelCatalogMatchMethod =
  | "provider"
  | "base-url"
  | "consensus"
  | "none";

export type ModelCatalogPriceRecommendation =
  | {
      status: "reliable";
      method: Exclude<ModelCatalogMatchMethod, "none">;
      cost: ModelCatalogCost;
      providerId?: string;
      providerName?: string;
      support: number;
      total: number;
    }
  | {
      status: "unreliable";
      reason:
        | "no-exact-match"
        | "no-valid-price"
        | "insufficient-support"
        | "conflict";
      support: number;
      total: number;
    };

export interface ModelCatalogRecommendation {
  exactMatches: number;
  metadataMethod: ModelCatalogMatchMethod;
  matchedProviderId?: string;
  matchedProviderName?: string;
  preset: ModelCatalogPreset;
  price: ModelCatalogPriceRecommendation;
}
