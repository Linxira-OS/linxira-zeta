"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { setRemoteToken } from "@/lib/remote-token";
import {
  fetchSettings,
  fetchWebConfig,
  settingsLang,
  updateSetting,
  updateWebConfig,
  type SettingEntry,
  type SettingsResponse,
  type WebConfigData,
} from "@/lib/settings-client";
import { DocsPanel } from "./DocsPanel";

// Tabs with full inline editing. The remaining tabs render read-only rows
// (label + current value) with a CLI /settings hint until a later phase.
const EDITABLE_TABS: ReadonlySet<string> = new Set([
  "appearance",
  "model",
  "tools",
  "context",
  "shell",
  "providers",
  "memory",
  "tasks",
]);

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

/** Set one dot path inside a web-config copy; returns a new object. */
function setAtPath<T>(obj: T, path: string, value: unknown): T {
  const segments = path.split(".");
  const next = structuredClone(obj) as Record<string, unknown>;
  let current = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (typeof current[segment] !== "object" || current[segment] === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
  return next as T;
}

/** Plain text input; commits on blur/Enter with local draft state. */
function WebPlainInput({
  path,
  value,
  placeholder,
  onCommit,
}: {
  path: string;
  value: string | undefined;
  placeholder: string;
  onCommit: (path: string, value: unknown) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  return (
    <input
      type="text"
      value={draft ?? value ?? ""}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const next = e.target.value.trim();
        setDraft(undefined);
        if (next !== (value ?? "")) onCommit(path, next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      style={{ ...inputStyle, width: 170, fontFamily: "var(--font-mono)" }}
    />
  );
}

/**
 * Credential input backed by the persisted value: shows the saved value
 * (masked for secrets) and never silently discards what the user typed — a
 * failed commit keeps the draft so it can be retried.
 */
const MASK_SENTINEL = "••••";
const MASK_DISPLAY = "••••••••";

function SecretInput({
  path,
  value,
  placeholder,
  mask = true,
  onCommit,
}: {
  path: string;
  value: string | undefined;
  placeholder: string;
  mask?: boolean;
  onCommit: (path: string, value: unknown) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // A stored secret arrives masked ("••••") from the gateway — that sentinel
  // means a secret IS set, so render the masked dots; only undefined/empty
  // means nothing is stored. Never re-commit the placeholder dots on blur.
  const hasStored = value !== undefined && value !== "";
  const display = draft ?? (hasStored ? (mask ? MASK_DISPLAY : value === MASK_SENTINEL ? "" : value) : "");
  return (
    <input
      type="password"
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        setFailed(false);
      }}
      onBlur={async (e) => {
        const next = e.target.value.trim();
        if (next === "" || next === value || next === MASK_SENTINEL || next === MASK_DISPLAY) {
          setDraft(undefined);
          return;
        }
        const ok = await onCommit(path, next);
        setFailed(!ok);
        if (ok) setDraft(undefined);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      style={{ ...inputStyle, width: 170, fontFamily: "var(--font-mono)", borderColor: failed ? "#f87171" : undefined }}
    />
  );
}

const CHANNEL_IDS = ["wechat", "feishu", "telegram"] as const;
const CHANNEL_LABEL_KEY: Record<(typeof CHANNEL_IDS)[number], string> = {
  wechat: "web-channel-wechat",
  feishu: "web-channel-feishu",
  telegram: "web-channel-telegram",
};

/**
 * Web-layer config editor (`~/.zeta/agent/web.yml`): tray/autostart, remote
 * access, and IM channel credentials. Data comes from `/api/web-config`, not
 * the CLI settings schema, so it renders outside the settings tab list.
 */
/**
 * WeChat login QR. Some flows return a direct image URL (the v1 clawbot API,
 * `data:` / `.png`), while the legacy iLink flow returns a page URL
 * (`liteapp.weixin.qq.com/...`, HTML) that an `<img>` cannot render. When the
 * URL is not a direct image — or the load fails — fall back to rendering a QR
 * code of that URL, so scanning still opens the WeChat login page.
 */
function WeChatQrImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const looksLikePage = !/^(data:|https?:.*\.(png|jpe?g|gif|webp|svg)(\?|$))/i.test(url);
  const effective =
    failed || looksLikePage
      ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`
      : url;
  return (
    <img
      src={effective}
      alt="WeChat login QR"
      width={140}
      height={140}
      onError={() => setFailed(true)}
      style={{ borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0, background: "#fff" }}
    />
  );
}

/**
 * Channel credential form with an explicit Save button: edits are held in
 * local draft state and only committed on Save, so the user gets visible
 * feedback (saving… / saved ✓ / error) instead of silent blur-commits.
 */
function ChannelCredentialsForm({
  channelId,
  channel,
  onCommit,
  t,
}: {
  channelId: "feishu" | "telegram";
  channel: { appId?: string; appSecret?: string; botToken?: string; domain?: string };
  onCommit: (path: string, value: unknown) => Promise<boolean>;
  t: (key: string) => string;
}) {
  const isFeishu = channelId === "feishu";
  const [appId, setAppId] = useState(channel.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [botToken, setBotToken] = useState("");
  const [domain, setDomain] = useState(channel.domain ?? "feishu");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasStoredSecret =
    (isFeishu && (channel.appSecret ?? "") !== "" && channel.appSecret !== "••••") || (isFeishu && channel.appSecret === "••••");
  const dirty = isFeishu
    ? appId !== (channel.appId ?? "") || appSecret !== "" || domain !== (channel.domain ?? "feishu")
    : botToken !== "";

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (isFeishu) {
        if (appId.trim() !== (channel.appId ?? "")) {
          const ok = await onCommit("channels.feishu.appId", appId.trim());
          if (!ok) return;
        }
        if (appSecret.trim() !== "") {
          const ok = await onCommit("channels.feishu.appSecret", appSecret.trim());
          if (!ok) return;
        }
        if (domain !== (channel.domain ?? "feishu")) {
          await onCommit("channels.feishu.domain", domain);
        }
      } else {
        if (botToken.trim() !== "") {
          const ok = await onCommit("channels.telegram.botToken", botToken.trim());
          if (!ok) return;
        }
      }
      setAppSecret("");
      setBotToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {isFeishu ? (
        <>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="App ID"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={hasStoredSecret ? "App Secret (已保存，留空保持不变)" : "App Secret"}
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            style={{ ...inputStyle, width: "auto", minWidth: 120 }}
          >
            <option value="feishu">{t("feishu")}</option>
            <option value="lark">Lark</option>
          </select>
        </>
      ) : (
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder={channel.botToken === "••••" ? "Bot Token (已保存，留空保持不变)" : "Bot Token"}
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          style={{
            padding: "5px 12px",
            background: saved ? "#16a34a" : dirty && !saving ? "var(--accent)" : "var(--bg-panel)",
            border: "none",
            borderRadius: 5,
            color: (dirty && !saving) || saved ? "#fff" : "var(--text-dim)",
            cursor: dirty && !saving ? "pointer" : "not-allowed",
            fontSize: 11.5,
            fontWeight: 600,
            width: "fit-content",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {saved ? "已保存 ✓" : saving ? "保存中…" : "保存"}
        </button>
        {error && <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>}
      </div>
    </div>
  );
}

function WebSettingsSection({  data,
  pending,
  error,
  savedFlash,
  t,
  onCommit,
}: {
  data: WebConfigData;
  pending: Record<string, boolean>;
  error: string | null;
  savedFlash: string | null;
  t: (key: string) => string;
  onCommit: (path: string, value: unknown) => Promise<boolean>;
}) {
  // WeChat QR-login progress surfaced by the gateway (see /api/channels/wechat/qrcode).
  const [wechatQr, setWechatQr] = useState<{
    pending: boolean;
    qrcodeUrl?: string;
    status?: string;
  }>({ pending: false });
  const [reconnecting, setReconnecting] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  useEffect(() => {
    if (!data.channels.wechat.enabled) {
      setWechatQr({ pending: false });
      return;
    }
    const poll = () => {
      fetch("/api/channels/wechat/qrcode")
        .then((r) => r.json())
        .then((qr: { pending: boolean; qrcodeUrl?: string; status?: string }) => setWechatQr(qr))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [data.channels.wechat.enabled]);

  const handleReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      await fetch("/api/channels/wechat/reconnect", { method: "POST" });
    } finally {
      setReconnecting(false);
    }
  }, []);

  const handleUnbind = useCallback(async () => {
    setUnbinding(true);
    try {
      await fetch("/api/channels/wechat/unbind", { method: "POST" });
      setWechatQr({ pending: false });
    } finally {
      setUnbinding(false);
    }
  }, []);

  const group = (title: string, children: React.ReactNode) => (
    <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );

  const row = (label: string, description: string | undefined, control: React.ReactNode, path?: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{label}</span>
        {description && <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>{description}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {path && pending[path] === true && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Saving…</span>}
        {control}
      </div>
    </div>
  );

  return (
    <>
      {error && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "#f87171", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
          {error}
        </div>
      )}
      {savedFlash && (
        <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-muted)", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
          {savedFlash}
        </div>
      )}

      {group(t("web-tray"), (
        <>
          {row(t("web-minimize-to-tray"), t("web-minimize-to-tray-desc"), (
            <Toggle checked={data.tray.minimizeToTray} label={t("web-minimize-to-tray")} onChange={(next) => onCommit("tray.minimizeToTray", next)} />
          ), "tray.minimizeToTray")}
          {row(t("web-autostart"), t("web-autostart-desc"), (
            <Toggle checked={data.tray.autostart} label={t("web-autostart")} onChange={(next) => onCommit("tray.autostart", next)} />
          ), "tray.autostart")}
        </>
      ))}

      {group(t("web-remote"), (
        <>
          {row(t("web-remote-host"), undefined, <WebPlainInput path="remote.host" value={data.remote.host} placeholder="https://…" onCommit={onCommit} />, "remote.host")}
          {row(t("web-remote-token"), t("web-remote-token-desc"), (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <SecretInput path="remote.token" value={data.remote.token} placeholder="••••" onCommit={onCommit} />
              <button
                type="button"
                onClick={() => void onCommit("remote.token", "")}
                style={{ padding: "5px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 11.5 }}
              >
                {t("web-remote-token-reset")}
              </button>
            </div>
          ), "remote.token")}
          {row(t("web-show-bot-sessions"), t("web-show-bot-sessions-desc"), (
            <Toggle
              checked={data.remote.showBotSessions === true}
              label={t("web-show-bot-sessions")}
              onChange={(next) => void onCommit("remote.showBotSessions", next)}
            />
          ), "remote.showBotSessions")}
        </>
      ))}

      {group(t("web-channels"), (
        <>
          {CHANNEL_IDS.map((channelId) => {
            const channel = data.channels[channelId];
            return (
              <div key={channelId} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "9px 11px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 7 }}>
                {row(t(CHANNEL_LABEL_KEY[channelId]), undefined, (
                  <Toggle checked={channel.enabled} label={t(CHANNEL_LABEL_KEY[channelId])} onChange={(next) => void onCommit(`channels.${channelId}.enabled`, next)} />
                ), `channels.${channelId}.enabled`)}
                {channelId === "wechat" && (
                  <>
                    {wechatQr.pending && wechatQr.qrcodeUrl && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {/^(data:|https?:)/.test(wechatQr.qrcodeUrl) ? (
                          <WeChatQrImage url={wechatQr.qrcodeUrl} />
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 220, overflowWrap: "anywhere", fontFamily: "var(--font-mono)" }}>
                            {wechatQr.qrcodeUrl}
                          </span>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
                          <span>
                            {wechatQr.status === "confirmed"
                              ? t("wechat-status-confirmed")
                              : wechatQr.status === "scaned"
                                ? t("wechat-status-scaned")
                                : wechatQr.status === "expired"
                                  ? t("wechat-status-expired")
                                  : t("wechat-status-wait")}
                          </span>
                        </div>
                      </div>
                    )}
                    {wechatQr.pending && !wechatQr.qrcodeUrl && (
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t("wechat-waiting-qr")}</div>
                    )}
                    {!wechatQr.pending && (
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        {channel.botToken
                          ? t("wechat-connected")
                          : channel.enabled
                            ? t("wechat-not-logged-in")
                            : t("wechat-disabled-hint")}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => void handleReconnect()}
                        disabled={reconnecting}
                        style={{
                          padding: "5px 9px",
                          background: "none",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          color: "var(--text-muted)",
                          cursor: reconnecting ? "default" : "pointer",
                          fontSize: 11.5,
                          opacity: reconnecting ? 0.5 : 1,
                          width: "fit-content",
                        }}
                      >
                        {reconnecting ? t("wechat-reconnecting") : t("wechat-reconnect")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUnbind()}
                        disabled={unbinding}
                        style={{
                          padding: "5px 9px",
                          background: "none",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          color: "#f87171",
                          cursor: unbinding ? "default" : "pointer",
                          fontSize: 11.5,
                          opacity: unbinding ? 0.5 : 1,
                          width: "fit-content",
                        }}
                      >
                        {unbinding ? t("wechat-unbinding") : t("wechat-unbind")}
                      </button>
                    </div>
                  </>
                )}
                {channelId === "feishu" && (
                  <ChannelCredentialsForm channelId="feishu" channel={channel} onCommit={onCommit} t={t} />
                )}
                {channelId === "telegram" && (
                  <ChannelCredentialsForm channelId="telegram" channel={channel} onCommit={onCommit} t={t} />
                )}
              </div>
            );
          })}
        </>
      ))}
    </>
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

/**
 * `modelRoles` editor: one text input per role, value = "provider/model[:level]"
 * (e.g. "anthropic/claude-sonnet-4-5:high"). Empty input removes the role.
 * Mirrors the CLI's role-assignment rows; saving goes through `PUT /api/settings`.
 */
function ModelRolesEditor({ value, onCommit }: { value: Record<string, string>; onCommit: (next: Record<string, string>) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newRole, setNewRole] = useState("");
  const [newValue, setNewValue] = useState("");

  const roles = useMemo(() => Object.keys(value).sort((a, b) => a.localeCompare(b)), [value]);

  const commitRole = (role: string, raw: string) => {
    const next = { ...value };
    const trimmed = raw.trim();
    if (trimmed === "") {
      delete next[role];
    } else {
      next[role] = trimmed;
    }
    setDrafts((d) => {
      const nd = { ...d };
      delete nd[role];
      return nd;
    });
    onCommit(next);
  };

  const addRole = () => {
    const role = newRole.trim();
    const model = newValue.trim();
    if (role === "" || model === "") return;
    onCommit({ ...value, [role]: model });
    setNewRole("");
    setNewValue("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      {roles.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          No role overrides set — the default role resolves from your model selection.
        </div>
      )}
      {roles.map((role) => (
        <div key={role} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <code style={{ flex: 1, fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{role}</code>
          <input
            value={drafts[role] ?? value[role] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [role]: e.target.value }))}
            onBlur={(e) => commitRole(role, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="provider/model[:level]"
            aria-label={`${role} model assignment`}
            style={{ ...inputStyle, width: 240, fontFamily: "var(--font-mono)", flexShrink: 0 }}
          />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          placeholder="role (e.g. plan)"
          style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)" }}
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addRole();
          }}
          placeholder="provider/model[:level]"
          style={{ ...inputStyle, width: 240, fontFamily: "var(--font-mono)", flexShrink: 0 }}
        />
        <button
          type="button"
          onClick={addRole}
          disabled={newRole.trim() === "" || newValue.trim() === ""}
          style={{
            padding: "6px 10px",
            border: "1px solid var(--border)",
            borderRadius: 5,
            background: "none",
            color: "var(--text-muted)",
            cursor: newRole.trim() === "" || newValue.trim() === "" ? "default" : "pointer",
            fontSize: 11.5,
            opacity: newRole.trim() === "" || newValue.trim() === "" ? 0.5 : 1,
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
  const { t } = useI18n();
  const wide = entry.type === "providerLimits" || entry.type === "modelRoles" || entry.type === "multiselect";

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
      case "modelRoles":
        return <ModelRolesEditor value={(value as Record<string, string> | undefined) ?? {}} onCommit={onCommit} />;
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
      {terminalNote && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("takes-effect-in-the-terminal-cli")}</div>}
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
  const [webData, setWebData] = useState<WebConfigData | null>(null);
  const [webError, setWebError] = useState<string | null>(null);
  const [webPending, setWebPending] = useState<Record<string, boolean>>({});
  const [webSavedFlash, setWebSavedFlash] = useState<string | null>(null);

  const lang = settingsLang(locale);

  const load = useCallback(async (lang: "en" | "zh") => {
    setLoadError(null);
    try {
      const next = await fetchSettings(lang);
      setData(next);
      setValues(Object.fromEntries(next.settings.map((s): [string, unknown] => [s.path, s.value])));
      setDrafts({});
      setErrors({});
      setActiveTab((cur) => (cur === "web" || cur === "docs" || next.tabs.some((tab) => tab.id === cur) ? cur : next.tabs[0]?.id ?? "appearance"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadWebConfig = useCallback(async () => {
    setWebError(null);
    try {
      const next = await fetchWebConfig();
      setWebData(next);
    } catch (err) {
      setWebError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(lang);
    void loadWebConfig();
  }, [lang, load, loadWebConfig]);

  const webCommit = useCallback(
    async (path: string, value: unknown): Promise<boolean> => {
      setWebPending((p) => ({ ...p, [path]: true }));
      setWebError(null);
      setWebSavedFlash(null);
      try {
        await updateWebConfig(path, value);
        setWebData((cur) => (cur ? setAtPath(cur, path, value) : cur));
        // Keep the raw remote token client-side so non-loopback (LAN/tunnel)
        // fetches can authenticate without re-entering it.
        if (path === "remote.token") {
          setRemoteToken(typeof value === "string" && value !== "" ? value : undefined);
        }
        setWebSavedFlash(t("web-config-saved"));
        return true;
      } catch (err) {
        setWebError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setWebPending((p) => {
          const next = { ...p };
          delete next[path];
          return next;
        });
      }
    },
    [t],
  );

  // Escape closes the modal, unless the user is typing in a field (so Escape
  // in an input/select doesn't accidentally dismiss the whole panel).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      onClose();
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
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("settings")}</span>
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
            <button
              key="web"
              type="button"
              onClick={() => setActiveTab("web")}
              aria-pressed={activeTab === "web"}
              style={{
                padding: "5px 11px",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
                flexShrink: 0,
                marginLeft: 4,
                background: activeTab === "web" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "web" ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {t("web-bot")}
            </button>
            <button
              key="docs"
              type="button"
              onClick={() => setActiveTab("docs")}
              aria-pressed={activeTab === "docs"}
              style={{
                padding: "5px 11px",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
                flexShrink: 0,
                marginLeft: 4,
                background: activeTab === "docs" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "docs" ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {t("web-docs")}
            </button>
          </div>
        )}

        {/* Config-scope banner: names the config UI (bot vs CLI), the actual
            file, and the object being edited for the active tab. */}
        {data && activeTab !== "docs" && (
          <div
            style={{
              padding: "7px 14px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-panel)",
              fontSize: 11.5,
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--text)" }}>
              {activeTab === "web" ? `⚠ ${t("editing-bot-config")}` : `⚠ ${t("editing-cli-config")}`}
            </span>
            <span>
              {t("config-file")}:{" "}
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                {activeTab === "web"
                  ? "~/.zeta/agent/web.yml"
                  : activeTab === "model"
                    ? "~/.zeta/agent/models.json"
                    : "~/.zeta/agent/config.yml"}
              </code>
            </span>
            <span>
              {t("config-object")}:{" "}
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
                {activeTab === "web"
                  ? "remote.* / channels.* / tray.*"
                  : activeTab === "model"
                    ? "modelRoles / enabledModels"
                    : `settings.${activeTab}`}
              </code>
            </span>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
          {activeTab === "docs" ? (
            <DocsPanel locale={locale} t={t} />
          ) : activeTab === "web" ? (
            webData ? (
              <WebSettingsSection
                data={webData}
                pending={webPending}
                error={webError}
                savedFlash={webSavedFlash}
                t={t}
                onCommit={(path, value) => webCommit(path, value)}
              />
            ) : (
              <div style={{ padding: 24, fontSize: 12.5, color: "var(--text-muted)" }}>
                {webError ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: "#f87171" }}>
                      {t("web-config-load-failed")}
                      {webError}
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadWebConfig()}
                      style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", cursor: "pointer", fontSize: 12 }}
                    >
                      {t("refresh")}
                    </button>
                  </div>
                ) : (
                  "Loading…"
                )}
              </div>
            )
          ) : loadError ? (
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
