import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTempCrewDirs, type TempCrewDirs } from "../helpers/temp-dirs.ts";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

type MockProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
};

function createProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    proc.exitCode = 143;
    queueMicrotask(() => {
      proc.emit("exit", proc.exitCode);
      proc.emit("close", proc.exitCode);
    });
    return true;
  });
  return proc;
}

function writeWorkerAgent(cwd: string): void {
  const filePath = path.join(cwd, ".pi", "messenger", "crew", "agents", "crew-worker.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
name: crew-worker
description: Test worker
crewRole: worker
---
You are a test worker.
`);
}

describe("crew agent event handling", () => {
  let dirs: TempCrewDirs;

  beforeEach(() => {
    dirs = createTempCrewDirs();
    writeWorkerAgent(dirs.cwd);
    spawnMock.mockReset();
  });

  it("compacts streaming message_update artifacts while preserving final output", async () => {
    const proc = createProcess();
    spawnMock.mockReturnValue(proc);
    const { spawnAgents } = await import("../../crew/agents.ts");

    const resultPromise = spawnAgents([{
      agent: "crew-worker",
      task: "Implement task",
      taskId: "task-1",
    }], dirs.cwd);

    const repeated = "SNAPSHOT_CONTENT".repeat(100);
    proc.stdout.emit("data", `${JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "ok", partial: { role: "assistant", content: [{ type: "text", text: repeated }] } },
      message: { role: "assistant", content: [{ type: "text", text: repeated }] },
    })}\n${JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "FINAL" }] },
    })}\n`);
    proc.exitCode = 0;
    proc.emit("close", 0);

    const [result] = await resultPromise;

    expect(result.output).toBe("FINAL");
    const artifact = fs.readdirSync(path.join(dirs.crewDir, "artifacts")).find(file => file.endsWith(".jsonl"));
    expect(artifact).toBeTruthy();
    const jsonl = fs.readFileSync(path.join(dirs.crewDir, "artifacts", artifact!), "utf-8");
    expect(jsonl).not.toContain("SNAPSHOT_CONTENT");
    expect(jsonl).toContain("text_delta");
  });

  it("fails fast on terminal provider quota errors", async () => {
    const proc = createProcess();
    spawnMock.mockReturnValue(proc);
    const { spawnAgents } = await import("../../crew/agents.ts");

    const resultPromise = spawnAgents([{
      agent: "crew-worker",
      task: "Implement task",
      taskId: "task-1",
    }], dirs.cwd);

    proc.stdout.emit("data", `${JSON.stringify({
      type: "provider_error",
      error: {
        status: 400,
        type: "invalid_request_error",
        message: "Third-party apps now draw from your extra usage. Add more at claude.ai/settings/usage and keep going.",
      },
    })}\n`);

    const [result] = await resultPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Provider error 400");
  });
});
