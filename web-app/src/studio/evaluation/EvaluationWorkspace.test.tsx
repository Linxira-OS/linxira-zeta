import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ClientEvent, ClientInteraction, CommandName, StudioClient } from "@linxiraos/studio-contract";
import type { EvaluationContext, EvaluationPlan, EvaluationRecord, EvaluationSpec } from "@linxiraos/studio-protocol";
import { I18nProvider } from "../i18n";
import { PreviewModeProvider } from "../preview/PreviewContext";
import { PREVIEW_MODE_STORAGE_KEY } from "../preview/mode";
import { EvaluationPage } from "./EvaluationPage";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

it("coalesces slow workspace and history reads and resumes them when the window returns", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const listeners = new Set<(event: ClientEvent) => void>();
  let release!: (value: { records: []; total: number }) => void;
  const pending = new Promise<{ records: []; total: number }>(resolve => { release = resolve; });
  const query = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ records: [], total: 0 });
  const client = {
    query,
    subscribe: (_scope: unknown, listener: (event: ClientEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as StudioClient;
  const changed = () => { for (const listener of listeners) listener({ kind: "evaluations.changed" } as ClientEvent); };
  const mounted = render(<I18nProvider forcedLanguage="en"><PreviewModeProvider switchEnabled>
    <EvaluationPage client={client} available />
  </PreviewModeProvider></I18nProvider>);
  for (let i = 0; i < 25; i++) await act(async () => changed());
  expect(query).toHaveBeenCalledTimes(1);
  await act(async () => { release({ records: [], total: 0 }); await vi.advanceTimersByTimeAsync(0); });
  expect(query).toHaveBeenCalledTimes(2);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^History/ })); });
  expect(query).toHaveBeenCalledTimes(3);
  await act(async () => {
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    changed();
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(query).toHaveBeenCalledTimes(3);
  await act(async () => {
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(query).toHaveBeenCalledTimes(5);
  await act(async () => { changed(); });
  expect(query).toHaveBeenCalledTimes(7);
  mounted.unmount();
  expect(listeners.size).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(query).toHaveBeenCalledTimes(7);
});
it("four evaluation surfaces remain local in preview, including rerun review and Ratchet approval", async () => {
  localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, "1");
  const client = { command: vi.fn(), query: vi.fn() } as unknown as StudioClient;
  render(
    <I18nProvider forcedLanguage="zh">
      <PreviewModeProvider switchEnabled>
        <EvaluationPage client={client} available={false} />
      </PreviewModeProvider>
    </I18nProvider>,
  );
  await screen.findByText("模型性能对比");
  fireEvent.click(screen.getByRole("button", { name: "按此配置复跑" }));
  fireEvent.click(screen.getByRole("button", { name: "检查并准备开始" }));
  const dialog = await screen.findByRole("dialog", { name: "确认评测配置" });
  expect(dialog.textContent).toContain("24");
  fireEvent.click(screen.getByRole("button", { name: "确认并开始" }));
  await screen.findByRole("button", { name: "按此配置复跑" });
  fireEvent.click(screen.getByRole("tab", { name: "指令遵循" }));
  await screen.findByText("连续指令测试");
  fireEvent.click(screen.getByRole("tab", { name: "模型评判" }));
  await screen.findByText("支持工单分类");
  fireEvent.click(screen.getByRole("tab", { name: "Ratchet" }));
  await screen.findByText("支持工单路由优化");
  fireEvent.click(screen.getAllByRole("button", { name: "审查" })[2]!);
  await screen.findByRole("button", { name: "启动／继续迭代" });
  expect(client.command).not.toHaveBeenCalled();
  expect(client.query).not.toHaveBeenCalled();
});

function liveRecord(sessionId: string, title = `Run ${sessionId}`): EvaluationRecord {
  return {
    id: `evaluation-${sessionId}`, workspaceId: "workspace", sessionId, title,
    spec: { kind: "benchmark", profile: "chat", models: ["fixture/model"], runs: 2 },
    createdAt: "2026-11-15T00:00:00.000Z", updatedAt: "2026-11-15T00:00:00.000Z",
    state: "completed", completed: 2, total: 2, failed: 0, cost: null, metrics: [], detail: {}, revision: 1,
  };
}
function liveSource(initial = liveRecord("a")) {
  let record = initial;
  const listeners = new Set<(event: ClientEvent) => void>();
  const receipts: Record<string, unknown> = {};
  const context: EvaluationContext = { available: true, models: [{ selector: "fixture/model", name: "Fixture model", provider: "fixture", kind: "chat", image: false }] };
  const query = vi.fn(async (name: string, input: { spec?: EvaluationSpec } = {}) => {
    if (name === "evaluations.context") return context;
    if (name === "evaluations.list") return { records: [record], total: 1 };
    if (name === "evaluations.read") return record;
    if (name === "evaluations.rows") return { rows: [{ key: "retained", data: { value: "retained evidence" } }], offset: 0, nextOffset: 1, total: 1 };
    if (name === "evaluations.retrySpec") return record.spec;
    if (name === "evaluations.exportChunk") return { data: btoa("retained report"), nextOffset: 15, total: 15, mimeType: "text/csv", name: "report.csv" };
    throw new Error(`Unexpected query ${name}: ${JSON.stringify(input)}`);
  });
  const command = vi.fn(async (name: CommandName, input: { spec?: EvaluationSpec }) => {
    const requestId = `command-${Object.keys(receipts).length}`;
    const result = name === "evaluations.prepare"
      ? { spec: input.spec!, requests: 2, upperBound: false, phases: [], notes: [] } satisfies EvaluationPlan
      : name === "evaluations.export" ? { artifactId: "export-owned", name: "report.csv" }
      : name === "evaluations.respond" ? { responded: true }
      : record;
    receipts[requestId] = { commandName: name, requestId, status: "completed", result };
    return { commandName: name, requestId, status: "local_pending" };
  });
  const client = { query, command, subscribe: (_scope: unknown, listener: (event: ClientEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, getState: () => ({ commands: receipts }) } as unknown as StudioClient;
  return { client, query, command, context, update(value: EvaluationRecord) { record = value; }, changed() { for (const listener of listeners) listener({ kind: "evaluations.changed" } as ClientEvent); } };
}
function livePage(client: StudioClient, sessionId = "a", available = true, intent?: { id: string; kind: EvaluationRecord["spec"]["kind"] }) {
  return <I18nProvider forcedLanguage="en"><PreviewModeProvider switchEnabled>
    <EvaluationPage client={client} workspaceId="workspace" sessionId={sessionId} available={available} {...(intent ? { intent } : {})} />
  </PreviewModeProvider></I18nProvider>;
}

it("refreshes native availability when the same conversation attaches its runtime", async () => {
  const source = liveSource();
  source.query.mockImplementationOnce(async () => ({ ...source.context, available: false, reason: "Native tool session is starting" }));
  const mounted = render(livePage(source.client, "a", false));
  await screen.findByText("Native tool session is starting");
  mounted.rerender(livePage(source.client, "a", true));
  await waitFor(() => expect(screen.getByRole("button", { name: "New evaluation" }).hasAttribute("disabled")).toBe(false));
  expect(source.query.mock.calls.filter(([name]) => name === "evaluations.context")).toHaveLength(2);
});

it("rebinds retained history and ignores a previous session's unfinished prepare receipt", async () => {
  const source = liveSource();
  const pending = Promise.withResolvers<{ commandName: string; requestId: string; status: string }>();
  source.command.mockImplementationOnce(() => pending.promise as never);
  const mounted = render(livePage(source.client));
  await screen.findByText("Run a");
  fireEvent.click(screen.getByRole("button", { name: "Run again" }));
  fireEvent.click(screen.getByRole("button", { name: "Review evaluation" }));
  await waitFor(() => expect(source.command).toHaveBeenCalledWith("evaluations.prepare", expect.anything()));
  source.update(liveRecord("b"));
  mounted.rerender(livePage(source.client, "b"));
  await screen.findByText("Run b");
  await act(async () => { pending.resolve({ commandName: "evaluations.prepare", requestId: "old-command", status: "local_pending" }); });
  expect(screen.queryByRole("dialog", { name: "Review evaluation" })).toBeNull();
  expect(screen.queryByText("Run a")).toBeNull();
  expect(source.command).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /^History/ }));
  const history = await screen.findByRole("dialog", { name: "Evaluation history" });
  expect(within(history).getByText("Run b")).toBeTruthy();
});

