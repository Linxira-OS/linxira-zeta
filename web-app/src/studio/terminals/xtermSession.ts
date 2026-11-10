/**
 * One xterm.js terminal owned outside React's render path.
 *
 * React only mounts a container for the lifetime of a session; this class owns
 * the `Terminal`, the renderer addon and the write batching. Rendering a PTY
 * stream through component state would put megabytes of ANSI through the React
 * reconciler, so data never crosses a render.
 *
 * Design rules that matter for compatibility and performance:
 *
 * - `convertEol: false`: a raw grid. Full-screen programs (vim, less, htop,
 *   agent TUIs) position with `\r\n`/CUP; converting `\n` shifts every later
 *   line right — that "first line ok, rest indented" class is a grid/padding
 *   bug, not a GPU bug. No gutter, no block indentation, no per-line wrapper
 *   exists here.
 * - Writes are batched (join + one `term.write`) on an 8 ms cadence for the
 *   active pane and a 120 ms cadence for background panes. A hidden pane keeps
 *   parsing at a lower rate instead of starving or burning a frame budget.
 * - WebGL is opt-in with an explicit DOM fallback; a lost context disposes the
 *   addon (xterm returns to its DOM renderer) and may retry a bounded number of
 *   times.
 */

import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";

export type TerminalRenderer = "webgl" | "dom";

export interface XtermSessionOptions {
	container: HTMLElement;
	scrollback?: number;
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
	theme?: ITheme;
	renderer?: TerminalRenderer;
	active?: boolean;
	onInput?: (data: string) => void;
	onResize?: (cols: number, rows: number) => void;
	onRendererChange?: (renderer: TerminalRenderer, reason: "initial" | "context-loss" | "fallback") => void;
	onTitleChange?: (title: string) => void;
}

/** Active panes flush fast; hidden panes still parse, just less often. */
const ACTIVE_FLUSH_MS = 8;
const BACKGROUND_FLUSH_MS = 120;
/** Flush immediately when a single burst passes this, so RAM cannot balloon. */
const ACTIVE_IMMEDIATE_CHARS = 512 * 1024;
const BACKGROUND_IMMEDIATE_CHARS = 1024 * 1024;
const MAX_WEBGL_RETRIES = 2;

export class XtermSession {
	readonly term: Terminal;
	readonly fit: FitAddon;
	readonly container: HTMLElement;

	#webgl: WebglAddon | null = null;
	#renderer: TerminalRenderer = "dom";
	#active: boolean;
	#queue: string[] = [];
	#queuedChars = 0;
	#peakQueuedChars = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#pendingWrites = 0;
	readonly #idleWaiters: Array<() => void> = [];
	#webglRetries = 0;
	#disposed = false;
	#bytesWritten = 0;
	#lastWriteAt = 0;
	readonly #onRendererChange: XtermSessionOptions["onRendererChange"];

	constructor(options: XtermSessionOptions) {
		this.#onRendererChange = options.onRendererChange;
		this.#active = options.active ?? true;
		this.container = options.container;

		this.term = new Terminal({
			convertEol: false,
			cursorBlink: true,
			allowProposedApi: false,
			fontFamily: options.fontFamily ?? "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
			fontSize: options.fontSize ?? 12,
			lineHeight: options.lineHeight ?? 1.25,
			letterSpacing: 0,
			scrollback: options.scrollback ?? 10_000,
			...(options.theme ? { theme: options.theme } : {}),
			// Terminal input must not be translated by the app: the PTY owns it.
			macOptionIsMeta: true,
		});
		this.fit = new FitAddon();
		this.term.loadAddon(this.fit);
		this.term.open(options.container);
		this.term.onData(data => options.onInput?.(data));
		this.term.onResize(size => options.onResize?.(size.cols, size.rows));
		this.term.onTitleChange(title => options.onTitleChange?.(title));

		if ((options.renderer ?? "webgl") === "webgl") this.#loadWebgl();
		else this.#reportRenderer("initial");
	}

	get renderer(): TerminalRenderer {
		return this.#renderer;
	}

	get bytesWritten(): number {
		return this.#bytesWritten;
	}

	get queuedChars(): number {
		return this.#queuedChars;
	}

	get peakQueuedChars(): number {
		return this.#peakQueuedChars;
	}

	get active(): boolean {
		return this.#active;
	}

	/** `performance.now()` of the most recent flush; diagnostics only. */
	get lastWriteAt(): number {
		return this.#lastWriteAt;
	}

