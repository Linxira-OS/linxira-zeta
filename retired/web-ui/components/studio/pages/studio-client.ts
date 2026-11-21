"use client";

/**
 * `PagesStudioClient` — the client the ported Studio pages render against.
 *
 * It is the foundation's `StudioClientImpl` with two changes:
 *  - queries/commands dispatch to this module's handler maps (all plain Zeta
 *    HTTP), with `cwd`/`sessionId` following the shell selection;
 *  - commands settle synchronously and expose `getState()`, so Studio's
 *    `waitReceipt()` sees the terminal receipt instead of waiting 120 s for an
 *    event the Zeta transport will never emit.
 *
 * An operation missing from a map throws `UnsupportedStudioOperationError` —
 * the ported surface then omits itself rather than showing stale data.
 */

import { useMemo } from "react";
import { StudioClientImpl, UnsupportedStudioOperationError, type StudioClientOptions } from "@/lib/studio-client";
import type { CommandInput, CommandName, CommandState, QueryInput, QueryName } from "@/lib/studio-protocol/contract";
import {
	createCommands,
	createQueries,
	createReceiptStore,
	defaultTransport,
	type PagesTransport,
} from "./client-handlers";

export class PagesStudioClient extends StudioClientImpl {
	readonly #queries;
	readonly #commands;
	readonly #receipts = createReceiptStore();
	readonly #scope: { cwd: string | null; sessionId: string | null };

	constructor(options: StudioClientOptions = {}) {
		super(options);
		this.#scope = { cwd: options.cwd ?? null, sessionId: options.sessionId ?? null };
		// The transport reads the live scope holder on every call, so a
		// workspace switch needs no new client instance.
		const scope = this.#scope;
		const transport: PagesTransport = {
			...defaultTransport,
			get cwd() {
				return scope.cwd;
			},
			get sessionId() {
				return scope.sessionId;
			},
		};
		this.#queries = createQueries(transport);
		this.#commands = createCommands(transport, this.#receipts);
	}

	override setSession(sessionId: string | null, cwd: string | null = this.#scope.cwd): void {
		super.setSession(sessionId, cwd);
		this.#scope.sessionId = sessionId;
		this.#scope.cwd = cwd;
	}

	override async query<TName extends QueryName>(name: TName, input: QueryInput<TName>) {
		const handler = this.#queries[name];
		if (!handler) throw new UnsupportedStudioOperationError("query", name);
		return (await handler(input as never)) as never;
	}

	override async command<TName extends CommandName>(name: TName, input: CommandInput<TName>) {
		const handler = this.#commands[name];
		if (!handler) throw new UnsupportedStudioOperationError("command", name);
		return (await handler(input as never)) as never;
	}

	/** `waitReceipt` polls this; every command here is already terminal. */
	getState(): { commands: Readonly<Record<string, CommandState>> } {
		return { commands: this.#receipts.snapshot() as unknown as Readonly<Record<string, CommandState>> };
	}
}

/** One client per (cwd, session) pair; the shell keeps it for the surface lifetime. */
export function usePagesStudioClient(cwd: string | null, sessionId: string | null = null): PagesStudioClient {
	return useMemo(() => new PagesStudioClient({ cwd, sessionId }), [cwd, sessionId]);
}
