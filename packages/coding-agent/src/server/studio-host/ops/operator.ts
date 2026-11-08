/**
 * Studio operations — operator command invocation and offline token counting.
 *
 * Owned operations: `operator.invoke`, `tokens.count`.
 *
 * A handler takes the contract input and returns the contract result; it
 * reaches Zeta state only through `../gateway.js` (`callGateway`, `gatewayJson`,
 * `invalid`, `unavailable`) plus the host's own runtime helpers. A name this
 * file does not export is not advertised in the capability manifest, so
 * leaving an operation out hides its surface in the Renderer — never answer
 * with made up data.
 *
 * Operation → Zeta source:
 * - `operator.invoke` → `POST /api/agent/:id {type:"prompt", message:"/<name> <args>"}`.
 *   That is the gateway's own slash-command dispatch: it runs
 *   `executeAcpBuiltinSlashCommand`, which resolves the builtin against the
 *   runtime's unified registry and streams its output through
 *   `command_output` events. This host subscribes to those events on the live
 *   session wrapper (`subscribeLiveSession`) and returns them verbatim as
 *   `output`. Only ids of the form `builtin.<name>` are accepted, and only
 *   when the registry knows the name **and** it has a text-mode handler, so a
 *   command that exists solely as a TUI surface is refused instead of being
 *   sent to the model as prose.
 * - `tokens.count` → the embedded offline tokenizers
 *   (`@linxiraos/pi-natives` `countTokens`), the same engine `zetacode toks`
 *   reports. No model request, no network.
 *
 * Both operations complete with the contract's post-command snapshot, which
 * they read through the `session.state` handler so the projection cannot drift
 * from the session family. Counting tokens therefore requires a live session;
 * with none, the receipt is `UNAVAILABLE` rather than a fabricated snapshot.
 */
import { isRecord } from "@linxiraos/pi-utils";
import { lookupBuiltinSlashCommand } from "../../../slash-commands/builtin-registry.js";
import type { OperatorInvokeOutcome } from "../contract/index.js";
import {
	ensureLiveSession,
	gatewayJson,
	invalid,
	requiredString,
	segment,
	subscribeLiveSession,
	unavailable,
} from "../gateway.js";
import type { TokenCountResult } from "../protocol/index.js";
import type { OperatorStateSnapshot } from "../protocol/contracts/state.js";
import type { StudioFamily } from "../registry.js";
import { countText } from "./text-count.js";

/** The command-id prefix the Renderer uses for OMP builtin slash commands. */
const BUILTIN_COMMAND_PREFIX = "builtin.";

/** Same character cap the transport applies to `tokens.count`. */
const TOKEN_TEXT_MAX_CHARS = 262_144;

/**
 * Post-command snapshot, projected by the `session.state` handler.
 *
 * Imported lazily: `registry.ts` merges the family list that includes this
 * file, so a static import of `session.js` would close the module cycle.
 */
async function liveSnapshot(): Promise<OperatorStateSnapshot> {
	const { sessionOps } = await import("./session.js");
	const readSnapshot = sessionOps.queries?.["session.state"] as
		| ((input: unknown, context: unknown) => Promise<OperatorStateSnapshot>)
		| undefined;
	if (readSnapshot === undefined) throw unavailable("session.state is not available");
	return await readSnapshot({}, {});
}

/**
 * Resolve an operator command id to the builtin slash-command name.
 *
 * Ids outside `builtin.*`, unknown names, and names whose registry entry has no
 * text-mode handler are client errors: the gateway would otherwise forward the
 * text to the model as a plain prompt.
 */
function builtinCommandName(commandId: string): string {
	if (!commandId.startsWith(BUILTIN_COMMAND_PREFIX)) {
		throw invalid(`commandId must name a builtin command (builtin.<name>): ${commandId}`);
	}
	const name = commandId.slice(BUILTIN_COMMAND_PREFIX.length);
	if (name === "") throw invalid("commandId must name a builtin command (builtin.<name>)");
	const spec = lookupBuiltinSlashCommand(name);
	if (spec === undefined) throw invalid(`unknown operator command: ${commandId}`);
	if (spec.handle === undefined) {
		throw invalid(`${commandId} has no text-mode handler and cannot run on the Zeta host`);
	}
	return name;
}

