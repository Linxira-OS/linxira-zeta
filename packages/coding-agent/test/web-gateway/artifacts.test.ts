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
import {
	handleDeleteArtifact,
	handleListArtifacts,
	handleReadArtifact,
	handleWriteArtifact,
} from "../../src/server/web-gateway/artifacts";
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

	test("the listing carries the Studio artifact record, and delete removes one", async () => {
		await setup();
		const { id, artifactsDir } = await seedSession();
		const localRoot = resolveLocalRoot({ getArtifactsDir: () => artifactsDir, getSessionId: () => id });
		await fs.mkdir(join(localRoot, "recordings"), { recursive: true });
		await fs.writeFile(join(localRoot, "judgment-1.json"), '{"ok":true}', "utf8");
		await fs.writeFile(join(localRoot, "recording-2026.webm"), "webm-bytes", "utf8");
		await fs.writeFile(join(localRoot, "notes.md"), "# notes", "utf8");

		const listed = await handleListArtifacts(id);
		const body = (await listed.json()) as {
			entries: Array<{
				name: string;
				artifactId: string;
				kind: string;
				mimeType: string;
				bytes: number;
				createdAt: string;
				sha256: string;
			}>;
			total: number;
			totalBytes: number;
			nextCursor?: string;
		};
		// `ArtifactRecord.sha256` is required by the client contract, so a listing
		// without a digest would be unusable for the Studio artifacts page.
		const byName = new Map(body.entries.map(entry => [entry.name, entry]));
		expect(byName.get("judgment-1.json")?.kind).toBe("judgment");
		expect(byName.get("judgment-1.json")?.mimeType).toBe("application/json");
		expect(byName.get("judgment-1.json")?.artifactId).toBe("judgment-1.json");
		expect(byName.get("recording-2026.webm")?.kind).toBe("recording");
		expect(byName.get("notes.md")?.kind).toBe("export");
		expect(byName.get("notes.md")?.bytes).toBe(7);
		expect(byName.get("notes.md")?.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(Number.isNaN(Date.parse(byName.get("notes.md")?.createdAt ?? ""))).toBe(false);
		expect(body.total).toBe(3);
		expect(body.totalBytes).toBe(body.entries.reduce((sum, entry) => sum + entry.bytes, 0));

		const firstPage = await handleListArtifacts(id, { limit: "2" });
		const page = (await firstPage.json()) as { entries: Array<{ name: string }>; nextCursor?: string };
		expect(page.entries).toHaveLength(2);
		expect(page.nextCursor).toBe(page.entries[1]?.name);
		const secondPage = await handleListArtifacts(id, { limit: "2", cursor: page.nextCursor ?? "" });
		const rest = (await secondPage.json()) as { entries: Array<{ name: string }>; nextCursor?: string };
		expect(rest.entries).toHaveLength(1);
		expect(rest.nextCursor).toBeUndefined();

		const deleted = await handleDeleteArtifact(id, encodeURIComponent("notes.md"));
		expect(deleted.status).toBe(204);
		await expect(fs.readFile(join(localRoot, "notes.md"), "utf8")).rejects.toThrow();
		// Containment is checked before the unlink: a traversal name never deletes.
		const traversal = await handleDeleteArtifact(id, encodeURIComponent("../outside.md"));
		expect(traversal.status).toBe(403);
	});

	test("unknown session is a miss", async () => {
		await setup();
		expect((await handleListArtifacts("missing-session")).status).toBe(404);
		expect((await handleReadArtifact("missing-session", "x.md")).status).toBe(404);
	});
});
