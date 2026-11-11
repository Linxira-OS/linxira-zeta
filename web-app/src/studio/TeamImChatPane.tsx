/**
 * IM Chat subpage inside the Team workspace.
 *
 * It reads the canonical session history and transcript APIs; it keeps no
 * second transcript and writes no message store. Rows are IM-origin sessions
 * only, limited to the last three days. The visible number is derived from the
 * current list (workspace 2 digits + session 5 digits), never persisted as a
 * short id; the session id stays a background key.
 *
 * The latest completed-turn summary is a provenance-owner read model. Until
 * that field is present, a row says "no summary" or "in progress" and never
 * substitutes the first user message for a completed task summary.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConversationItem,
  ConversationMessageItem,
  SessionHistoryEntry,
  SessionHistoryReadModel,
  StudioClient,
} from "@linxiraos/studio-contract";
import { hostErrorMessage } from "./hostError";
import { buildRecentImRows } from "./teamImChatModel";
import { useI18n } from "./i18n";
import "./TeamImChatPane.css";

export interface ImChatTargetLabel {
  readonly workspaceAlias?: string;
  readonly agentId?: string;
  readonly label: string;
}

export interface ImChatPendingBinding {
  readonly pendingId: string;
  readonly current: ImChatTargetLabel;
  readonly next: ImChatTargetLabel;
  /** IM owner's control record; displayed verbatim, never regenerated here. */
  readonly controlRecord: string;
  readonly requestedAt: string;
}

/** The IM/provenance owner supplies confirmation; this pane never invents one. */
export interface ImChatBindingControl {
  readonly current?: ImChatTargetLabel;
  readonly pending?: ImChatPendingBinding;
  confirm(pendingId: string): Promise<void>;
  cancel(pendingId: string): Promise<void>;
}

function textOf(item: ConversationMessageItem): string {
  return item.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map(block => block.text)
    .join("\n")
    .trim();
}

function MessageItem({ item, source }: { item: ConversationMessageItem; source?: string }) {
  const text = textOf(item);
  if (!text) {
    const tool = item.content.find(block => block.type === "toolCall" || block.type === "toolResult");
    if (!tool || (tool.type !== "toolCall" && tool.type !== "toolResult")) return null;
    return (
      <div className={`tic-tool role-${item.role}`}>
        <code>{tool.toolName ?? "tool"}</code>
      </div>
    );
  }
  return (
    <div className={`tic-bubble role-${item.role}`}>
      <div className="tic-meta">
        <span>{item.role === "user" ? "user" : item.role === "assistant" ? "agent" : item.role}</span>
        {source ? <span className="tic-source">{source}</span> : null}
        <time>{new Date(item.createdAt).toLocaleString()}</time>
      </div>
      <p>{text}</p>
    </div>
  );
}

function TranscriptItem({ item }: { item: ConversationItem }) {
  if (item.kind === "message") return <MessageItem item={item} />;
  if (item.kind === "compaction") {
    return (
      <div className="tic-compaction">
        <span>{item.shortSummary ?? item.summary}</span>
      </div>
    );
  }
  return <div className="tic-reset">context reset</div>;
}

