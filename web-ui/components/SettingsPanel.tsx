"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import {
  fetchSettings,
  settingsLang,
  updateSetting,
  type SettingEntry,
  type SettingsResponse,
} from "@/lib/settings-client";

// Tabs with full inline editing. The remaining tabs render read-only rows
// (label + current value) with a CLI /settings hint until a later phase.
const EDITABLE_TABS: ReadonlySet<string> = new Set(["appearance", "model", "tools"]);

// Settings whose effect lands in the terminal CLI rather than the web UI.
function isTerminalEffect(path: string): boolean {
  return (
    path === "language" ||
    path === "symbolPreset" ||
    path === "colorBlindMode" ||
    path.startsWith("theme.") ||
    path.startsWith("statusLine.")
  );
}

const ZETA_LOCALE_STORAGE_KEY = "zeta-locale";

const inputStyle = {
  padding: "6px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box" as const,
};

/** Render a setting's current value as display text for read-only rows. */
function formatValue(entry: SettingEntry): string {
  const { value } = entry;
  if (entry.secret) return "••••";
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "—";
    return entries.map(([key, v]) => `${key}: ${String(v)}`).join(", ");
  }
  const text = String(value);
  return text === "" ? "—" : text;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        padding: 0,
        border: "none",
        flexShrink: 0,
        position: "relative",
        cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--accent)" : "var(--border)",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#fff",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}

