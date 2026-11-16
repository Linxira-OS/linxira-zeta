import { createHash, randomUUID } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import * as path from "node:path";
import type { TextReviewAnnotation } from "@linxiraos/pi-tui/overlays/annotation-types";
import { buildTextReviewPrompt } from "../../../extensibility/custom-commands/bundled/annotate/text-review.js";
import { buildReviewPrompt } from "../../../extensibility/custom-commands/bundled/review/prompt.js";
import {
	createResolvedReviewTarget,
	readUncommittedReviewTarget,
} from "../../../extensibility/custom-commands/bundled/review/target.js";
import type { AgentSession } from "../../../session/agent-session.js";
import { invalid, StudioOpError, unavailable } from "../errors.js";
import type {
	AnnotationCapture,
	AnnotationNote,
	AnnotationOperation,
	AnnotationResultMap,
	AnnotationSource,
} from "../protocol/contracts/annotations.js";

export const annotationVersion = (text: string) => "sha256:" + createHash("sha256").update(text).digest("hex");
const MAX_SOURCE_CHARS = 120_000;
const MAX_FILE_BYTES = 360_000;
const MAX_PATH_CHARS = 4096;

/** Offsets are UTF-16 code units in the captured source, end exclusive. */
function annotationForNote(source: AnnotationSource, note: AnnotationNote): TextReviewAnnotation {
	if (!note.selection) return { scope: "text", note: note.note };
	const { start, end } = note.selection;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start >= end ||
		end > source.text.length
	)
		throw invalid("Annotation selection is outside the source");
	return {
		scope: "line",
		line: source.text.slice(0, start).split("\n").length,
		quote: source.text.slice(start, end),
		note: note.note,
	};
}

function assertSourceText(source: AnnotationSource): void {
	if (typeof source.text !== "string" || source.text.length > MAX_SOURCE_CHARS || source.text.includes("\0"))
		throw invalid("Annotation source is too large or binary");
	if (source.version !== annotationVersion(source.text))
		throw invalid("Annotation source contents do not match their version");
}

function assertRelativePath(value: string): void {
	if (
		!value.trim() ||
		value.length > MAX_PATH_CHARS ||
		value.includes("\0") ||
		/^(?:[A-Za-z]:|[\\/])/u.test(value) ||
		value.split(/[\\/]/u).includes("..")
	)
		throw invalid("Annotation paths must be workspace-relative");
}

/** Native prompt builders over versioned snapshots; never sends a model request. */
export class StudioAnnotationService {
	constructor(readonly session: AgentSession) {}

	async execute<K extends AnnotationOperation["kind"]>(
		operation: Extract<AnnotationOperation, { kind: K }>,
	): Promise<AnnotationResultMap[K]>;
	async execute(operation: AnnotationOperation): Promise<AnnotationResultMap[AnnotationOperation["kind"]]> {
		try {
			return operation.kind === "annotations.capture"
				? { source: await this.capture(operation.source) }
				: await this.prepare(operation);
		} catch (error) {
			if (error instanceof StudioOpError) throw error;
			throw invalid("Unable to prepare annotations. Check the source, its size, and its text encoding.");
		}
	}

