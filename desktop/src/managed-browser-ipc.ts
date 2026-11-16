import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import type { ManagedBrowserCommand, ManagedBrowserPresentation } from "./managed-browser-protocol";
import type { DesktopManagedBrowser } from "./managed-browser";
import type { ManagedBrowserRelay } from "./managed-browser-relay";
import { MANAGED_BROWSER_CHANNELS as CHANNELS } from "./managed-browser-shared";

function sessionId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) throw new Error("Select a valid chat first.");
  return value;
}
function commandInput(value: unknown): ManagedBrowserCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid browser request.");
  const row = value as Record<string, unknown>;
  sessionId(row.sessionId);
  const fields: Record<string, string[]> = {
    create: ["url", "spaceId", "openerPageId"], select: ["pageId"], close: ["pageId"], "close-handoff": ["pageId"], "close-others": ["pageId"], reload: ["pageId"], stop: ["pageId"], back: ["pageId"], forward: ["pageId"], devtools: ["pageId"], pick: ["pageId"], navigate: ["pageId", "url"], zoom: ["pageId", "factor"], find: ["pageId", "text", "forward"], take: [], return: [], release: [], "stop-picking": [], "space-create": ["name"], settings: ["settings"], "permission-forget": ["spaceId", "origin", "permission"], "download-open": ["downloadId"], "download-reveal": ["downloadId"], "download-cancel": ["downloadId"],
  };
  if (typeof row.action !== "string" || !Object.hasOwn(fields, row.action) || Object.keys(row).some(key => !["sessionId", "action", ...fields[row.action as string]!].includes(key))) throw new Error("Invalid browser action.");
  for (const key of fields[row.action]!) {
    const field = row[key];
    if (["spaceId", "openerPageId"].includes(key) && row.action === "create" && field === undefined || key === "forward" && field === undefined) continue;
    if (key === "factor") { if (typeof field !== "number" || !Number.isFinite(field) || field < 0.25 || field > 3) throw new Error("Invalid browser zoom."); }
    else if (key === "forward") { if (typeof field !== "boolean") throw new Error("Invalid browser find direction."); }
    else if (key === "settings") {
      if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error("Invalid browser settings.");
      const settings = field as Record<string, unknown>;
      if (Object.keys(settings).some(name => !["maxTabs", "downloadDirectory", "askDownloadLocation"].includes(name)) || settings.maxTabs !== undefined && (typeof settings.maxTabs !== "number" || !Number.isInteger(settings.maxTabs) || settings.maxTabs < 1 || settings.maxTabs > 256) || settings.downloadDirectory !== undefined && (typeof settings.downloadDirectory !== "string" || settings.downloadDirectory.length > 4096 || settings.downloadDirectory.includes("\0")) || settings.askDownloadLocation !== undefined && typeof settings.askDownloadLocation !== "boolean") throw new Error("Invalid browser settings.");
    } else if (typeof field !== "string" || field.length > (key === "text" ? 16384 : 4096) || field.includes("\0") || !field && key !== "text") throw new Error("Invalid browser command field.");
  }
  // Every discriminant and its fields were checked above; this is the validated IPC union.
  return row as unknown as ManagedBrowserCommand;
}
function presentationInput(value: unknown): ManagedBrowserPresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid browser presentation.");
  const row = value as Record<string, unknown>;
  sessionId(row.sessionId);
  if (Object.keys(row).some(key => !["sessionId", "surfaceId", "windowKey", "pageId", "visible", "bounds", "clip"].includes(key)) || typeof row.surfaceId !== "string" || !row.surfaceId || row.surfaceId.length > 512 || row.windowKey !== undefined && typeof row.windowKey !== "string" || row.pageId !== null && typeof row.pageId !== "string" || typeof row.visible !== "boolean") throw new Error("Invalid browser presentation.");
  for (const key of ["bounds", "clip"]) {
    const rect = row[key];
    if (!rect || typeof rect !== "object" || Array.isArray(rect)) throw new Error("Invalid browser bounds.");
    const values = rect as Record<string, unknown>;
    if (Object.keys(values).length !== 4 || !["x", "y", "width", "height"].every(name => typeof values[name] === "number" && Number.isFinite(values[name]) && Math.abs(values[name] as number) <= 100000) || Number(values.width) < 0 || Number(values.height) < 0) throw new Error("Invalid browser bounds.");
  }
  // The IPC presentation shape and rectangle limits have been checked completely.
  return row as unknown as ManagedBrowserPresentation;
}

