import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "../AppSelect";
import { Icon } from "../icons";
import { useI18n } from "../i18n";
import { fetchSchemaSettings, writeSchemaSetting } from "./schemaSettingsClient";
import {
  formatSchemaSettingValue,
  groupedSchemaSettings,
  parseSchemaSettingValue,
  toggleSchemaMultiselect,
  visibleSchemaSettings,
  type SchemaSettingEntry,
  type SchemaSettingsCatalog,
} from "./schemaSettings";
import { SettingRow, Switch } from "./SettingRow";
import "./schemaSettings.css";

export interface SchemaSettingsPaneProps {
  readonly visible: boolean;
  readonly cwd?: string | null | undefined;
}

/**
 * The complete gateway settings catalog, restored from the old windowed
 * settings surface: every tab/group/row the gateway advertises, including the
 * control kinds the hand-coded Studio panes do not rebuild (provider limits,
 * model roles, multiselect, free-text submenu, secrets).
 *
 * A write is PUT `/api/settings` followed by a fresh GET, matching the CLI and
 * the old panel; the UI never assumes an optimistic value when a project,
 * environment or overlay layer may still win.
 */
export function SchemaSettingsPane({ visible, cwd }: SchemaSettingsPaneProps) {
  const { t, resolvedLanguage } = useI18n();
  const [catalog, setCatalog] = useState<SchemaSettingsCatalog | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSchemaSettings(resolvedLanguage === "zh" ? "zh" : "en", cwd);
      setCatalog(next);
      setActiveTab(current => next.tabs.some(tab => tab.id === current) ? current : next.tabs[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd, resolvedLanguage]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const write = useCallback(async (path: string, value: unknown) => {
    setPending(path);
    try {
      await writeSchemaSetting(path, value, cwd);
      await load();
    } finally {
      setPending(null);
    }
  }, [cwd, load]);

  const tab = catalog?.tabs.find(item => item.id === activeTab) ?? catalog?.tabs[0];
  const entries = catalog && tab ? visibleSchemaSettings(catalog, tab.id, query) : [];
  const groups = catalog && tab ? groupedSchemaSettings(entries, catalog.groups[tab.id] ?? []) : [];

  return <section className="schema-settings" aria-label={t("settings.schema.title")}>
    <header className="schema-settings-head">
      <div>
        <span className="feature-eyebrow">{t("settings.schema.eyebrow")}</span>
        <h3>{t("settings.schema.title")}</h3>
        <p className="feature-status">{t("settings.schema.desc")}</p>
      </div>
      <button type="button" className="btn outline" disabled={loading} onClick={() => void load()}>
        <Icon name="refresh" extra="sm" />{t("settings.schema.refresh")}
      </button>
    </header>

    {catalog ? (
      <div className="schema-settings-toolbar">
        <div className="schema-settings-tabs" role="tablist" aria-label={t("settings.schema.tabs")}>
          {catalog.tabs.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === tab?.id}
              className={item.id === tab?.id ? "active" : undefined}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          value={query}
          placeholder={t("settings.schema.search")}
          aria-label={t("settings.schema.search")}
          onChange={event => setQuery(event.target.value)}
        />
      </div>
    ) : null}

    {error ? <p className="feature-error" role="alert">{t("settings.schema.loadFailed", { error })}</p> : null}
    {!catalog && loading ? <p className="feature-status" role="status">{t("settings.schema.loading")}</p> : null}
    {catalog && entries.length === 0 ? <p className="feature-status">{query.trim() ? t("settings.schema.noMatch") : t("settings.schema.empty")}</p> : null}

    {catalog && tab ? (
      <div className="schema-settings-body">
        {groups.filter(group => group.entries.length > 0).map(group => (
          <section className="schema-settings-group" key={group.title ?? "__ungrouped"}>
            {group.title ? <h4>{group.title}</h4> : null}
            {group.entries.map(entry => (
              <SchemaSettingRow
                key={entry.path}
                entry={entry}
                pending={pending === entry.path}
                disabled={loading || (pending !== null && pending !== entry.path)}
                write={write}
              />
            ))}
          </section>
        ))}
      </div>
    ) : null}
  </section>;
}

/** One schema row; exported for the renderer test. */
export function SchemaSettingRow({
  entry,
  pending,
  disabled,
  write,
}: {
  readonly entry: SchemaSettingEntry;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly write: (path: string, value: unknown) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => entry.secret ? "" : formatSchemaSettingValue(entry));
  const [error, setError] = useState<string | null>(null);
  const wide = entry.type === "providerLimits" || entry.type === "modelRoles" || entry.type === "multiselect";
  const jsonEditor = entry.type === "providerLimits" || entry.type === "modelRoles"
    || (entry.type === "text" && typeof entry.value === "object" && entry.value !== null);

  useEffect(() => {
    setDraft(formatSchemaSettingValue(entry));
    setError(null);
  }, [entry]);

  const commit = (value: unknown) => {
    setError(null);
    void write(entry.path, value).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const commitDraft = () => {
    try {
      const parsed = parseSchemaSettingValue(entry, draft);
      setError(null);
      commit(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const control = () => {
    if (entry.type === "boolean") {
      return <Switch label={entry.label} checked={entry.value === true} disabled={disabled || pending} onChange={next => commit(next)} />;
    }
    if (entry.type === "enum" || entry.type === "submenu") {
      const options = entry.options ?? entry.values?.map(value => ({ value, label: value })) ?? [];
      if (options.length === 0) return <span className="mono small">{String(entry.value ?? "—")}</span>;
      return <AppSelect className="select" aria-label={entry.label} disabled={disabled || pending} value={String(entry.value ?? "")} onChange={event => commit(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </AppSelect>;
    }
    if (entry.type === "multiselect") {
      const selected = Array.isArray(entry.value) ? entry.value.filter((item): item is string => typeof item === "string") : [];
      return <div className="schema-settings-checks">
        {(entry.options ?? []).map(option => <label key={option.value} className="schema-settings-check" data-tip={option.description}>
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            disabled={disabled || pending}
            onChange={event => commit(toggleSchemaMultiselect(entry, selected, option.value, event.target.checked))}
          />
          <span>{option.label}</span>
        </label>)}
      </div>;
    }
    if (entry.secret) {
      return <div className="schema-settings-json">
        <input className="input mono" type="password" value={draft} disabled={disabled || pending} placeholder={t("settings.schema.secretPlaceholder")} aria-label={entry.label} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={() => { if (draft !== "") commitDraft(); }} />
      </div>;
    }
    if (jsonEditor) {
      return <div className="schema-settings-json">
        <textarea className="input mono" rows={4} value={draft} disabled={disabled || pending} aria-label={entry.label} onChange={event => setDraft(event.target.value)} />
        <button type="button" className="btn small outline" disabled={disabled || pending} onClick={commitDraft}>{t("settings.schema.apply")}</button>
      </div>;
    }
    return <input className="input" value={draft} disabled={disabled || pending} aria-label={entry.label} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={() => { if (draft !== formatSchemaSettingValue(entry)) commitDraft(); }} />;
  };

  return <SettingRow label={entry.label} source={null} {...(entry.description === undefined ? {} : { desc: entry.description })}>
    <div className={wide ? "schema-settings-wide" : "schema-settings-control"}>
      {control()}
      {pending ? <span className="small muted">{t("settings.schema.saving")}</span> : null}
      <span className="mono schema-settings-path">{entry.path}</span>
      {error ? <span className="feature-error" role="alert">{t("settings.schema.saveFailed", { error })}</span> : null}
    </div>
  </SettingRow>;
}