export function TeamImChatPane({
  client,
  binding,
}: {
  client: StudioClient;
  /** Supplied by the IM integration; absent means no binding controls are shown. */
  binding?: ImChatBindingControl;
}) {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage.startsWith("zh");
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = (await client.query("history.list", { includeIm: true })) as SessionHistoryReadModel;
        if (!active) return;
        setEntries(result.entries);
        setError("");
      } catch (cause) {
        if (active) setError(hostErrorMessage(cause, zh ? "读取会话失败" : "Failed to read sessions"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, zh]);

  const rows = useMemo(() => buildRecentImRows(entries, Date.now()), [entries]);
  const selectedRow = rows.find(row => row.entry.sessionId === selected) ?? rows[0];
  const selectedSessionId = selectedRow?.entry.sessionId;

  useEffect(() => {
    if (!selectedSessionId) {
      setItems([]);
      return;
    }
    let active = true;
    setChatLoading(true);
    void (async () => {
      try {
        const result = await client.query("conversation.open", {
          target: { kind: "session", sessionId: selectedSessionId },
        });
        if (!active) return;
        setItems([...result.page.items]);
        setError("");
      } catch (cause) {
        if (active) setError(hostErrorMessage(cause, zh ? "读取会话内容失败" : "Failed to read transcript"));
      } finally {
        if (active) setChatLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, selectedSessionId, zh]);

  const cancel = useCallback(async () => {
    if (!binding?.pending) return;
    setControlBusy(true);
    try {
      await binding.cancel(binding.pending.pendingId);
      setConfirming(false);
    } finally {
      setControlBusy(false);
    }
  }, [binding]);

  const confirm = useCallback(async () => {
    if (!binding?.pending) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setControlBusy(true);
    try {
      await binding.confirm(binding.pending.pendingId);
      setConfirming(false);
    } finally {
      setControlBusy(false);
    }
  }, [binding, confirming]);

  if (loading) return <div className="tic-empty">{zh ? "正在读取…" : "Loading…"}</div>;

  return (
    <div className="tic-root">
      <section className="tic-list">
        <header>
          <strong>{zh ? "IM 会话" : "IM chats"}</strong>
          <span>{zh ? "最近 3 天" : "last 3 days"}</span>
        </header>
        {rows.length === 0 ? (
          <p className="tic-empty">{zh ? "最近 3 天没有 IM 会话。" : "No IM chats in the last 3 days."}</p>
        ) : (
          <ul>
            {rows.map(row => (
              <li key={row.entry.historyId}>
                <button
                  type="button"
                  className={`tic-row${selectedRow?.entry.historyId === row.entry.historyId ? " active" : ""}`}
                  onClick={() => setSelected(row.entry.sessionId)}
                >
                  <span className="tic-number">{row.number}</span>
                  <span className="tic-main">
                    <span className="tic-name">{row.label}</span>
                    <span className={`tic-summary ${row.status}`}>
                      {row.summary || (row.status === "in-progress" ? (zh ? "进行中 · 暂无摘要" : "in progress · no summary") : zh ? "暂无摘要" : "no summary")}
                    </span>
                  </span>
                  <span className="tic-channel">{row.channel ?? "IM"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tic-chat">
        {selectedRow ? (
          <>
            <header className="tic-chat-head">
              <div>
                <strong>{selectedRow.label}</strong>
                <span className="tic-number">{selectedRow.number}</span>
              </div>
              <div className="tic-source-line">
                <span>{selectedRow.channel ?? "IM"}</span>
                {selectedRow.workspaceAlias ? <span>{selectedRow.workspaceAlias}</span> : null}
                <span>{selectedRow.entry.status}</span>
              </div>
            </header>

            {binding?.pending ? (
              <div className="tic-pending">
                <div>
                  <strong>{zh ? "待确认绑定" : "Pending binding"}</strong>
                  <span>
                    {binding.pending.current.label} → {binding.pending.next.label}
                  </span>
                  <code>{binding.pending.controlRecord}</code>
                  <small>
                    {zh
                      ? "确认前普通消息仍发旧目标；确认后直达新目标。上下文不搬。"
                      : "Before confirm, messages still go to the old target; after confirm they go direct. Context is not moved."}
                  </small>
                </div>
                <div className="tic-pending-actions">
                  <button type="button" disabled={controlBusy} onClick={() => void confirm()}>
                    {confirming ? (zh ? "再次确认" : "Confirm again") : zh ? "确认切换" : "Confirm switch"}
                  </button>
                  <button type="button" disabled={controlBusy} onClick={() => void cancel()}>
                    {zh ? "取消" : "Cancel"}
                  </button>
                </div>
              </div>
            ) : binding?.current ? (
              <div className="tic-current">
                <span>{zh ? "当前目标" : "Current target"}</span>
                <strong>{binding.current.label}</strong>
              </div>
            ) : null}

            {error ? <div className="tic-error">{error}</div> : null}
            <div className="tic-transcript">
              {chatLoading ? <div className="tic-empty">{zh ? "正在读取…" : "Loading…"}</div> : null}
              {items.map(item => (
                <TranscriptItem key={item.itemId} item={item} />
              ))}
              {!chatLoading && items.length === 0 ? (
                <div className="tic-empty">{zh ? "暂无消息。" : "No messages."}</div>
              ) : null}
            </div>
            <p className="tic-boundary">
              {zh
                ? "每条消息只读 canonical transcript；原始 ID 仅作后台 key。"
                : "Bubbles read the canonical transcript only; raw ids stay background keys."}
            </p>
          </>
        ) : (
          <div className="tic-empty">{zh ? "选择一个会话。" : "Select a chat."}</div>
        )}
      </section>
    </div>
  );
}
