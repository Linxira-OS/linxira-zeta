/**
 * In-process semantic transport for tests and P0 fixtures (P0 transports are
 * in-process by design). Implements the exact ClientTransport contract:
 * deterministic bootstrap/query/command handlers, `emit(event)` for tests,
 * closed-state enforcement and exact subscription scope filtering.
 *
 * Copy policy (ported from upstream PR #20, `host-client-api/src/facade.ts`):
 * the stream path is zero-copy, the read path copies once.
 *
 * - {@link MemoryClientTransport.emit} hands the published event object to
 *   every matching subscriber. It used to deep-clone each event first, which
 *   meant a JSON round trip of the whole operator snapshot on every streamed
 *   frame (`agents`, `jobs`, telemetry). The replacement invariant is the one
 *   the upstream facade states for its committed publication: an emitted event
 *   and everything it reaches through `event.snapshot` are read-only once
 *   published. The reducer stores that object by reference and never mutates
 *   it; renderers select from it. The publisher (host, fixture, test) must not
 *   mutate an event after emitting it — build a new event instead.
 * - `bootstrap()` and `query()` results are external boundaries and still
 *   deep-clone exactly once, because those values leave the transport to a
 *   caller that may legitimately keep or mutate its own copy.
 */

import type {
  ClientBootstrap,
  ClientCommandAccepted,
  ClientCommandRequest,
  ClientError,
  ClientEvent,
  ClientQueryRequest,
  ClientQueryResponse,
  ClientTransport,
  CommandName,
  QueryName,
  SubscriptionScope,
  Unsubscribe,
} from "@linxiraos/studio-contract";

import { toClientError } from "./errors.js";
import { eventMatchesScope } from "./scope.js";

export interface MemoryTransportHandlers {
  bootstrap?(): ClientBootstrap | Promise<ClientBootstrap>;
  query?<TName extends QueryName>(
    request: ClientQueryRequest<TName>,
  ): ClientQueryResponse<TName> | Promise<ClientQueryResponse<TName>>;
  command?<TName extends CommandName>(
    request: ClientCommandRequest<TName>,
  ): ClientCommandAccepted<TName> | Promise<ClientCommandAccepted<TName>>;
}

interface Subscriber {
  readonly scope: SubscriptionScope;
  readonly listener: (event: ClientEvent) => void;
}

/** The single copy of a read-model result (external boundary); see the file header. */
function cloneReadModel<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function unavailable(label: string): ClientError {
  return { code: "UNAVAILABLE", message: `no handler registered for ${label}` };
}

export class MemoryClientTransport implements ClientTransport {
  private readonly handlers: MemoryTransportHandlers;
  private closed = false;
  private readonly subscribers: Subscriber[] = [];

  constructor(handlers: MemoryTransportHandlers = {}) {
    this.handlers = handlers;
  }

  async bootstrap(): Promise<ClientBootstrap> {
    this.assertOpen();
    return cloneReadModel(await this.invoke(() => this.handlers.bootstrap?.(), "bootstrap"));
  }

  async query<TName extends QueryName>(request: ClientQueryRequest<TName>): Promise<ClientQueryResponse<TName>> {
    this.assertOpen();
    return cloneReadModel(await this.invoke(() => this.handlers.query?.(request), `query ${request.queryName}`));
  }

  async command<TName extends CommandName>(
    request: ClientCommandRequest<TName>,
  ): Promise<ClientCommandAccepted<TName>> {
    this.assertOpen();
    return cloneReadModel(await this.invoke(() => this.handlers.command?.(request), `command ${request.commandName}`));
  }

  subscribe(scope: SubscriptionScope, listener: (event: ClientEvent) => void): Unsubscribe {
    if (this.closed) {
      return () => {};
    }
    const subscriber: Subscriber = { scope, listener };
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * Deliver a host-side event to matching subscribers (tests only).
   *
   * Zero-copy: the published event object goes to every matching subscriber,
   * so the reducer can retain `event.snapshot` without a copy. See the file
   * header for the read-only invariant this requires of the publisher.
   */
  emit(event: ClientEvent): void {
    if (this.closed) {
      return;
    }
    for (const { scope, listener } of this.subscribers) {
      if (eventMatchesScope(event, scope)) {
        listener(event);
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.subscribers.length = 0;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw { code: "TRANSPORT_ERROR", message: "transport is closed" } as ClientError;
    }
  }

  private async invoke<T>(handler: () => T | undefined, label: string): Promise<T> {
    let result: T | undefined;
    try {
      result = handler();
    } catch (error) {
      throw toClientError(error);
    }
    if (result === undefined) {
      throw unavailable(label);
    }
    try {
      return await result;
    } catch (error) {
      throw toClientError(error);
    }
  }
}
