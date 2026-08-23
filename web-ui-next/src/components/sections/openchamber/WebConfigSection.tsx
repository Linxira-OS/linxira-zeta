import React from 'react';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { runtimeFetch } from '@/lib/runtime-fetch';

interface WebConfigShape {
  tray?: { minimizeToTray?: boolean; autostart?: boolean };
  channels?: Record<string, { enabled?: boolean; [key: string]: unknown }>;
  remote?: { token?: string; [key: string]: unknown };
}

const CHANNEL_LABELS: Record<string, string> = {
  wechat: 'WeChat',
  feishu: 'Feishu',
  telegram: 'Telegram',
};

export const WebConfigSection: React.FC = () => {
  const [config, setConfig] = React.useState<WebConfigShape | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await runtimeFetch('/api/web-config');
      const data = await res.json() as WebConfigShape;
      setConfig(data);
    } catch {
      toast.error('Failed to load web/desktop settings');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const put = React.useCallback(async (path: string, value: unknown) => {
    setSaving(path);
    try {
      const res = await runtimeFetch('/api/web-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      // optimistic local update for toggle rows
      setConfig((prev) => {
        if (!prev) return prev;
        const seg = path.split('.');
        if (seg[0] === 'tray' && prev.tray) return { ...prev, tray: { ...prev.tray, [seg[1]]: value } };
        if (seg[0] === 'channels' && prev.channels) {
          return {
            ...prev,
            channels: { ...prev.channels, [seg[1]]: { ...(prev.channels[seg[1]] ?? {}), enabled: value } },
          };
        }
        if (seg[0] === 'remote' && prev.remote) return { ...prev, remote: { ...prev.remote, [seg[1]]: value } };
        return prev;
      });
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  }, []);

  if (loading) return <div className="p-4 text-muted-foreground">Loading…</div>;
  if (!config) return <div className="p-4 text-destructive">Failed to load web/desktop settings.</div>;

  const tray = config.tray ?? {};
  const channels = config.channels ?? {};
  const remote = config.remote ?? {};

  const toggleRow = (label: string, path: string, value: boolean) => (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => void put(path, e.target.checked)}
            className="h-4 w-4 accent-foreground"
          />
          <span className="text-sm">{value === true ? 'On' : 'Off'}</span>
        </label>
        {saving === path ? <span className="text-xs text-muted-foreground">…</span> : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <section>
        <h3 className="typography-ui-label mb-2 font-semibold text-foreground">Tray</h3>
        <div className="space-y-2 rounded border border-border/60 p-3">
          {toggleRow('Minimize to tray', 'tray.minimizeToTray', tray.minimizeToTray === true)}
          {toggleRow('Start at login (autostart)', 'tray.autostart', tray.autostart === true)}
        </div>
      </section>

      <section>
        <h3 className="typography-ui-label mb-2 font-semibold text-foreground">Channels</h3>
        <div className="space-y-2 rounded border border-border/60 p-3">
          {Object.entries(channels).map(([id, ch]) => {
            const enabled = typeof ch === "object" && ch !== null && "enabled" in ch
              ? ch.enabled === true
              : false;
            return (
              <div key={id} className="flex items-center justify-between gap-4 py-1">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{CHANNEL_LABELS[id] ?? id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => void put(`channels.${id}.enabled`, e.target.checked)}
                      className="h-4 w-4 accent-foreground"
                    />
                    <span className="text-sm">{enabled ? 'On' : 'Off'}</span>
                  </label>
                  {saving === `channels.${id}.enabled` ? <span className="text-xs text-muted-foreground">…</span> : null}
                </div>
              </div>
            );
          })}
          {Object.keys(channels).length === 0 ? <p className="text-sm text-muted-foreground">No channels configured.</p> : null}
        </div>
      </section>

      <section>
        <h3 className="typography-ui-label mb-2 font-semibold text-foreground">Remote access</h3>
        <div className="space-y-2 rounded border border-border/60 p-3">
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">Remote token</div>
              <p className="text-xs text-muted-foreground">
                Required for non-loopback (LAN/tunnel) access. Currently {String(remote.token ?? '').length > 0 ? 'set' : 'not set'}.
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={true} title="Token editing requires the desktop app">
              Manage
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
