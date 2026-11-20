import { listLocalFiles } from "../../../internal-urls/local-protocol.js";
import { acquireFileLock } from "@linxiraos/pi-utils";
import { writeFileAtomically } from "../../../utils/atomic-file.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import {
	AttachmentProtocolHandler,
	ConflictProtocolHandler,
	LocalProtocolHandler,
	ZetaProtocolHandler,
	parseInternalUrl,
	sessionResolveContext,
	type ProtocolHandler,
	type ResolveContext,
} from "../../../internal-urls/index.js";
import type { AgentSession } from "../../../session/agent-session.js";
import type { ToolSession } from "../../../tools/index.js";
import { resizeImage } from "../../../utils/image-resize.js";
import { StudioOpError } from "../errors.js";
import type { LocalResourceOperation } from "../protocol/contracts/local-resources.js";
import type { ResourceOperation, ResourcePage } from "../protocol/contracts/resources.js";

const MAX_LOCAL_TEXT_BYTES = 512 * 1024;
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const PAGE_LINES = 100;
const LINE_MAX_CHARS = 2048;

const SCHEME_MIME: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

/**
 * Native session resources for the Resources surface.
 *
 * Every file read goes through the session's own internal-URL handlers, so
 * `local://` keeps the artifacts-root containment and symlink rules and
 * `attachment://`/`conflict://` read only the session objects that registered
 * them. `zeta://` is the embedded documentation corpus. Nothing here scans the
 * filesystem, resolves an arbitrary path or invokes a tool.
 */
export class StudioResourceService {
	constructor(
		readonly session: AgentSession,
		/** Native tool session; absent only when a host build lacks the Studio seam. */
		readonly toolSession?: ToolSession,
	) {}

