import { connect, type Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PrivateSender, PrivateIpcMain, StudioPrivatePaths } from "./private-ipc";
import {
  PREDICTION_CHANNELS,
  type PredictionResult,
  parsePredictionInput, parsePredictionEvent,
} from "./prediction-protocol";
const id = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
    throw new Error("Invalid prediction ID");
  return value;
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid prediction fields");
  return value as Record<string, unknown>;
}
interface Entry {
  id: string;
  sessionId: string;
  sender: PrivateSender;
  socket: Socket;
  attached: boolean;
  frame: unknown;
  paths: StudioPrivatePaths;
  importing?:
    | {
        id: string;
        resolve: (value: PredictionResult) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
}
export class DesktopPrediction {
  #disposed = false;
  readonly #activeImports = new Set<number>();
  readonly #connections = new Map<number, Entry>();
  readonly #generation = new Map<number, number>();
  constructor(
    readonly options: {
      paths(): Promise<StudioPrivatePaths>;
      isActive(sender: PrivateSender): boolean;
      chooseHistory(sender: PrivateSender): Promise<string | undefined>;
    },
  ) {}
  async attach(sender: PrivateSender, value: unknown): Promise<void> {
    // The renderer forwards the channel `prediction.prepare` returned. Protocol
    // v2 adds ranked choices to the same private event stream.
    const input = object(value, ["channelId", "sessionId", "expiresAt", "protocolVersion"]),
      channelId = id(input.channelId);
    if (input.protocolVersion !== undefined && input.protocolVersion !== 2)
      throw new Error("Invalid prediction protocol");
    if (
      typeof input.sessionId !== "string" ||
      !input.sessionId ||
      input.sessionId.length > 512 || input.sessionId.includes("\0")
    )
      throw new Error("Invalid prediction session");
    if (this.#disposed || sender.isDestroyed() || !this.options.isActive(sender)) throw new Error("Prediction view unavailable");
    this.disposeWindow(sender.id);
    const generation = this.#generation.get(sender.id), frame = sender.mainFrame;
    const paths = await this.options.paths();
    const current = () => !this.#disposed && generation === this.#generation.get(sender.id) && !sender.isDestroyed() && sender.mainFrame === frame && this.options.isActive(sender);
    if (!current()) throw new Error("Prediction target changed");
    const file = join(
        paths.mediaDirectory,
        "prediction",
        channelId + ".json",
      ),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      throw new Error("Prediction descriptor unavailable");
    const descriptor = object(JSON.parse(await readFile(file, "utf8")), [
      "version",
      "channelId",
      "sessionId",
      "endpoint",
      "token",
      "expiresAt",
    ]);
    const endpoint =
      process.platform === "win32"
        ? "\\\\.\\pipe\\zeta-studio-predict-" + channelId
        : join(
            paths.socketDirectory,
            "p-" +
              createHash("sha256")
                .update(channelId)
                .digest("hex")
                .slice(0, 16) +
              ".sock",
          );
    if (
      descriptor.version !== 1 ||
      descriptor.channelId !== channelId ||
      descriptor.sessionId !== input.sessionId ||
      descriptor.endpoint !== endpoint ||
      typeof descriptor.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.token) ||
      typeof descriptor.expiresAt !== "number" ||
      !Number.isSafeInteger(descriptor.expiresAt) ||
      descriptor.expiresAt !== input.expiresAt ||
      descriptor.expiresAt < Date.now() ||
      descriptor.expiresAt > Date.now() + 30000 ||
      generation !== this.#generation.get(sender.id) ||
      !current()
    )
      throw new Error("Prediction descriptor expired or changed");
    const socket = connect(endpoint),
      entry: Entry = {
        id: channelId,
        sessionId: input.sessionId,
        sender,
        socket,
        attached: false,
        frame, paths,
      };
    this.#connections.set(sender.id, entry);
    let accept!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, fail) => {
        accept = resolve;
        reject = fail;
      }),
      timer = setTimeout(() => {
        reject(new Error("Prediction attach timed out"));
        socket.destroy();
      }, 5000);
    const pending = Buffer.alloc(32768); let pendingLength = 0;
    socket.on("error", () => reject(new Error("Prediction connection failed")));
    socket.once("connect", () => { if (!current()) { socket.destroy(); return; } socket.write(descriptor.token + "\n"); });
    socket.once("close", () => {
      clearTimeout(timer);
      reject(new Error("Prediction detached"));
      entry.importing?.resolve({
        ok: false,
        message:
          "Prediction import interrupted and may have partially completed; it was not retried",
      });
      if (entry.importing) clearTimeout(entry.importing.timer);
      const owned = this.#connections.get(sender.id) === entry;
      if (owned) this.#connections.delete(sender.id);
      if (current() && owned)
        sender.send(PREDICTION_CHANNELS.event, { kind: "closed", channelId });
    });
    socket.on("data", (part: Buffer) => {
      if (typeof part === "string" || pendingLength + part.length > pending.length) { socket.destroy(); return; }
      part.copy(pending, pendingLength); pendingLength += part.length;
      for (let at = pending.subarray(0, pendingLength).indexOf(10); at >= 0; at = pending.subarray(0, pendingLength).indexOf(10)) {
        const line = pending.subarray(0, at).toString("utf8");
        pending.copyWithin(0, at + 1, pendingLength); pendingLength -= at + 1;
        if (!current()) { socket.destroy(); return; }
        if (!entry.attached) {
          if (line !== "OK") {
            socket.destroy();
            return;
          }
          entry.attached = true;
          clearTimeout(timer);
          accept();
          continue;
        }
        try {
          const event = parsePredictionEvent(JSON.parse(line));
          if (event.channelId !== entry.id)
            throw new Error("Prediction target changed");
          if (
            event.kind === "imported" &&
            event.requestId === entry.importing?.id
          ) {
            clearTimeout(entry.importing.timer);
            entry.importing.resolve({
              ok: true,
              count: event.count,
              truncated: event.truncated,
            });
            entry.importing = undefined;
          }
          if (
            event.kind === "error" &&
            event.requestId &&
            event.requestId === entry.importing?.id
          ) {
            clearTimeout(entry.importing.timer);
            entry.importing.resolve({ ok: false, message: event.message });
            entry.importing = undefined;
          }
          if (
            current() &&
            this.#connections.get(sender.id) === entry
          )
            sender.send(PREDICTION_CHANNELS.event, event);
        } catch {
          socket.destroy();
          return;
        }
      }
    });
    try {
      await ready;
      if (!current() || socket.destroyed)
        throw new Error("Prediction owner changed");
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
  async input(sender: PrivateSender, value: unknown): Promise<void> {
    const raw = object(value, ["channelId", "input"]);
    const input = parsePredictionInput(raw.input);
    if (input.kind === "import")
      throw new Error("History imports require the file picker");
    const entry = this.#entry(sender, raw.channelId);
    await this.#paths(entry);
    if (entry.socket.writableLength > 32768)
      throw new Error("Prediction input buffer is full");
    entry.socket.write(JSON.stringify(input) + "\n");
  }
  #entry(sender: PrivateSender, channelId: unknown): Entry {
    const entry = this.#connections.get(sender.id);
    if (
      this.#disposed || sender.isDestroyed() || !this.options.isActive(sender) ||
      !entry?.attached || entry.sender !== sender || entry.frame !== sender.mainFrame ||
      entry.id !== id(channelId) ||
      entry.socket.destroyed
    )
      throw new Error("Prediction channel is not owned by this window");
    return entry;
  }
  detach(sender: PrivateSender, value: unknown): void {
    const input = object(value, ["channelId"]);
    if (this.#connections.get(sender.id)?.id === id(input.channelId))
      this.disposeWindow(sender.id);
  }
  async importHistory(
    sender: PrivateSender,
    value: unknown,
  ): Promise<PredictionResult> {
    if (this.#activeImports.has(sender.id))
      throw new Error("A history import is already running");
    this.#activeImports.add(sender.id);
    try {
      return await this.#importHistory(sender, value);
    } finally {
      this.#activeImports.delete(sender.id);
    }
  }
  async #importHistory(
    sender: PrivateSender,
    value: unknown,
  ): Promise<PredictionResult> {
    const raw = object(value, ["channelId"]),
      entry = this.#entry(sender, raw.channelId);
    if (entry.importing) throw new Error("A history import is already running");
    const selected = await this.options.chooseHistory(sender);
    if (!selected) return { ok: true, cancelled: true };
    if (this.#connections.get(sender.id) !== entry || sender.isDestroyed())
      throw new Error("Prediction session changed");
    const paths = await this.#paths(entry);
    const stat = await lstat(selected);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new Error("Select a JSONL history file no larger than 8 MiB");
    const transferId = randomUUID(),
      requestId = randomUUID(),
      directory = join(paths.mediaDirectory, "prediction-imports"),
      target = join(directory, transferId + ".jsonl");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let bytes = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > 8 * 1024 * 1024
            ? new Error("History file exceeds 8 MiB")
            : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        createReadStream(selected),
        bounded,
        createWriteStream(target, { flags: "wx", mode: 0o600 }),
      );
      await this.#paths(entry);
      const result = new Promise<PredictionResult>((resolve) => {
        const timer = setTimeout(() => {
          if (entry.importing?.id === requestId) {
            entry.importing = undefined;
            resolve({
              ok: false,
              message: "Prediction import timed out; it was not retried",
            });
          }
        }, 90000);
        entry.importing = { id: requestId, resolve, timer };
      });
      entry.socket.write(
        JSON.stringify({ kind: "import", requestId, transferId }) + "\n",
      );
      return await result;
    } finally {
      await unlink(target).catch(() => {});
    }
  }
  async #paths(entry: Entry): Promise<StudioPrivatePaths> {
    const paths = await this.options.paths();
    if (this.#entry(entry.sender, entry.id) !== entry || paths.mediaDirectory !== entry.paths.mediaDirectory || paths.socketDirectory !== entry.paths.socketDirectory) { entry.socket.destroy(); throw new Error("Prediction Host changed"); }
    return paths;
  }
  disposeWindow(owner: number): void {
    this.#generation.set(owner, (this.#generation.get(owner) ?? 0) + 1);
    this.#connections.get(owner)?.socket.destroy();
    this.#connections.delete(owner);
  }
  dispose(): void {
    this.#disposed = true;
    for (const owner of this.#connections.keys()) this.disposeWindow(owner);
  }
}
export function registerPredictionIpc(options: {
  ipcMain: PrivateIpcMain;
  manager: DesktopPrediction;
  isTrustedSender(sender: PrivateSender): boolean;
  isVisible(sender: PrivateSender): boolean;
}): { dispose(): void } {
  const owners = new Map<number, { dispose(): void }>();
  for (const kind of ["attach", "input", "detach", "import"] as const)
    options.ipcMain.handle(
      PREDICTION_CHANNELS[kind],
      async ({ sender, senderFrame }, input): Promise<PredictionResult> => {
        if (sender.isDestroyed() || senderFrame !== sender.mainFrame || !options.isTrustedSender(sender))
          throw new Error("Untrusted prediction request");
        if (kind !== "detach" && !options.isVisible(sender)) {
          options.manager.disposeWindow(sender.id);
          return { ok: false, message: "Prediction requires a visible window" };
        }
        if (kind === "attach" && !owners.has(sender.id)) {
          const dispose = () => {
            options.manager.disposeWindow(sender.id); owners.delete(sender.id);
            sender.removeListener("destroyed", dispose);
            sender.removeListener("did-navigate", dispose);
            sender.removeListener("render-process-gone", dispose);
            sender.removeListener("did-start-navigation", navigate);
          };
          const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => { if (mainFrame && !inPlace) dispose(); };
          owners.set(sender.id, { dispose });
          sender.once("destroyed", dispose);
          sender.once("did-navigate", dispose);
          sender.once("render-process-gone", dispose);
          sender.on("did-start-navigation", navigate);
        }
        try {
          if (kind === "attach") await options.manager.attach(sender, input);
          else if (kind === "input") await options.manager.input(sender, input);
          else if (kind === "detach") options.manager.detach(sender, input);
          else return await options.manager.importHistory(sender, input);
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  return {
    dispose() {
      for (const kind of ["attach", "input", "detach", "import"] as const)
        options.ipcMain.removeHandler(PREDICTION_CHANNELS[kind]);
      for (const owner of [...owners.values()]) owner.dispose();
      owners.clear();
    },
  };
}