	#reportRenderer(reason: "initial" | "context-loss" | "fallback"): void {
		this.#onRendererChange?.(this.#renderer, reason);
	}

	#loadWebgl(): void {
		if (this.#disposed) return;
		let addon: WebglAddon | null = null;
		try {
			addon = new WebglAddon();
			addon.onContextLoss(() => {
				if (this.#webgl !== addon) return;
				try {
					addon?.dispose();
				} catch {
					// Already torn down.
				}
				this.#webgl = null;
				this.#renderer = "dom";
				this.#reportRenderer("context-loss");
				this.#scheduleWebglRetry();
			});
			this.term.loadAddon(addon);
			this.#webgl = addon;
			this.#renderer = "webgl";
			this.#reportRenderer("initial");
		} catch {
			try {
				addon?.dispose();
			} catch {
				// Nothing loaded.
			}
			this.#webgl = null;
			this.#renderer = "dom";
			this.#reportRenderer("fallback");
		}
	}

	#scheduleWebglRetry(): void {
		if (this.#disposed || this.#webglRetries >= MAX_WEBGL_RETRIES) return;
		this.#webglRetries++;
		const delay = this.#webglRetries * 1000;
		setTimeout(() => {
			if (this.#disposed || this.#webgl) return;
			this.#loadWebgl();
		}, delay);
	}

	/** Push PTY output into the write queue; never one `term.write` per frame. */
	enqueue(text: string): void {
		if (this.#disposed || text.length === 0) return;
		this.#queue.push(text);
		this.#queuedChars += text.length;
		if (this.#queuedChars > this.#peakQueuedChars) this.#peakQueuedChars = this.#queuedChars;
		const immediate = this.#active ? ACTIVE_IMMEDIATE_CHARS : BACKGROUND_IMMEDIATE_CHARS;
		if (this.#queuedChars >= immediate) {
			this.#flush();
			return;
		}
		this.#scheduleFlush();
	}

	#scheduleFlush(): void {
		if (this.#timer !== null) return;
		this.#timer = setTimeout(
			() => {
				this.#timer = null;
				this.#flush();
			},
			this.#active ? ACTIVE_FLUSH_MS : BACKGROUND_FLUSH_MS,
		);
	}

	#flush(): void {
		if (this.#disposed || this.#queue.length === 0) return;
		const data = this.#queue.length === 1 ? this.#queue[0]! : this.#queue.join("");
		this.#queue.length = 0;
		this.#queuedChars = 0;
		this.#bytesWritten += data.length;
		this.#lastWriteAt = performance.now();
		this.#pendingWrites++;
		this.term.write(data, () => {
			this.#pendingWrites--;
			this.#resolveIdle();
		});
	}

	/** Resolves once every enqueued write has been parsed and painted. */
	whenIdle(): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>();
		if (this.#queue.length === 0 && this.#pendingWrites === 0) requestAnimationFrame(() => resolve());
		else this.#idleWaiters.push(resolve);
		return promise;
	}

	#resolveIdle(): void {
		if (this.#pendingWrites > 0 || this.#queue.length > 0) return;
		if (this.#timer !== null) return;
		const waiters = this.#idleWaiters.splice(0);
		if (waiters.length === 0) return;
		requestAnimationFrame(() => {
			for (const resolve of waiters) resolve();
		});
	}

	setActive(active: boolean): void {
		if (this.#active === active) return;
		this.#active = active;
		if (active) this.#flush();
	}

	fitToContainer(): { cols: number; rows: number; changed: boolean } {
		const before = { cols: this.term.cols, rows: this.term.rows };
		try {
			this.fit.fit();
		} catch {
			// Mid-collapse containers throw; the observer fires again.
		}
		return { cols: this.term.cols, rows: this.term.rows, changed: before.cols !== this.term.cols || before.rows !== this.term.rows };
	}

	focus(): void {
		this.term.focus();
	}

	paste(text: string): void {
		this.term.paste(text);
	}

	async copySelection(): Promise<string | null> {
		const selection = this.term.getSelection();
		if (!selection) return null;
		await navigator.clipboard.writeText(selection);
		return selection;
	}

	clear(): void {
		this.term.clear();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#queue.length = 0;
		this.#queuedChars = 0;
		try {
			this.#webgl?.dispose();
		} catch {
			// Already disposed with the terminal.
		}
		this.#webgl = null;
		this.term.dispose();
	}
}
