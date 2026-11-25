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
 * control events. There is no second transcript store.
 *
 * A candidate whose `bindingId` maps to a chat binding also gets the IM
 * router's real confirm-gated switch: `GET /api/im/switch` reads the pending
 * handshake and `POST /api/im/switch/{confirm,cancel}` applies/discards it.
 * This pane keeps no pending state of its own and never switches optimistically.
 */
import { useEffect, useMemo, useState } from "react";
import { hostErrorMessage } from "./hostError";
import { useI18n } from "./i18n";
import {
  cancelImChatSwitch,
  confirmImChatSwitch,
  loadImChatBindings,
  loadImChatSwitch,
  type ImChatBindingRef,
  type ImChatSwitchState,
  type ImChatSwitchTarget,
} from "./teamImBindingGateway";
import {
  loadImChatTranscript,
  type ImChatBubble,
  type ImChatCandidate,
  type ImChatControlEvent,
  type ImChatOrigin,
  type ImChatTranscript,
} from "./teamImChatGateway";
import type { GatewayFetch } from "./gatewayRequest";
import "./TeamImChatPane.css";

function originLabel(origin: ImChatOrigin | undefined): string | undefined {
  if (!origin) return undefined;
  const parts = [
    origin.workspaceAlias,
    origin.agentId === undefined ? undefined : `agent ${origin.agentId}`,
    origin.bindingId === undefined ? undefined : `binding ${origin.bindingId}`,
  ].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function targetLabel(target: ImChatSwitchTarget | undefined): string | undefined {
  if (!target) return undefined;
  const parts = [
    target.workspaceAlias,
    target.agentId === undefined ? undefined : `agent ${target.agentId}`,
  ].filter((part): part is string => part !== undefined && part !== "");
  return parts.length > 0 ? parts.join(" · ") : target.targetKey;
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

function ControlEvent({ event }: { event: ImChatControlEvent }) {
  const { t } = useI18n();
  const action =
    event.action === "switch_request"
      ? t("teamWorkspace.im.switchRequested")
      : event.action === "switch_confirm"
        ? t("teamWorkspace.im.switchConfirmed")
        : t("teamWorkspace.im.switchCancelled");
  const from = originLabel(event.from) ?? t("teamWorkspace.im.unknown");
  const to = originLabel(event.to) ?? t("teamWorkspace.im.unknown");
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
  fetcher,
}: {
  /** IM backend selector rows; an empty array is an honest empty list. */
  candidates?: readonly ImChatCandidate[] | undefined;
  /** True while the IM selector read is in flight. */
  loading?: boolean | undefined;
  /** Test seam; production uses the same-origin gateway `fetch`. */
  fetcher?: GatewayFetch | undefined;
}) {
  const { t } = useI18n();
  const rows = useMemo(() => candidates ?? [], [candidates]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<ImChatTranscript | undefined>();
  const [chatLoading, setChatLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const [bindings, setBindings] = useState<ImChatBindingRef[] | undefined>();
  const [switchState, setSwitchState] = useState<ImChatSwitchState | undefined>();
  const [switchLoading, setSwitchLoading] = useState(false);
  const [controlError, setControlError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);

  const selected = rows.find(row => row.canonicalSessionId === selectedSessionId) ?? rows[0];
  const selectedBindingId = selected?.bindingId;
  const selectedBinding = useMemo(
    () => (selectedBindingId ? bindings?.find(binding => binding.id === selectedBindingId) : undefined),
    [selectedBindingId, bindings],
  );

  useEffect(() => {
    let active = true;
    void loadImChatBindings(fetcher)
      .then(rows => {
        if (active) setBindings(rows);
      })
      .catch(cause => {
        if (active) setControlError(hostErrorMessage(cause, t("teamWorkspace.im.bindingsError")));
      });
    return () => {
      active = false;
    };
  }, [fetcher, t]);

  useEffect(() => {
    if (!selected) {
      setTranscript(undefined);
      return;
    }
    let active = true;
    setTranscript(undefined);
    setTranscriptError("");
    // The registry key is not a transcript id: a bot/relay entry may be keyed
    // by `relay` or `im-<binding>` while the header carries a real session id.
    // Reading by the registry key would ask for a nonexistent transcript and
    // show its 404 as if the chat were missing.
    const transcriptSessionId = selected.transcriptSessionId;
    if (transcriptSessionId === undefined) {
      setChatLoading(false);
      setTranscriptError(t("teamWorkspace.im.transcriptMissing"));
      return () => {
        active = false;
      };
    }
    setChatLoading(true);
    void (async () => {
      try {
        const result = await loadImChatTranscript(transcriptSessionId, fetcher);
        if (!active) return;
        setTranscript(result);
      } catch (cause) {
        if (active) {
          setTranscriptError(hostErrorMessage(cause, t("teamWorkspace.im.transcriptError")));
        }
      } finally {
        if (active) setChatLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selected, t, fetcher]);

  useEffect(() => {
    if (!selectedBinding) {
      setSwitchState(undefined);
      setSwitchLoading(false);
      return;
    }
    let active = true;
    setSwitchLoading(true);
    setControlError("");
    void loadImChatSwitch(selectedBinding, fetcher)
      .then(state => {
        if (active) setSwitchState(state);
      })
      .catch(cause => {
        if (active) {
          setControlError(hostErrorMessage(cause, t("teamWorkspace.im.switchStateError")));
        }
      })
      .finally(() => {
        if (active) setSwitchLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedBinding, fetcher, t]);

  const refreshSwitch = async () => {
    if (!selectedBinding) return;
    const state = await loadImChatSwitch(selectedBinding, fetcher);
    setSwitchState(state);
  };

  const confirm = async () => {
    if (!selectedBinding || !switchState?.pending) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setControlBusy(true);
    setControlError("");
    try {
      await confirmImChatSwitch(selectedBinding, switchState.pending.requestId, fetcher);
      await refreshSwitch();
      setConfirming(false);
    } catch (cause) {
      setControlError(hostErrorMessage(cause, t("teamWorkspace.im.confirmError")));
    } finally {
      setControlBusy(false);
    }
  };

  const cancel = async () => {
    if (!selectedBinding || !switchState?.pending) return;
    setControlBusy(true);
    setControlError("");
    try {
      await cancelImChatSwitch(selectedBinding, switchState.pending.requestId, fetcher);
      await refreshSwitch();
      setConfirming(false);
    } catch (cause) {
      setControlError(hostErrorMessage(cause, t("teamWorkspace.im.cancelError")));
    } finally {
      setControlBusy(false);
    }
  };

  const summaryText = (row: ImChatCandidate): string => {
    if (row.latestTaskSummary) return row.latestTaskSummary;
    if (row.summaryState === "incomplete") return t("teamWorkspace.im.inProgress");
    return "";
  };

  const pending = switchState?.pending;
  const currentTarget = targetLabel(switchState?.current);
  const currentFallback = selected?.workspaceAlias ?? (selected?.bindingId ? selected.bindingId : undefined);
  const pendingFrom = targetLabel(pending?.from) ?? (selected?.workspaceAlias ?? t("teamWorkspace.im.unknown"));
  const pendingTo = targetLabel(pending?.to) ?? t("teamWorkspace.im.unknown");

  return (
    <div className="tic-root">
      <section className="tic-list">
        <header>
          <strong>{t("teamWorkspace.im.chats")}</strong>
          <span>{t("teamWorkspace.im.last3Days")}</span>
        </header>
        {rows.length === 0 ? (
          <p className="tic-empty">
            {loading
              ? t("teamWorkspace.im.readingSelector")
              : candidates === undefined
                ? t("teamWorkspace.im.selectorDisconnected")
                : t("teamWorkspace.im.noChats")}
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

            {pending ? (
              <div className="tic-pending">
                <div>
                  <strong>
                    {pending.operation === "unbind"
                      ? t("teamWorkspace.im.pendingUnbind")
                      : t("teamWorkspace.im.pendingBinding")}
                  </strong>
                  <span>
                    {pendingFrom} → {pendingTo}
                  </span>
                  <code>{pending.controlRecord ?? pending.requestId}</code>
                  <small>{t("teamWorkspace.im.pendingDetail")}</small>
                </div>
                <div className="tic-pending-actions">
                  <button type="button" disabled={controlBusy} onClick={() => void confirm()}>
                    {confirming ? t("teamWorkspace.im.confirmAgain") : t("teamWorkspace.im.confirmSwitch")}
                  </button>
                  <button type="button" disabled={controlBusy} onClick={() => void cancel()}>
                    {t("teamWorkspace.im.cancel")}
                  </button>
                </div>
              </div>
            ) : currentTarget || currentFallback ? (
              <div className="tic-current">
                <span>{t("teamWorkspace.im.currentTarget")}</span>
                <strong>{currentTarget ?? currentFallback}</strong>
                {switchLoading ? <small>{t("teamWorkspace.im.reading")}</small> : null}
              </div>
            ) : null}

            {controlError ? <div className="tic-error">{controlError}</div> : null}
            {transcriptError ? <div className="tic-error">{transcriptError}</div> : null}
            <div className="tic-transcript">
              {chatLoading ? <div className="tic-empty">{t("teamWorkspace.im.loading")}</div> : null}
              {(transcript?.bubbles ?? []).map(bubble => (
                <Bubble key={bubble.itemId} bubble={bubble} />
              ))}
              {(transcript?.controls ?? []).map(event => (
                <ControlEvent key={event.entryId} event={event} />
              ))}
              {!chatLoading && (transcript?.bubbles.length ?? 0) === 0 ? (
                <div className="tic-empty">{t("teamWorkspace.im.noMessages")}</div>
              ) : null}
            </div>
            <p className="tic-boundary">{t("teamWorkspace.im.boundary")}</p>
          </>
        ) : (
          <div className="tic-empty">{t("teamWorkspace.im.selectChat")}</div>
        )}
      </section>
    </div>
  );
}