/** Renderer roots lease exact prepared descriptors; child panels share only that root's sessions. */
export function registerManagedBrowserIpc(options: {
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  manager: DesktopManagedBrowser; relay: ManagedBrowserRelay;
  isTrustedSender(sender: WebContents): boolean;
  ownerId(sender: WebContents): number;
  ownsWindow(sender: WebContents, key?: string): boolean;
  detachWindow(sender: WebContents): void;
}): { dispose(): void } {
  const documents = new Map<WebContents, { sessions: Set<string>; teardown(): void }>();
  const trusted = (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) => {
    const sender = event.sender;
    if (sender.isDestroyed() || event.senderFrame !== sender.mainFrame || !options.isTrustedSender(sender)) throw new Error("Managed browser requires a trusted desktop document.");
    let document = documents.get(sender);
    if (!document) {
      document = { sessions: new Set(), teardown() {
        if (documents.get(sender) !== document) return;
        documents.delete(sender); options.relay.release(sender.id); options.detachWindow(sender);
        sender.removeListener("destroyed", document!.teardown);
        sender.removeListener("did-navigate", document!.teardown);
        sender.removeListener("render-process-gone", document!.teardown);
        sender.removeListener("did-start-navigation", navigate);
      } };
      const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) document!.teardown(); };
      documents.set(sender, document);
      sender.once("destroyed", document.teardown);
      sender.once("did-navigate", document.teardown);
      sender.once("render-process-gone", document.teardown);
      sender.on("did-start-navigation", navigate);
    }
    return document;
  };
  const owned = (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, id: unknown) => {
    const document = trusted(event), selected = sessionId(id);
    if (!options.relay.owns(options.ownerId(event.sender), selected)) throw new Error("Managed browser is not attached to this view.");
    document.sessions.add(selected);
    return selected;
  };
  options.ipcMain.handle(CHANNELS.available, event => !event.sender.isDestroyed() && event.senderFrame === event.sender.mainFrame && options.isTrustedSender(event.sender));
  options.ipcMain.handle(CHANNELS.attach, async (event, input: unknown) => {
    const document = trusted(event);
    try {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["sessionId", "descriptorId"].includes(key)) || !("sessionId" in input) || !("descriptorId" in input) || typeof input.descriptorId !== "string") throw new Error("Invalid managed browser attachment.");
      if (options.ownerId(event.sender) !== event.sender.id) throw new Error("Attach the managed browser from its root view.");
      const id = sessionId(input.sessionId);
      await options.relay.attach(event.sender.id, { sessionId: id, descriptorId: input.descriptorId });
      if (documents.get(event.sender) !== document || event.sender.isDestroyed() || !options.isTrustedSender(event.sender)) throw new Error("Managed browser view closed.");
      document.sessions.add(id);
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Managed browser unavailable." }; }
  });
  options.ipcMain.handle(CHANNELS.release, (event, input: unknown) => {
    const document = trusted(event);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "sessionId") || !("sessionId" in input)) return { ok: false, message: "Invalid browser release." };
    const id = sessionId(input.sessionId);
    options.relay.release(event.sender.id, id); document.sessions.delete(id); options.detachWindow(event.sender);
    return { ok: true };
  });
  options.ipcMain.handle(CHANNELS.read, (event, id: unknown) => options.manager.read(owned(event, id)));
  options.ipcMain.handle(CHANNELS.execute, (event, value: unknown) => {
    const command = commandInput(value); owned(event, command.sessionId); const document = documents.get(event.sender);
    return options.manager.execute(command, () => documents.get(event.sender) === document && !event.sender.isDestroyed() && options.isTrustedSender(event.sender) && options.relay.owns(options.ownerId(event.sender), command.sessionId));
  });
  options.ipcMain.handle(CHANNELS.present, (event, value: unknown) => {
    const presentation = presentationInput(value); owned(event, presentation.sessionId);
    if (!options.ownsWindow(event.sender, presentation.windowKey)) throw new Error("Browser surface belongs to another window.");
    const document = documents.get(event.sender);
    return options.manager.present({ ...presentation, surfaceId: `${event.sender.id}:${presentation.surfaceId}` }, () => documents.get(event.sender) === document && !event.sender.isDestroyed() && options.isTrustedSender(event.sender) && options.relay.owns(options.ownerId(event.sender), presentation.sessionId));
  });
  const unsubscribe = options.manager.subscribe(event => {
    const id = event.kind === "state" ? event.state.sessionId : event.sessionId;
    for (const [sender, document] of documents) if (document.sessions.has(id) && !sender.isDestroyed() && options.isTrustedSender(sender) && options.relay.owns(options.ownerId(sender), id)) sender.send(CHANNELS.event, event);
  });
  return { dispose() { unsubscribe(); for (const document of [...documents.values()]) document.teardown(); for (const channel of [CHANNELS.available, CHANNELS.attach, CHANNELS.release, CHANNELS.read, CHANNELS.execute, CHANNELS.present]) options.ipcMain.removeHandler(channel); } };
}