	async capture(input: AnnotationCapture): Promise<AnnotationSource> {
		const capturedCwd = this.session.sessionManager.getCwd();
		const capturedSessionId = this.session.sessionId;
		let text: string;
		let label: string;
		if (input.kind === "file") {
			assertRelativePath(input.path);
			const root = await realpath(capturedCwd);
			const file = await realpath(path.resolve(root, input.path));
			const relative = path.relative(root, file);
			if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
				throw invalid("Annotation file must stay inside the workspace");
			const handle = await open(file, "r");
			try {
				const stat = await handle.stat();
				if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
					throw invalid("Annotation file must be a small text file");
				const bytes = Buffer.alloc(stat.size + 1);
				let offset = 0;
				while (offset < bytes.length) {
					const read = await handle.read(bytes, offset, bytes.length - offset, offset);
					if (!read.bytesRead) break;
					offset += read.bytesRead;
				}
				if (offset !== stat.size) throw invalid("File changed during capture; try again");
				text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
			} finally {
				await handle.close();
			}
			label = input.path;
		} else if (input.kind === "diff") {
			if (input.path !== undefined) assertRelativePath(input.path);
			const target = await readUncommittedReviewTarget(capturedCwd);
			const relative = input.path?.replaceAll("\\", "/");
			text = target.snapshot.files
				.filter(
					file => !relative || file.path === relative || file.newPath === relative || file.oldPath === relative,
				)
				.map(file => file.rawDiff)
				.join("\n");
			if (!text.trim()) throw invalid("No reviewable changes for this source");
			label = input.path ?? "Uncommitted changes";
		} else {
			if (
				typeof input.text !== "string" ||
				typeof input.label !== "string" ||
				!input.label.trim() ||
				input.label.includes("\0") ||
				input.label.length > 512
			)
				throw invalid("Invalid annotation text");
			text = input.text;
			label = input.label;
		}
		text = text.replace(/\r\n?/gu, "\n");
		if (text.length > MAX_SOURCE_CHARS || text.includes("\0"))
			throw invalid("Annotation source is too large or binary");
		const reference =
			input.kind === "file" || input.kind === "diff"
				? capturedCwd + ":" + input.kind + ":" + (input.path ?? "*")
				: randomUUID();
		if (this.session.sessionId !== capturedSessionId || this.session.sessionManager.getCwd() !== capturedCwd)
			throw unavailable("Session changed during source capture; try again");
		return {
			id: "source-" + createHash("sha256").update(reference).digest("hex").slice(0, 32),
			kind: input.kind,
			label,
			text,
			version: annotationVersion(text),
			...("path" in input && input.path ? { path: input.path } : {}),
			sessionId: "sessionId" in input && input.sessionId ? input.sessionId : capturedSessionId,
			...("messageId" in input && input.messageId ? { messageId: input.messageId } : {}),
		};
	}

	async prepare(
		operation: Extract<AnnotationOperation, { kind: "annotations.prepare" }>,
	): Promise<{ prompt: string; staleSources: string[] }> {
		const capturedCwd = this.session.sessionManager.getCwd();
		const capturedSessionId = this.session.sessionId;
		const staleSources: string[] = [];
		const prompts: string[] = [];
		for (const source of operation.sources) {
			assertSourceText(source);
			if (source.path !== undefined) assertRelativePath(source.path);
			const notes = operation.notes.filter(note => note.sourceId === source.id);
			if (!notes.length) continue;
			for (const note of notes) {
				if (
					typeof note.note !== "string" ||
					!note.note.trim() ||
					note.note.length > 8000 ||
					note.note.includes("\0")
				)
					throw invalid("Invalid annotation text");
			}
			if (source.kind === "file" || source.kind === "diff") {
				if (source.kind === "file" && !source.path) throw invalid("Missing annotation file");
				try {
					const current = await this.capture(
						source.kind === "file"
							? { kind: "file", path: source.path! }
							: { kind: "diff", ...(source.path ? { path: source.path } : {}) },
					);
					if (
						current.version !== source.version ||
						(source.id !== current.id && !source.id.startsWith(current.id + ":"))
					)
						staleSources.push(source.id);
				} catch {
					staleSources.push(source.id);
				}
			} else if (source.sessionId && source.sessionId !== capturedSessionId) {
				staleSources.push(source.id);
			}
			const native = notes.map(note => annotationForNote(source, note));
			const feedback =
				buildTextReviewPrompt(
					{
						id: source.id,
						kind: source.kind === "diff" ? "code" : source.kind === "quote" ? "prompt" : source.kind,
						...(source.kind === "message"
							? { provenance: { kind: "session" as const, entryId: source.messageId ?? source.id } }
							: {}),
						label: source.label + " (" + source.version + ")",
						text: source.text,
					},
					native,
				) ?? "";
			prompts.push(
				operation.action === "review" && source.kind === "diff"
					? buildReviewPrompt(
							createResolvedReviewTarget("uncommitted", "Studio annotated snapshot", source.text, "No changes", {
								contextInstruction:
									"The operator annotated the captured source version. Check for drift before applying changes.",
							}),
							feedback,
						)
					: feedback,
			);
		}
		if (this.session.sessionId !== capturedSessionId || this.session.sessionManager.getCwd() !== capturedCwd)
			throw unavailable("Session changed while preparing annotations; try again");
		return {
			prompt: staleSources.length && !operation.allowStale ? "" : prompts.filter(Boolean).join("\n\n---\n\n"),
			staleSources,
		};
	}
}
