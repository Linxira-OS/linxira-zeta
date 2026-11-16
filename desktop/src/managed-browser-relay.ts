import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebContents } from "electron";
import type { ManagedBrowserPage } from "./managed-browser-protocol";
import type { DesktopManagedBrowser, ManagedBrowserRuntime } from "./managed-browser.js";
import type { StudioPrivatePaths } from "./private-ipc";

interface Descriptor { version: number; sessionId: string; generation: string; endpoint: string; pid: number; }
interface Lease { owner: number; sessionId: string; descriptorId: string; descriptor?: Descriptor }
interface TabSnapshot { studioPageId: string; studioDocumentId?: string; tabId: number; url: string; title: string; active: boolean; discarded: boolean; windowId: number; pinned: boolean; groupId: number; }
interface RelayRequest { t: "rpc"; id: number; op: string; tabId?: number; sessionId?: string; method?: string; params?: Record<string, unknown>; url?: string; active?: boolean; action?: "enable" | "list"; directory?: string; }
interface Attached { contents: WebContents; message: (event: Electron.Event, method: string, params: Record<string, unknown>, sessionId?: string) => void; detach: (event: Electron.Event, reason: string) => void; }
interface Link {
  descriptor: Descriptor;
  socket: WebSocket;
  signatures: Map<number, string>;
  attached: Map<number, Attached>;
  controls: Map<number, { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }>;
  ready: boolean;
  opened: Promise<void>;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class ManagedBrowserRelay implements ManagedBrowserRuntime {
  readonly #links = new Map<string, Link>();
  readonly #leases = new Map<string, Lease>();
  readonly #pageNumbers = new Map<string, number>();
  readonly #pagesByNumber = new Map<number, string>();
  readonly #instance = randomUUID();
  #nextPage = 1;
  #nextControl = 1;
  #disposed = false;
  #scanning = false;
  readonly #timer: NodeJS.Timeout;

  constructor(readonly options: { manager: DesktopManagedBrowser; authority(): Promise<(StudioPrivatePaths & { readonly pid: number }) | undefined> }) {
    options.manager.setRuntime(this);
    this.#timer = setInterval(() => { void this.#scan().catch(() => { for (const lease of [...this.#leases.values()]) this.release(lease.owner, lease.sessionId); }); }, 1000);
    this.#timer.unref();
  }
  async #read(lease: Lease, authority: StudioPrivatePaths & { readonly pid: number }): Promise<Descriptor> {
    const filename = join(authority.mediaDirectory, "managed-browser", lease.descriptorId), info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("Managed browser descriptor unavailable");
    const value: unknown = JSON.parse(await readFile(filename, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid managed browser descriptor");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !["version", "sessionId", "generation", "endpoint", "pid"].includes(key)) || row.version !== 1 || row.sessionId !== lease.sessionId || typeof row.generation !== "string" || !/^[a-f0-9-]{36}$/.test(row.generation) || row.pid !== authority.pid || typeof row.endpoint !== "string") throw new Error("Managed browser Host identity changed");
    if (lease.descriptorId !== `${createHash("sha256").update(lease.sessionId).digest("hex")}-${row.generation}.json`) throw new Error("Managed browser descriptor does not match this session");
    const endpoint = new URL(row.endpoint);
    if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/managed\/[a-f0-9]{64}$/.test(endpoint.pathname)) throw new Error("Invalid private managed browser endpoint");
    return { version: 1, sessionId: lease.sessionId, generation: row.generation, endpoint: endpoint.href, pid: authority.pid };
  }
  async attach(owner: number, input: { sessionId: string; descriptorId: string }): Promise<void> {
    if (this.#disposed || !input || typeof input.sessionId !== "string" || !input.sessionId || input.sessionId.length > 512 || input.sessionId.includes("\0") || typeof input.descriptorId !== "string" || !/^[a-f0-9]{64}-[a-f0-9-]{36}\.json$/.test(input.descriptorId)) throw new Error("Invalid managed browser attachment");
    const previous = this.#leases.get(input.sessionId);
    if (previous && previous.owner !== owner) throw new Error("Managed browser is owned by another window");
    const lease: Lease = { owner, sessionId: input.sessionId, descriptorId: input.descriptorId };
    this.#leases.set(input.sessionId, lease);
    try {
      await this.options.manager.ready;
      const authority = await this.options.authority();
      if (!authority) throw new Error("Private managed browser Host is unavailable");
      const descriptor = await this.#read(lease, authority);
      const current = await this.options.authority();
      if (this.#disposed || this.#leases.get(input.sessionId) !== lease || !current || current.pid !== authority.pid || current.mediaDirectory !== authority.mediaDirectory) throw new Error("Managed browser owner changed");
      const link = this.#links.get(input.sessionId);
      if (link?.descriptor.generation === descriptor.generation && link.socket.readyState < WebSocket.CLOSING) { lease.descriptor = descriptor; await link.opened; if (this.#leases.get(input.sessionId) !== lease) throw new Error("Managed browser owner changed"); return; }
      if (link) { this.#disconnect(link); this.#leases.set(input.sessionId, lease); }
      const response = await fetch(descriptor.endpoint + "/json/list", { redirect: "error", signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error("Managed browser producer unavailable");
      await response.body?.cancel();
      if (this.#disposed || this.#leases.get(input.sessionId) !== lease) throw new Error("Managed browser owner changed");
      const live = await this.options.authority();
      if (!live || live.pid !== descriptor.pid || live.mediaDirectory !== authority.mediaDirectory || this.#leases.get(input.sessionId) !== lease) throw new Error("Managed browser Host changed");
      lease.descriptor = descriptor;
      await this.#connect(descriptor);
      if (this.#disposed || this.#leases.get(input.sessionId) !== lease) throw new Error("Managed browser owner changed");
    } catch (error) { if (this.#leases.get(input.sessionId) === lease) this.release(owner, input.sessionId); throw error; }
  }
  release(owner: number, sessionId?: string): void {
    for (const [id, lease] of this.#leases) if (lease.owner === owner && (sessionId === undefined || id === sessionId)) {
      this.#leases.delete(id);
      this.options.manager.detachSession(id);
      const link = this.#links.get(id); if (link) this.#disconnect(link);
    }
  }
  releaseAll(): void { for (const lease of [...this.#leases.values()]) this.release(lease.owner, lease.sessionId); }
  owns(owner: number, sessionId: string): boolean {
    const lease = this.#leases.get(sessionId), link = this.#links.get(sessionId);
    return lease?.owner === owner && !!link?.ready && link.descriptor.generation === lease.descriptor?.generation;
  }
  async #scan(): Promise<void> {
    if (this.#disposed || this.#scanning || !this.#leases.size) return;
    this.#scanning = true;
    try {
      const authority = await this.options.authority();
      for (const [id, lease] of this.#leases) {
        try {
          if (!lease.descriptor) continue;
          if (!authority) throw new Error("Managed browser Host unavailable");
          const descriptor = await this.#read(lease, authority);
          if (this.#leases.get(id) !== lease) continue;
          if (descriptor.pid !== lease.descriptor.pid || descriptor.generation !== lease.descriptor.generation || descriptor.endpoint !== lease.descriptor.endpoint) throw new Error("Managed browser Host changed");
          if (!this.#links.has(id)) this.release(lease.owner, id);
        } catch { if (this.#leases.get(id) === lease) this.release(lease.owner, id); }
      }
    } finally { this.#scanning = false; }
  }
  #number(page: ManagedBrowserPage): number {
    let number = this.#pageNumbers.get(page.id);
    if (number === undefined) { number = this.#nextPage++; this.#pageNumbers.set(page.id, number); this.#pagesByNumber.set(number, page.id); }
    return number;
  }
  #snapshot(page: ManagedBrowserPage): TabSnapshot {
    return { studioPageId: page.id, ...(page.documentId ? { studioDocumentId: page.documentId } : {}), tabId: this.#number(page), url: page.url, title: page.title, active: this.options.manager.store.state(page.sessionId).activePageId === page.id, discarded: page.status === "crashed" || page.devtools || this.options.manager.isReleased(page.id), windowId: 1, pinned: false, groupId: -1 };
  }
  #send(link: Link, message: unknown): void { if (link.socket.readyState === WebSocket.OPEN) link.socket.send(JSON.stringify(message)); }
  #connect(descriptor: Descriptor): Promise<void> {
    const socket = new WebSocket(descriptor.endpoint.replace(/^http:/u, "ws:") + "/ext");
    const ready = Promise.withResolvers<void>();
    const timer = setTimeout(() => { ready.reject(new Error("Managed browser attach timed out")); this.#disconnect(link); }, 65_000);
    const link: Link = { descriptor, socket, signatures: new Map(), attached: new Map(), controls: new Map(), ready: false, opened: ready.promise, reject: ready.reject, timer };
    this.#links.set(descriptor.sessionId, link);
    this.options.manager.store.connection(descriptor.sessionId, "connecting");
    socket.addEventListener("open", () => {
      if (this.#disposed || this.#links.get(descriptor.sessionId) !== link || this.#leases.get(descriptor.sessionId)?.descriptor?.generation !== descriptor.generation) { this.#disconnect(link); return; }
      const tabs = this.options.manager.pages(descriptor.sessionId).map(page => this.#snapshot(page));
      for (const tab of tabs) link.signatures.set(tab.tabId, JSON.stringify(tab));
      this.#send(link, { t: "hello", userAgent: `Zeta Studio Electron/${process.versions.electron}`, browserVersion: process.versions.chrome ? `Chrome/${process.versions.chrome}` : "", tabs, attachedTabIds: [], discardedTabsProtocol: 1, instanceId: this.#instance, browserSession: this.#instance });
      const control = this.options.manager.store.initialControl(descriptor.sessionId) ?? "agent";
      void this.#requestControl(link, control === "waiting" ? "human" : control).then(() => {
        if (socket.readyState !== WebSocket.OPEN || this.#links.get(descriptor.sessionId) !== link || this.#leases.get(descriptor.sessionId)?.descriptor?.generation !== descriptor.generation) { this.#disconnect(link); return; }
        link.ready = true; clearTimeout(timer); this.options.manager.store.connection(descriptor.sessionId, "connected");
        if (control === "waiting") this.options.manager.store.control(descriptor.sessionId, "human");
        ready.resolve();
      }).catch(error => { ready.reject(error); this.#disconnect(link); });
    });
    socket.addEventListener("message", event => {
      let message: Omit<RelayRequest, "t"> & { t: string; ok?: boolean; error?: string };
      try { message = JSON.parse(String(event.data)); } catch { socket.close(); return; }
      if (message.t === "studioControlResult") {
        const pending = link.controls.get(message.id);
        if (pending) { clearTimeout(pending.timer); link.controls.delete(message.id); if (message.ok) pending.resolve(); else pending.reject(new Error(message.error ?? "Browser control handoff failed.")); }
      } else if (message.t === "rpc") {
        void this.#rpc(link, { ...message, t: "rpc" }).then(result => this.#send(link, { t: "rpcResult", id: message.id, ok: true, result }), error => this.#send(link, { t: "rpcResult", id: message.id, ok: false, error: error instanceof Error ? error.message : "Browser operation failed" }));
      }
    });
    socket.addEventListener("close", () => this.#disconnect(link));
    socket.addEventListener("error", () => socket.close());
    return ready.promise;
  }
  #disconnect(link: Link): void {
    clearTimeout(link.timer); link.reject(new Error("Managed browser producer disconnected"));
    for (const pending of link.controls.values()) { clearTimeout(pending.timer); pending.reject(new Error("Runtime disconnected during browser control handoff.")); }
    link.controls.clear();
    for (const tabId of [...link.attached.keys()]) this.#detach(link, tabId);
    link.ready = false;
    if (link.socket.readyState < WebSocket.CLOSING) link.socket.close();
    if (this.#links.get(link.descriptor.sessionId) === link) {
      this.#links.delete(link.descriptor.sessionId);
      this.options.manager.detachSession(link.descriptor.sessionId);
      const lease = this.#leases.get(link.descriptor.sessionId);
      if (lease?.descriptor?.generation === link.descriptor.generation) this.#leases.delete(link.descriptor.sessionId);
      this.options.manager.store.connection(link.descriptor.sessionId, "disconnected");
    }
  }
  #requestControl(link: Link, control: "human" | "agent"): Promise<void> {
    if (link.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Runtime browser connection is unavailable."));
    const id = this.#nextControl++;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { link.controls.delete(id); reject(new Error("Browser handoff is still waiting for the current operation. Retry after it finishes.")); }, 60000);
      link.controls.set(id, { resolve, reject, timer });
      this.#send(link, { t: "studioControl", id, control });
    });
  }
  async control(sessionId: string, control: "human" | "agent"): Promise<void> {
    const link = this.#links.get(sessionId);
    if (!link) throw new Error("Managed browser producer is unavailable.");
    await this.#requestControl(link, control);
    this.changed(sessionId);
  }
  changed(sessionId: string): void {
    const link = this.#links.get(sessionId);
    if (!link || link.socket.readyState !== WebSocket.OPEN) return;
    const liveIds = new Set<number>();
    for (const page of this.options.manager.pages(sessionId)) {
      const tab = this.#snapshot(page), signature = JSON.stringify(tab); liveIds.add(tab.tabId);
      if (link.signatures.get(tab.tabId) === signature) continue;
      this.#send(link, { t: link.signatures.has(tab.tabId) ? "tabUpdated" : "tabCreated", tab });
      link.signatures.set(tab.tabId, signature);
    }
    for (const tabId of [...link.signatures.keys()]) if (!liveIds.has(tabId)) { this.#send(link, { t: "tabRemoved", tabId }); link.signatures.delete(tabId); }
  }
  closed(pageId: string): void {
    const tabId = this.#pageNumbers.get(pageId);
    if (tabId === undefined) return;
    for (const link of this.#links.values()) if (link.attached.has(tabId)) this.#detach(link, tabId);
    if (!this.options.manager.store.page(pageId)) { this.#pageNumbers.delete(pageId); this.#pagesByNumber.delete(tabId); }
  }
  #page(link: Link, tabId: number | undefined): ManagedBrowserPage {
    const pageId = tabId === undefined ? undefined : this.#pagesByNumber.get(tabId);
    const page = pageId ? this.options.manager.store.page(pageId) : undefined;
    if (!page || page.sessionId !== link.descriptor.sessionId) throw new Error("This browser page does not belong to the connected chat.");
    return page;
  }
  async #attach(link: Link, tabId: number): Promise<WebContents> {
    const page = this.#page(link, tabId);
    const contents = await this.options.manager.ensure(page.id);
    if (this.#disposed || this.#links.get(link.descriptor.sessionId) !== link || !this.#leases.has(link.descriptor.sessionId)) throw new Error("Managed browser owner changed");
    const release = this.options.manager.holdActivity(page.id);
    try {
      if (link.attached.has(tabId) && contents.debugger.isAttached()) return contents;
      if (contents.isDevToolsOpened()) throw new Error("DevTools is open. Return browser control after closing DevTools.");
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
      const message = (_event: Electron.Event, method: string, params: Record<string, unknown>, sessionId?: string) => this.#send(link, { t: "cdpEvent", tabId, method, params, ...(sessionId ? { sessionId } : {}) });
      const detach = (_event: Electron.Event, reason: string) => {
        contents.debugger.removeListener("message", message); link.attached.delete(tabId);
        this.#send(link, { t: "detached", tabId, reason, relayInitiated: this.options.manager.store.state(page.sessionId).control !== "agent" });
      };
      link.attached.set(tabId, { contents, message, detach });
      contents.debugger.on("message", message); contents.debugger.once("detach", detach);
      return contents;
    } finally { release(); }
  }
  #detach(link: Link, tabId: number): void {
    const attached = link.attached.get(tabId);
    if (!attached) return;
    link.attached.delete(tabId);
    attached.contents.debugger.removeListener("message", attached.message); attached.contents.debugger.removeListener("detach", attached.detach);
    if (!attached.contents.isDestroyed() && attached.contents.debugger.isAttached()) attached.contents.debugger.detach();
    this.#send(link, { t: "detached", tabId, reason: "studio-control", relayInitiated: true });
  }
  async #rpc(link: Link, request: RelayRequest): Promise<unknown> {
    if (this.#disposed || this.#links.get(link.descriptor.sessionId) !== link || this.#leases.get(link.descriptor.sessionId)?.descriptor?.generation !== link.descriptor.generation) throw new Error("Managed browser owner changed");
    const manager = this.options.manager, sessionId = link.descriptor.sessionId;
    if (request.op === "detach") { this.#detach(link, request.tabId!); return {}; }
    if (manager.store.initialControl(sessionId) === "human" && ["createTab", "removeTab", "activateTab"].includes(request.op)) throw new Error("This chat's browser is under human control.");
    switch (request.op) {
      case "createTab": return { tab: this.#snapshot(await manager.create(sessionId, request.url ?? "about:blank", "agent")) };
      case "removeTab": { const page = this.#page(link, request.tabId); await manager.close(sessionId, page.id); return {}; }
      case "activateTab": { const page = this.#page(link, request.tabId); manager.store.select(sessionId, page.id); return {}; }
      case "group": return { groupId: -1 };
      case "ungroup": return {};
      case "attach": await this.#attach(link, request.tabId!); return {};
      case "studioDownloads": return manager.downloadOperation(this.#page(link, request.tabId).id, request.action!, request.directory);
      case "send": {
        const contents = await this.#attach(link, request.tabId!);
        if (request.method === "Page.bringToFront") return {};
        if (request.method === "Browser.setDownloadBehavior") return {};
        return manager.agentCommand(this.#page(link, request.tabId).id, request.method!, request.params, request.sessionId);
      }
      default: throw new Error(`Unsupported Studio browser operation: ${request.op}`);
    }
  }
  async dispose(): Promise<void> { this.#disposed = true; clearInterval(this.#timer); this.#leases.clear(); for (const link of [...this.#links.values()]) this.#disconnect(link); }
}
