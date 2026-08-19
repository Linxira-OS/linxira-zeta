/**
 * Client for the web-gateway `/api/settings` endpoint.
 *
 * GET returns the settings schema metadata (tabs, groups, per-setting rows)
 * with current values and localized labels; PUT updates one setting by path.
 * All label/description localization happens on the gateway side — this
 * module never builds its own translation table.
 */

export type SettingsType = "boolean" | "enum" | "submenu" | "text" | "providerLimits" | "multiselect";

export interface SettingsOptionInfo {
  value: string;
  label: string;
  description?: string;
}

export interface SettingEntry {
  path: string;
  type: SettingsType;
  label: string;
  description?: string;
  tab: string;
  group?: string;
  value: unknown;
  default?: unknown;
  /** True for credentials — the value must be masked and never rendered. */
  secret?: boolean;
  options?: SettingsOptionInfo[];
  /** Condition-gated rows are hidden when false. */
  visible: boolean;
  /** Enum values (when the setting has no labeled options). */
  values?: string[];
}

export interface SettingsTabInfo {
  id: string;
  label: string;
}

export interface SettingsResponse {
  tabs: SettingsTabInfo[];
  /** Localized group headings per tab, in render order. */
  groups: Record<string, string[]>;
  settings: SettingEntry[];
}

/** Map the web UI locale onto the gateway's supported `lang` values. */
export function settingsLang(locale: string): "en" | "zh" {
  return locale === "zh-CN" ? "zh" : "en";
}

/** Fetch the settings catalog for a language. */
export async function fetchSettings(lang: "en" | "zh"): Promise<SettingsResponse> {
  const res = await fetch(`/api/settings?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SettingsResponse;
}

/** Persist a single setting value; throws Error with the server message on failure. */
export async function updateSetting(path: string, value: unknown): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, value }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { errorMessage?: string };
      if (typeof body.errorMessage === "string" && body.errorMessage !== "") {
        message = body.errorMessage;
      }
    } catch {
      // non-JSON error body — keep the HTTP status message
    }
    throw new Error(message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Web config (`~/.zeta/agent/web.yml`, served at /api/web-config)
// ═══════════════════════════════════════════════════════════════════════════

export interface WebConfigChannel {
  enabled: boolean;
  botToken?: string;
  ilinkBotId?: string;
  ilinkUserId?: string;
  baseUrl?: string;
  appId?: string;
  appSecret?: string;
  domain?: "feishu" | "lark";
}

export interface WebConfigData {
  tray: { minimizeToTray: boolean; autostart: boolean };
  channels: {
    wechat: WebConfigChannel;
    feishu: WebConfigChannel;
    telegram: WebConfigChannel;
  };
  remote: { host?: string; token?: string; workspaces?: string[] };
}

/** Fetch the merged web-layer config (secrets arrive masked). */
export async function fetchWebConfig(): Promise<WebConfigData> {
  const res = await fetch("/api/web-config");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as WebConfigData;
}

/** Persist one web-config dot path; throws Error with the server message on failure. */
export async function updateWebConfig(path: string, value: unknown): Promise<void> {
  const res = await fetch("/api/web-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, value }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error !== "") {
        message = body.error;
      }
    } catch {
      // non-JSON error body — keep the HTTP status message
    }
    throw new Error(message);
  }
}
