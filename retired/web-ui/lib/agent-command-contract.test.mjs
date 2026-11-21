// Field-contract test: every `sendAgentCommand` body web-ui emits must match the
// gateway's `AgentCommand` union (`packages/coding-agent/src/server/web-gateway/agents.ts`).
//
// Why this exists: `sendAgentCommand` takes `Record<string, unknown>`, so a
// mistyped field is invisible to tsc and to the sender. This bit us twice —
// `navigate_tree` was sent as `{ targetId }` while the gateway parses
// `{ entryId }`, and `steer`/`follow_up` were sent as `{ message }` while the
// gateway parses `{ text }`. Both silently no-oped (the gateway read `undefined`)
// behind a `.catch(() => {})`. This test derives the field names from the real
// parser and asserts the senders agree, so that class of drift fails CI instead
// of a user's session.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GATEWAY_URL = new URL(
	"../../packages/coding-agent/src/server/web-gateway/agents.ts",
	import.meta.url,
);

// Every web-ui module that POSTs to `/api/agent/:id`.
const SENDER_URLS = [
	"../hooks/useAgentSession.ts",
	"../components/ChatWindow.tsx",
	"../components/PluginsConfig.tsx",
	"../components/PluginsManager.tsx",
].map(rel => new URL(rel, import.meta.url));

/** Outermost balanced `{...}` blocks in `text` (nested blocks are not returned separately). */
function braceBlocks(text, from = 0) {
	const blocks = [];
	for (let i = from; i < text.length; i++) {
		if (text[i] !== "{") continue;
		const start = i;
		let depth = 0;
		let j = i;
		for (; j < text.length; j++) {
			const c = text[j];
			if (c === '"' || c === "'" || c === "`") {
				j = skipString(text, j) - 1;
				continue;
			}
			if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) break;
			}
		}
		blocks.push({ start, end: j, text: text.slice(start, j + 1) });
		i = j;
	}
	return blocks;
}

/** Index just past the closing quote of the string literal opening at `start`. */
function skipString(text, start) {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		if (text[i] === "\\") {
			i++;
			continue;
		}
		if (text[i] === quote) return i + 1;
	}
	return text.length;
}

/** Index just past the value that begins at `start` (inside a depth-1 object body). */
function skipValue(text, start) {
	let rel = 0;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (c === '"' || c === "'" || c === "`") {
			i = skipString(text, i) - 1;
			continue;
		}
		if (c === "{" || c === "[" || c === "(") {
			rel++;
			continue;
		}
		if (c === "}" || c === "]" || c === ")") {
			if (rel === 0) return i;
			rel--;
			continue;
		}
		if (c === "," && rel === 0) return i;
	}
	return text.length;
}

/**
 * Top-level keys of an object literal `text` (including braces), plus any keys
 * carried by `...` spreads whose target is an inline object literal. Spreads
 * over a bare identifier (e.g. `...response`) are reported as opaque: their keys
 * cannot be seen from the source, so the caller must not demand them.
 */
function literalKeys(text) {
	const keys = new Set();
	let opaqueSpread = false;
	let i = 1; // past the opening brace
	const end = text.length - 1;
	while (i < end) {
		const c = text[i];
		if (c === "{") {
			i = braceBlocks(text, i)[0].end + 1;
			continue;
		}
		if (c === "}") {
			i++;
			continue;
		}
		if (c === "," || /\s/.test(c)) {
			i++;
			continue;
		}
		if (c === "." && text[i + 1] === "." && text[i + 2] === ".") {
			const spread = skipSpread(text, i + 3);
			for (const key of spread.keys) keys.add(key);
			opaqueSpread ||= spread.opaque;
			i = spread.end;
			continue;
		}
		const property = /^([A-Za-z_$][\w$]*)\s*:/.exec(text.slice(i));
		if (property) {
			keys.add(property[1]);
			const valueEnd = skipValue(text, i + property[0].length);
			i = text[valueEnd] === "," ? valueEnd + 1 : valueEnd;
			continue;
		}
		const shorthand = /^([A-Za-z_$][\w$]*)\s*[,}]/.exec(text.slice(i));
		if (shorthand) {
			keys.add(shorthand[1]);
			i += shorthand[0].length - 1;
			continue;
		}
		i++;
	}
	return { keys, opaqueSpread };
}

