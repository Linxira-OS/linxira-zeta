import type { ClientBootstrap, ClientCommandAccepted, ClientCommandRequest, ClientEvent, ClientQueryRequest, ClientQueryResponse, ClientTransport, CommandName, QueryName, SubscriptionScope, Unsubscribe } from '@linxiraos/studio-contract';

export interface WebSocketLike { send(data: string): void; close(): void; onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: () => void; }

/**
 * The fetch shape this transport needs. `typeof fetch` includes `preconnect`
 * and other runtime extras, which a wrapper cannot honestly provide.
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BrowserWebClientOptions { baseUrl: string; fetcher?: FetchLike; webSocketFactory?: (url: string) => WebSocketLike; }

/**
 * A non-2xx answer from the Studio host.
 *
 * The status alone is not enough to act on: `403` may mean a CSRF refusal, a
 * scope refusal, or a `totp_required` challenge that the caller should answer.
 * `code` carries the host's own error word so a transport consumer can branch
 * without re-parsing a response that was already consumed.
 */
export class StudioHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined) {
    super(`http_${status}`);
    this.name = 'StudioHttpError';
    this.status = status;
    this.code = code;
  }
}

/** Read the host's `{error}` word without failing on an empty/non-JSON body. */
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.clone().json();
    if (body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  } catch {
    // Non-JSON body: the status is the only signal.
  }
  return undefined;
}

/** Browser-side ClientTransport over the HTTP/WebSocket adapter. */
export class BrowserWebClientTransport implements ClientTransport {
  readonly #base: string; readonly #fetch: FetchLike; readonly #wsFactory?: (url: string) => WebSocketLike; #csrf?: string; #closed=false; readonly #sockets = new Set<WebSocketLike>();
  constructor(options: BrowserWebClientOptions) { this.#base = options.baseUrl.replace(/\/$/, ''); this.#fetch = options.fetcher ?? globalThis.fetch.bind(globalThis); if (options.webSocketFactory) this.#wsFactory = options.webSocketFactory; }
  async pair(code: string): Promise<void> {
    const r = await this.#fetch(this.#base+'/api/v1/pair',{method:'POST',credentials:'include',headers:{'content-type':'application/json','Origin': this.#base},body:JSON.stringify({code})});
    if(!r.ok) throw new StudioHttpError(r.status, await errorCode(r));
    const b=await r.json() as {csrf?:string};
    if(typeof b.csrf!=='string') throw new StudioHttpError(500, 'pair_failed');
    this.#csrf=b.csrf;
  }
  async bootstrap(): Promise<ClientBootstrap> {
    const r = await this.#fetch(this.#base+'/api/v1/bootstrap',{method:'GET',credentials:'include'});
    if(!r.ok) throw new StudioHttpError(r.status, await errorCode(r));
    const csrf = r.headers.get('x-studio-csrf');
    if(csrf) this.#csrf = csrf;
    return r.json() as Promise<ClientBootstrap>;
  }
  async query<T extends QueryName>(request: ClientQueryRequest<T>): Promise<ClientQueryResponse<T>> { return this.req('/api/v1/query','POST',request) as Promise<ClientQueryResponse<T>>; }
  async command<T extends CommandName>(request: ClientCommandRequest<T>): Promise<ClientCommandAccepted<T>> { return this.req('/api/v1/command','POST',request) as Promise<ClientCommandAccepted<T>>; }
  subscribe(scope: SubscriptionScope, listener: (event: ClientEvent)=>void): Unsubscribe { if(this.#closed) throw new Error('transport_closed'); if(!this.#wsFactory) throw new Error('websocket_unavailable'); const ws=this.#wsFactory(this.#base.replace(/^http/,'ws')+'/api/v1/events'); this.#sockets.add(ws); ws.onopen=()=>ws.send(JSON.stringify({scope})); ws.onmessage=(e)=>{ try { listener(JSON.parse(e.data)); } catch {} }; ws.onclose=()=>this.#sockets.delete(ws); return ()=>{ this.#sockets.delete(ws); ws.close(); }; }
  async close(): Promise<void> { if(this.#closed)return; this.#closed=true; for(const ws of this.#sockets) ws.close(); this.#sockets.clear(); }
  private async req(path:string, method:string, body?:unknown): Promise<unknown> {
    if(this.#closed) throw new Error('transport_closed');
    const headers: Record<string,string> = {};
    const init: RequestInit = {method,credentials:'include',headers};
    if(body!==undefined){ headers['content-type']='application/json'; headers['X-Studio-CSRF']=this.#csrf ?? ''; init.body=JSON.stringify(body); }
    const r=await this.#fetch(this.#base+path,init);
    if(!r.ok) throw new StudioHttpError(r.status, await errorCode(r));
    return r.json();
  }
}
