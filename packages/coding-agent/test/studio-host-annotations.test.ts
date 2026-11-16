import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTextReviewPrompt } from "../src/extensibility/custom-commands/bundled/annotate/text-review.js";
import { buildReviewPrompt } from "../src/extensibility/custom-commands/bundled/review/prompt.js";
import { createResolvedReviewTarget } from "../src/extensibility/custom-commands/bundled/review/target.js";
import type { StudioHostContext } from "../src/server/studio-host/registry.js";
import type { OperatorStateSnapshot } from "../src/server/studio-host/protocol/index.js";
import type { AnnotationSource } from "../src/server/studio-host/protocol/contracts/annotations.js";
import { createAnnotationsOps, type AnnotationHostDeps } from "../src/server/studio-host/ops/annotations.js";
import { runWithStudioSelection } from "../src/server/studio-host/selection.js";
import { StudioAnnotationService } from "../src/server/studio-host/services/annotation-service.js";
import type { AgentSession } from "../src/session/agent-session.js";

function fakeSession(directory: string, sessionId = "session-1"): AgentSession {
	return {
		sessionId,
		sessionManager: { getCwd: () => directory },
		isDisposed: false,
	} as unknown as AgentSession;
}

it("captures a real workspace file, blocks a stale prepare, and keeps the exact snapshot when allowed", async () => {
	const directory = await mkdtemp(join(tmpdir(), "studio-annotations-file-"));
	try {
		await writeFile(join(directory, "source.txt"), "first\noriginal\n");
		const service = new StudioAnnotationService(fakeSession(directory));
		const captured = await service.execute({
			kind: "annotations.capture",
			source: { kind: "file", path: "source.txt" },
		});
		const source = captured.source;
		expect(source.kind).toBe("file");
		expect(source.path).toBe("source.txt");
		expect(source.text).toBe("first\noriginal\n");
		expect(source.version).toMatch(/^sha256:[a-f0-9]{64}$/u);
		expect(source.sessionId).toBe("session-1");
		const input = {
			kind: "annotations.prepare" as const,
			sources: [source],
			notes: [
				{
					id: "note",
					sourceId: source.id,
					note: "Change this exact value",
					selection: { start: 6, end: 14 },
				},
			],
			action: "feedback" as const,
		};
		await writeFile(join(directory, "source.txt"), "first\nchanged\n");
		const stale = await service.execute(input);
		expect(stale.prompt).toBe("");
		expect(stale.staleSources).toEqual([source.id]);
		const accepted = await service.execute({ ...input, allowStale: true });
		expect(accepted.staleSources).toEqual([source.id]);
		const expected = buildTextReviewPrompt(
			{
				id: source.id,
				kind: "file",
				label: source.label + " (" + source.version + ")",
				text: source.text,
			},
			[{ scope: "line", line: 2, quote: "original", note: "Change this exact value" }],
		);
		expect(expected).toBeDefined();
		if (!expected) throw new Error("native text review builder returned no prompt");
		expect(accepted.prompt).toBe(expected);
		expect(accepted.prompt).toContain("original");
		expect(accepted.prompt).not.toContain("changed");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("keeps a quoted message's captured session and reports it stale until explicitly allowed", async () => {
	const directory = await mkdtemp(join(tmpdir(), "studio-annotations-session-"));
	try {
		const service = new StudioAnnotationService(fakeSession(directory, "live-session"));
		const captured = await service.execute({
			kind: "annotations.capture",
			source: {
				kind: "message",
				text: "historical reply",
				label: "Reply",
				sessionId: "historical-session",
				messageId: "entry-1",
			},
		});
		const source = captured.source;
		expect(source.sessionId).toBe("historical-session");
		expect(source.messageId).toBe("entry-1");
		const input = {
			kind: "annotations.prepare" as const,
			sources: [source],
			notes: [{ id: "note", sourceId: source.id, note: "Keep this exact reply" }],
			action: "feedback" as const,
		};
		const stale = await service.execute(input);
		expect(stale.prompt).toBe("");
		expect(stale.staleSources).toEqual([source.id]);
		const accepted = await service.execute({ ...input, allowStale: true });
		expect(accepted.staleSources).toEqual([source.id]);
		expect(accepted.prompt).toContain("historical reply");
		expect(accepted.prompt).toContain("Keep this exact reply");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("rejects wrong versions, traversal, out-of-bounds selections, and NUL text", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-annotations-invalid-"));
	const directory = join(root, "workspace");
	await mkdir(directory);
	try {
		await writeFile(join(root, "secret.txt"), "secret\n");
		await writeFile(join(directory, "text.txt"), "ok\n");
		await writeFile(join(directory, "binary.txt"), Buffer.from([0x61, 0x00, 0x62]));
		const service = new StudioAnnotationService(fakeSession(directory));
		const { source } = await service.execute({
			kind: "annotations.capture",
			source: { kind: "quote", text: "snapshot", label: "Source" },
		});
		const rejected = (operation: () => Promise<unknown>) => operation().catch(error => error);
		const note = { id: "note", sourceId: source.id, note: "Check" };
		expect(
			await rejected(() =>
				service.execute({
					kind: "annotations.prepare",
					sources: [{ ...source, version: "sha256:" + "0".repeat(64) }],
					notes: [note],
					action: "feedback",
				}),
			),
		).toMatchObject({ code: "INVALID_ARGUMENT" });
		expect(
			await rejected(() =>
				service.execute({
					kind: "annotations.prepare",
					sources: [source],
					notes: [{ ...note, selection: { start: 0, end: source.text.length + 1 } }],
					action: "feedback",
				}),
			),
		).toMatchObject({ code: "INVALID_ARGUMENT" });
		expect(
			await rejected(() =>
				service.execute({
					kind: "annotations.capture",
					source: { kind: "file", path: "../secret.txt" },
				}),
			),
		).toMatchObject({ code: "INVALID_ARGUMENT" });
		expect(
			await rejected(() =>
				service.execute({
					kind: "annotations.capture",
					source: { kind: "quote", text: "bad\0text", label: "Source" },
				}),
			),
		).toMatchObject({ code: "INVALID_ARGUMENT" });
		expect(
			await rejected(() =>
				service.execute({
					kind: "annotations.capture",
					source: { kind: "file", path: "binary.txt" },
				}),
			),
		).toMatchObject({ code: "INVALID_ARGUMENT" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("fences a session switch during preparation even when stale sources are explicitly allowed", async () => {
	const session = {
		sessionId: "before",
		sessionManager: { getCwd: () => "." },
		isDisposed: false,
	};
	const service = new StudioAnnotationService(session as unknown as AgentSession);
	const { source } = await service.execute({
		kind: "annotations.capture",
		source: { kind: "quote", text: "snapshot", label: "Source" },
	});
	const file = { ...source, kind: "file" as const, path: "source.txt" };
	service.capture = async () => {
		session.sessionId = "after";
		return file;
	};
	const error = await service
		.execute({
			kind: "annotations.prepare",
			sources: [file],
			notes: [{ id: "note", sourceId: source.id, note: "Check" }],
			action: "feedback",
			allowStale: true,
		})
		.catch(reason => reason);
	expect(error).toMatchObject({ code: "UNAVAILABLE" });
});

it("captures a real uncommitted diff in an isolated git fixture and builds the native review prompt", async () => {
	const directory = await mkdtemp(join(tmpdir(), "studio-annotations-diff-"));
	try {
		await Bun.$`git init -q`.cwd(directory).quiet();
		await Bun.$`git config user.email tester@example.com`.cwd(directory).quiet();
		await Bun.$`git config user.name Tester`.cwd(directory).quiet();
		await Bun.$`git config core.autocrlf false`.cwd(directory).quiet();
		await writeFile(join(directory, "tracked.txt"), "one\ntwo\n");
		await Bun.$`git add tracked.txt`.cwd(directory).quiet();
		await Bun.$`git commit -q -m baseline`.cwd(directory).quiet();
		await writeFile(join(directory, "tracked.txt"), "one\nchanged\n");
		const service = new StudioAnnotationService(fakeSession(directory));
		const { source } = await service.execute({
			kind: "annotations.capture",
			source: { kind: "diff" },
		});
		expect(source.kind).toBe("diff");
		expect(source.text).toContain("-two");
		expect(source.text).toContain("+changed");
		const start = source.text.indexOf("+changed");
		const prepared = await service.execute({
			kind: "annotations.prepare",
			sources: [source],
			notes: [
				{
					id: "note",
					sourceId: source.id,
					note: "Keep this change",
					selection: { start, end: start + "+changed".length },
				},
			],
			action: "review",
		});
		const feedback = buildTextReviewPrompt(
			{
				id: source.id,
				kind: "code",
				label: source.label + " (" + source.version + ")",
				text: source.text,
			},
			[
				{
					scope: "line",
					line: source.text.slice(0, start).split("\n").length,
					quote: "+changed",
					note: "Keep this change",
				},
			],
		);
		const expected = buildReviewPrompt(
			createResolvedReviewTarget("uncommitted", "Studio annotated snapshot", source.text, "No changes", {
				contextInstruction:
					"The operator annotated the captured source version. Check for drift before applying changes.",
			}),
			feedback,
		);
		expect(prepared.prompt).toBe(expected);
		expect(prepared.staleSources).toEqual([]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it("requires a live owner and binds the exact selected session through the Workbench envelope", async () => {
	const directory = await mkdtemp(join(tmpdir(), "studio-annotations-ops-"));
	try {
		const session = fakeSession(directory);
		let ownerLive = true;
		const selection = { workspaceId: "workspace-1", sessionId: "session-1", closed: false };
		const owner = { id: "owner-1", expiresAt: Date.now() + 60_000, isLive: () => ownerLive };
		const snapshot = { stateVersion: 7 } as unknown as OperatorStateSnapshot;
		const deps: AnnotationHostDeps = {
			resolveSession: sessionId => (sessionId === "session-1" ? { session, isLive: () => true } : undefined),
			snapshot: async () => snapshot,
		};
		const context = { selection, privateOwner: owner } as unknown as StudioHostContext;
		const ops = createAnnotationsOps(deps);
		const capture = ops.commands?.["annotations.capture"];
		const prepare = ops.commands?.["annotations.prepare"];
		expect(capture).toBeDefined();
		expect(prepare).toBeDefined();
		const run = <T>(action: () => Promise<T>): Promise<T> => runWithStudioSelection(selection, action);
		const captured = await run(() => capture!({ source: { kind: "quote", text: "hello", label: "Quote" } }, context));
		expect(captured?.snapshot).toBe(snapshot);
		const source = captured?.result.source as AnnotationSource;
		expect(source).toMatchObject({
			kind: "quote",
			text: "hello",
			label: "Quote",
			sessionId: "session-1",
		});
		const prepared = await run(() =>
			prepare!(
				{
					sources: [source],
					notes: [{ id: "note", sourceId: source.id, note: "Check this" }],
					action: "feedback",
				},
				context,
			),
		);
		expect(prepared?.snapshot).toBe(snapshot);
		expect(prepared?.result.prompt).toContain("Check this");
		const invalid = await run(() =>
			capture!(
				{
					source: { kind: "quote", text: "hello", label: "Quote", extra: true },
				} as unknown as Parameters<NonNullable<typeof capture>>[0],
				context,
			),
		).catch(error => error);
		expect(invalid).toMatchObject({ code: "INVALID_ARGUMENT" });
		const missingOwner = await run(() =>
			capture!({ source: { kind: "quote", text: "hello", label: "Quote" } }, {
				selection,
			} as unknown as StudioHostContext),
		).catch(error => error);
		expect(missingOwner).toMatchObject({ code: "UNAVAILABLE" });
		const missingSelection = await run(() =>
			capture!({ source: { kind: "quote", text: "hello", label: "Quote" } }, {
				privateOwner: owner,
			} as unknown as StudioHostContext),
		).catch(error => error);
		expect(missingSelection).toMatchObject({ code: "UNAVAILABLE" });
		const historical = await run(() =>
			capture!(
				{
					source: {
						kind: "message",
						text: "hello",
						label: "Quote",
						sessionId: "other",
						messageId: "entry-1",
					},
				},
				context,
			),
		);
		expect(historical?.snapshot).toBe(snapshot);
		const historicalSource = historical?.result.source as AnnotationSource;
		expect(historicalSource).toMatchObject({
			kind: "message",
			text: "hello",
			label: "Quote",
			sessionId: "other",
			messageId: "entry-1",
		});
		const historicalNote = {
			id: "historical-note",
			sourceId: historicalSource.id,
			note: "Check the saved reply",
		};
		const stale = await run(() =>
			prepare!(
				{
					sources: [historicalSource],
					notes: [historicalNote],
					action: "feedback",
				},
				context,
			),
		);
		expect(stale?.snapshot).toBe(snapshot);
		expect(stale?.result.prompt).toBe("");
		expect(stale?.result.staleSources).toEqual([historicalSource.id]);
		const approved = await run(() =>
			prepare!(
				{
					sources: [historicalSource],
					notes: [historicalNote],
					action: "feedback",
					allowStale: true,
				},
				context,
			),
		);
		expect(approved?.result.prompt).toContain("Check the saved reply");
		const missing = createAnnotationsOps({ ...deps, resolveSession: () => undefined });
		const missingCapture = missing.commands?.["annotations.capture"];
		expect(missingCapture).toBeDefined();
		const unavailable = await run(() =>
			missingCapture!({ source: { kind: "quote", text: "hello", label: "Quote" } }, context),
		).catch(error => error);
		expect(unavailable).toMatchObject({ code: "UNAVAILABLE" });
		const revokedDeps = createAnnotationsOps({
			resolveSession: deps.resolveSession,
			snapshot: async () => {
				ownerLive = false;
				return snapshot;
			},
		});
		const revokedCapture = revokedDeps.commands?.["annotations.capture"];
		expect(revokedCapture).toBeDefined();
		const revoked = await run(() =>
			revokedCapture!({ source: { kind: "quote", text: "hello", label: "Quote" } }, context),
		).catch(error => error);
		expect(revoked).toMatchObject({ code: "UNAVAILABLE" });
		ownerLive = true;
		const switchedDeps = createAnnotationsOps({
			resolveSession: deps.resolveSession,
			snapshot: async () => {
				selection.sessionId = "other";
				return snapshot;
			},
		});
		const switchedCapture = switchedDeps.commands?.["annotations.capture"];
		expect(switchedCapture).toBeDefined();
		const switched = await run(() =>
			switchedCapture!({ source: { kind: "quote", text: "hello", label: "Quote" } }, context),
		).catch(error => error);
		expect(switched).toMatchObject({ code: "UNAVAILABLE" });
		selection.sessionId = "session-1";
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