/** Keys contributed by a `...` spread that begins at `start`, plus where it ends. */
function skipSpread(text, start) {
	let i = start;
	while (i < text.length && /\s/.test(text[i])) i++;
	if (text[i] === "(") {
		// `...(cond ? { a } : { b })` — collect keys from every literal inside.
		let depth = 0;
		let j = i;
		for (; j < text.length; j++) {
			if (text[j] === "(") depth++;
			else if (text[j] === ")") {
				depth--;
				if (depth === 0) break;
			} else if (text[j] === '"' || text[j] === "'" || text[j] === "`") {
				j = skipString(text, j) - 1;
			}
		}
		const keys = new Set();
		for (const block of braceBlocks(text.slice(i, j + 1))) {
			for (const key of literalKeys(block.text).keys) keys.add(key);
		}
		return { keys, opaque: false, end: j + 1 };
	}
	if (text[i] === "{") {
		const block = braceBlocks(text, i)[0];
		return { keys: literalKeys(block.text).keys, opaque: false, end: block.end + 1 };
	}
	const identifier = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
	return { keys: new Set(), opaque: true, end: i + (identifier ? identifier[0].length : 0) };
}

/** Parse the gateway `AgentCommand` union into `type -> { required, declared }`. */
function parseGatewayCommands(source) {
	const start = source.indexOf("export type AgentCommand =");
	assert.notEqual(start, -1, "gateway AgentCommand union not found");
	const end = source.indexOf("\n\nexport type", start);
	assert.notEqual(end, -1, "gateway AgentCommand union terminator not found");
	const commands = new Map();
	for (const member of braceBlocks(source.slice(start, end))) {
		const type = /type:\s*"([^"]+)"/.exec(member.text);
		assert.ok(type, `union member without a type literal: ${member.text.slice(0, 60)}…`);
		const required = new Set();
		const declared = new Set();
		for (const match of member.text.matchAll(/([A-Za-z_$][\w$]*)\s*(\?)?\s*:/g)) {
			declared.add(match[1]);
			if (!match[2]) required.add(match[1]);
		}
		commands.set(type[1], { required, declared });
	}
	return commands;
}

/** Every `sendAgentCommand(...)` object-literal body in a sender source. */
function parseSendSites(source) {
	const sites = [];
	const call = /sendAgentCommand/g;
	for (let match; (match = call.exec(source)); ) {
		let i = match.index + match[0].length;
		if (source[i] === "<") {
			// Skip the generic argument list (it may itself contain `{ ... }`).
			let depth = 0;
			for (; i < source.length; i++) {
				if (source[i] === "<") depth++;
				else if (source[i] === ">") {
					depth--;
					if (depth === 0) break;
				}
			}
			i++;
		}
		if (source[i] !== "(") continue; // import / definition, not a call
		const body = braceBlocks(source, i)[0];
		if (!body) continue;
		const type = /type:\s*"([^"]+)"/.exec(body.text);
		if (!type) continue;
		sites.push({ type: type[1], ...literalKeys(body.text), line: source.slice(0, match.index).split("\n").length });
	}
	return sites;
}

const gateway = parseGatewayCommands(await readFile(GATEWAY_URL, "utf8"));

test("gateway union declares the fields this contract guards", () => {
	// Anchor the parser itself: these are the exact mismatches this test exists
	// to catch, so a parser regression that silently reads zero fields fails here.
	assert.ok(gateway.has("navigate_tree"), "gateway must declare navigate_tree");
	assert.deepEqual([...gateway.get("navigate_tree").declared].sort(), ["entryId", "type"]);
	assert.deepEqual([...gateway.get("steer").declared].sort(), ["images", "text", "type"]);
	assert.deepEqual([...gateway.get("follow_up").declared].sort(), ["images", "text", "type"]);
});

for (const url of SENDER_URLS) {
	const name = url.pathname.split("/").pop();
	const sites = parseSendSites(await readFile(url, "utf8"));

	test(`${name}: every sendAgentCommand body matches the gateway AgentCommand union`, () => {
		assert.ok(sites.length > 0, `no sendAgentCommand call sites found in ${name}`);
		for (const site of sites) {
			const command = gateway.get(site.type);
			assert.ok(command, `${name}:${site.line} sends unknown command type "${site.type}"`);
			for (const field of command.required) {
				assert.ok(
					site.keys.has(field),
					`${name}:${site.line} "${site.type}" omits required field "${field}" (gateway parses ${[...command.declared].sort().join(", ")})`,
				);
			}
			for (const field of site.keys) {
				assert.ok(
					command.declared.has(field),
					`${name}:${site.line} "${site.type}" sends field "${field}" the gateway does not parse (gateway parses ${[...command.declared].sort().join(", ")})`,
				);
			}
			assert.ok(
				!site.opaqueSpread || command.declared.size >= site.keys.size,
				`${name}:${site.line} "${site.type}" spread is opaque`,
			);
		}
	});
}