it("prepares and starts a reviewed native configuration through command receipts", async () => {
  const source = liveSource();
  render(livePage(source.client));
  await screen.findByText("Run a");
  fireEvent.click(screen.getByRole("button", { name: "Run again" }));
  fireEvent.click(screen.getByRole("button", { name: "Review evaluation" }));
  await screen.findByRole("dialog", { name: "Review evaluation" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
  await screen.findByText("Run a");
  expect(source.command).toHaveBeenNthCalledWith(1, "evaluations.prepare", { workspaceId: "workspace", spec: liveRecord("a").spec });
  expect(source.command).toHaveBeenNthCalledWith(2, "evaluations.start", { workspaceId: "workspace", title: "Run a", spec: liveRecord("a").spec, sourceId: "evaluation-a" });
});

it("maps real Ask deck labels to native option ids without changing its review lease", async () => {
  const interaction: ClientInteraction = { kind: "ask", title: "Review native inputs", interactionId: "native-review" as never, sessionId: "a" as never, leaseGeneration: 7, acceptImages: false, questions: [{ id: "inputs", question: "Inspect real native materials", multiple: false, options: [{ id: "0", label: "Approve" }, { id: "1", label: "Revise" }] }] };
  const record = { ...liveRecord("a"), clientInteraction: interaction };
  const source = liveSource(record);
  render(livePage(source.client));
  fireEvent.click(await screen.findByRole("radio", { name: "Approve" }));
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await waitFor(() => expect(source.command).toHaveBeenCalledWith("evaluations.respond", { id: record.id, interactionId: interaction.interactionId, leaseGeneration: 7, decision: "submit", value: { results: [{ id: "inputs", selectedOptions: ["0"] }] } }));
});

it("downloads retained export chunks through the evaluation owner even when desktop chrome exists", async () => {
  const source = liveSource();
  const nativeExport = vi.fn();
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createObjectURL = vi.fn(() => "blob:evaluation-export");
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
  vi.stubGlobal("zetaStudioChrome", { exportArtifact: nativeExport });
  render(livePage(source.client));
  await screen.findByText("Run a");
  vi.useFakeTimers();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "CSV" })); });
  expect(screen.getByText("Report exported.")).toBeTruthy();
  expect(source.query).toHaveBeenCalledWith("evaluations.exportChunk", { artifactId: "export-owned", offset: 0 });
  expect(download).toHaveBeenCalledOnce();
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(nativeExport).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
});

it("discards a late context response after a session switch", async () => {
  const source = liveSource();
  const previous = Promise.withResolvers<EvaluationContext>();
  source.query.mockImplementationOnce(() => previous.promise as never);
  const mounted = render(livePage(source.client, "a"));
  source.update(liveRecord("b"));
  mounted.rerender(livePage(source.client, "b"));
  await screen.findByText("Run b");
  await act(async () => { previous.resolve({ available: false, models: [], reason: "Expired old session" }); });
  expect(screen.queryByText("Expired old session")).toBeNull();
  expect(screen.getByRole("button", { name: "New evaluation" }).hasAttribute("disabled")).toBe(false);
});
