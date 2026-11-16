import type {
	BrowserObservationOperation,
	BrowserObservationResultMap,
} from "../protocol/contracts/browser-observation.js";
import type { StudioFamily, StudioHostContext } from "../registry.js";
import { browserRuntime, managedBrowserRuntime } from "../services/browser-runtime.js";
import { snapshotFor } from "./session.js";
import { invalid } from "../errors.js";
import { requiredString } from "../gateway.js";

function observationInput(kind: BrowserObservationOperation["kind"], input: unknown): void {
	const sessionId = requiredString(input, "sessionId");
	if (sessionId.length > 512 || sessionId.includes("\0")) throw invalid("Invalid browser session identity");
	if (kind === "browser.observe.prepare" && !/^[a-f0-9-]{36}$/u.test(requiredString(input, "tabId")))
		throw invalid("Invalid browser tab identity");
}

function webMcpInput(input: unknown, invoke: boolean): void {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("WebMCP input must be an object");
	const row = input as Record<string, unknown>;
	const keys = invoke
		? ["sessionId", "pageId", "documentId", "name", "params", "options"]
		: ["sessionId", "pageId", "options"];
	if (Object.keys(row).some(key => !keys.includes(key))) throw invalid("Unknown WebMCP input field");
	for (const key of invoke ? ["sessionId", "pageId", "documentId", "name"] : ["sessionId", "pageId"])
		if (typeof row[key] !== "string" || !row[key] || row[key].length > 512 || row[key].includes("\0"))
			throw invalid(`Invalid WebMCP ${key}`);
	if (invoke && (!row.params || typeof row.params !== "object" || Array.isArray(row.params)))
		throw invalid("WebMCP params must be an object");
	if (row.options !== undefined) {
		if (!row.options || typeof row.options !== "object" || Array.isArray(row.options))
			throw invalid("Invalid WebMCP options");
		const options = row.options as Record<string, unknown>;
		if (Object.keys(options).some(key => !(invoke ? ["frame", "timeout"] : ["frame", "name"]).includes(key)))
			throw invalid("Unknown WebMCP option");
		for (const key of ["frame", "name"])
			if (
				options[key] !== undefined &&
				(typeof options[key] !== "string" ||
					!options[key] ||
					options[key].length > 512 ||
					options[key].includes("\0"))
			)
				throw invalid(`Invalid WebMCP ${key}`);
		if (
			options.timeout !== undefined &&
			(typeof options.timeout !== "number" ||
				!Number.isSafeInteger(options.timeout) ||
				options.timeout < 1 ||
				options.timeout > 60_000)
		)
			throw invalid("WebMCP timeout must be 1–60000 ms");
	}
}

async function execute<K extends Exclude<BrowserObservationOperation["kind"], "browser.managed.prepare">>(
	kind: K,
	input: Omit<Extract<BrowserObservationOperation, { kind: K }>, "kind">,
	context: StudioHostContext,
) {
	const operation = { ...input, kind } as BrowserObservationOperation;
	observationInput(kind, input);
	const runtime = await browserRuntime(input, context);
	const result = (await runtime.execute(
		operation as Exclude<BrowserObservationOperation, { kind: "browser.managed.prepare" }>,
	)) as BrowserObservationResultMap[K];
	return { snapshot: await snapshotFor(runtime.session.sessionId), result };
}

export const browserOps: StudioFamily = {
	id: "browser",
	queries: {
		"browser.webmcp.list": async (input, context) => {
			webMcpInput(input, false);
			return (await managedBrowserRuntime(input, context, false)).webMcpList(
				input.sessionId,
				input.pageId,
				input.options,
			);
		},
	},
	commands: {
		"browser.tabs.get": (input, context) => execute("browser.tabs.get", input, context),
		"browser.observe.prepare": (input, context) => execute("browser.observe.prepare", input, context),
		"browser.managed.prepare": async (input, context) => {
			observationInput("browser.managed.prepare", input);
			const runtime = await managedBrowserRuntime(input, context);
			return {
				snapshot: await snapshotFor(runtime.session.sessionId),
				result: await runtime.prepare(input.sessionId),
			};
		},
		"browser.webmcp.invoke": async (input, context) => {
			webMcpInput(input, true);
			const runtime = await managedBrowserRuntime(input, context, false);
			return {
				snapshot: await snapshotFor(runtime.session.sessionId),
				result: await runtime.webMcpInvoke({ ...input, kind: "browser.webmcp.invoke" }),
			};
		},
	},
};
