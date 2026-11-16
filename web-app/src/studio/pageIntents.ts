import type { MediaKind } from "@linxiraos/studio-protocol"
import { isRealSubagentId } from "./conversation/toolMeta";

// Navigation callers must not load the destination page just to leave an intent.
export const MC_INTENT_KEY = "zeta.modelConfigIntent";
export const CAP_INTENT_KEY = "zeta.capIntent";
export const SETTINGS_INTENT_KEY = "zeta.settingsIntent";
export const DIAGNOSTICS_INTENT_KEY = "zeta.diagnosticsIntent";
export const HUB_INTENT_KEY = "zeta.hubIntent";
export const MEDIA_INTENT_KEY = "zeta.mediaIntent";

export type McTab = "providers" | "visibility" | "roles" | "subagents" | "websearch" | "presets" | "accounts";
export type McIntent = { tab?: McTab; edit?: string; role?: string; assign?: string; agent?: string };
export type CapTab = "skills" | "plugins" | "mcp" | "slash" | "ida" | "resources";
export type CapIntent = { tab?: CapTab; name?: string };
export type SettingsGroupId = "general" | "appearance" | "interaction" | "voice" | "permissions" | "context" | "files" | "tasks" | "models" | "maintenance" | "unsupported" | "background" | "advanced" | "native" | "imRuntime" | "security" | "catalog";
export type SettingsIntent = { group: SettingsGroupId; setting?: string };
export type DiagnosticsIntent = "check-update" | "reconnect" | "restart";
export type HubTab = "overview" | "transcript" | "jobs" | "messages" | "btw";
export type HubIntentTab = HubTab | "chat";

const CAP_TABS: ReadonlyArray<CapTab> = ["skills", "plugins", "mcp", "slash", "ida", "resources"];
const SETTINGS_GROUPS: ReadonlyArray<SettingsGroupId> = ["general", "appearance", "interaction", "voice", "permissions", "context", "files", "tasks", "models", "maintenance", "unsupported", "background", "advanced", "native", "imRuntime", "security", "catalog"];

export function normalizeSettingsGroupId(value: string): SettingsGroupId | null {
  if (value === "channels") return "imRuntime";
  return SETTINGS_GROUPS.includes(value as SettingsGroupId) ? value as SettingsGroupId : null;
}
const DIAGNOSTICS_INTENTS: ReadonlySet<string> = new Set(["check-update", "reconnect", "restart"]);

export function setModelConfigIntent(intent: McIntent): void {
  try {
    sessionStorage.setItem(MC_INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* ignore */
  }
}

export function takeModelConfigIntent(): McIntent | null {
  try {
    const raw = sessionStorage.getItem(MC_INTENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(MC_INTENT_KEY);
    return JSON.parse(raw) as McIntent;
  } catch {
    return null;
  }
}

export function setCapIntent(tab: CapTab, name?: string): void {
  try {
    sessionStorage.setItem(CAP_INTENT_KEY, JSON.stringify({ tab, name: name ?? null }));
  } catch {
    /* sessionStorage may be blocked; navigation still opens the page. */
  }
}

export function takeCapIntent(): CapIntent | null {
  try {
    const raw = sessionStorage.getItem(CAP_INTENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CAP_INTENT_KEY);
    const value = JSON.parse(raw) as { tab?: unknown; name?: unknown };
    const tab = CAP_TABS.some((id) => id === value.tab) ? value.tab as CapTab : undefined;
    const name = typeof value.name === "string" ? value.name : undefined;
    return { ...(tab ? { tab } : {}), ...(name ? { name } : {}) };
  } catch {
    return null;
  }
}

export function setSettingsIntent(group: SettingsGroupId, setting?: string): void {
  try {
    sessionStorage.setItem(SETTINGS_INTENT_KEY, JSON.stringify({ group, ...(setting ? { setting } : {}) }));
  } catch {
    /* sessionStorage may be blocked; navigation still opens the page. */
  }
}

export function takeSettingsIntent(): SettingsIntent | null {
  try {
    const raw = sessionStorage.getItem(SETTINGS_INTENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SETTINGS_INTENT_KEY);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("group" in value) || typeof value.group !== "string") return null;
    const group = normalizeSettingsGroupId(value.group);
    if (!group) return null;
    return { group, ...("setting" in value && typeof value.setting === "string" ? { setting: value.setting } : {}) };
  } catch {
    return null;
  }
}

export function setDiagnosticsIntent(intent: DiagnosticsIntent): void {
  try {
    sessionStorage.setItem(DIAGNOSTICS_INTENT_KEY, JSON.stringify({ intent }));
  } catch {
    /* sessionStorage may be blocked */
  }
}

export function takeDiagnosticsIntent(): DiagnosticsIntent | null {
  try {
    const raw = sessionStorage.getItem(DIAGNOSTICS_INTENT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DIAGNOSTICS_INTENT_KEY);
    const value = JSON.parse(raw) as { intent?: unknown };
    return typeof value.intent === "string" && DIAGNOSTICS_INTENTS.has(value.intent)
      ? (value.intent as DiagnosticsIntent)
      : null;
  } catch {
    return null;
  }
}

export function setHubIntent(agentId: string, tab?: HubIntentTab): void {
  if (!isRealSubagentId(agentId)) return;
  try {
    const openChat = tab === "chat";
    sessionStorage.setItem(
      HUB_INTENT_KEY,
      JSON.stringify({
        agentId,
        tab: openChat ? null : (tab ?? null),
        ...(openChat ? { chat: true } : {}),
      }),
    );
  } catch {
    /* sessionStorage may be blocked; navigation still opens the hub. */
  }
}

export function setMediaIntent(type: MediaKind): void {
  try {
    sessionStorage.setItem(MEDIA_INTENT_KEY, type);
  } catch {}
}

export function takeMediaIntent(): MediaKind {
  try {
    const value = sessionStorage.getItem(MEDIA_INTENT_KEY);
    sessionStorage.removeItem(MEDIA_INTENT_KEY);
    if (["image", "video", "speech", "transcription"].includes(value ?? ""))
      return value as MediaKind;
  } catch {}
  return "image";
}
