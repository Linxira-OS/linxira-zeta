import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { APP_NAME, removeWithRetries } from "@linxiraos/pi-utils";
import { $ } from "bun";
import { exportFromFile, exportSessionToHtml, type SessionData } from "../src/export/html";
import type { SessionHeader } from "../src/session/session-entries";
import { collectSubSessions } from "../src/session/sub-sessions";

/**
 * Contract: a session at `<dir>/<name>.jsonl` embeds subagent transcripts from
 * `<dir>/<name>/<AgentId>.jsonl` (recursively) under slash-joined keys, with
 * parent links and replayed leaf ids. Corrupt/empty/backup files are skipped.
 */

function sessionJsonl(
	id: string,
	entryIds: string[],
	previousSessionFiles?: string[],
	cacheKeys?: Pick<SessionHeader, "providerPromptCacheKey" | "taskPromptCacheKey">,
): string {
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id,
			timestamp: "2026-06-12T00:00:00.000Z",
			cwd: "/tmp",
			previousSessionFiles,
			...cacheKeys,
		}),
	];
	let parent: string | null = null;
	for (const entryId of entryIds) {
		lines.push(
			JSON.stringify({
				type: "model_change",
				id: entryId,
				parentId: parent,
				timestamp: "2026-06-12T00:00:01.000Z",
				model: "test/model",
			}),
		);
		parent = entryId;
	}
	return `${lines.join("\n")}\n`;
}

async function readExportData(outputPath: string): Promise<SessionData> {
	const html = await Bun.file(outputPath).text();
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	expect(encoded).toBeDefined();
	return JSON.parse(Buffer.from(encoded!, "base64").toString("utf8")) as SessionData;
}

