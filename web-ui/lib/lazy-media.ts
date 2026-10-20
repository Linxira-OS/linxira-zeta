/**
 * Lazy media fetch-back for the web UI.
 *
 * History loads send `?deferMedia`, so the gateway replaces large inline
 * tool-result images with `GET /api/blobs/<sha256>` URLs. The phone must then
 * fetch those bytes itself — and it cannot simply use `<img src>`: on a remote
 * (non-loopback) origin the gateway requires `X-Zeta-Token`, which the web UI
 * attaches to `fetch` (see `lib/remote-token.ts`) but browsers never attach to
 * element-initiated requests. So images are fetched through `fetch`, turned
 * into an object URL, and only the small object URL reaches the `<img>`.
 *
 * The cache dedupes concurrent loads per path, caps the number of live object
 * URLs (a long scroll through a screenshot-heavy session must not pin hundreds
 * of decoded images), and revokes evicted URLs.
 */

export const BLOB_PATH_RE = /^\/api\/blobs\/[^/?#]+$/;

export function isDeferredMediaUrl(src: string): boolean {
  return BLOB_PATH_RE.test(src);
}

/** Minimal fetch shape: the cache never uses `fetch.preconnect`. */
export type BlobFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BlobMediaCacheOptions {
  fetchImpl?: BlobFetch;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  /** Maximum live object URLs (default 24). */
  maxEntries?: number;
}

interface CacheEntry {
  promise: Promise<string>;
  /** Set once the bytes decoded and the object URL exists. */
  objectUrl?: string;
}

export class BlobMediaCache {
  readonly #fetch: BlobFetch;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #revokeObjectUrl: (url: string) => void;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CacheEntry>();

  constructor(options: BlobMediaCacheOptions = {}) {
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#createObjectUrl =
      options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.#revokeObjectUrl =
      options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.#maxEntries = Math.max(1, options.maxEntries ?? 24);
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Object URL for one blob path; repeated/concurrent calls share one fetch. */
  load(path: string): Promise<string> {
    const existing = this.#entries.get(path);
    if (existing) {
      // Refresh insertion order — this is the LRU recency signal.
      this.#entries.delete(path);
      this.#entries.set(path, existing);
      return existing.promise;
    }
    // A failed entry must not poison later retries (a 401 while the token was
    // missing, or a phone that was briefly offline): the whole chain — network
    // error *and* non-2xx — drops the map entry before rethrowing.
    const holder: { entry: CacheEntry | null } = { entry: null };
    const promise = (async () => {
      try {
        const response = await this.#fetch(path, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`Blob fetch failed: HTTP ${response.status}`);
        const objectUrl = this.#createObjectUrl(await response.blob());
        if (holder.entry) holder.entry.objectUrl = objectUrl;
        return objectUrl;
      } catch (error) {
        if (holder.entry && this.#entries.get(path) === holder.entry) this.#entries.delete(path);
        throw error;
      }
    })();
    const entry: CacheEntry = { promise };
    holder.entry = entry;
    this.#entries.set(path, entry);
    this.#evict();
    return entry.promise;
  }

  /** Drop every cached object URL (config/token change, logout, teardown). */
  clear(): void {
    for (const entry of this.#entries.values()) {
      if (entry.objectUrl) this.#revokeObjectUrl(entry.objectUrl);
    }
    this.#entries.clear();
  }

  #evict(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.entries().next();
      if (oldest.done) return;
      const [path, entry] = oldest.value;
      // Skip in-flight loads; they are bounded by concurrent viewports.
      if (entry.objectUrl === undefined) {
        if (this.#entries.size <= this.#maxEntries + 8) return;
        this.#entries.delete(path);
        continue;
      }
      this.#revokeObjectUrl(entry.objectUrl);
      this.#entries.delete(path);
    }
  }
}

/** Process-wide cache shared by every image in the conversation. */
export const blobMediaCache = new BlobMediaCache();
