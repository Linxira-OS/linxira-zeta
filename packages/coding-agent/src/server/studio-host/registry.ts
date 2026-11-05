/**
 * Studio host operation registry.
 *
 * The Renderer speaks the Studio semantic contract (`@linxiraos/studio-contract`);
 * this process answers it. A family file under `ops/` owns one operation domain
 * and exports plain handler maps; {@link StudioOperations} merges them, decides
 * what the capability manifest advertises, and shapes the envelopes.
 *
 * Invariants:
 * - A name that has no handler is NOT advertised in the capability manifest, so
 *   the Renderer never navigates to a surface this host cannot serve.
 * - An unregistered name is answered with `ok: false` / `code: "unsupported"`
 *   (`"unsupported"` is deliberately outside the contract's `ClientErrorCode`
 *   union: it is this host's own "not implemented" code, and the transport only
 *   requires a string code plus a message).
 * - Handlers see the caller's origin but never its cookies, CSRF token or any
 *   other secret; they reach Zeta state only through `gateway.ts`.
 */
import { createHash } from "node:crypto";
import type {
	ClientCommandAccepted,
	ClientCommandRequest,
	ClientError,
	ClientQueryRequest,
	ClientQueryResponse,
	CommandInput,
	CommandName,
	CommandResult,
	QueryInput,
	QueryName,
	QueryResult,
} from "./contract/index.js";
import type { CapabilityManifest } from "./protocol/index.js";
import { canonicalJson } from "./protocol/canonical-json.js";
import { StudioOpError } from "./gateway.js";

export { StudioOpError };
import { STUDIO_FAMILIES } from "./ops/index.js";

/** Request-scoped facts a handler may use. Never carries credentials. */
export interface StudioHostContext {
	/** `Origin` header of the calling page, already validated against the allowlist. */
	readonly origin?: string;
	/**
	 * The capability manifest this host advertises, so `capabilities.get` can
	 * answer without the family importing the registry (which imports it).
	 */
	readonly capabilities: CapabilityManifest;
}

export type StudioQueryHandler<K extends QueryName> = (
	input: QueryInput<K>,
	context: StudioHostContext,
) => Promise<QueryResult<K>>;

export type StudioCommandHandler<K extends CommandName> = (
	input: CommandInput<K>,
	context: StudioHostContext,
) => Promise<CommandResult<K> | undefined>;

export type StudioQueryHandlers = { [K in QueryName]: StudioQueryHandler<K> };
export type StudioCommandHandlers = { [K in CommandName]: StudioCommandHandler<K> };

/** One operation domain (`ops/session.ts`, `ops/git.ts`, …). */
export interface StudioFamily {
	/** Manifest id prefix this family answers (`session`, `git`, …). */
	readonly id: string;
	readonly queries?: Partial<StudioQueryHandlers>;
	readonly commands?: Partial<StudioCommandHandlers>;
}

/** The host's own "this operation does not exist here" code. */
export const UNSUPPORTED = "unsupported" as const;

function unsupportedError(name: string): ClientError {
	return {
		code: UNSUPPORTED as ClientError["code"],
		message: `Operation ${name} is not supported by the Zeta host`,
	};
}

/** The capability manifest advertised to the Renderer, built from the handlers. */
export interface StudioCapabilities {
	readonly manifest: CapabilityManifest;
	readonly queries: readonly QueryName[];
	readonly commands: readonly CommandName[];
}

/**
 * Merged operation set. Construction is cheap and side-effect free; the
 * manifest is built once on first read because it hashes the whole id list.
 */
export class StudioOperations {
	readonly #queries: Partial<StudioQueryHandlers>;
	readonly #commands: Partial<StudioCommandHandlers>;
	#capabilitySet: StudioCapabilities | undefined;

	constructor(families: readonly StudioFamily[] = STUDIO_FAMILIES) {
		const queries: Partial<StudioQueryHandlers> = {};
		const commands: Partial<StudioCommandHandlers> = {};
		for (const family of families) {
			Object.assign(queries, family.queries ?? {});
			Object.assign(commands, family.commands ?? {});
		}
		this.#queries = queries;
		this.#commands = commands;
	}

	get queries(): readonly QueryName[] {
		return this.#capability().queries;
	}

	get commands(): readonly CommandName[] {
		return this.#capability().commands;
	}

	capabilities(): StudioCapabilities {
		return this.#capability();
	}

	#capability(): StudioCapabilities {
		if (this.#capabilitySet) return this.#capabilitySet;
		const queries = Object.keys(this.#queries).sort() as QueryName[];
		const commands = Object.keys(this.#commands).sort() as CommandName[];
		const ids = [...queries, ...commands];
		this.#capabilitySet = {
			queries,
			commands,
			manifest: {
				profile: "limited",
				// Stamped once per process: the hash covers only the advertised ids,
				// so the timestamp can be honest without making the manifest unstable.
				generatedAt: new Date().toISOString(),
				hash: createHash("sha256").update(canonicalJson(ids)).digest("hex"),
				capabilities: ids.map(id => ({
					id,
					grade: "stable",
					version: 1,
					evidence: "zeta-gateway",
				})),
			},
		};
		return this.#capabilitySet;
	}

	/** Answer one semantic query; unknown names (and thrown failures) become envelopes. */
	async query<TName extends QueryName>(
		request: ClientQueryRequest<TName>,
		context: StudioHostContext,
	): Promise<ClientQueryResponse<TName>> {
		const name = request.queryName;
		const handler = this.#queries[name] as StudioQueryHandler<TName> | undefined;
		if (!handler) {
			return { ok: false, queryName: name, error: unsupportedError(name) };
		}
		try {
			const result = await handler(request.input, context);
			return { ok: true, queryName: name, result };
		} catch (error) {
			return { ok: false, queryName: name, error: toClientError(error) };
		}
	}

	/**
	 * Run one semantic command.
	 *
	 * Zeta performs the work in-process, so the handler's outcome is known
	 * before the acknowledgement is written: the caller acks and then delivers
	 * `result` as a `command.receipt`. An unknown name throws
	 * {@link StudioOpError} (`unsupported`) so the HTTP layer answers 400 with
	 * the same error envelope it uses for queries.
	 */
	async command<TName extends CommandName>(
		request: ClientCommandRequest<TName>,
		context: StudioHostContext,
	): Promise<{ accepted: ClientCommandAccepted<TName>; result: CommandResult<TName> | undefined }> {
		const name = request.commandName;
		const handler = this.#commands[name] as StudioCommandHandler<TName> | undefined;
		if (!handler) {
			throw new StudioOpError(UNSUPPORTED, `Operation ${name} is not supported by the Zeta host`);
		}
		const result = await handler(request.input, context);
		return {
			accepted: {
				commandName: name,
				requestId: request.requestId,
				status: "accepted",
				acceptedAt: new Date().toISOString(),
			},
			result,
		};
	}
}

/** Map any thrown value to the contract's error shape. */
export function toClientError(error: unknown): ClientError {
	if (error instanceof StudioOpError) {
		return { code: error.code as ClientError["code"], message: error.message };
	}
	return {
		code: "INTERNAL_ERROR",
		message: error instanceof Error ? error.message : String(error),
	};
}
