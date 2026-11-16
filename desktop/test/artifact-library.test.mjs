import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	ARTIFACT_LIBRARY_CHANNELS,
	isArtifactLibraryUrl,
	registerArtifactLibrary,
} from "../dist/artifact-library.js";

class Sender extends EventEmitter {
	constructor(id) {
		super();
		this.id = id;
		this.mainFrame = {};
	}
	isDestroyed() {
		return false;
	}
	getURL() {
		return "http://127.0.0.1:43141/";
	}
	send() {}
}

test("artifact library imports and exports raw Host bytes with sender and target fences", async () => {
	const temporaryRoot = fileURLToPath(new URL("../../temp/", import.meta.url));
	await mkdir(temporaryRoot, { recursive: true });
	const directory = await mkdtemp(join(temporaryRoot, "zeta-artifact-library-"));
	const source = join(directory, "pixel.png");
	const bytes = Buffer.alloc(70_001);
	for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
	await writeFile(source, bytes);

	const stored = new Map();
	const calls = [];
	const server = createServer((request, response) => {
		const chunks = [];
		request.on("data", chunk => chunks.push(chunk));
		request.on("end", () => {
			const url = new URL(request.url, "http://127.0.0.1");
			const body = Buffer.concat(chunks);
			calls.push({
				method: request.method,
				path: url.pathname,
				query: url.searchParams,
				body,
				contentType: request.headers["content-type"],
				contentLength: request.headers["content-length"],
			});
			if (request.method === "POST" && url.pathname === "/api/v1/artifacts") {
				const sessionId = url.searchParams.get("sessionId");
				const kind = url.searchParams.get("kind");
				const mimeType = url.searchParams.get("mimeType");
				const storedName = `image-${randomUUID()}.png`;
				const artifactId = Buffer.from(`zeta-artifact\u0000${sessionId}\u0000${storedName}`, "utf8").toString("base64url");
				const artifact = {
					artifactId,
					kind,
					name: storedName,
					mimeType,
					bytes: body.length,
					createdAt: new Date().toISOString(),
					sessionId,
					sha256: createHash("sha256").update(body).digest("hex"),
				};
				stored.set(artifactId, { artifact, bytes: body });
				response.writeHead(201, { "content-type": "application/json" });
				response.end(JSON.stringify({ artifact }));
				return;
			}
			if (url.pathname.startsWith("/api/v1/artifacts/")) {
				const artifactId = decodeURIComponent(url.pathname.slice("/api/v1/artifacts/".length));
				const found = stored.get(artifactId);
				if (!found) {
					response.writeHead(404);
					response.end();
					return;
				}
				const headers = {
					"content-type": found.artifact.mimeType,
					"content-length": String(found.bytes.length),
					"accept-ranges": "bytes",
				};
				if (request.method === "HEAD") {
					response.writeHead(200, headers);
					response.end();
					return;
				}
				const range = request.headers.range;
				if (range) {
					const match = /^bytes=(\d*)-(\d*)$/.exec(range);
					const start = match[1] ? Number(match[1]) : 0;
					const end = match[2] ? Math.min(found.bytes.length - 1, Number(match[2])) : found.bytes.length - 1;
					response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${found.bytes.length}`, "content-length": String(end - start + 1) });
					response.end(found.bytes.subarray(start, end + 1));
					return;
				}
				response.writeHead(200, headers);
				response.end(found.bytes);
				return;
			}
			response.writeHead(404);
			response.end();
		});
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${server.address().port}`;

	const handlers = new Map();
	const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) };
	const targetCalls = [];
	let navigateOnGet;
	let revokeOnGet = false;
	let contextLive = true;
	const connection = targetId => {
		targetCalls.push(targetId);
		if (targetId === "remote-down") throw new Error("remote target disconnected");
		return {
			async request(route, init = {}) {
				if (!contextLive) return new Response(null, { status: 404 });
				const response = await fetch(`${base}${route}`, {
					method: init.method ?? "GET",
					headers: init.headers,
					body: init.body,
					signal: init.signal,
				});
				if (navigateOnGet && init.method === "GET") {
					const sender = navigateOnGet;
					navigateOnGet = undefined;
					sender.emit("did-start-navigation", {}, "http://127.0.0.1:43141/next", false, true);
				}
				if (revokeOnGet && init.method === "GET") {
					revokeOnGet = false;
					contextLive = false;
				}
				return response;
			},
		};
	};
	const sender = new Sender(1);
	const staleSender = new Sender(2);
	const foreign = new Sender(99);
	const trusted = new Set([sender, staleSender]);
	let imports = 0;
	let exportPath = join(directory, "exported.png");
	let exportedName;
	const library = registerArtifactLibrary({
		ipcMain,
		connection,
		isTrustedSender: candidate => trusted.has(candidate),
		pickImport: async kind => {
			imports += 1;
			assert.equal(kind, "image");
			return source;
		},
		pickExport: async name => {
			exportedName = name;
			return exportPath;
		},
	});
	const invoke = (channel, activeSender, value) => handlers.get(channel)({ sender: activeSender, senderFrame: activeSender.mainFrame }, value);

	try {
		const imported = await invoke(ARTIFACT_LIBRARY_CHANNELS.import, sender, {
			kind: "image",
			sessionId: "session-1",
			contextId: "context-1",
			targetId: "remote-1",
		});
		assert.equal(imported.ok, true);
		assert.equal(imported.cancelled, false);
		assert.equal(imported.artifact.kind, "image");
		assert.equal(imported.artifact.mimeType, "image/png");
		assert.equal(imported.artifact.bytes, bytes.length);
		const post = calls.filter(call => call.method === "POST");
		assert.equal(post.length, 1);
		assert.deepEqual(post[0].body, bytes);
		assert.equal(post[0].contentType, "application/octet-stream");
		assert.equal(post[0].contentLength, String(bytes.length));
		assert.equal(post[0].query.get("sessionId"), "session-1");
		assert.equal(post[0].query.get("contextId"), "context-1");
		assert.equal(post[0].query.get("name"), "pixel.png");
		assert.equal(post[0].query.get("kind"), "image");
		assert.equal(post[0].query.get("mimeType"), "image/png");
		assert.deepEqual(targetCalls, ["remote-1"]);

		const exported = await invoke(ARTIFACT_LIBRARY_CHANNELS.export, sender, {
			artifactId: imported.artifact.artifactId,
			contextId: "context-1",
			targetId: "remote-1",
		});
		assert.equal(exported.ok, true);
		assert.equal(exported.cancelled, false);
		assert.deepEqual(await readFile(exportPath), bytes);
		assert.equal(exportedName, imported.artifact.name);
		assert.deepEqual(targetCalls, ["remote-1", "remote-1"]);

		const foreignResult = await invoke(ARTIFACT_LIBRARY_CHANNELS.import, foreign, {
			kind: "image",
			sessionId: "session-1",
			contextId: "context-1",
		});
		assert.equal(foreignResult.ok, false);
		assert.equal(imports, 1);
		const subframe = await handlers.get(ARTIFACT_LIBRARY_CHANNELS.import)(
			{ sender, senderFrame: {} },
			{ kind: "image", sessionId: "session-1", contextId: "context-1" },
		);
		assert.equal(subframe.ok, false);
		assert.equal(imports, 1);
		const audio = await invoke(ARTIFACT_LIBRARY_CHANNELS.import, sender, {
			kind: "audio",
			sessionId: "session-1",
			contextId: "context-1",
		});
		assert.equal(audio.ok, false);
		assert.match(audio.message, /Audio import is unavailable/u);
		assert.equal(imports, 1);

		const staleDestination = join(directory, "stale.png");
		exportPath = staleDestination;
		navigateOnGet = staleSender;
		const stale = await invoke(ARTIFACT_LIBRARY_CHANNELS.export, staleSender, {
			artifactId: imported.artifact.artifactId,
			contextId: "context-1",
			targetId: "remote-1",
		});
		assert.equal(stale.ok, false);
		await assert.rejects(access(staleDestination));

		const revokedDestination = join(directory, "revoked-context.png");
		exportPath = revokedDestination;
		revokeOnGet = true;
		const revoked = await invoke(ARTIFACT_LIBRARY_CHANNELS.export, sender, {
			artifactId: imported.artifact.artifactId,
			contextId: "context-1",
			targetId: "remote-1",
		});
		assert.equal(revoked.ok, false);
		await assert.rejects(access(revokedDestination));
		contextLive = true;

		const localBefore = targetCalls.filter(targetId => targetId === null).length;
		const disconnected = await invoke(ARTIFACT_LIBRARY_CHANNELS.import, sender, {
			kind: "image",
			sessionId: "session-1",
			contextId: "context-1",
			targetId: "remote-down",
		});
		assert.equal(disconnected.ok, false);
		assert.equal(targetCalls.filter(targetId => targetId === null).length, localBefore);
		assert.equal(imports, 1);

		const origin = "http://127.0.0.1:43141";
		const schemeUrl = `zeta-artifact://library/${encodeURIComponent(imported.artifact.artifactId)}?contextId=context-1&targetId=remote-1`;
		assert.equal(isArtifactLibraryUrl(schemeUrl), true);
		assert.equal(isArtifactLibraryUrl("zeta-artifact://recording.studiocast"), false);
		assert.equal(library.allowsRequest(schemeUrl, sender, sender.mainFrame, "image"), true);
		assert.equal(library.allowsRequest(schemeUrl, foreign, foreign.mainFrame, "image"), false);
		assert.equal(library.allowsRequest("zeta-artifact://recording.studiocast", sender, sender.mainFrame, "media"), false);
		const schemeResponse = await library.response(new Request(schemeUrl, { headers: { origin } }), origin);
		assert.equal(schemeResponse.status, 200);
		assert.equal(schemeResponse.headers.get("content-type"), "image/png");
		assert.equal(schemeResponse.headers.get("x-content-type-options"), "nosniff");
		assert.equal(schemeResponse.headers.get("access-control-allow-origin"), origin);
		assert.deepEqual(Buffer.from(await schemeResponse.arrayBuffer()), bytes);
		const rangeResponse = await library.response(new Request(schemeUrl, { headers: { range: "bytes=10-19" } }), "");
		assert.equal(rangeResponse.status, 206);
		assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), bytes.subarray(10, 20));
		const foreignOrigin = await library.response(new Request(schemeUrl, { headers: { origin: "http://evil.example" } }), origin);
		assert.equal(foreignOrigin.status, 403);
		const missingContext = await library.response(new Request(`zeta-artifact://library/${encodeURIComponent(imported.artifact.artifactId)}`), origin);
		assert.equal(missingContext.status, 400);
		assert.equal(targetCalls.at(-2), "remote-1");
		const localResponse = await library.response(new Request(`zeta-artifact://library/${encodeURIComponent(imported.artifact.artifactId)}?contextId=context-1`), "");
		assert.equal(localResponse.status, 200);
		assert.equal(targetCalls.at(-1), null);
		assert.deepEqual(Buffer.from(await localResponse.arrayBuffer()), bytes);
	} finally {
		library.dispose();
		assert.equal(handlers.size, 0);
		await new Promise(resolve => server.close(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});
