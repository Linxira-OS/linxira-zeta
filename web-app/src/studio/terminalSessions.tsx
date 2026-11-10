import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { TerminalGraphic } from "./terminalGraphics";
import type { StudioTerminalApi } from "./terminals/api";
import { preloadTerminalApi } from "./terminals/api";
import { createBrowserTerminalApi } from "./terminals/browserTerminalApi";
import type { TerminalProfile } from "./terminals/gatewayTerminal";
import type { XtermSession } from "./terminals/xtermSession";
import { TerminalGraphicsDecoder } from "./terminalGraphics";

export interface TerminalSession {
  readonly targetId: string | null;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly profile: string | null;
  readonly instance: string;
  readonly status: "running" | "ended";
}
export interface TerminalScreenHost { readonly screen: XtermSession; }
interface TerminalState {
  sessions: readonly TerminalSession[];
  graphics: Readonly<Record<string, TerminalGraphic[]>>;
  graphicsErrors: Readonly<Record<string, string>>;
  profiles: readonly TerminalProfile[];
  defaultProfileId: string | null;
  profileWarnings: readonly string[];
  profileError: string | null;
}
const PENDING_MAX_CHARS = 64 * 1024;
const STORAGE_KEY = "studio.terminal.sessions.v1";
const MAX_RESTORED = 4;

interface StoredSession {
  instanceId: string;
  profileId: string | null;
  cwd: string;
  workspaceId?: string;
  targetId: string | null;
  name: string;
}

function readStored(): StoredSession[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is StoredSession => {
        if (!entry || typeof entry !== "object") return false;
        const record = entry as Record<string, unknown>;
        return typeof record.instanceId === "string" && typeof record.cwd === "string";
      })
      .slice(0, MAX_RESTORED);
  } catch {
    return [];
  }
}

function writeStored(sessions: StoredSession[]): void {
  try {
    if (sessions.length === 0) globalThis.sessionStorage?.removeItem(STORAGE_KEY);
    else globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_RESTORED)));
  } catch {
    // Private-mode storage failures must not break the terminal.
  }
}