/**
 * `operator.invoke` arguments. The Renderer sends the raw text typed after the
 * command name; nothing else has meaning for a slash command, so a structured
 * object is refused rather than stringified into the prompt.
 */
function operatorArguments(input: unknown): string | undefined {
	if (!isRecord(input)) return undefined;
	const value = input.arguments;
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw invalid("arguments must be the command's argument text");
	return value === "" ? undefined : value;
}

/** Split one session's `command_output` events off the live event stream. */
function collectCommandOutput(): { output: string[]; onEvent: (event: unknown) => void } {
	const output: string[] = [];
	return {
		output,
		onEvent: event => {
			if (!isRecord(event) || event.type !== "command_output") return;
			const text = event.text;
			if (typeof text === "string" && text !== "") output.push(text);
		},
	};
}

/**
 * `operator.invoke` → `POST /api/agent/:id {type:"prompt"}` with the slash text.
 *
 * The gateway runs the builtin inline (it does not hand `/compact` to a
 * background dispatcher on this path), so every `command_output` line is
 * emitted before the POST settles and the receipt carries the real operator
 * feedback the surfaces display.
 */
async function invokeOperator(input: {
	readonly commandId: string;
	readonly arguments?: unknown;
}): Promise<OperatorInvokeOutcome> {
	const commandId = requiredString(input, "commandId");
	const name = builtinCommandName(commandId);
	const args = operatorArguments(input);
	const spec = lookupBuiltinSlashCommand(name);
	if (args !== undefined && spec?.allowArgs !== true) {
		throw invalid(`${commandId} does not take arguments`);
	}

	// The `session.*` commands act on the session the client is driving; the
	// gateway's coordinator session is the only fallback when none was created.
	const sessionId = await currentSessionId();
	await ensureLiveSession(sessionId);

	const { output, onEvent } = collectCommandOutput();
	const detach = await subscribeLiveSession(sessionId, onEvent);
	try {
		const body = await gatewayJson<unknown>(`/api/agent/${segment(sessionId)}`, {
			method: "POST",
			body: { type: "prompt", message: args === undefined ? `/${name}` : `/${name} ${args}` },
		});
		if (!isRecord(body) || body.success !== true) {
			throw unavailable(`the agent command was not accepted: ${commandId}`);
		}
		const result = isRecord(body.data) ? body.data : (body.data ?? null);
		return { snapshot: await liveSnapshot(), output, result };
	} finally {
		detach?.();
	}
}

/**
 * The session the sessionless operations act on.
 *
 * Read from the session family so both cannot disagree about which session the
 * client is driving (`activeSessionId`, else the gateway's coordinator session).
 */
async function currentSessionId(): Promise<string> {
	const { currentSessionId: read } = await import("./session.js");
	return await read();
}

/**
 * `tokens.count` → the embedded offline tokenizers.
 *
 * The command's result shape carries the post-command snapshot, so the live
 * session is read even though counting itself never touches it.
 */
async function countTokens(input: { readonly text: string }): Promise<{
	readonly snapshot: OperatorStateSnapshot;
	readonly result: TokenCountResult;
}> {
	const raw = isRecord(input) ? input.text : undefined;
	if (typeof raw !== "string") throw invalid("text must be a string");
	if (raw.length > TOKEN_TEXT_MAX_CHARS) {
		throw invalid(`text must be at most ${TOKEN_TEXT_MAX_CHARS} characters`);
	}
	return { snapshot: await liveSnapshot(), result: countText(raw) };
}

/** Operator family: builtin command invocation and the offline token counter. */
export const operatorOps: StudioFamily = {
	id: "operator",
	commands: {
		"operator.invoke": invokeOperator,
		"tokens.count": countTokens,
	},
};
