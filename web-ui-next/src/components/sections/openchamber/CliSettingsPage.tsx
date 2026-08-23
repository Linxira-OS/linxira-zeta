import React from 'react';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { opencodeClient } from '@/lib/opencode/client';

interface CliSettingEntry {
  path: string;
  label: string;
  description?: string;
  tab: string;
  group: string;
  visible?: boolean;
  type: string;
  options?: Array<{ value: string; label: string }>;
  value?: unknown;
  default?: unknown;
}

interface CliSettingsResponse {
  tabs: Array<{ id: string; label: string }>;
  groups: Record<string, string[]>;
  settings: CliSettingEntry[];
}

function renderControl(
  entry: CliSettingEntry,
  value: unknown,
  onChange: (value: unknown) => void,
  t: (key: string, params?: Record<string, unknown>) => string,
) {
  switch (entry.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-foreground"
          />
          <span className="text-sm">{value === true ? t('cliSettings.on') : t('cliSettings.off')}</span>
        </label>
      );
    case 'enum':
    case 'submenu':
      return (
        <select
          className="w-full max-w-xs rounded border border-border/70 bg-background px-2 py-1.5 text-sm"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {(entry.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    case 'multiselect':
      return (
        <div className="flex flex-wrap gap-1.5">
          {(entry.options ?? []).map((opt) => {
            const selected = Array.isArray(value) && (value as unknown[]).includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const current = Array.isArray(value) ? [...(value as string[])] : [];
                  const next = selected ? current.filter((v) => v !== opt.value) : [...current, opt.value];
                  onChange(next);
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${selected ? 'border-foreground bg-foreground text-background' : 'border-border/70 text-muted-foreground'}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    case 'modelRoles':
    case 'providerLimits':
    case 'text':
    default:
      return (
        <textarea
          className="w-full max-w-md rounded border border-border/70 bg-background px-2 py-1.5 text-sm font-mono"
          rows={entry.type === 'text' ? 1 : 3}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? entry.default ?? '', null, 2)}
          onChange={(e) => {
            const raw = e.target.value;
            if (entry.type === 'text') {
              onChange(raw);
              return;
            }
            try {
              onChange(JSON.parse(raw || '{}'));
            } catch {
              // keep last valid; raw text stays in the textarea
            }
          }}
        />
      );
  }
}

export const CliSettingsPage: React.FC = () => {
  const [data, setData] = React.useState<CliSettingsResponse | null>(null);
  const [activeTab, setActiveTab] = React.useState<string>('appearance');
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const service = opencodeClient as unknown as { getSettings(): Promise<unknown>; putSetting(path: string, value: unknown): Promise<unknown> };
      const res = (await service.getSettings()) as CliSettingsResponse;
      setData(res);
      const next: Record<string, unknown> = {};
      for (const entry of res.settings) {
        if (entry.value !== undefined) next[entry.path] = entry.value;
      }
      setValues(next);
      if (res.tabs.length > 0 && !res.tabs.some((t) => t.id === activeTab)) {
        setActiveTab(res.tabs[0].id);
      }
    } catch {
      toast.error('Failed to load CLI settings');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <SettingsPageLayout title="CLI Settings" showSaveStatus={false}><div className="p-4 text-muted-foreground">Loading…</div></SettingsPageLayout>;
  }
  if (!data) {
    return <SettingsPageLayout title="CLI Settings" showSaveStatus={false}><div className="p-4 text-destructive">Failed to load settings.</div></SettingsPageLayout>;
  }

  const tabSettings = data.settings.filter((s) => s.tab === activeTab && s.visible !== false);
  const groups = data.groups[activeTab] ?? [];
  const pendingCount = Object.keys(values).filter((k) => {
    const entry = data.settings.find((s) => s.path === k);
    return entry && values[k] !== entry.value;
  }).length;

  const handleSave = async (path: string, value: unknown) => {
    setSaving(path);
    try {
      const service = opencodeClient as unknown as { getSettings(): Promise<unknown>; putSetting(path: string, value: unknown): Promise<unknown> };
      await service.putSetting(path, value);
      // mark saved by updating baseline
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          settings: prev.settings.map((s) => (s.path === path ? { ...s, value } : s)),
        };
      });
      toast.success('Saved');
    } catch {
      toast.error('Failed to save setting');
    } finally {
      setSaving(null);
    }
  };

  return (
    <SettingsPageLayout title="CLI Settings" showSaveStatus={false}>
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2">
          {data.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-2.5 py-1 text-sm ${activeTab === tab.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {groups.map((group) => {
            const entries = tabSettings.filter((s) => s.group === group);
            if (entries.length === 0) return null;
            return (
              <section key={group} className="mb-5">
                <h3 className="typography-ui-label mb-2 font-semibold text-foreground">{group}</h3>
                <div className="space-y-2 rounded border border-border/60 p-3">
                  {entries.map((entry) => {
                    const dirty = values[entry.path] !== entry.value;
                    return (
                      <div key={entry.path} className="flex items-start justify-between gap-4 py-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            {entry.label}
                            {dirty && <span className="rounded bg-accent px-1 text-[10px] text-accent-foreground">unsaved</span>}
                          </div>
                          {entry.description ? (
                            <p className="text-xs text-muted-foreground">{entry.description}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {renderControl(entry, values[entry.path], (v) => setValues((prev) => ({ ...prev, [entry.path]: v })), () => '')}
                          {dirty ? (
                            <Button size="sm" variant="outline" disabled={saving === entry.path} onClick={() => void handleSave(entry.path, values[entry.path])}>
                              {saving === entry.path ? '…' : 'Save'}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {groups.length === 0 && tabSettings.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">No settings in this tab.</div>
          ) : null}
          {pendingCount > 0 ? (
            <div className="sticky bottom-2 mt-2 text-center text-xs text-muted-foreground">
              {pendingCount} unsaved change(s) — each row saves individually.
            </div>
          ) : null}
        </div>
      </div>
    </SettingsPageLayout>
  );
};