describe("collectSubSessions", () => {
	let root: string;
	let mainFile: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subsessions-"));
		mainFile = path.join(root, "main.jsonl");
		await Bun.write(mainFile, sessionJsonl("main", ["m1"]));
	});

	afterEach(async () => {
		await removeWithRetries(root);
	});

	test("collects nested subagent sessions with parent links and leaf ids", async () => {
		await Bun.write(path.join(root, "main/Alpha.jsonl"), sessionJsonl("alpha", ["a1", "a2"]));
		await Bun.write(path.join(root, "main/Alpha/Child.jsonl"), sessionJsonl("child", ["c1"]));
		await Bun.write(path.join(root, "main/Beta.jsonl"), sessionJsonl("beta", ["b1"]));

		const subs = await collectSubSessions(mainFile);

		expect(Object.keys(subs).sort()).toEqual(["Alpha", "Alpha/Child", "Beta"]);
		expect(subs.Alpha).toMatchObject({ agentId: "Alpha", parent: null, leafId: "a2" });
		expect(subs.Alpha.entries.map(e => e.id)).toEqual(["a1", "a2"]);
		expect(subs.Alpha.header?.id).toBe("alpha");
		expect(subs["Alpha/Child"]).toMatchObject({ agentId: "Child", parent: "Alpha", leafId: "c1" });
		expect(subs.Beta).toMatchObject({ agentId: "Beta", parent: null, leafId: "b1" });
	});

	test("selects the leaf a late completion-probe usage entry restored", async () => {
		const lateUsage = JSON.stringify({
			type: "model_usage",
			id: "probe",
			parentId: "a1",
			timestamp: "2026-06-12T00:00:02.000Z",
			activeLeafId: "a2",
			purpose: "task-completion-probe",
			usage: { cost: { total: 0.01 } },
		});
		await Bun.write(path.join(root, "main/Alpha.jsonl"), `${sessionJsonl("alpha", ["a1", "a2"])}${lateUsage}\n`);

		const subs = await collectSubSessions(mainFile);

		expect(subs.Alpha.leafId).toBe("a2");
	});

	test("omits internal routing and move history from standalone HTML and nested sessions", async () => {
		const mainPreviousPath = "/Users/private/main.jsonl";
		const subPreviousPath = "/Users/private/Alpha.jsonl";
		const mainKeys = { providerPromptCacheKey: "private-main-cache", taskPromptCacheKey: "private-parent:reviewer" };
		const subKeys = { providerPromptCacheKey: "private-sub-cache", taskPromptCacheKey: "private-parent:scout" };
		const mainJsonl = sessionJsonl("main", ["m1"], [mainPreviousPath], mainKeys);
		const subJsonl = sessionJsonl("alpha", ["a1"], [subPreviousPath], subKeys);
		const subFile = path.join(root, "main/Alpha.jsonl");
		await Bun.write(mainFile, mainJsonl);
		await Bun.write(subFile, subJsonl);
		const outputPath = path.join(root, "export.html");

		await exportFromFile(mainFile, { outputPath });

		const html = await Bun.file(outputPath).text();
		const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
		expect(encoded).toBeDefined();
		const data = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8")) as {
			header: SessionHeader;
			subSessions: Record<string, { header: SessionHeader }>;
		};
		expect(data.header.previousSessionFiles).toBeUndefined();
		expect(data.subSessions.Alpha.header.previousSessionFiles).toBeUndefined();
		for (const header of [data.header, data.subSessions.Alpha.header]) {
			expect(header.providerPromptCacheKey).toBeUndefined();
			expect(header.taskPromptCacheKey).toBeUndefined();
		}
		expect(JSON.stringify(data)).not.toContain("private-");
		expect(data.header.id).toBe("main");
		expect(data.subSessions.Alpha.header.id).toBe("alpha");
		expect(await Bun.file(mainFile).text()).toBe(mainJsonl);
		expect(await Bun.file(subFile).text()).toBe(subJsonl);
		expect((await collectSubSessions(mainFile)).Alpha.header).toMatchObject(subKeys);
		expect(html).not.toContain(mainPreviousPath);
		expect(html).not.toContain(subPreviousPath);
	});

	test("rejects a missing input without creating session or export files", async () => {
		const missingInput = path.join(root, "missing.jsonl");
		const outputPath = path.join(root, "export.html");

		await expect(exportFromFile(missingInput, { outputPath })).rejects.toThrow(`File not found: ${missingInput}`);
		expect(await Bun.file(missingInput).exists()).toBe(false);
		expect(await Bun.file(outputPath).exists()).toBe(false);
	});

	test("skips corrupt, empty, backup, and non-jsonl files", async () => {
		await Bun.write(path.join(root, "main/Good.jsonl"), sessionJsonl("good", ["g1"]));
		await Bun.write(path.join(root, "main/corrupt.jsonl"), "{not json\n");
		await Bun.write(path.join(root, "main/empty.jsonl"), "");
		await Bun.write(path.join(root, "main/Good.jsonl.123.bak"), sessionJsonl("bak", ["x1"]));
		await Bun.write(path.join(root, "main/notes.md"), "# notes\n");

		const subs = await collectSubSessions(mainFile);

		expect(Object.keys(subs)).toEqual(["Good"]);
	});

	test("skips advisor transcripts stored alongside subagent sessions", async () => {
		await Bun.write(path.join(root, "main/Scout.jsonl"), sessionJsonl("scout", ["s1"]));
		await Bun.write(path.join(root, "main/__advisor.jsonl"), sessionJsonl("adv", ["v1"]));
		await Bun.write(path.join(root, "main/__advisor.reviewer.jsonl"), sessionJsonl("adv2", ["v2"]));
		await Bun.write(path.join(root, "main/Scout/__advisor.jsonl"), sessionJsonl("adv3", ["v3"]));

		const subs = await collectSubSessions(mainFile);

		expect(Object.keys(subs)).toEqual(["Scout"]);
	});

	test("terminates when a transcript stem names the directory itself", async () => {
		// "..jsonl" has the stem "."; descending into `<dir>/.` used to rescan the same directory forever.
		await Bun.write(path.join(root, "main/..jsonl"), sessionJsonl("dot", ["d1"]));
		await Bun.write(path.join(root, "main/Scout.jsonl"), sessionJsonl("scout", ["s1"]));

		const subs = await collectSubSessions(mainFile);

		expect(Object.keys(subs).sort()).toEqual([".", "Scout"]);
	});

	test("flags subagents killed with a tombstone sidecar as aborted", async () => {
		await Bun.write(path.join(root, "main/Killed.jsonl"), sessionJsonl("killed", ["k1"]));
		await Bun.write(path.join(root, "main/Killed.jsonl.tombstone"), "");
		await Bun.write(path.join(root, "main/Live.jsonl"), sessionJsonl("live", ["l1"]));

		const subs = await collectSubSessions(mainFile);

		expect(subs.Killed.aborted).toBe(true);
		expect(subs.Live.aborted).toBe(false);
	});

	test("returns empty record when no subagent dir exists", async () => {
		expect(await collectSubSessions(mainFile)).toEqual({});
		expect(await collectSubSessions(path.join(root, "not-a-session"))).toEqual({});
	});
});

// Relative paths resolve against process cwd, so each export runs in a subprocess rooted at `root`.
describe("HTML export relative output paths", () => {
	let root: string;
	let mainFile: string;

	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-export-paths-")));
		mainFile = path.join(root, "main.jsonl");
		await Bun.write(mainFile, sessionJsonl("main", ["m1"]));
	});

	afterEach(async () => {
		await removeWithRetries(root);
	});

	test.each([
		["the default filename", undefined, `${APP_NAME}-session-main.html`],
		["a path that normalizes to cwd", "sub/../export.html", "export.html"],
	])("writes %s into cwd and returns its absolute path", async (_description, outputPath, written) => {
		const probe = path.join(import.meta.dir, "fixtures", "html-export-path-probe.ts");
		const result = await $`${process.execPath} ${probe} ${mainFile} ${outputPath ?? []}`
			.cwd(root)
			// Skip the development viewer asset, which CI does not build.
			.env({ ...process.env, PI_BUNDLED: "1" })
			.quiet()
			.nothrow();
		expect(result.exitCode, result.stderr.toString()).toBe(0);
		expect(result.text()).toBe(path.join(root, written));
		expect((await readExportData(path.join(root, written))).header?.id).toBe("main");
	});
});
