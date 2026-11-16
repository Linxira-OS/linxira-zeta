import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, open, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  evaluationTerminal,
  type EvaluationRecord,
  type EvaluationPlan,
  type EvaluationSpec,
  type EvaluationListInput,
  type EvaluationListResult,
  type EvaluationStartInput,
  type EvaluationControlInput,
  type EvaluationNativeSnapshot,
  type EvaluationResultPage,
  type EvaluationWorkspaceOperation,
  type EvaluationContext,
  type EvaluationResultRow,
  type EvaluationExportInput,
  type EvaluationExportResult,
} from "../protocol/contracts/evaluation-workspace.js";
import type { StudioPendingInteraction } from "../protocol/contracts/interactions.js";
import type { EvaluationExportStore } from "./evaluation-export-store.js";
import { EVALUATION_LIMITS, evaluationOffset, evaluationPageLimit, validateEvaluationSpec } from "./evaluation-limits.js";
import { EvaluationPublicProjection } from "./evaluation-public.js";
import { type } from "@linxiraos/zeta-schema";

const savedRecord = type({
  id: "string", workspaceId: "string", title: "string", spec: "object",
  sessionId: "string", state: "'preparing' | 'ready' | 'running' | 'cancelling' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted'",
  completed: "number >= 0", total: "number >= 0", failed: "number >= 0", cost: "number | null",
  metrics: "unknown[]", detail: "object", revision: "number.integer >= 0", createdAt: "string", updatedAt: "string",
});

export interface EvaluationWorker {
  sessionId: string;
  runtimeVersion: string;
  invoke(operation: EvaluationWorkspaceOperation, authorize?: () => void): Promise<unknown>;
  context(): Promise<EvaluationContext>;
  preserveInputs?(spec: EvaluationSpec, authorize?: () => void): Promise<EvaluationSpec>;
  pending(): StudioPendingInteraction | undefined;
  respond(input: {
    interactionId: string;
    leaseGeneration: number;
    decision: "submit" | "cancel";
    value?: unknown;
  }): Promise<void>;
  subscribe(listener: () => void): () => void;
  release(): Promise<void>;
  settled?(): Promise<void>;
  claim?(owner: string): void;
  isView?(owner: string): boolean;
  releaseView?(owner: string): void;
}
export interface EvaluationWorkerFactory {
  reveal?(path: string, authorize: () => void): Promise<void>;
  open(workspaceId: string, attachSessionId?: string): Promise<EvaluationWorker>;
}
interface Resident {
  worker: EvaluationWorker;
  unsubscribe: () => void;
  timer: ReturnType<typeof setInterval>;
  refreshing?: Promise<void>;
  again: boolean;
  revision: number;
}
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
const csv = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';

