import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir, getHistoryDbPath } from "@linxiraos/pi-utils";
import { Settings } from "../src/config/settings";
import { StudioPredictionEngine } from "../src/server/studio-host/services/prediction-engine";
import { parsePredictionInput } from "../src/server/studio-host/services/prediction-input";

// Draft privacy and corpus deletion are consumer-visible persistence contracts.
test("draft queries never become confirmed history and clear leaves unrelated profile data intact", async () => {
	const root = TempDir.createSync(path.resolve(import.meta.dir, "../../../temp/studio-prediction-corpus-"));
	const calls: Array<[string, string]> = [];
	let stopped = false;
	const client = {
		async complete(_method: string, before: string, prefix: string) { calls.push([before, prefix]); return { engine: "ngram" as const, suggestion: { suffix: "view", confidence: 0.9 } }; },
		sync() {}, close() {}, async stop() { stopped = true; },
	};
	const engine = new StudioPredictionEngine({ sessionId: "owner", settings: Settings.isolated() }, { directory: root.join("studio"), client });
	try {
		expect(await engine.query({ sessionId: "owner", version: 2, before: "draft-only ", prefix: "re" })).toEqual({ version: 2, suffix: "view", engine: "ngram" });
		expect(await Bun.file(getHistoryDbPath(root.join("studio"))).exists()).toBe(false);
		await engine.observeSent("submission-a", "confirmed prompt");
		await engine.observeSent("submission-a", "confirmed prompt");
		expect((await engine.control("status")).corpusCount).toBe(1);
		const db = new Database(getHistoryDbPath(root.join("studio")), { readonly: true });
		try { expect(db.query("SELECT prompt FROM history").all()).toEqual([{ prompt: "confirmed prompt" }]); } finally { db.close(); }
		await fs.mkdir(root.join("studio", "studio-predict"));
		await Bun.write(root.join("studio", "studio-predict", "learned"), "private state");
		await Bun.write(root.join("tui-history"), "keep");
		expect((await engine.control("clear")).corpusCount).toBe(0);
		expect(stopped).toBe(true);
		expect(await Bun.file(root.join("studio", "studio-predict", "learned")).exists()).toBe(false);
		expect(await Bun.file(root.join("tui-history")).text()).toBe("keep");
		expect(calls).toEqual([["draft-only ", "re"]]);
	} finally { engine.dispose(); await root.remove(); }
});

test("private prediction inputs reject unknown fields, malformed revisions and mismatched editor state", () => {
	for (const input of [
		{ kind: "ping", text: "hidden" },
		{ kind: "update", revision: -1, text: "text", caret: 4 },
		{ kind: "update", revision: 1, text: "text", caret: 5 },
		{ kind: "update", revision: 1, text: "\0", caret: 0 },
		{ kind: "next", revision: 2, empty: true, text: "draft" },
		{ kind: "next.accepted", revision: 2, rank: 4 },
		{ kind: "import", requestId: "../escape", transferId: "not-a-transfer" },
	]) expect(() => parsePredictionInput(input)).toThrow();
	expect(parsePredictionInput({ kind: "next", revision: 0, empty: true, text: "" })).toEqual({ kind: "next", revision: 0, empty: true, text: "" });
});
