import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { formatDirectoryName } from '@/lib/utils';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

interface UsageRow {
  sessionId: string;
  cwd: string;
  title: string;
  totalTokens: number;
  input: number;
  output: number;
  cost: number;
  lastActive: string;
}

interface UsagePayload {
  totalTokens: number;
  input: number;
  output: number;
  cost: number;
  sessions: UsageRow[];
}

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatDate = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
};

export const ZetaUsagePage: React.FC = () => {
  const [data, setData] = React.useState<UsagePayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await runtimeFetch('/api/usage');
      const payload = await res.json() as UsagePayload;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-4 text-muted-foreground">Loading usage…</div>;
  if (error || !data) return <div className="p-4 text-destructive">Failed to load usage: {error ?? 'no data'}</div>;

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Total tokens', value: formatTokens(data.totalTokens) },
          { label: 'Input', value: formatTokens(data.input) },
          { label: 'Output', value: formatTokens(data.output) },
          { label: 'Cost (USD)', value: `$${data.cost.toFixed(4)}` },
        ].map((cell) => (
          <div key={cell.label} className="rounded border border-border/60 p-2">
            <div className="typography-meta text-muted-foreground">{cell.label}</div>
            <div className="text-base font-medium text-foreground">{cell.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="typography-ui-label font-semibold text-foreground">Sessions ({data.sessions.length})</h3>
        <button type="button" onClick={() => void load()} className="rounded border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">
          Refresh
        </button>
      </div>

      <div className="overflow-y-auto rounded border border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[var(--surface-muted)]">
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Session</th>
              <th className="px-2 py-1.5 font-medium">Directory</th>
              <th className="px-2 py-1.5 text-right font-medium">Tokens</th>
              <th className="px-2 py-1.5 text-right font-medium">Output</th>
              <th className="px-2 py-1.5 text-right font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.filter((s) => s.totalTokens > 0).map((s) => (
              <tr key={s.sessionId} className="border-t border-border/40">
                <td className="max-w-[220px] truncate px-2 py-1.5 text-foreground" title={s.title}>
                  {s.title || '(untitled)'}
                </td>
                <td className="max-w-[200px] truncate px-2 py-1.5 text-muted-foreground" title={s.cwd}>
                  {s.cwd ? formatDirectoryName(s.cwd, homeDirectory) : ''}
                </td>
                <td className="px-2 py-1.5 text-right text-foreground">{formatTokens(s.totalTokens)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{formatTokens(s.output)}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{formatDate(s.lastActive)}</td>
              </tr>
            ))}
            {data.sessions.filter((s) => s.totalTokens > 0).length === 0 ? (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">No token usage recorded yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
};