/** Durable report owner. Neither navigation nor Renderer subscriptions own running work. */
export class EvaluationCoordinator {
  readonly #records = new Map<string, EvaluationRecord>();
  readonly #residents = new Map<string, Resident>();
  readonly #prepared = new Map<string, Promise<EvaluationWorker>>();
  readonly #starts = new Set<Promise<EvaluationRecord>>();
  readonly #listeners = new Set<() => void>();
  readonly #ready: Promise<void>;
  readonly #writes = new Map<string, Promise<void>>();
  #closed = false;
  #reservations = 0;
  constructor(
    readonly directory: string,
    readonly workers: EvaluationWorkerFactory,
    readonly artifacts: EvaluationExportStore,
    readonly sessionId: string,
    readonly projection = new EvaluationPublicProjection(),
  ) {
    this.#ready = this.#load();
  }
  async #load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.record\.json$/u.test(name)) continue;
      if (this.#records.size >= EVALUATION_LIMITS.records) throw new Error("Evaluation history limit exceeded");
      const file = join(this.directory, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > EVALUATION_LIMITS.recordBytes) throw new Error("Invalid evaluation record storage");
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      savedRecord.assert(parsed);
      // Required persisted fields were validated above; native detail fields remain opaque.
      const record = parsed as EvaluationRecord;
      validateEvaluationSpec(record.spec);
      if (`${record.id}.record.json` !== name || record.sessionId !== this.sessionId) throw new Error("Evaluation ownership mismatch");
      if (!evaluationTerminal(record.state) && record.state !== "ready") {
        record.state = "interrupted";
        record.error =
          "Runtime stopped. Recorded results are retained; rerun requires an explicit start.";
      }
      delete record.interaction;
      this.#records.set(record.id, record);
    }
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
  async #openWorker(workspaceId: string, attachSessionId?: string): Promise<EvaluationWorker> {
    await this.#ready;
    if (this.#closed) throw new Error("Host is shutting down");
    const worker = await this.workers.open(workspaceId, attachSessionId);
    try {
      if (this.#closed) throw new Error("Host is shutting down");
      if (worker.sessionId !== this.sessionId) throw new Error("Evaluation worker belongs to another session");
      return worker;
    } catch (error) {
      await worker.release();
      throw error;
    }
  }
  #path(id: string, suffix: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid evaluation identity");
    return join(this.directory, `${id}.${suffix}`);
  }
  async #save(record: EvaluationRecord): Promise<void> {
    const text = JSON.stringify(record),
      dest = this.#path(record.id, "record.json");
    const next = (this.#writes.get(record.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const temporary = `${dest}.tmp`;
        if (Buffer.byteLength(text) > EVALUATION_LIMITS.recordBytes) throw new Error("Evaluation record exceeds 4 MiB");
        await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, dest);
      });
    this.#writes.set(record.id, next);
    try {
      await next;
      delete record.saveError;
    } catch (error) {
      record.saveError = `Report could not be saved: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    } finally {
      if (this.#writes.get(record.id) === next) this.#writes.delete(record.id);
    }
  }
  async list(input: EvaluationListInput = {}): Promise<EvaluationListResult> {
    await this.#ready;
    const offset = evaluationOffset(input.offset), limit = evaluationPageLimit(input.limit);
    const records = [...this.#records.values()]
      .filter(
        (r) =>
          (!input.workspaceId || !r.workspaceId || r.workspaceId === input.workspaceId) &&
          (!input.kind || r.spec.kind === input.kind) &&
          (!input.search ||
            `${r.title} ${r.id}`.toLowerCase().includes(input.search.toLowerCase())),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page: EvaluationRecord[] = [];
    let bytes = 0;
    for (const record of records.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(record));
      if (page.length && bytes + size > EVALUATION_LIMITS.recordBytes) break;
      bytes += size; page.push(record);
    }
    return { records: page, total: records.length };
  }
  async read(id: string): Promise<EvaluationRecord> {
    await this.#ready;
    const record = this.#records.get(id);
    if (!record) throw new Error("Evaluation not found");
    return record;
  }
  claim(id: string, owner: string): void {
    const worker = this.#residents.get(id)?.worker, record = this.#records.get(id);
    worker?.claim?.(owner);
    const pending = worker?.pending();
    if (record && pending) record.interaction = pending;
  }
  releaseView(owner: string): void {
    for (const resident of this.#residents.values()) resident.worker.releaseView?.(owner);
  }
  pending(id: string, owner: string): StudioPendingInteraction | undefined {
    const worker = this.#residents.get(id)?.worker;
    return worker?.isView?.(owner) === false ? undefined : worker?.pending();
  }
  #planningWorker(workspaceId: string): Promise<EvaluationWorker> {
    if (this.#closed) return Promise.reject(new Error("Host is shutting down"));
    let pending = this.#prepared.get(workspaceId);
    if (!pending) {
      pending = this.#openWorker(workspaceId);
      this.#prepared.set(workspaceId, pending);
      void pending.catch(() => {
        if (this.#prepared.get(workspaceId) === pending) this.#prepared.delete(workspaceId);
      });
    }
    return pending;
  }
  async #discardPrepared(workspaceId: string, worker: EvaluationWorker): Promise<void> {
    const pending = this.#prepared.get(workspaceId);
    if (pending && await pending === worker && this.#prepared.get(workspaceId) === pending) {
      this.#prepared.delete(workspaceId);
      await worker.release();
    }
  }
  async context(workspaceId: string): Promise<EvaluationContext> {
    try {
      const worker = await this.#planningWorker(workspaceId),
        context = await worker.context().catch(async error => {
          await this.#discardPrepared(workspaceId, worker);
          throw error;
        });
      if (!context.available) {
        await this.#discardPrepared(workspaceId, worker);
      }
      return context;
    } catch (error) {
      return {
        available: false,
        models: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  async prepare(input: { workspaceId: string; spec: EvaluationSpec }, authorize: () => void = () => {}): Promise<EvaluationPlan> {
    validateEvaluationSpec(input.spec);
    const worker = await this.#planningWorker(input.workspaceId);
    authorize();
    const plan = (await worker.invoke({
      kind: "evaluation.runtime.plan",
      spec: input.spec,
    }, authorize)) as EvaluationPlan;
    authorize();
    if (worker.preserveInputs) plan.spec = await worker.preserveInputs(plan.spec, authorize);
    authorize();
    return plan;
  }
  start(input: EvaluationStartInput, authorize: () => void = () => {}): Promise<EvaluationRecord> {
    validateEvaluationSpec(input.spec);
    if (this.#records.size + this.#reservations >= EVALUATION_LIMITS.records || this.#residents.size + this.#reservations >= EVALUATION_LIMITS.active)
      return Promise.reject(new Error("Evaluation record or active task limit reached"));
    this.#reservations++;
    const pending = this.#start(input, authorize).finally(() => { this.#reservations--; });
    this.#starts.add(pending);
    void pending.finally(() => this.#starts.delete(pending)).catch(() => {});
    return pending;
  }
  async #start(input: EvaluationStartInput, authorize: () => void): Promise<EvaluationRecord> {
    await this.#ready;
    if (this.#closed) throw new Error("Host is shutting down");
    authorize();
    if (this.#records.size >= EVALUATION_LIMITS.records) throw new Error("Evaluation record limit reached");
    const prepared = this.#prepared.get(input.workspaceId);
    this.#prepared.delete(input.workspaceId);
    const preparedWorker = await prepared;
    const attachSessionId = input.spec.kind === "judgment" ? input.spec.attachSessionId : undefined;
    if (attachSessionId) await preparedWorker?.release();
    const worker =
      attachSessionId
        ? await this.#openWorker(input.workspaceId, attachSessionId)
        : preparedWorker ?? await this.#openWorker(input.workspaceId);
    const id = randomUUID(),
      now = new Date().toISOString();
    let plan: EvaluationPlan;
    try {
      authorize();
      plan = await worker.invoke({ kind: "evaluation.runtime.plan", spec: input.spec }, authorize) as EvaluationPlan;
      authorize();
      if (worker.preserveInputs) plan.spec = await worker.preserveInputs(plan.spec, authorize);
      if (this.#closed) throw new Error("Host is shutting down");
      authorize();
    } catch (error) {
      await worker.release();
      throw error;
    }
    const record: EvaluationRecord = {
      id,
      workspaceId: input.workspaceId,
      title: input.title.trim().slice(0, 200) || input.spec.kind,
      spec: structuredClone(plan.spec),
      plan,
      createdAt: now,
      updatedAt: now,
      runtimeVersion: worker.runtimeVersion,
      sessionId: worker.sessionId,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      state: "preparing",
      completed: 0,
      total: 0,
      failed: 0,
      cost: null,
      revision: 0,
      metrics: [],
      detail: {},
    };
    this.#records.set(id, record);
    try {
      await this.#save(record);
      if (this.#closed) throw new Error("Host is shutting down");
      authorize();
      Object.assign(
        record,
        await worker.invoke({
          kind: "evaluation.runtime.start",
          id,
          title: record.title,
          spec: record.spec,
        }, authorize),
      );
      this.#attach(record, worker);
      await this.#refresh(id);
    } catch (error) {
      record.state = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      try {
        await this.#save(record);
      } finally {
        if (this.#residents.has(id)) await this.#release(id);
        else await worker.release();
      }
    }
    this.#changed();
    return record;
  }
  #attach(record: EvaluationRecord, worker: EvaluationWorker): void {
    const refresh = () => {
      void this.#refresh(record.id);
    };
    const resident: Resident = {
      worker,
      unsubscribe: worker.subscribe(refresh),
      timer: setInterval(refresh, 1000),
      again: false,
      revision: -1,
    };
    resident.timer.unref?.();
    this.#residents.set(record.id, resident);
  }
  async #readChunks(
    worker: EvaluationWorker,
    id: string,
    kind: "evaluation.runtime.report" | "evaluation.runtime.patch",
    destination: string,
  ): Promise<void> {
    const temporary = `${destination}.tmp`,
      handle = await open(temporary, "w", 0o600);
    try {
      let offset = 0;
      let bytes = 0;
      for (;;) {
        const page = (await worker.invoke({ kind, id, offset })) as {
          text: string;
          nextOffset: number;
          total: number;
        };
        bytes += Buffer.byteLength(page.text);
        if (bytes > EVALUATION_LIMITS.reportBytes || page.text.length > 48000 || !Number.isSafeInteger(page.nextOffset) || page.nextOffset < offset || page.total > EVALUATION_LIMITS.reportBytes) throw new Error("Evaluation report exceeds transfer limits");
        await handle.writeFile(page.text);
        if (page.nextOffset >= page.total) break;
        if (page.nextOffset <= offset) throw new Error("Report transfer did not advance");
        offset = page.nextOffset;
      }
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  }
  async #saveRows(worker: EvaluationWorker, id: string): Promise<void> {
    const destination = this.#path(id, "rows.jsonl"), temporary = `${destination}.tmp`;
    const handle = await open(temporary, "w", 0o600);
    try {
      let offset = 0, bytes = 0;
      for (;;) {
        const page = await worker.invoke({ kind: "evaluation.runtime.rows", id, offset, limit: 100 }) as EvaluationResultPage;
        if (page.total > EVALUATION_LIMITS.rows || page.rows.length > 100) throw new Error("Evaluation row limit exceeded");
        for (const row of page.rows) {
          const text = JSON.stringify(row) + "\n";
          const size = Buffer.byteLength(text);
          bytes += size;
          if (size > EVALUATION_LIMITS.pageBytes || bytes > EVALUATION_LIMITS.reportBytes) throw new Error("Evaluation results exceed storage limits");
          await handle.writeFile(text);
        }
        if (page.nextOffset >= page.total) break;
        if (page.nextOffset <= offset) throw new Error("Result transfer did not advance");
        offset = page.nextOffset;
      }
    } finally { await handle.close(); }
    await rename(temporary, destination);
  }
  #refresh(id: string): Promise<void> {
    const resident = this.#residents.get(id),
      record = this.#records.get(id);
    if (!resident || !record) return Promise.resolve();
    if (resident.refreshing) {
      resident.again = true;
      return resident.refreshing;
    }
    resident.refreshing = this.#refreshResident(id, resident, record).finally(() => {
      delete resident.refreshing;
    });
    return resident.refreshing;
  }
  async #refreshResident(id: string, resident: Resident, record: EvaluationRecord): Promise<void> {
    try {
      do {
        resident.again = false;
        const value = (await resident.worker.invoke({
          kind: "evaluation.runtime.read",
          id,
        })) as EvaluationNativeSnapshot;
        const pending = resident.worker.pending();
        let changed = JSON.stringify(record.interaction) !== JSON.stringify(pending);
        if (pending) record.interaction = pending;
        else delete record.interaction;
        if (resident.revision !== value.revision) {
          changed = true;
          Object.assign(record, value, { updatedAt: new Date().toISOString() });
          // A transient read race can publish an error one cycle and recover the
          // next; an absent native error must clear the retained one instead of
          // leaving a recovered run permanently labelled failed.
          if (value.error === undefined) delete record.error;
          if (record.spec.kind === "ratchet" && value.detail.configuration)
            record.spec = value.detail.configuration as Extract<
              EvaluationSpec,
              { kind: "ratchet" }
            >;
          try {
            await this.#saveRows(resident.worker, id);
            await this.#readChunks(
              resident.worker,
              id,
              "evaluation.runtime.report",
              this.#path(id, "native.json"),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code)
              record.saveError = `Result storage unavailable: ${String(error)}`;
            throw error;
          }
          if (
            record.spec.kind === "judgment" &&
            record.spec.attachId &&
            record.spec.items.length === 0
          ) {
            const report = JSON.parse(await readFile(this.#path(id, "native.json"), "utf8")) as {
              configuration?: {
                items: Extract<EvaluationSpec, { kind: "judgment" }>["items"];
                questions: Record<
                  string,
                  { type: string; instructions: string; criteria?: unknown }
                >;
                options: { concurrency: number; retries: number; minOk: number };
              };
            };
            if (report.configuration) {
              const config = report.configuration;
              record.spec = {
                kind: "judgment",
                ...config.options,
                items: config.items,
                questions: Object.fromEntries(
                  Object.entries(config.questions).map(([key, q]) => [
                    key,
                    { ...q, type: q.type === "noul" ? "bool" : q.type },
                  ]),
                ) as Extract<EvaluationSpec, { kind: "judgment" }>["questions"],
              };
              record.replayable = config.items.every(
                item => !item.images || item.images.every(image => typeof image === "string"),
              );
              if (record.replayable && resident.worker.preserveInputs) record.spec = await resident.worker.preserveInputs(record.spec);
            }
          }
          if (evaluationTerminal(record.state)) record.finishedAt ??= new Date().toISOString();
          if (record.spec.kind === "ratchet" && record.detail.patchAvailable)
            await this.#readChunks(
              resident.worker,
              id,
              "evaluation.runtime.patch",
              this.#path(id, "best.patch"),
            );
          await this.#save(record);
          resident.revision = value.revision;
        }
        if (changed) this.#changed();
      } while (resident.again && !evaluationTerminal(record.state));
      if (evaluationTerminal(record.state) && record.spec.kind !== "ratchet")
        await this.#release(id);
    } catch (error) {
      // A failed write is retryable while the Worker remains resident. A lost Worker is never restarted into paid work.
      record.error = error instanceof Error ? error.message : String(error);
      if (!record.saveError) {
        record.state = "interrupted";
        await this.#save(record).catch(() => {});
        await this.#release(id);
      }
      this.#changed();
    }
  }
  async #release(id: string): Promise<void> {
    const resident = this.#residents.get(id);
    if (!resident) return;
    clearInterval(resident.timer);
    resident.unsubscribe();
    this.#residents.delete(id);
    await resident.worker.release();
  }
  async rows(input: {
    id: string;
    offset?: number;
    limit?: number;
  }): Promise<EvaluationResultPage> {
    await this.read(input.id);
    const offset = evaluationOffset(input.offset), limit = evaluationPageLimit(input.limit);
    const current = await this.#readRows(input.id);
    const rows: EvaluationResultRow[] = [];
    let bytes = 0;
    for (const row of current.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (size > EVALUATION_LIMITS.pageBytes) throw new Error("Evaluation row exceeds page limit");
      if (bytes + size > EVALUATION_LIMITS.pageBytes) break;
      rows.push(row); bytes += size;
    }
    return { rows, offset, nextOffset: offset + rows.length, total: current.length };
  }
  async #readRows(id: string): Promise<EvaluationResultPage["rows"]> {
    const current = new Map<string, EvaluationResultPage["rows"][number]>();
    try {
      const info = await lstat(this.#path(id, "rows.jsonl"));
      if (!info.isFile() || info.isSymbolicLink() || info.size > EVALUATION_LIMITS.reportBytes) throw new Error("Invalid evaluation row storage");
    } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    try {
      for await (const line of createInterface({
        input: createReadStream(this.#path(id, "rows.jsonl")),
        crlfDelay: Infinity,
      })) {
        if (line) {
          const row = JSON.parse(line) as EvaluationResultPage["rows"][number];
          current.set(row.key, row);
          if (current.size > EVALUATION_LIMITS.rows) throw new Error("Evaluation row limit exceeded");
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return [...current.values()];
  }
  async control(input: EvaluationControlInput, authorize: () => void = () => {}): Promise<EvaluationRecord> {
    const record = await this.read(input.id);
    authorize();
    if (input.spec) validateEvaluationSpec(input.spec);
    let resident = this.#residents.get(input.id);
    if (!resident) {
      if (record.spec.kind !== "ratchet")
        throw new Error("This run ended. Review its configuration to start a new run");
      const worker = await this.#openWorker(record.workspaceId);
      try { authorize(); } catch (error) { await worker.release(); throw error; }
      this.#attach(record, worker);
      resident = this.#residents.get(input.id)!;
    }
    authorize();
    Object.assign(
      record,
      await resident.worker.invoke({ ...input, kind: "evaluation.runtime.control" }, authorize),
    );
    if (input.spec) record.spec = input.spec;
    delete record.finishedAt;
    await this.#save(record);
    await this.#refresh(record.id);
    authorize();
    return record;
  }
  async retrySpec(id: string): Promise<EvaluationSpec> {
    const record = await this.read(id);
    if (record.spec.kind !== "judgment" || record.replayable === false)
      throw new Error("This report has no reusable judgment input");
    const failed = new Set<string>();
    for (const row of await this.#readRows(id)) {
      const item = row.data as { key?: string | number; error?: string };
      if (item.error) failed.add(String(item.key ?? row.key));
    }
    const items = record.spec.items.filter((item) => failed.has(String(item.key)));
    if (!items.length) throw new Error("No failed items remain");
    const { attachId: _attach, attachSessionId: _session, ...spec } = record.spec;
    return { ...spec, items, minOk: Math.min(spec.minOk ?? 1, items.length) };
  }
  async respond(input: {
    id: string;
    interactionId: string;
    leaseGeneration: number;
    decision: "submit" | "cancel";
    value?: unknown;
  }, owner: string, authorize: () => void = () => {}): Promise<void> {
    const resident = this.#residents.get(input.id);
    if (!resident) throw new Error("The evaluation is no longer connected");
    authorize();
    if (resident.worker.isView?.(owner) !== true) throw new Error("evaluation interaction belongs to another view");
    await resident.worker.respond(input);
    await this.#refresh(input.id);
  }
  async patch(input: {
    id: string;
    offset?: number;
  }): Promise<{ text: string; nextOffset: number; total: number }> {
    const record = await this.read(input.id);
    if (record.spec.kind !== "ratchet") throw new Error("Only Ratchet produces code patches");
    const text = this.projection.text(await this.#readText(input.id, "best.patch"));
    const offset = evaluationOffset(input.offset), chunk = text.slice(offset, offset + 48000);
    return { text: chunk, nextOffset: offset + chunk.length, total: text.length };
  }
  async openWorkspace(id: string, authorize: () => void): Promise<void> {
    const record = await this.read(id);
    if (record.spec.kind !== "ratchet" || typeof record.detail.workspace !== "string")
      throw new Error("Isolated workspace unavailable");
    if (!this.workers.reveal)
      throw new Error("Open this workspace through the connected remote file tools");
    await this.workers.reveal(record.detail.workspace, authorize);
  }
  async export(input: EvaluationExportInput): Promise<EvaluationExportResult> {
    const record = this.projection.value(await this.read(input.id));
    const name = `${record.title.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "-").slice(0, 120)}-${record.id.slice(0, 8)}.${input.format}`;
    if (!["json", "csv", "html", "patch"].includes(input.format)) throw new Error("Unknown evaluation export format");
    let bytes: Uint8Array, mimeType: string;
    if (input.format === "json") {
      bytes = new TextEncoder().encode(JSON.stringify(this.projection.value(JSON.parse(await this.#readText(record.id, "native.json"))), null, 2));
      mimeType = "application/json";
    } else if (input.format === "patch") {
      if (record.spec.kind !== "ratchet") throw new Error("Only Ratchet produces patches");
      bytes = new TextEncoder().encode(this.projection.text(await this.#readText(record.id, "best.patch")));
      mimeType = "text/plain";
    } else {
      const rows = this.projection.value(await this.#readRows(record.id));
      const text =
        input.format === "csv"
          ? "key,model,phase,result\r\n" +
            rows
              .map((r) => [r.key, r.model, r.phase, JSON.stringify(r.data)].map(csv).join(","))
              .join("\r\n")
          : `<!doctype html><meta charset="utf-8"><title>${escapeHtml(record.title)}</title><h1>${escapeHtml(record.title)}</h1><p>${escapeHtml(record.state)} · ${record.completed}/${record.total}</p><small>${escapeHtml(record.createdAt)} · Zeta ${escapeHtml(record.runtimeVersion)}</small><h2>Configuration</h2><pre>${escapeHtml(JSON.stringify(record.spec, null, 2))}</pre><h2>Results</h2><table><tr><th>Item</th><th>Model</th><th>Result</th></tr>${rows.map(row => `<tr><td>${escapeHtml(row.key)}</td><td>${escapeHtml(row.model)}</td><td><pre>${escapeHtml(JSON.stringify(row.data, null, 2))}</pre></td></tr>`).join("")}</table>`;
      bytes = new TextEncoder().encode(text);
      mimeType = input.format === "csv" ? "text/csv" : "text/html";
    }
    const artifact = await this.artifacts.registerBytes(
      { kind: "export", name, mimeType, workspaceId: record.workspaceId, runId: record.id },
      bytes,
    );
    return { artifactId: artifact.artifactId, name: artifact.name };
  }
  async exportChunk(input: {
    artifactId: string;
    offset?: number;
  }): Promise<{ data: string; nextOffset: number; total: number; mimeType: string; name: string }> {
    const artifact = await this.artifacts.resolve(input.artifactId);
    const offset = evaluationOffset(input.offset),
      handle = await open(artifact.path, "r");
    try {
      const buffer = Buffer.alloc(48 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
      return {
        data: buffer.subarray(0, bytesRead).toString("base64"),
        nextOffset: offset + bytesRead,
        total: artifact.record.bytes,
        mimeType: artifact.record.mimeType,
        name: artifact.record.name,
      };
    } finally {
      await handle.close();
    }
  }
  async shutdown(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled(this.#starts);
    await this.#ready;
    for (const [id, resident] of this.#residents) {
      try {
        await resident.refreshing;
        const current = this.#records.get(id)!;
        if (evaluationTerminal(current.state) || (current.state === "ready" && !resident.worker.pending())) {
          await this.#save(current);
          continue;
        }
        await resident.worker.invoke({ kind: "evaluation.runtime.control", id, action: "cancel" });
        const record = this.#records.get(id)!;
        await resident.worker.settled?.();
        await this.#refresh(id);
        if (!evaluationTerminal(record.state)) {
          record.state = "interrupted";
          record.error =
            "Application closed before the native task settled. Partial results are retained.";
          await this.#save(record);
        }
      } finally {
        await this.#release(id);
      }
    }
    for (const pending of this.#prepared.values()) {
      const worker = await pending.catch(() => undefined);
      await worker?.release();
    }
    this.#prepared.clear();
    await Promise.allSettled(this.#writes.values());
  }
  async #readText(id: string, suffix: string): Promise<string> {
    const path = this.#path(id, suffix), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > EVALUATION_LIMITS.reportBytes) throw new Error("Evaluation report is unavailable or exceeds 64 MiB");
    return readFile(path, "utf8");
  }
}