	#assertSession(sessionId: string, assertActive?: () => void): void {
		assertActive?.();
		if (sessionId !== this.session.sessionId)
			throw new StudioOpError("UNAVAILABLE", "The active session changed; reopen resources");
	}

	#context(): ResolveContext {
		if (this.toolSession) return sessionResolveContext(this.toolSession);
		const session = this.session;
		return {
			cwd: session.sessionManager.getCwd(),
			settings: session.settings,
			sessionFile: session.sessionManager.getSessionFile() ?? undefined,
			sessionId: session.sessionManager.getSessionId(),
			localProtocolOptions: {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionManager.getSessionId(),
			},
			skills: session.skills,
		};
	}

	#localOptions(context: ResolveContext) {
		const options = LocalProtocolHandler.resolveOptions(context);
		if (!options?.getArtifactsDir?.())
			throw new StudioOpError("UNAVAILABLE", "The session has no local artifacts directory");
		return options;
	}

	async local(operation: LocalResourceOperation, assertActive?: () => void): Promise<unknown> {
		this.#assertSession(operation.sessionId, assertActive);
		const context = this.#context();
		const options = this.#localOptions(context);
		if (operation.kind === "resource.local.list") {
			const files = await listLocalFiles(options);
			this.#assertSession(operation.sessionId, assertActive);
			return {
				files: files
					.slice(0, 500)
					.map(file => ({ name: file.name, uri: file.url, bytes: file.size, modifiedAt: file.mtimeMs })),
				truncated: files.length > 500,
			};
		}
		if (!operation.uri.startsWith("local://"))
			throw new StudioOpError("INVALID_ARGUMENT", "Choose a session-local file");
		const handler = new LocalProtocolHandler();
		let located: string | null;
		try {
			located = await handler.locate(parseInternalUrl(operation.uri), context);
		} catch (error) {
			throw new StudioOpError("INVALID_ARGUMENT", error instanceof Error ? error.message : "Invalid local file");
		}
		this.#assertSession(operation.sessionId, assertActive);
		if (!located) throw new StudioOpError("UNAVAILABLE", "The local file no longer exists");
		const lock = operation.kind === "resource.local.save" ? await acquireFileLock(located) : undefined;
		try {
			const stat = await fs.stat(located);
			if (!stat.isFile() || stat.size > MAX_LOCAL_TEXT_BYTES)
				throw new StudioOpError("INVALID_ARGUMENT", "The text editor supports regular files up to 512 KiB");
			const bytes = await fs.readFile(located);
			if (bytes.includes(0)) throw new StudioOpError("INVALID_ARGUMENT", "This local resource is binary");
			const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			const version = createHash("sha256").update(bytes).digest("hex");
			this.#assertSession(operation.sessionId, assertActive);
			if (operation.kind === "resource.local.open") return { uri: operation.uri, version, text };
			if (version !== operation.version)
				throw new StudioOpError("STATE_VERSION_CONFLICT", "The local file changed; reopen it before saving");
			if (
				typeof operation.text !== "string" ||
				Buffer.byteLength(operation.text) > MAX_LOCAL_TEXT_BYTES ||
				operation.text.includes("\0")
			)
				throw new StudioOpError("INVALID_ARGUMENT", "Local text exceeds editor limits");
			assertActive?.();
			await writeFileAtomically(located, operation.text, stat.mode & 0o777);
			assertActive?.();
			return {
				saved: true,
				uri: operation.uri,
				version: createHash("sha256").update(operation.text).digest("hex"),
			};
		} finally {
			lock?.release();
		}
	}

	async read(operation: ResourceOperation, assertActive?: () => void): Promise<ResourcePage> {
		this.#assertSession(operation.sessionId, assertActive);
		const context = this.#context();
		const scheme = operation.uri.slice(0, operation.uri.indexOf("://"));
		const handler: ProtocolHandler | undefined =
			scheme === "local"
				? new LocalProtocolHandler()
				: scheme === "zeta"
					? new ZetaProtocolHandler()
					: scheme === "attachment"
						? new AttachmentProtocolHandler()
						: scheme === "conflict"
							? new ConflictProtocolHandler()
							: undefined;
		if (!handler) throw new StudioOpError("INVALID_ARGUMENT", "Unsupported resource scheme");
		if (scheme === "conflict" && !this.toolSession) {
			throw new StudioOpError(
				"CAPABILITY_UNAVAILABLE",
				"conflict:// reading requires the native session tool context",
			);
		}
		const url = parseInternalUrl(operation.uri);
		let content = "";
		let bytes: Uint8Array | undefined;
		let image: ResourcePage["image"];
		let located: string | null = null;
		if (handler.spec.backing === "file" && handler.locate) {
			try {
				located = await handler.locate(url, context);
			} catch (error) {
				throw new StudioOpError("INVALID_ARGUMENT", error instanceof Error ? error.message : "Invalid resource");
			}
			this.#assertSession(operation.sessionId, assertActive);
		}
		// Attachment source paths are the same native files the handler locates;
		// without a tool-session seam the session still owns their identities.
		if (!located && scheme === "attachment") {
			const attachment = this.session.getImageAttachments().find(entry => entry.uri === operation.uri);
			if (attachment) located = attachment.sourcePath;
			this.#assertSession(operation.sessionId, assertActive);
		}
		if (located) {
			const stat = await fs.stat(located);
			if (stat.isFile()) {
				if (stat.size > MAX_RESOURCE_BYTES)
					throw new StudioOpError("INVALID_ARGUMENT", "Resource exceeds the 16 MiB viewer limit");
				bytes = await fs.readFile(located);
				this.#assertSession(operation.sessionId, assertActive);
				const imageType = /\.(png|jpe?g|gif|webp)$/i.exec(located)?.[1];
				if (imageType || scheme === "attachment") {
					const mimeType = SCHEME_MIME[(imageType ?? "jpeg").toLowerCase()] ?? "image/jpeg";
					const resized = await resizeImage(
						{ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType },
						{ maxBytes: 300000, maxWidth: 1280, maxHeight: 1280 },
					);
					if (resized.data.length > 600000)
						throw new StudioOpError("INVALID_ARGUMENT", "Resource image exceeds the preview budget");
					image = { mimeType: resized.mimeType, data: resized.data };
					content = `${resized.originalWidth}×${resized.originalHeight} → ${resized.width}×${resized.height}`;
				} else {
					if (bytes.includes(0))
						throw new StudioOpError("INVALID_ARGUMENT", "Binary resource; use its native application");
					content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
				}
			}
		}
		if (bytes === undefined) {
			try {
				const resolved = await handler.resolve(url, context);
				content = typeof resolved.content === "string" ? resolved.content : resolved.content.toString("utf8");
			} catch (error) {
				throw new StudioOpError(
					"UNAVAILABLE",
					error instanceof Error ? error.message : "The resource could not be resolved",
				);
			}
			this.#assertSession(operation.sessionId, assertActive);
		}
		if (Buffer.byteLength(content) > MAX_RESOURCE_BYTES)
			throw new StudioOpError("INVALID_ARGUMENT", "Resource exceeds the viewer budget");
		const version = createHash("sha256")
			.update(bytes ?? content)
			.digest("hex");
		if (operation.version && operation.version !== version)
			throw new StudioOpError("STATE_VERSION_CONFLICT", "Resource changed; restart from the first page");
		const lines = content.split("\n");
		const offset = operation.offset ?? 0;
		if (offset > lines.length) throw new StudioOpError("INVALID_ARGUMENT", "Resource page is out of range");
		const selected = lines.slice(offset, offset + PAGE_LINES);
		const result: ResourcePage = {
			uri: operation.uri,
			version,
			offset,
			total: lines.length,
			text: selected.map(line => line.slice(0, LINE_MAX_CHARS)).join("\n"),
			truncated: selected.some(line => line.length > LINE_MAX_CHARS),
			...(offset + selected.length < lines.length ? { nextOffset: offset + selected.length } : {}),
			...(image ? { image } : {}),
		};
		this.#assertSession(operation.sessionId, assertActive);
		return result;
	}
}