/** Array-of-enum setting edited as a checkbox list. */
function MultiSelectEditor({ entry, value, onCommit }: { entry: SettingEntry; value: string[]; onCommit: (next: string[]) => void }) {
  const options = entry.options ?? [];
  const toggle = (option: string) => {
    const next = value.includes(option) ? value.filter((v) => v !== option) : [...value, option];
    onCommit(next);
  };
  if (options.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatValue(entry)}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%" }}>
      {options.map((option) => {
        const checked = value.includes(option.value);
        return (
          <label key={option.value} style={{ display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer", fontSize: 12, color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(option.value)}
              style={{ width: 13, height: 13, accentColor: "var(--accent)", marginTop: 1, cursor: "pointer" }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span>{option.label}</span>
              {option.description && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{option.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * `providers.maxInFlightRequests` editor: one numeric input per provider id,
 * matching the CLI's provider-limits submenu (empty input removes the entry,
 * values clamp to >= 1). Omitted providers are unlimited.
 */
function ProviderLimitsEditor({ value, onCommit }: { value: Record<string, number>; onCommit: (next: Record<string, number>) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newLimit, setNewLimit] = useState("");

  const providers = useMemo(() => Object.keys(value).sort((a, b) => a.localeCompare(b)), [value]);

  const commitProvider = (provider: string, raw: string) => {
    const next = { ...value };
    const trimmed = raw.trim();
    if (trimmed === "") {
      delete next[provider];
    } else {
      const limit = Number(trimmed);
      if (!Number.isFinite(limit) || limit <= 0) return; // invalid — keep the draft for correction
      next[provider] = Math.max(1, Math.floor(limit));
    }
    setDrafts((d) => {
      const nd = { ...d };
      delete nd[provider];
      return nd;
    });
    onCommit(next);
  };

  const addProvider = () => {
    const name = newName.trim();
    const limit = Number(newLimit.trim());
    if (name === "" || !Number.isFinite(limit) || limit <= 0) return;
    onCommit({ ...value, [name]: Math.max(1, Math.floor(limit)) });
    setNewName("");
    setNewLimit("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      {providers.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>No limits set — omitted providers are unlimited.</div>
      )}
      {providers.map((provider) => (
        <div key={provider} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code style={{ flex: 1, fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{provider}</code>
          <input
            type="number"
            min={1}
            value={drafts[provider] ?? String(value[provider] ?? "")}
            onChange={(e) => setDrafts((d) => ({ ...d, [provider]: e.target.value }))}
            onBlur={(e) => commitProvider(provider, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="∞"
            aria-label={`${provider} max in-flight requests`}
            style={{ ...inputStyle, width: 90, fontFamily: "var(--font-mono)", flexShrink: 0 }}
          />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="provider id (e.g. openai)"
          style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)" }}
        />
        <input
          type="number"
          min={1}
          value={newLimit}
          onChange={(e) => setNewLimit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addProvider();
          }}
          placeholder="limit"
          style={{ ...inputStyle, width: 90, fontFamily: "var(--font-mono)", flexShrink: 0 }}
        />
        <button
          type="button"
          onClick={addProvider}
          disabled={newName.trim() === "" || newLimit.trim() === ""}
          style={{
            padding: "6px 12px",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: "var(--text-muted)",
            cursor: newName.trim() === "" || newLimit.trim() === "" ? "default" : "pointer",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

interface SettingRowProps {
  entry: SettingEntry;
  value: unknown;
  draft: string | undefined;
  error: string | undefined;
  pending: boolean;
  revealed: boolean;
  terminalNote: boolean;
  onCommit: (value: unknown) => void;
  onDraft: (text: string) => void;
  onReveal: () => void;
}

function SettingRow({ entry, value, draft, error, pending, revealed, terminalNote, onCommit, onDraft, onReveal }: SettingRowProps) {
  const wide = entry.type === "providerLimits" || entry.type === "multiselect";

  const renderControl = () => {
    switch (entry.type) {
      case "boolean":
        return <Toggle checked={Boolean(value)} label={entry.label} onChange={onCommit} />;
      case "enum": {
        const current = String(value ?? "");
        return (
          <select value={current} onChange={(e) => onCommit(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 180 }}>
            {(entry.values ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      }
      case "submenu": {
        const options = entry.options ?? [];
        if (options.length === 0) {
          // Runtime options (e.g. theme names) — free-text fallback.
          return (
            <input
              value={draft ?? String(value ?? "")}
              onChange={(e) => onDraft(e.target.value)}
              onBlur={(e) => {
                if (e.target.value !== String(value ?? "")) onCommit(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
            />
          );
        }
        const current = String(value ?? "");
        const missing = current !== "" && !options.some((o) => o.value === current);
        return (
          <select value={current} onChange={(e) => onCommit(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 180 }}>
            {missing && <option value={current}>{current}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      }
      case "text": {
        const display = draft ?? (entry.secret ? "" : String(value ?? ""));
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
            <input
              type={entry.secret && !revealed ? "password" : "text"}
              value={display}
              placeholder={entry.secret ? "••••" : undefined}
              onChange={(e) => onDraft(e.target.value)}
              onBlur={(e) => {
                const next = e.target.value;
                if (entry.secret ? next !== "" : next !== String(value ?? "")) onCommit(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              style={{ ...inputStyle, fontFamily: entry.secret ? "var(--font-mono)" : "inherit" }}
            />
            {entry.secret && (
              <button
                type="button"
                onClick={onReveal}
                title={revealed ? "Hide" : "Show"}
                aria-label={revealed ? "Hide value" : "Show value"}
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {revealed ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
                    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                    <path d="M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            )}
          </div>
        );
      }
      case "providerLimits":
        return <ProviderLimitsEditor value={(value as Record<string, number> | undefined) ?? {}} onCommit={onCommit} />;
      case "multiselect":
        return <MultiSelectEditor entry={entry} value={(value as string[] | undefined) ?? []} onCommit={onCommit} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{entry.label}</span>
        {!wide && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {pending && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Saving…</span>}
            {renderControl()}
          </div>
        )}
      </div>
      {entry.description && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{entry.description}</div>
      )}
      {terminalNote && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Takes effect in the terminal CLI</div>}
      {wide && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
          {pending && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Saving…</span>}
          {renderControl()}
        </div>
      )}
      {error && <div style={{ fontSize: 11.5, color: "#f87171" }}>Save failed: {error}</div>}
    </div>
  );
}

export interface SettingsPanelProps {
  onClose: () => void;
  /** Opens the existing ModelsConfig modal on top (model tab chains to it). */
  onOpenModelsConfig: () => void;
}

export function SettingsPanel({ onClose, onOpenModelsConfig }: SettingsPanelProps) {
  const isMobile = useIsMobile();
  const { locale, setLocale, t } = useI18n();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("appearance");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const lang = settingsLang(locale);

  const load = useCallback(async (lang: "en" | "zh") => {
    setLoadError(null);
    try {
      const next = await fetchSettings(lang);
      setData(next);
      setValues(Object.fromEntries(next.settings.map((s): [string, unknown] => [s.path, s.value])));
      setDrafts({});
      setErrors({});
      setActiveTab((cur) => (next.tabs.some((tab) => tab.id === cur) ? cur : next.tabs[0]?.id ?? "appearance"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(lang);
  }, [lang, load]);

  // Escape closes the modal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const commit = useCallback(
    async (path: string, value: unknown) => {
      setPending((p) => ({ ...p, [path]: true }));
      setErrors((e) => {
        const next = { ...e };
        delete next[path];
        return next;
      });
      try {
        await updateSetting(path, value);
        setValues((v) => ({ ...v, [path]: value }));
        if (path === "language") {
          const nextLocale = value === "zh" ? "zh-CN" : "en";
          try {
            window.localStorage.setItem(ZETA_LOCALE_STORAGE_KEY, nextLocale);
          } catch {
            // storage unavailable — the in-page switch still applies
          }
          setLocale(nextLocale);
        }
      } catch (err) {
        setErrors((e) => ({ ...e, [path]: err instanceof Error ? err.message : String(err) }));
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[path];
          return next;
        });
      }
    },
    [setLocale],
  );

  const editable = EDITABLE_TABS.has(activeTab);
  const tabSettings = useMemo(
    () => (data ? data.settings.filter((s) => s.tab === activeTab && s.visible) : []),
    [data, activeTab],
  );
  const groupOrder = data?.groups[activeTab] ?? [];
  const ungrouped = tabSettings.filter((s) => s.group === undefined);
  const grouped = groupOrder
    .map((group) => ({ group, items: tabSettings.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0);

  const renderRow = (entry: SettingEntry) => {
    if (!editable) {
      return (
        <div key={entry.path} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{entry.label}</span>
            <code style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{formatValue(entry)}</code>
          </div>
          {entry.description && <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{entry.description}</div>}
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Configure via CLI: /settings</div>
        </div>
      );
    }
    return (
      <SettingRow
        key={entry.path}
        entry={entry}
        value={values[entry.path]}
        draft={drafts[entry.path]}
        error={errors[entry.path]}
        pending={pending[entry.path] === true}
        revealed={revealed[entry.path] === true}
        terminalNote={isTerminalEffect(entry.path)}
        onCommit={(next) => void commit(entry.path, next)}
        onDraft={(text) => setDrafts((d) => ({ ...d, [entry.path]: text }))}
        onReveal={() => setRevealed((r) => ({ ...r, [entry.path]: !r[entry.path] }))}
      />
    );
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 760,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Settings</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.zeta/agent/config.yml</code>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        {data && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0, overflowX: "auto", background: "var(--bg-panel)" }}>
            {data.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={activeTab === tab.id}
                style={{
                  padding: "5px 11px",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  background: activeTab === tab.id ? "var(--bg-selected)" : "transparent",
                  color: activeTab === tab.id ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
          {loadError ? (
            <div style={{ padding: 24, fontSize: 12.5, color: "#f87171", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <span>Failed to load settings: {loadError}</span>
              <button
                type="button"
                onClick={() => void load(lang)}
                style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", cursor: "pointer", fontSize: 12 }}
              >
                Retry
              </button>
            </div>
          ) : !data ? (
            <div style={{ padding: 24, fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>
          ) : (
            <>
              {activeTab === "model" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 14px",
                    background: "var(--accent-muted)",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  <span style={{ lineHeight: 1.45 }}>{t("configure-provider-models-via-the-models-configu")}</span>
                  <button
                    type="button"
                    onClick={onOpenModelsConfig}
                    style={{
                      padding: "5px 12px",
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text)",
                      cursor: "pointer",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {t("models")} →
                  </button>
                </div>
              )}
              {ungrouped.map(renderRow)}
              {grouped.map(({ group, items }) => (
                <div key={group}>
                  <div
                    style={{
                      padding: "10px 14px 6px",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      background: "var(--bg)",
                    }}
                  >
                    {group}
                  </div>
                  {items.map(renderRow)}
                </div>
              ))}
              {tabSettings.length === 0 && <div style={{ padding: 24, fontSize: 12.5, color: "var(--text-muted)" }}>No settings in this tab.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