export class TerminalSessions {
  readonly hosts = new Map<string, TerminalScreenHost>();
  readonly pending = new Map<string, string>();
  readonly activeIds = new Map<string | null, string>();
  readonly #decoders = new Map<string, TerminalGraphicsDecoder>();
  readonly #listeners = new Set<() => void>();
  readonly #earlyExits = new Set<string>();
  #state: TerminalState = {
    sessions: [],
    graphics: {},
    graphicsErrors: {},
    profiles: [],
    defaultProfileId: null,
    profileWarnings: [],
    profileError: null,
  };
  #off: (() => void) | undefined;
  #creating = 0;
  #closed = false;
  #profilesRequest: Promise<void> | undefined;
  #restoring: Promise<number> | undefined;

  constructor(readonly api: StudioTerminalApi | undefined) {}
  snapshot = (): TerminalState => this.#state;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };

  /** Load the shell catalog once; failures become an honest banner. */
  ensureProfiles(): Promise<void> {
    if (!this.api?.profiles || this.#closed) return Promise.resolve();
    if (this.#state.profiles.length > 0 && !this.#state.profileError) return Promise.resolve();
    this.#profilesRequest ??= this.api
      .profiles()
      .then(catalog => {
        this.#publish({
          ...this.#state,
          profiles: catalog.profiles,
          defaultProfileId: catalog.defaultProfileId,
          profileWarnings: catalog.warnings,
          profileError: null,
        });
      })
      .catch(cause => {
        this.#publish({ ...this.#state, profileError: cause instanceof Error ? cause.message : String(cause) });
      })
      .finally(() => {
        this.#profilesRequest = undefined;
      });
    return this.#profilesRequest;
  }

  /** Retry profile discovery after a gateway start/fix. */
  retryProfiles(): Promise<void> {
    this.#publish({ ...this.#state, profileError: null });
    return this.ensureProfiles();
  }

  async create(targetId: string | null, workspaceId?: string, sessionId?: string, profileId?: string): Promise<string> {
    if (!this.api || this.#closed) throw new Error("Terminal gateway is unavailable");
    this.#listen();
    this.#creating++;
    const instanceId = `studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const info = await this.api.create({
        cols: 80,
        rows: 24,
        instanceId,
        ...(profileId ? { profileId } : {}),
        ...(targetId ? { targetId, ...(workspaceId ? { workspaceId } : {}) } : {}),
      });
      if (this.#closed) { await this.api.dispose(info.id); throw new Error("Terminal window has closed"); }
      const session: TerminalSession = {
        ...info,
        profile: info.profile ?? profileId ?? null,
        instance: info.instance ?? instanceId,
        targetId,
        status: this.#earlyExits.delete(info.id) ? "ended" : "running",
        ...(workspaceId ? { workspaceId } : {}),
        ...(sessionId ? { sessionId } : {}),
      };
      this.#publish({ ...this.#state, sessions: [...this.#state.sessions, session] });
      this.activeIds.set(targetId, info.id);
      this.#persist();
      return info.id;
    } finally {
      this.#creating--;
      if (!this.#creating) {
        for (const id of this.pending.keys()) if (!this.#state.sessions.some(session => session.id === id)) this.pending.delete(id);
        this.#earlyExits.clear();
      }
    }
  }

  /**
   * Reattach the tabs stored for this browser session. `ensure` reuses a live
   * PTY for the same `(cwd, instanceId)` slot, so a closed/reopened panel (or a
   * reload while the gateway kept running) gets the same shell and its replay
   * buffer instead of a new process.
   */
  restore(): Promise<number> {
    if (!this.api || this.#closed || this.#state.sessions.length > 0) return Promise.resolve(0);
    this.#restoring ??= (async () => {
      const stored = readStored();
      if (stored.length === 0) return 0;
      this.#listen();
      let restored = 0;
      for (const entry of stored) {
        try {
          const info = await this.api!.create({
            cols: 80,
            rows: 24,
            instanceId: entry.instanceId,
            ...(entry.profileId ? { profileId: entry.profileId } : {}),
            ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
            cwd: entry.cwd,
          });
          const session: TerminalSession = {
            id: info.id,
            name: info.name,
            cwd: info.cwd,
            profile: info.profile ?? entry.profileId,
            instance: info.instance ?? entry.instanceId,
            targetId: entry.targetId,
            status: "running",
            ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
          };
          this.#publish({ ...this.#state, sessions: [...this.#state.sessions, session] });
          restored++;
        } catch (cause) {
          this.#publish({
            ...this.#state,
            profileError: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
      if (restored > 0) {
        this.activeIds.set(this.#state.sessions[0]?.targetId ?? null, this.#state.sessions[0]!.id);
        this.#persist();
      }
      return restored;
    })().finally(() => {
      this.#restoring = undefined;
    });
    return this.#restoring;
  }

  /** Switch a tab's shell: end the slot's session and spawn the chosen profile. */
  async restart(id: string, profileId: string): Promise<string> {
    const session = this.#state.sessions.find(entry => entry.id === id);
    if (!session || !this.api) return id;
    await this.api.dispose(id);
    this.#releaseScreen(id);
    this.#publish({ ...this.#state, sessions: this.#state.sessions.filter(entry => entry.id !== id) });
    this.#creating++;
    try {
      const info = await this.api.create({
        cols: 80,
        rows: 24,
        instanceId: session.instance,
        profileId,
        ...(session.targetId ? { targetId: session.targetId } : {}),
        ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
        cwd: session.cwd,
      });
      const next: TerminalSession = {
        ...session,
        id: info.id,
        name: info.name,
        cwd: info.cwd,
        profile: info.profile ?? profileId,
        instance: info.instance ?? session.instance,
        status: "running",
      };
      this.#publish({ ...this.#state, sessions: [...this.#state.sessions, next] });
      this.activeIds.set(session.targetId, next.id);
      this.#persist();
      return next.id;
    } finally {
      this.#creating--;
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.#state.sessions.some(session => session.id === id)) return;
    await this.api?.dispose(id);
    this.#releaseScreen(id);
    const { [id]: _graphic, ...graphics } = this.#state.graphics;
    const { [id]: _error, ...graphicsErrors } = this.#state.graphicsErrors;
    this.#publish({ ...this.#state, sessions: this.#state.sessions.filter(session => session.id !== id), graphics, graphicsErrors });
    this.#persist();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#off?.();
    for (const session of this.#state.sessions) {
      try {
        void Promise.resolve(this.api?.dispose(session.id)).catch(() => {});
      } catch {
        // Already gone.
      }
    }
    for (const id of this.hosts.keys()) this.#releaseScreen(id);
    this.pending.clear();
    this.#decoders.clear();
    this.#listeners.clear();
  }

  #persist(): void {
    writeStored(
      this.#state.sessions
        .filter(session => session.status === "running")
        .map(session => ({
          instanceId: session.instance,
          profileId: session.profile,
          cwd: session.cwd,
          ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
          targetId: session.targetId,
          name: session.name,
        })),
    );
  }

  #listen(): void {
    if (!this.api || this.#off) return;
    const offData = this.api.onData(event => {
      if (!this.#creating && !this.#state.sessions.some(session => session.id === event.id)) return;
      let decoder = this.#decoders.get(event.id);
      if (!decoder) { decoder = new TerminalGraphicsDecoder(); this.#decoders.set(event.id, decoder); }
      const decoded = decoder.push(event.data);
      if (decoded.images.length || decoded.errors.length) this.#publish({
        ...this.#state,
        graphics: decoded.images.length ? { ...this.#state.graphics, [event.id]: [...(this.#state.graphics[event.id] ?? []), ...decoded.images].slice(-4) } : this.#state.graphics,
        graphicsErrors: decoded.errors.length ? { ...this.#state.graphicsErrors, [event.id]: decoded.errors.join("; ") } : this.#state.graphicsErrors,
      });
      const host = this.hosts.get(event.id);
      if (host) host.screen.enqueue(decoded.text);
      else this.pending.set(event.id, ((this.pending.get(event.id) ?? "") + decoded.text).slice(-PENDING_MAX_CHARS));
    });
    const offExit = this.api.onExit(event => {
      if (this.#creating && !this.#state.sessions.some(session => session.id === event.id)) this.#earlyExits.add(event.id);
      this.#publish({ ...this.#state, sessions: this.#state.sessions.map(session => session.id === event.id ? { ...session, status: "ended" } : session) });
      this.#persist();
    });
    this.#off = () => { offData(); offExit(); };
  }

  #releaseScreen(id: string): void {
    this.hosts.get(id)?.screen.dispose();
    this.hosts.delete(id);
    this.pending.delete(id);
    this.#decoders.delete(id);
  }
  #publish(state: TerminalState): void { this.#state = state; for (const listener of this.#listeners) listener(); }
}

const Context = createContext<TerminalSessions | undefined>(undefined);
export function TerminalSessionsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => {
    const bridge = globalThis.zetaStudioTerminal;
    // Electron preload keeps ownership of PTYs when present; the browser path
    // is the gateway client and needs no desktop shell.
    const api = bridge ? preloadTerminalApi(bridge) : createBrowserTerminalApi();
    return new TerminalSessions(api);
  }, []);
  useEffect(() => () => store.close(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useTerminalSessions() {
  const store = useContext(Context);
  if (!store) throw new Error("Terminal sessions need their window provider");
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  return { store, ...state };
}
