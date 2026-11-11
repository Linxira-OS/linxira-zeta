import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { TerminalRecorder, recordingFileName } from "../src/terminal/recorder.ts";

test("recording writes a studiocast header and output frames", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeta-terminal-rec-"));
	const recorder = new TerminalRecorder(root);
	const started = recorder.start({ terminalId: "term-1", cols: 100, rows: 30, title: "demo" });
	assert.equal(started.state, "recording");
	recorder.append("term-1", "hello ");
	recorder.append("term-1", "world\n");
	const stopped = recorder.stop("term-1");
	assert.equal(stopped.state, "saved");
	assert.ok(stopped.artifactId);
	const file = recorder.artifactPath(stopped.artifactId);
	assert.ok(file);
	const lines = fs.readFileSync(file, "utf8").trim().split("\n");
	assert.equal(JSON.parse(lines[0]).studiocast, 1);
	assert.equal(JSON.parse(lines[1])[1].data, "hello ");
	assert.equal(JSON.parse(lines[2])[1].data, "world\n");
	assert.equal(recorder.artifactPath("../escape.studiocast"), null);
	fs.rmSync(root, { recursive: true, force: true });
});

test("recording names are filesystem-safe and terminal-scoped", () => {
	const name = recordingFileName("a/b c", new Date("2026-01-02T03:04:05.006Z"));
	assert.match(name, /^recording-2026-01-02T03-04-05-006Z-abc\.studiocast$/);
});
