/**
 * Gateway session-artifact contract: a remote client lists, reads, and
 * replaces `local://` files of a backend session through the same root the
 * tools use, and traversal never escapes it.
 *
 * The attach TUI's `/local` path calls exactly these three handlers, so this
 * covers standalone→remote parity for the picker, the editor staging read, and
 * the save-back write.
 */

import { afterEach, describe, expect, test, vi } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import { resolveLocalRoot } from "../../src/internal-urls/local-protocol";
import { handleListArtifacts, handleReadArtifact, handleWriteArtifact } from "../../src/server/web-gateway/artifacts";
import { invalidateSessionListCache } from "../../src/server/web-gateway/sessions";
import { SessionManager } from "../../src/session/session-manager";

const ENV_KEY = "ZETA_CODING_AGENT_DIR";

describe("gateway session artifacts", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const savedEnv = new Map<string, string | undefined>();

	afterEach(async () => {
		vi.restoreAllMocks();
		invalidateSessionListCache();
		const saved = savedEnv.get(ENV_KEY);
		if (saved === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = saved;
		refreshDirsFromEnv();
		await Promise.all(cleanups.splice(0).map(fn => fn()));
	});

	async function setup(): Promise<void> {
		const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-artifacts-"));
		cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
		savedEnv.set(ENV_KEY, process.env[ENV_KEY]);
		process.env[ENV_KEY] = agentDir;
		refreshDirsFromEnv();
		invalidateSessionListCache();
	}

	/** Seed a minimal, discoverable session and return its id and artifacts dir. */
	async function seedSession(): Promise<{ id: string; artifactsDir: string }> {
		const cwd = await mkdtemp(join(tmpdir(), "zeta-gw-artifacts-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const dir = SessionManager.getDefaultSessionDir(cwd);
		await fs.mkdir(dir, { recursive: true });
		const id = randomUUID();
		const file = join(dir, `${id}.jsonl`);
		const header = { type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd };
		await fs.writeFile(file, `${JSON.stringify(header)}\n`, "utf8");
		return { id, artifactsDir: file.slice(0, -".jsonl".length) };
	}

	test("lists, reads, and replaces local:// files", async () => {
		await setup();
		const { id, artifactsDir } = await seedSession();
		const localRoot = resolveLocalRoot({ getArtifactsDir: () => artifactsDir, getSessionId: () => id });
		await fs.mkdir(join(localRoot, "plans"), { recursive: true });
		await fs.writeFile(join(localRoot, "plans", "x-plan.md"), "first", "utf8");

		const listed = await handleListArtifacts(id);
		expect(listed.status).toBe(200);
		const body = (await listed.json()) as { entries: Array<{ name: string; url: string }> };
		expect(body.entries.map(entry => entry.name)).toEqual(["plans/x-plan.md"]);
		expect(body.entries[0]?.url).toBe("local://plans/x-plan.md");

		const read = await handleReadArtifact(id, encodeURIComponent("plans/x-plan.md"));
		expect(read.status).toBe(200);
		expect(await read.text()).toBe("first");

		const put = await handleWriteArtifact(
			new Request("http://gateway.local/", { method: "PUT", body: new TextEncoder().encode("second") }),
			id,
			encodeURIComponent("plans/x-plan.md"),
		);
		expect(put.status).toBe(204);
		expect(await fs.readFile(join(localRoot, "plans", "x-plan.md"), "utf8")).toBe("second");
	});

	test("refuses traversal and escaping names", async () => {
		await setup();
		const { id, artifactsDir } = await seedSession();
		const localRoot = resolveLocalRoot({ getArtifactsDir: () => artifactsDir, getSessionId: () => id });
		await fs.mkdir(localRoot, { recursive: true });
		await fs.writeFile(join(artifactsDir, "outside.md"), "secret", "utf8");

		const read = await handleReadArtifact(id, encodeURIComponent("../outside.md"));
		expect(read.status).toBe(403);

		const put = await handleWriteArtifact(
			new Request("http://gateway.local/", { method: "PUT", body: new TextEncoder().encode("pwned") }),
			id,
			encodeURIComponent("../outside.md"),
		);
		expect(put.status).toBe(403);
		expect(await fs.readFile(join(artifactsDir, "outside.md"), "utf8")).toBe("secret");
	});

	test("unknown session is a miss", async () => {
		await setup();
		expect((await handleListArtifacts("missing-session")).status).toBe(404);
		expect((await handleReadArtifact("missing-session", "x.md")).status).toBe(404);
	});
});
