import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { readTerminalTypography, readXtermTheme, applyTheme } from "./terminalTheme";
import { useAppSettings } from "./settings/appSettings";
import { useTerminalSessions, type TerminalSession as Session } from "./terminalSessions";
import { TerminalGraphicView } from "./TerminalGraphicView";
import { TerminalRecordingControls } from "./recordings/TerminalRecordingControls";
import { XtermSession, type TerminalRenderer } from "./terminals/xtermSession";
import { useExecutionTarget } from "./workspaces/ExecutionTargets";
/**
 * Work Studio terminal. The PTY lives behind the gateway's WebSocket; the
 * browser owns only the emulator. `window.zetaStudioTerminal` (Electron
 * preload) is used when present, but the browser path never needs it.
 */

import { Icon } from "./icons";
import { useI18n } from "./i18n";

/** 每个终端的回滚行数。乘以同时存在的终端数就是本面板的内存底数。 */
const TERMINAL_SCROLLBACK_LINES = 10_000;

export type TerminalPaneHandle = {
  create: () => void;
  available: boolean;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, { visible: boolean; workspaceId?: string | undefined; sessionId?: string | undefined }>(function TerminalPane(
  { visible, workspaceId, sessionId },
  ref,
) {
  const { t } = useI18n();
  const { store, sessions: allSessions, graphics, graphicsErrors, profiles, defaultProfileId, profileWarnings, profileError } = useTerminalSessions();
  const executionTarget = useExecutionTarget();
  const sessions = allSessions.filter(session => session.targetId === executionTarget.id);
  const api = store.api;
  const [activeId, setActiveId] = useState<string | null>(() => store.activeIds.get(executionTarget.id) ?? null);
  const [newProfileId, setNewProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [renderer, setRenderer] = useState<TerminalRenderer>("webgl");
  const bootstrapped = useRef(false);
  const createLock = useRef(false);
  const targetStatus = executionTarget.inventory.statuses.find(status => status.id === executionTarget.id);
  const canCreate = !executionTarget.id || (targetStatus?.state === "connected" && !targetStatus.operation);
  const selectSession = (id: string): void => { store.activeIds.set(executionTarget.id, id); setActiveId(id); };
  const active = sessions.find(session => session.id === activeId) ?? sessions[0] ?? null;
  const activeHost = active ? store.hosts.get(active.id) : undefined;
  const defaultShell = newProfileId ?? active?.profile ?? defaultProfileId ?? undefined;

  const createSession = useCallback(async () => {
    if (!api || createLock.current || !canCreate) return;
    createLock.current = true;
    setCreating(true);
    setError(null);
    try {
      setActiveId(await store.create(executionTarget.id, workspaceId, sessionId, defaultShell));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  }, [api, store, workspaceId, sessionId, executionTarget.id, canCreate, defaultShell]);

  useImperativeHandle(ref, () => ({ create: () => { void createSession(); }, available: api !== undefined && canCreate }), [api, canCreate, createSession]);

  useEffect(() => { if (!visible) bootstrapped.current = false; }, [visible]);

  useEffect(() => {
    if (!visible) return;
    void store.ensureProfiles();
  }, [visible, store]);

  useEffect(() => {
    if (!api || bootstrapped.current || !visible || !canCreate) return;
    if (sessions.length > 0) { bootstrapped.current = true; return; }
    bootstrapped.current = true;
    void (async () => {
      const restored = await store.restore();
      if (restored === 0 && store.snapshot().sessions.length === 0) await createSession();
    })();
  }, [api, visible, canCreate, sessions.length, store, createSession]);

  const selectedProfile = active?.profile ?? newProfileId ?? defaultProfileId ?? "";

  const changeProfile = async (profileId: string): Promise<void> => {
    setError(null);
    if (!active) { setNewProfileId(profileId); return; }
    setRestarting(true);
    try {
      const id = await store.restart(active.id, profileId);
      selectSession(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestarting(false);
    }
  };

  const reconnect = async (): Promise<void> => {
    if (!active) return;
    setRestarting(true);
    try {
      selectSession(await store.restart(active.id, active.profile ?? defaultProfileId ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRestarting(false);
    }
  };

  const copy = (): void => { void activeHost?.screen.copySelection().catch(cause => setError(String(cause))); };
  const paste = (): void => {
    void navigator.clipboard.readText()
      .then(text => activeHost?.screen.paste(text))
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  if (!api) {
    return (
      <div className="empty">
        <Icon name="terminal" extra="lg" />
        <p>{t("terminal.profileError")}</p>
        <button type="button" className="btn small outline" onClick={() => void store.retryProfiles()}>{t("terminal.retry")}</button>
      </div>
    );
  }

  return (
    <div className="term-layout">
      <div className="term-tabs" role="tablist" aria-label={t("terminal.listAria")}>
        {sessions.map((session, index) => {
          const selected = session.id === active?.id;
          return (
            <div
              key={session.id}
              className={`term-tab${selected ? " active" : ""}${session.status === "ended" ? " ended" : ""}`}
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              onClick={() => selectSession(session.id)}
            >
              <Icon name="terminal" extra="sm" />
              <span className="term-tab-name ellipsis">{session.name || `Terminal ${index + 1}`}</span>
              {session.status === "ended" ? <span className="chip gray xs">{t("terminal.statusEnded")}</span> : null}
              <button
                className="icon-btn small"
                type="button"
                aria-label={`${t("terminal.close")} ${session.name}`}
                onClick={event => { event.stopPropagation(); void store.remove(session.id).catch(cause => setError(String(cause))); }}
              >
                <Icon name="x" extra="sm" />
              </button>
            </div>
          );
        })}
        <button className="term-new" type="button" disabled={creating || !canCreate} onClick={() => void createSession()} aria-label={t("terminal.newTerminal")}>
          <Icon name="plus" extra="sm" />
        </button>
        <span className="spacer" />
        <label className="term-shell">
          <Icon name="terminal" extra="sm" />
          <select
            value={selectedProfile}
            aria-label={t("terminal.selectShell")}
            disabled={restarting || profiles.length === 0}
            onChange={event => void changeProfile(event.target.value)}
          >
            {profiles.length === 0 ? <option value="">—</option> : null}
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.label}{profile.detail ? ` — ${profile.detail}` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="term-renderer chip gray xs" title={t("terminal.renderer")}>{renderer}</span>
        <button className="icon-btn small" type="button" disabled={!active} data-tip={t("terminal.copy")} aria-label={t("terminal.copy")} onClick={copy}><Icon name="copy" extra="sm" /></button>
        <button className="icon-btn small" type="button" disabled={!active} data-tip={t("terminal.paste")} aria-label={t("terminal.paste")} onClick={paste}><Icon name="clipboard" extra="sm" /></button>
        <button className="icon-btn small" type="button" disabled={!activeHost} data-tip={t("terminal.clear")} aria-label={t("terminal.clear")} onClick={() => activeHost?.screen.clear()}><Icon name="trash" extra="sm" /></button>
        {active?.status === "ended" ? (
          <button className="btn small outline" type="button" disabled={restarting} onClick={() => void reconnect()}>{t("terminal.reconnect")}</button>
        ) : null}
      </div>
      <div className="term-view">
        {profileError ? (
          <div className="term-banner error" role="alert">
            <Icon name="alert-c" extra="sm" />
            <span>{t("terminal.gatewayError")}: {profileError}</span>
            <button type="button" className="btn small outline" onClick={() => void store.retryProfiles()}>{t("terminal.retry")}</button>
          </div>
        ) : null}
        {profileWarnings.length > 0 ? (
          <div className="term-banner warn" role="status">
            <Icon name="alert-c" extra="sm" />
            <span>{t("terminal.profilesWarning")}: {profileWarnings.join("; ")}</span>
          </div>
        ) : null}
        {executionTarget.id ? (
          <div className="empty">
            <Icon name="terminal" extra="lg" />
            <p>{t("terminal.localOnly")}</p>
          </div>
        ) : null}
        {error ? <p role="alert" className="muted small term-error">{error}</p> : null}
        {active && !executionTarget.id ? (
          <>
            <div className="term-cwd">
              <Icon name="folder" extra="sm" />
              <span className="ellipsis">{active.cwd}</span>
              {active.status === "ended" ? (
                <span className="chip gray xs" style={{ marginLeft: "auto" }}>{t("terminal.statusEnded")}</span>
              ) : (
                <span className="chip green xs" style={{ marginLeft: "auto" }}>{active.name}</span>
              )}
            </div>
            {globalThis.zetaStudioTerminal && active.workspaceId && active.sessionId ? <TerminalRecordingControls key={active.id} api={globalThis.zetaStudioTerminal} id={active.id} ended={active.status === "ended"} workspaceId={active.workspaceId} sessionId={active.sessionId} /> : null}
            {(graphics[active.id]?.length || graphicsErrors[active.id]) ? <div style={{ maxHeight: 240, overflow: "auto" }} aria-label="Terminal images / 终端图片">
              {graphics[active.id]?.map((image, index) => <TerminalGraphicView key={index} image={image} />)}
              {graphicsErrors[active.id] ? <p role="status">{graphicsErrors[active.id]}</p> : null}
            </div> : null}
            <div className="term-screens">
              {sessions.map(session => (
                <XtermScreen
                  key={session.id}
                  session={session}
                  hosts={store.hosts}
                  pending={store.pending}
                  active={visible && session.id === active.id}
                  onRendererChange={setRenderer}
                  onError={message => setError(message)}
                />
              ))}
            </div>
          </>
        ) : null}
        {!active && !executionTarget.id ? (
          <div className="empty">
            <Icon name="terminal" extra="lg" />
            <p>{creating || restarting ? t("terminal.starting") : t("terminal.noSessions")}</p>
            {profileError ? null : <p className="muted small">{t("terminal.clickToStart")}</p>}
            <button type="button" className="btn small outline" disabled={creating || !canCreate} onClick={() => void createSession()}>
              <Icon name="plus" extra="sm" />
              {t("terminal.newTerminal")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

function XtermScreen({
  session,
  hosts,
  pending,
  active,
  onRendererChange,
  onError,
}: {
  session: Session;
  hosts: Map<string, { readonly screen: XtermSession }>;
  pending: Map<string, string>;
  active: boolean;
  onRendererChange: (renderer: TerminalRenderer) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useAppSettings();
  const { store } = useTerminalSessions();
  const api = store.api;

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !api) return;
    let host = hosts.get(session.id);
    if (host === undefined) {
      const typography = readTerminalTypography();
      // `?terminalRenderer=dom` is the diagnostic escape hatch for GPU-canvas
      // capture and for machines whose driver drops WebGL contexts.
      const forcedRenderer = new URLSearchParams(location.search).get("terminalRenderer");
      const screen = new XtermSession({
        container: node,
        ...typography,
        lineHeight: 1.25,
        theme: readXtermTheme(),
        scrollback: TERMINAL_SCROLLBACK_LINES,
        renderer: forcedRenderer === "dom" ? "dom" : "webgl",
        active,
        onInput: data => { void api.write(session.id, data); },
        onResize: (cols, rows) => { void api.resize(session.id, cols, rows); },
        onRendererChange: renderer => onRendererChange(renderer),
      });
      screen.term.attachCustomKeyEventHandler(event => {
        const primary = event.ctrlKey || event.metaKey;
        if (!primary || !event.shiftKey) return true;
        const key = event.key.toLowerCase();
        if (key === "c") { void screen.copySelection().catch(cause => onError(String(cause))); return false; }
        if (key === "v") {
          void navigator.clipboard.readText().then(text => screen.paste(text)).catch(cause => onError(String(cause)));
          return false;
        }
        return true;
      });
      host = { screen };
      hosts.set(session.id, host);
      const queued = pending.get(session.id);
      if (queued !== undefined) {
        screen.enqueue(queued);
        pending.delete(session.id);
      }
    } else if (host.screen.term.element && host.screen.term.element.parentElement !== node) {
      // The panel was closed and reopened: the emulator survives, its DOM
      // container did not. Move the rendered element instead of rebuilding it.
      node.appendChild(host.screen.term.element);
    }
    const observer = new MutationObserver(() => {
      applyTheme(host!.screen.term);
      host!.screen.fitToContainer();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { observer.disconnect(); };
  }, [api, hosts, pending, session.id, onRendererChange, onError]);

  useEffect(() => {
    const host = hosts.get(session.id);
    if (!host) return;
    host.screen.setActive(active);
    if (!active) return;
    const node = containerRef.current;
    if (!node) return;
    let disposed = false;
    let frame = 0;
    const fit = (): void => {
      if (disposed || node.clientWidth === 0 || node.clientHeight === 0) return;
      host.screen.fitToContainer();
    };
    applyTheme(host.screen.term);
    frame = requestAnimationFrame(() => { fit(); host.screen.focus(); });
    void document.fonts?.ready.then(fit);
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(node);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, hosts, session.id, settings.terminalFontFamily, settings.terminalFontSize]);

  return <div className="term-xterm" ref={containerRef} hidden={!active} />;
}
