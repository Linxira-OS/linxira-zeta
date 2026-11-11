/**
 * IM chat subpage inside the Team workspace.
 *
 * The candidate list and every visible fact about a chat come from the IM
 * backend selector (`GET /api/im/sessions`): the stable `NN-NNNNN` number, the
 * display label, and the latest completed-task summary. This pane never
 * re-derives a number, sorts by activity to renumber, or shows a raw session id.
 *
 * Selecting a candidate reads the canonical persisted transcript from the
 * gateway (`GET /api/sessions/:id`); bubbles render the IM ingress's immutable
 * per-message route metadata, and switch handshakes render from the transcript
 * control events. There is no second transcript store and no second approval
 * system: pending binding controls are supplied by the IM integration.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { hostErrorMessage } from "./hostError";
import { useI18n } from "./i18n";
import {
  loadImChatTranscript,
  type ImChatBubble,
  type ImChatCandidate,
  type ImChatControlEvent,
  type ImChatOrigin,
  type ImChatTranscript,
} from "./teamImChatGateway";
import type { GatewayFetch } from "./settings/gatewayRequest";
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

function originLabel(origin: ImChatOrigin | undefined): string | undefined {
  if (!origin) return undefined;
  const parts = [
    origin.workspaceAlias,
    origin.agentId === undefined ? undefined : `agent ${origin.agentId}`,
    origin.bindingId === undefined ? undefined : `binding ${origin.bindingId}`,
  ].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function Bubble({ bubble }: { bubble: ImChatBubble }) {
  const source = originLabel(bubble.origin);
  if (bubble.text === "") {
    return (
      <div className={`tic-tool role-${bubble.role}`}>
        <code>{bubble.toolName ?? "tool"}</code>
      </div>
    );
  }
  return (
    <div className={`tic-bubble role-${bubble.role}`}>
      <div className="tic-meta">
        <span>{bubble.role === "user" ? "user" : bubble.role === "assistant" ? "agent" : bubble.role}</span>
        {source ? <span className="tic-source" title={source}>{source}</span> : null}
        {bubble.replyToMessageId ? <span className="tic-reply" title={bubble.replyToMessageId}>↩</span> : null}
        {bubble.createdAt ? <time>{new Date(bubble.createdAt).toLocaleString()}</time> : null}
      </div>
      <p>{bubble.text}</p>
    </div>
  );
}

function ControlEvent({ event, zh }: { event: ImChatControlEvent; zh: boolean }) {
  const action =
    event.action === "switch_request"
      ? zh
        ? "切换请求"
        : "switch requested"
      : event.action === "switch_confirm"
        ? zh
          ? "切换已确认"
          : "switch confirmed"
        : zh
          ? "切换已取消"
          : "switch cancelled";
  const from = originLabel(event.from) ?? (zh ? "未知来源" : "unknown");
  const to = originLabel(event.to) ?? (zh ? "未知目标" : "unknown");
  return (
    <div className={`tic-control action-${event.action}`}>
      <strong>{action}</strong>
      <span>
        {from} → {to}
      </span>
      <code>{event.requestId}</code>
    </div>
  );
}

export function TeamImChatPane({
  candidates,
  loading,
  binding,
  fetcher,
}: {
  /** IM backend selector rows; an empty array is an honest empty list. */
  candidates?: readonly ImChatCandidate[];
  /** True while the IM selector read is in flight. */
  loading?: boolean;
  /** Supplied by the IM integration; absent means no binding controls are shown. */
  binding?: ImChatBindingControl;
  /** Test seam; production uses the same-origin gateway `fetch`. */
  fetcher?: GatewayFetch;
}) {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage.startsWith("zh");
  const rows = useMemo(() => candidates ?? [], [candidates]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<ImChatTranscript | undefined>();
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);

  const selected = rows.find(row => row.canonicalSessionId === selectedSessionId) ?? rows[0];

  useEffect(() => {
    if (!selected) {
      setTranscript(undefined);
      return;
    }
    let active = true;
    setTranscript(undefined);
    setChatLoading(true);
    setError("");
    void (async () => {
      try {
        const result = await loadImChatTranscript(selected.canonicalSessionId, fetcher);
        if (!active) return;
        setTranscript(result);
      } catch (cause) {
        if (active) setError(hostErrorMessage(cause, zh ? "读取会话内容失败" : "Failed to read transcript"));
      } finally {
        if (active) setChatLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selected, zh, fetcher]);

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

  const summaryText = (row: ImChatCandidate): string => {
    if (row.latestTaskSummary) return row.latestTaskSummary;
    if (row.summaryState === "incomplete") return zh ? "进行中" : "in progress";
    return "";
  };

  return (
    <div className="tic-root">
      <section className="tic-list">
        <header>
          <strong>{zh ? "IM 会话" : "IM chats"}</strong>
          <span>{zh ? "最近 3 天" : "last 3 days"}</span>
        </header>
        {rows.length === 0 ? (
          <p className="tic-empty">
            {loading
              ? zh
                ? "正在读取 IM 选择器…"
                : "Reading the IM selector…"
              : candidates === undefined
                ? zh
                  ? "IM 选择器尚未连接。"
                  : "IM selector is not connected."
                : zh
                  ? "最近 3 天没有 IM 会话。更早的会话请在 desktop 或 remote Studio 历史中打开。"
                  : "No IM chats in the last 3 days. Open earlier chats in desktop or remote Studio history."}
          </p>
        ) : (
          <ul>
            {rows.map(row => (
              <li key={row.canonicalSessionId}>
                <button
                  type="button"
                  className={`tic-row${selected?.canonicalSessionId === row.canonicalSessionId ? " active" : ""}`}
                  onClick={() => setSelectedSessionId(row.canonicalSessionId)}
                >
                  <span className="tic-number">{row.selector}</span>
                  <span className="tic-main">
                    <span className="tic-name">{row.label}</span>
                    <span className={`tic-summary ${row.summaryState}`}>{summaryText(row)}</span>
                  </span>
                  <span className="tic-channel">
                    {row.isPm ? "PM · " : ""}
                    {row.channel ?? row.tag ?? "IM"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tic-chat">
        {selected ? (
          <>
            <header className="tic-chat-head">
              <div>
                <strong>{selected.label}</strong>
                <span className="tic-number">{selected.selector}</span>
              </div>
              <div className="tic-source-line">
                <span>{selected.channel ?? selected.tag ?? "IM"}</span>
                {selected.workspaceAlias ? <span>{selected.workspaceAlias}</span> : null}
                {selected.bindingId ? (
                  <span className="tic-binding" title={selected.bindingId}>
                    binding · {selected.bindingId}
                  </span>
                ) : null}
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
              {(transcript?.bubbles ?? []).map(bubble => (
                <Bubble key={bubble.itemId} bubble={bubble} />
              ))}
              {(transcript?.controls ?? []).map(event => (
                <ControlEvent key={event.entryId} event={event} zh={zh} />
              ))}
              {!chatLoading && (transcript?.bubbles.length ?? 0) === 0 ? (
                <div className="tic-empty">{zh ? "暂无消息。" : "No messages."}</div>
              ) : null}
            </div>
            <p className="tic-boundary">
              {zh
                ? "编号/名称/摘要来自 IM 后端选择器；气泡只读 canonical transcript 及其每消息来源，原始 ID 仅作后台 key。"
                : "Numbers/names/summaries come from the IM backend selector; bubbles read the canonical transcript and its per-message origin, and raw ids stay background keys."}
            </p>
          </>
        ) : (
          <div className="tic-empty">{zh ? "选择一个会话。" : "Select a chat."}</div>
        )}
      </section>
    </div>
  );
}
