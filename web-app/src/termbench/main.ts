/**
 * Terminal performance / compatibility spike for Work Studio.
 *
 * Measurement build only: this entry is not a product input. It drives the
 * real gateway (`/api/terminal/*` + the binary PTY WebSocket) with the same
 * `XtermSession` the Work Studio panel uses, so numbers describe the shipping
 * path rather than a synthetic mock.
 *
 * Run with `vite` (dev), open `/termbench.html`, then either press Run or
 * evaluate `window.__termBench.runAll()` in the page. Results are also exposed
 * as JSON for scripted collection.
 */

import "@xterm/xterm/css/xterm.css";
import "./bench.css";
import {
	gatewayTerminal,
	TerminalGatewayError,
	type GatewayTerminalInfo,
	type TerminalProfileCatalog,
} from "../studio/terminals/gatewayTerminal";
import { XtermSession, type TerminalRenderer } from "../studio/terminals/xtermSession";

type ScenarioResult = {
	scenario: string;
	renderer: string;
	ok: boolean;
	metrics: Record<string, number | string | boolean | null>;
	note?: string;
};

type LatencyStats = { samples: number; p50: number; p95: number; max: number; mean: number };

type RttSimulation = { label: string; rttMs: number };

const logNode = document.querySelector<HTMLPreElement>("#log")!;
const statusNode = document.querySelector<HTMLSpanElement>("#status")!;
const resultsNode = document.querySelector<HTMLTableSectionElement>("#results tbody")!;
const hostNode = document.querySelector<HTMLDivElement>("#host")!;

const results: ScenarioResult[] = [];
let running = false;
/** Shell under test; set from the catalog so every PTY scenario matches. */
let defaultProfileId: string | undefined;
interface BackgroundRun {
	name: string;
	startedAt: number;
	done: boolean;
	result?: unknown;
	error?: string;
}
let backgroundRun: BackgroundRun | null = null;

function log(message: string): void {
	const line = `[${new Date().toISOString().slice(11, 23)}] ${message}`;
	logNode.textContent += `${line}\n`;
	logNode.scrollTop = logNode.scrollHeight;
}

function setStatus(text: string): void {
	statusNode.textContent = text;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index]!;
}

function stats(values: number[]): LatencyStats {
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((total, value) => total + value, 0);
	return {
		samples: sorted.length,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		max: sorted.at(-1) ?? 0,
		mean: sorted.length === 0 ? 0 : sum / sorted.length,
	};
}

function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function heapUsedMb(): number | null {
	const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
	return memory?.usedJSHeapSize ? round(memory.usedJSHeapSize / 1024 / 1024, 1) : null;
}

async function rafSample(durationMs: number): Promise<{ fps: number; p50: number; p95: number; max: number; frames: number; longTasks: number }> {
	const intervals: number[] = [];
	let longTasks = 0;
	const observer = new PerformanceObserver(list => {
		longTasks += list.getEntries().length;
	});
	try {
		observer.observe({ type: "longtask", buffered: true });
	} catch {
		// longtask is Chromium-only.
	}
	const start = performance.now();
	let previous = start;
	await new Promise<void>(resolve => {
		const tick = (now: number): void => {
			intervals.push(now - previous);
			previous = now;
			if (now - start < durationMs) requestAnimationFrame(tick);
			else resolve();
		};
		requestAnimationFrame(tick);
	});
	observer.disconnect();
	const meaningful = intervals.filter(ms => ms > 0);
	const p50 = percentile([...meaningful].sort((a, b) => a - b), 50);
	return {
		fps: round((meaningful.length / durationMs) * 1000, 1),
		p50: round(p50, 1),
		p95: round(percentile([...meaningful].sort((a, b) => a - b), 95), 1),
		max: round(Math.max(...meaningful), 1),
		frames: meaningful.length,
		longTasks,
	};
}

function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
	const start = performance.now();
	while (performance.now() - start < timeoutMs) {
		if (predicate()) return;
		await delay(25);
	}
	throw new Error(`timeout waiting for ${label}`);
}

// --- session harness ---

interface BenchSession {
	session: XtermSession;
	connection: ReturnType<typeof gatewayTerminal.connect>;
	info: GatewayTerminalInfo;
	container: HTMLDivElement;
	received: number;
	text: string;
	setInboundDelay(ms: number): void;
	dispose(): Promise<void>;
}

interface CreateBenchOptions {
	renderer: TerminalRenderer;
	profileId?: string;
	instanceId?: string;
	visible?: boolean;
	onData?: (text: string) => void;
}

async function createBenchSession(options: CreateBenchOptions): Promise<BenchSession> {
	const container = document.createElement("div");
	container.className = "bench-term";
	if (options.visible === false) container.style.display = "none";
	hostNode.append(container);
	const instanceId = options.instanceId ?? `bench-${Math.random().toString(36).slice(2, 10)}`;
	const profileId = options.profileId ?? defaultProfileId;
	let connection: BenchSession["connection"] | undefined;
	let inboundDelayMs = 0;
	let info: GatewayTerminalInfo | null = null;
	const session = new XtermSession({
		container,
		renderer: options.renderer,
		active: true,
		scrollback: 10_000,
		onInput: data => connection?.send(data),
		onResize: (cols, rows) => {
			if (info) void gatewayTerminal.resize(info.id, cols, rows).catch(() => {});
		},
	});
	info = await gatewayTerminal.ensure({
		cols: session.term.cols,
		rows: session.term.rows,
		instanceId,
		...(profileId ? { profileId } : {}),
	});
	await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
	const fitted = session.fitToContainer();
	if (fitted.changed) await gatewayTerminal.resize(info.id, fitted.cols, fitted.rows).catch(() => {});
	const bench: BenchSession = {
		session,
		connection: undefined as unknown as BenchSession["connection"],
		info,
		container,
		received: 0,
		text: "",
		setInboundDelay: ms => {
			inboundDelayMs = ms;
		},
		dispose: async () => {
			bench.connection.dispose();
			session.dispose();
			container.remove();
			await gatewayTerminal.remove(info.id).catch(() => {});
		},
	};
	connection = gatewayTerminal.connect(info, {
		onData: text => {
			const apply = (): void => {
				bench.received += text.length;
				bench.text = (bench.text + text).slice(-64 * 1024);
				session.enqueue(text);
				options.onData?.(text);
			};
			if (inboundDelayMs > 0) setTimeout(apply, inboundDelayMs);
			else apply();
		},
		onError: message => log(`session ${info.id}: ${message}`),
	});
	bench.connection = connection;
	await waitFor(() => connection?.state === "open", 5_000, "terminal socket");
	return bench;
}

/**
 * Wait until the shell actually executes input, not just paints a startup
 * banner. The echoed command contains the literal `$RANDOM`; only the
 * expanded output has digits, so a false positive is impossible.
 */
async function waitReady(bench: BenchSession, timeoutMs = 30_000): Promise<void> {
	bench.connection.send("echo READY_$RANDOM\r");
	await waitFor(() => /READY_\d+/.test(bench.text), timeoutMs, `shell readiness (${bench.info.profile ?? "default"})`);
}

/** Wait until output *after this call* has been quiet for `quietMs`. */
function waitQuiet(
	bench: BenchSession,
	quietMs: number,
	timeoutMs: number,
	options: { includeExisting?: boolean } = {},
): Promise<{ bytes: number; ms: number; firstByteAt: number }> {
	const { promise, resolve, reject } = Promise.withResolvers<{ bytes: number; ms: number; firstByteAt: number }>();
	const start = performance.now();
	// Readiness (shell already painted its prompt before the call) counts the
	// bytes that arrived earlier; command waits only count bytes after the call.
	const base = options.includeExisting ? 0 : bench.received;
	let last = start;
	let bytes = 0;
	let firstAt = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		const total = bench.received - base;
		if (total > bytes) {
			bytes = total;
			last = now;
			if (!firstAt) firstAt = now;
		}
		if (bytes > 0 && now - last >= quietMs) {
			clearInterval(timer);
			resolve({ bytes, ms: last - start, firstByteAt: firstAt });
		}
		if (now - start > timeoutMs) {
			clearInterval(timer);
			reject(new Error(`no output within ${timeoutMs}ms (${bytes} bytes, queued ${bench.session.queuedChars})`));
		}
	}, 20);
	return promise;
}

/** Type one character and time the echo path back into xterm's input write. */
async function keystrokeSample(bench: BenchSession, char: string, simulation: RttSimulation | null): Promise<number> {
	const start = performance.now();
	const before = bench.received;
	const send = (): void => bench.connection.send(char);
	if (simulation) setTimeout(send, simulation.rttMs / 2);
	else send();
	const { promise, resolve } = Promise.withResolvers<number>();
	const poll = setInterval(() => {
		if (bench.received > before) {
			clearInterval(poll);
			const elapsed = performance.now() - start;
			resolve(elapsed);
		}
	}, 1);
	const timeout = setTimeout(() => {
		clearInterval(poll);
		resolve(Number.NaN);
	}, 3_000);
	return promise.finally(() => clearTimeout(timeout));
}

// --- synthetic streams ---

function buildSyntheticLines(totalBytes: number, lineBytes = 96): string {
	const words = ["alpha", "bravo", "中文终端", "emoji🙂", "┌─┐", "│├┤", "1234567890", "zeta"];
	let out = "";
	let index = 0;
	while (out.length < totalBytes) {
		const line = `${String(index).padStart(6, "0")} ${words[index % words.length]} ${words[(index * 3) % words.length]}`;
		out += `${line.padEnd(lineBytes, " ")}\r\n`;
		index++;
	}
	return out;
}

function buildAnsiStream(totalBytes: number): string {
	const colors = [31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97];
	let out = "";
	let index = 0;
	while (out.length < totalBytes) {
		const color = colors[index % colors.length];
		out += `\x1b[1;${color}m${String(index).padStart(7, "0")}\x1b[0m \x1b[4munder\x1b[24m \x1b[7mreverse\x1b[0m 日本語 🙂 ─│┌\r\n`;
		index++;
	}
	return out;
}

function buildAtlasStream(lines: number): string {
	const glyphs = "ᚠᚢᚦᚨᚱᚲ中文漢字日本語のテキスト🙂🚀👍🏽┌─┐│┬┴┼╔═╗║╚╝▀▄█░▒▓←→↑↓";
	let out = "";
	for (let index = 0; index < lines; index++) {
		let line = "";
		for (let column = 0; column < 120; column++) line += glyphs[(index * 7 + column * 3) % glyphs.length];
		out += `${line}\r\n`;
	}
	return out;
}

async function feedInChunks(session: XtermSession, data: string, chunkSize: number): Promise<void> {
	for (let offset = 0; offset < data.length; offset += chunkSize) {
		session.enqueue(data.slice(offset, offset + chunkSize));
		if (offset % (chunkSize * 8) === 0) await delay(0);
	}
	await session.whenIdle();
}

// --- scenarios ---

async function runSmoke(renderer: TerminalRenderer, profileId: string | undefined): Promise<ScenarioResult> {
	const bench = await createBenchSession({ renderer, ...(profileId ? { profileId } : {}) });
	try {
		await waitReady(bench);
		bench.connection.send("pwd; echo MARK_OK; command -v cat; command -v seq; echo PATH=$PATH | head -c 200; echo\r");
		await delay(1500);
		bench.connection.send("test -f /tmp/zeta-termbench-20m.txt && echo FILE_YES || echo FILE_NO; ls -la /tmp | head -5; echo\r");
		await delay(1500);
		const lines: string[] = [];
		const buffer = bench.session.term.buffer.active;
		for (let index = Math.max(0, buffer.length - 20); index < buffer.length; index++) {
			lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
		}
		return {
			scenario: "smoke-shell",
			renderer,
			ok: lines.some(line => line.includes("MARK_OK")),
			metrics: {
				received: bench.received,
				rendererActual: bench.session.renderer,
				cols: bench.session.term.cols,
				rows: bench.session.term.rows,
			},
			note: lines.filter(Boolean).join(" | ").slice(0, 900),
		};
	} finally {
		await bench.dispose();
	}
}

async function runLatency(catalog: TerminalProfileCatalog, profileId: string | undefined): Promise<ScenarioResult[]> {
	const out: ScenarioResult[] = [];
	const simulations: Array<RttSimulation | null> = [null, { label: "rtt40", rttMs: 40 }, { label: "rtt120", rttMs: 120 }];
	for (const renderer of ["webgl", "dom"] as const) {
		const bench = await createBenchSession({ renderer, ...(profileId ? { profileId } : {}) });
		try {
			await waitReady(bench);
			for (const simulation of simulations) {
				bench.setInboundDelay(simulation ? simulation.rttMs / 2 : 0);
				// Warm up the shell's echo path so the first prompt paint cannot
				// become a multi-second outlier in the sample set.
				for (let warmup = 0; warmup < 5; warmup++) {
					bench.connection.send("x");
					await delay(simulation ? simulation.rttMs + 40 : 60);
				}
				bench.connection.send("\u0015");
				await delay(80);
				const samples: number[] = [];
				const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
				for (let index = 0; index < 25; index++) {
					const sample = await keystrokeSample(bench, chars[index % chars.length]!, simulation);
					if (Number.isFinite(sample)) samples.push(sample);
					await delay(simulation ? 120 : 40);
				}
				bench.connection.send("\u0015");
				const outliers = samples.filter(sample => sample > 1000).length;
				const stable = samples.filter(sample => sample <= 1000);
				const statsValue = stats(stable);
				out.push({
					scenario: `keystroke-${simulation?.label ?? "local"}`,
					renderer,
					ok: statsValue.samples >= 20,
					metrics: {
						samples: statsValue.samples,
						startupOutliers: outliers,
						p50ms: round(statsValue.p50, 2),
						p95ms: round(statsValue.p95, 2),
						maxMs: round(statsValue.max, 2),
						meanMs: round(statsValue.mean, 2),
						dpr: window.devicePixelRatio,
						rendererActual: bench.session.renderer,
					},
				});
			}
		} finally {
			await bench.dispose();
		}
	}
	log(`profiles: ${catalog.profiles.map(profile => profile.id).join(", ") || "(none)"}`);
	return out;
}

async function runGatewayThroughput(renderer: TerminalRenderer, profileId: string | undefined): Promise<ScenarioResult[]> {
	const out: ScenarioResult[] = [];
	const bench = await createBenchSession({ renderer, ...(profileId ? { profileId } : {}) });
	try {
		await waitReady(bench);
		bench.connection.send("test -f /tmp/zeta-termbench-20m.txt || yes 'the quick brown fox jumps over the lazy dog 0123456789' | head -c 20000000 > /tmp/zeta-termbench-20m.txt\r");
		await waitQuiet(bench, 600, 20_000);
		const rafPromise = rafSample(4_000);
		const before = bench.received;
		const start = performance.now();
		bench.connection.send("cat /tmp/zeta-termbench-20m.txt\r");
		const result = await waitQuiet(bench, 600, 120_000);
		const raf = await rafPromise;
		const bytes = bench.received - before;
		const seconds = result.ms / 1000;
		out.push({
			scenario: "pty-cat-20mb",
			renderer,
			ok: bytes > 18_000_000,
			metrics: {
				bytes,
				wallMs: round(performance.now() - start, 0),
				quietMs: round(result.ms, 0),
				mbPerSecond: round(bytes / 1024 / 1024 / seconds, 2),
				peakQueueChars: bench.session.peakQueuedChars,
				rendererActual: bench.session.renderer,
				rafFps: raf.fps,
				rafP95Ms: raf.p95,
				rafMaxMs: raf.max,
				longTasks: raf.longTasks,
				heapMb: heapUsedMb(),
			},
		});
	} finally {
		await bench.dispose();
	}
	return out;
}

async function runSeqThroughput(renderer: TerminalRenderer, profileId: string | undefined): Promise<ScenarioResult[]> {
	const bench = await createBenchSession({ renderer, ...(profileId ? { profileId } : {}) });
	try {
		await waitReady(bench);
		const rafPromise = rafSample(3_000);
		const before = bench.received;
		const start = performance.now();
		bench.connection.send("seq 1 300000\r");
		const result = await waitQuiet(bench, 500, 60_000);
		const raf = await rafPromise;
		const bytes = bench.received - before;
		return [
			{
				scenario: `pty-seq-${bytes > 0 ? "300k" : "empty"}`,
				renderer,
				ok: bytes > 1_000_000,
				metrics: {
					bytes,
					wallMs: round(performance.now() - start, 0),
					quietMs: round(result.ms, 0),
					mbPerSecond: round(bytes / 1024 / 1024 / (result.ms / 1000), 2),
					rendererActual: bench.session.renderer,
					rafFps: raf.fps,
					rafP95Ms: raf.p95,
					rafMaxMs: raf.max,
					longTasks: raf.longTasks,
					heapMb: heapUsedMb(),
				},
			},
		];
	} finally {
		await bench.dispose();
	}
}

async function runSynthetic(renderer: TerminalRenderer, name: string, data: string): Promise<ScenarioResult> {
	const container = document.createElement("div");
	container.className = "bench-term";
	hostNode.append(container);
	const session = new XtermSession({ container, renderer, active: true, scrollback: 10_000 });
	try {
		const heapBefore = heapUsedMb();
		const rafPromise = rafSample(2_000);
		const start = performance.now();
		await feedInChunks(session, data, 64 * 1024);
		const elapsed = performance.now() - start;
		const raf = await rafPromise;
		return {
			scenario: name,
			renderer,
			ok: true,
			metrics: {
				chars: data.length,
				elapsedMs: round(elapsed, 0),
				mbPerSecond: round(data.length / 1024 / 1024 / (elapsed / 1000), 2),
				bufferLines: session.term.buffer.active.length,
				rendererActual: session.renderer,
				rafFps: raf.fps,
				rafP95Ms: raf.p95,
				rafMaxMs: raf.max,
				longTasks: raf.longTasks,
				heapBeforeMb: heapBefore,
				heapAfterMb: heapUsedMb(),
			},
		};
	} finally {
		session.dispose();
		container.remove();
	}
}

type TuiApp = "vim" | "less" | "top" | "omp" | "opencode" | "wsl-top";

const TUI_COMMANDS: Record<TuiApp, string> = {
	vim: "vim -u NONE -N -n /tmp/zeta-termbench.txt\r",
	less: "less /tmp/zeta-termbench.txt\r",
	top: "top\r",
	omp: "omp\r",
	opencode: "opencode\r",
	"wsl-top": "wsl.exe -e top\r",
};

const TUI_EXIT: Record<TuiApp, string> = {
	vim: "\u001b:q!\r",
	less: "q",
	top: "q",
	omp: "\u0003",
	opencode: "\u0003",
	"wsl-top": "q",
};

async function runTui(renderer: TerminalRenderer, profileId: string | undefined, app: TuiApp): Promise<ScenarioResult> {
	let bench: BenchSession | undefined;
	try {
		bench = await createBenchSession({ renderer, ...(profileId ? { profileId } : {}) });
		await waitReady(bench);
		bench.connection.send("printf 'line\\n%.0s' {1..500} > /tmp/zeta-termbench.txt\r");
		await waitQuiet(bench, 300, 10_000);
		const before = bench.received;
		const start = performance.now();
		bench.connection.send(TUI_COMMANDS[app]);
		let altEntered = false;
		const altWindow = app === "less" ? 2_000 : app === "omp" || app === "opencode" ? 12_000 : 10_000;
		try {
			await waitFor(() => bench!.session.term.buffer.active.type === "alternate", altWindow, `${app} alternate screen`);
			altEntered = true;
		} catch {
			// `less` in Git Bash has no `smcup`, and inline TUIs legitimately stay
			// on the main buffer. Record the fact instead of failing the matrix.
			await delay(1_000);
			if (bench.received === before) throw new Error(`${app} produced no output`);
		}
		const enterMs = performance.now() - start;
		const raf = await rafSample(1_500);
		const exitStart = performance.now();
		bench.connection.send(TUI_EXIT[app]);
		await delay(400);
		bench.connection.send(TUI_EXIT[app]);
		if (altEntered) {
			await waitFor(() => bench!.session.term.buffer.active.type === "normal", 5_000, `${app} normal screen`).catch(() => {});
		} else {
			await delay(300);
		}
		const exitMs = performance.now() - exitStart;
		return {
			scenario: `tui-${app}`,
			renderer,
			ok: true,
			metrics: {
				enterAltMs: round(enterMs, 0),
				exitAltMs: round(exitMs, 0),
				bytes: bench.received - before,
				rafFps: raf.fps,
				rafP95Ms: raf.p95,
				rafMaxMs: raf.max,
				longTasks: raf.longTasks,
				altBuffer: altEntered,
				exitedAlt: bench.session.term.buffer.active.type === "normal",
			},
			...(altEntered ? {} : { note: `${app} painted the main buffer` }),
		};
	} catch (error) {
		const tail: string[] = [];
		if (bench) {
			const buffer = bench.session.term.buffer.active;
			for (let index = Math.max(0, buffer.length - 6); index < buffer.length; index++) {
				tail.push(buffer.getLine(index)?.translateToString(true) ?? "");
			}
		}
		return {
			scenario: `tui-${app}`,
			renderer,
			ok: false,
			metrics: { received: bench?.received ?? 0 },
			note: `${error instanceof Error ? error.message : String(error)}; tail: ${tail.filter(Boolean).join(" | ").slice(0, 500)}`,
		};
	} finally {
		if (bench) {
			bench.connection.send("\u001b");
			await delay(50);
			await bench.dispose();
		}
	}
}

async function runAltScreenSynthetic(renderer: TerminalRenderer): Promise<ScenarioResult> {
	const container = document.createElement("div");
	container.className = "bench-term";
	hostNode.append(container);
	const session = new XtermSession({ container, renderer, active: true });
	try {
		let altBuffer = false;
		session.term.buffer.onBufferChange(buffer => {
			altBuffer = buffer.type === "alternate";
		});
		const enterStart = performance.now();
		session.enqueue("\x1b[?1049h\x1b[2J\x1b[HALT-SCREEN-TOP\x1b[24;80Hbottom-right");
		await session.whenIdle();
		const enterMs = performance.now() - enterStart;
		await delay(30);
		const exitStart = performance.now();
		session.enqueue(`\x1b[?1049l`);
		await session.whenIdle();
		const exitMs = performance.now() - exitStart;
		return {
			scenario: "altscreen-enter-exit",
			renderer,
			ok: altBuffer || session.term.buffer.active.type === "normal",
			metrics: { enterMs: round(enterMs, 1), exitMs: round(exitMs, 1), altObserved: altBuffer },
		};
	} finally {
		session.dispose();
		container.remove();
	}
}

async function runContextLoss(renderer: TerminalRenderer): Promise<ScenarioResult> {
	if (renderer !== "webgl") {
		return { scenario: "webgl-context-loss", renderer, ok: false, metrics: {}, note: "webgl only" };
	}
	const container = document.createElement("div");
	container.className = "bench-term";
	hostNode.append(container);
	let changes: string[] = [];
	const session = new XtermSession({
		container,
		renderer,
		active: true,
		onRendererChange: (kind, reason) => changes.push(`${reason}:${kind}`),
	});
	try {
		session.enqueue("before-loss\r\n");
		await session.whenIdle();
		const canvases = Array.from(session.term.element?.querySelectorAll("canvas") ?? []);
		let gl: WebGL2RenderingContext | null = null;
		let canvas: HTMLCanvasElement | null = null;
		for (const candidate of canvases) {
			const context = candidate.getContext("webgl2");
			if (context) {
				gl = context;
				canvas = candidate;
				break;
			}
		}
		const canvasCount = canvases.length;
		const documentCanvasCount = document.querySelectorAll("canvas").length;
		const extension = gl?.getExtension("WEBGL_lose_context");
		if (!extension || !canvas) {
			return {
				scenario: "webgl-context-loss",
				renderer,
				ok: false,
				metrics: {
					rendererActual: session.renderer,
					canvasCount,
					documentCanvasCount,
					canvasClasses: canvases.map(item => item.className).join(","),
				},
				note: "WEBGL_lose_context unavailable",
			};
		}
		const lostAt = performance.now();
		const events: string[] = [];
		for (const candidate of canvases) {
			candidate.addEventListener("webglcontextlost", () => events.push(`lost:${Math.round(performance.now() - lostAt)}`));
			candidate.addEventListener("webglcontextrestored", () => events.push(`restored:${Math.round(performance.now() - lostAt)}`));
		}
		extension.loseContext();
		// xterm's WebGL renderer gives the browser 3 s to restore the context
		// before it fires `onContextLoss`; wait past that window.
		await waitFor(() => session.renderer === "dom" || events.length > 0, 9_000, "context-loss event").catch(() => {});
		await waitFor(() => session.renderer === "dom", 6_000, "DOM fallback").catch(() => {});
		const fallbackMs = performance.now() - lostAt;
		const fellBack = session.renderer === "dom";
		session.enqueue("after-loss-visible\r\n");
		await session.whenIdle();
		await delay(2_500);
		return {
			scenario: "webgl-context-loss",
			renderer,
			ok: fellBack,
			metrics: {
				fallbackMs: round(fallbackMs, 0),
				fellBack,
				contextLost: gl?.isContextLost() ?? null,
				events: events.join("|"),
				finalRenderer: session.renderer,
				transitions: changes.join("|"),
				bufferTail: session.term.buffer.active.getLine(session.term.buffer.active.length - 2)?.translateToString(true) ?? "",
			},
		};
	} finally {
		session.dispose();
		container.remove();
	}
}

async function runScrollbackAtlas(renderer: TerminalRenderer): Promise<ScenarioResult> {
	const container = document.createElement("div");
	container.className = "bench-term";
	hostNode.append(container);
	const session = new XtermSession({ container, renderer, active: true, scrollback: 100_000 });
	try {
		const start = performance.now();
		const data = buildAtlasStream(20_000);
		await feedInChunks(session, data, 64 * 1024);
		const feedMs = performance.now() - start;
		const scrollStart = performance.now();
		session.term.scrollToTop();
		await delay(50);
		session.term.scrollToBottom();
		await delay(50);
		session.term.scrollToLine(Math.floor(session.term.buffer.active.length / 2));
		await delay(100);
		const scrollMs = performance.now() - scrollStart;
		const atlasPages = session.term.element?.querySelectorAll("canvas").length ?? 0;
		return {
			scenario: "atlas-mixed-script-scrollback",
			renderer,
			ok: true,
			metrics: {
				feedMs: round(feedMs, 0),
				chars: data.length,
				bufferLines: session.term.buffer.active.length,
				scrollMs: round(scrollMs, 0),
				canvases: atlasPages,
				rendererActual: session.renderer,
				heapMb: heapUsedMb(),
			},
		};
	} finally {
		session.dispose();
		container.remove();
	}
}

async function runResizeStorm(renderer: TerminalRenderer): Promise<ScenarioResult> {
	const bench = await createBenchSession({ renderer });
	try {
		await waitReady(bench);
		const latencies: number[] = [];
		let failures = 0;
		for (let index = 0; index < 40; index++) {
			const cols = index % 2 === 0 ? 120 : 60;
			const rows = index % 2 === 0 ? 40 : 20;
			const start = performance.now();
			try {
				bench.session.term.resize(cols, rows);
				await gatewayTerminal.resize(bench.info.id, cols, rows);
				latencies.push(performance.now() - start);
			} catch {
				failures++;
			}
		}
		const statsValue = stats(latencies);
		return {
			scenario: "resize-storm",
			renderer,
			ok: failures === 0,
			metrics: {
				resizes: latencies.length,
				failures,
				p50ms: round(statsValue.p50, 2),
				p95ms: round(statsValue.p95, 2),
				maxMs: round(statsValue.max, 2),
				finalCols: bench.session.term.cols,
				finalRows: bench.session.term.rows,
			},
		};
	} finally {
		await bench.dispose();
	}
}

async function runReconnect(renderer: TerminalRenderer): Promise<ScenarioResult> {
	const bench = await createBenchSession({ renderer });
	try {
		await waitReady(bench);
		bench.connection.send("seq 1 2000\r");
		await waitQuiet(bench, 500, 10_000);
		const before = bench.received;
		let replayed: number | null = null;
		const originalHandler = bench.connection.handlers.onControl;
		bench.connection.handlers.onControl = frame => {
			if (typeof frame.replayedBytes === "number") replayed = frame.replayedBytes;
			originalHandler?.(frame);
		};
		const start = performance.now();
		bench.connection.reconnect();
		await waitFor(() => bench.connection.state === "open", 8_000, "reconnected socket");
		await delay(500);
		return {
			scenario: "reconnect-replay",
			renderer,
			ok: replayed !== null && bench.received > before,
			metrics: {
				reconnectMs: round(performance.now() - start, 0),
				replayedBytes: replayed,
				receivedAfter: bench.received - before,
				state: bench.connection.state,
			},
		};
	} finally {
		await bench.dispose();
	}
}

async function runMultiPty(count: number, profileId?: string): Promise<ScenarioResult> {
	const sessions: BenchSession[] = [];
	try {
		for (let index = 0; index < count; index++) sessions.push(await createBenchSession({ renderer: "webgl", ...(profileId ? { profileId } : {}), instanceId: `bench-multi-${index}-${Math.random().toString(36).slice(2, 6)}` }));
		for (const bench of sessions) {
			try {
				await waitReady(bench);
			} catch (error) {
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}; shell=${bench.info.shell} profile=${bench.info.profile} state=${bench.connection.state} received=${bench.received} instance=${bench.info.instance}`,
				);
			}
		}
		const heapBefore = heapUsedMb();
		const rafPromise = rafSample(3_000);
		const start = performance.now();
		const waits = sessions.map(bench => {
			bench.connection.send("seq 1 60000\r");
			return waitQuiet(bench, 500, 60_000);
		});
		const resultsPer = await Promise.all(waits);
		const elapsedMs = performance.now() - start;
		const raf = await rafPromise;
		const totalBytes = resultsPer.reduce((sum, result) => sum + result.bytes, 0);
		return {
			scenario: `multi-pty-${count}`,
			renderer: "webgl",
			ok: resultsPer.every(result => result.bytes > 200_000),
			metrics: {
				terminals: count,
				wallMs: round(elapsedMs, 0),
				bytes: resultsPer.map(result => result.bytes).join(","),
				mbPerSecond: round(totalBytes / 1024 / 1024 / (elapsedMs / 1000), 2),
				rafFps: raf.fps,
				rafP95Ms: raf.p95,
				heapBeforeMb: heapBefore,
				heapAfterMb: heapUsedMb(),
			},
		};
	} finally {
		for (const bench of sessions) await bench.dispose();
	}
}

/** Renderer memory at 8 instances (the gateway caps live PTYs at 4). */
async function runSyntheticMany(count: number): Promise<ScenarioResult> {
	const containers: HTMLDivElement[] = [];
	const sessions: XtermSession[] = [];
	try {
		for (let index = 0; index < count; index++) {
			const container = document.createElement("div");
			container.className = "bench-term small";
			hostNode.append(container);
			containers.push(container);
			sessions.push(new XtermSession({ container, renderer: "webgl", active: index === 0, scrollback: 10_000 }));
		}
		const heapBefore = heapUsedMb();
		const line = "synthetic mixed 中文 🙂 ─│┌ 0123456789\r\n";
		await Promise.all(
			sessions.map(async session => {
				for (let chunk = 0; chunk < 40; chunk++) session.enqueue(line.repeat(50));
				await session.whenIdle();
			}),
		);
		await delay(500);
		return {
			scenario: `synthetic-${count}-terminals`,
			renderer: "webgl",
			ok: true,
			metrics: {
				terminals: count,
				heapBeforeMb: heapBefore,
				heapAfterMb: heapUsedMb(),
				bufferLines: sessions[0]?.term.buffer.active.length ?? 0,
			},
		};
	} finally {
		for (const session of sessions) session.dispose();
		for (const container of containers) container.remove();
	}
}

async function runBackgroundThrottle(): Promise<ScenarioResult> {
	const foreground = await createBenchSession({ renderer: "webgl", instanceId: `bench-fg-${Math.random().toString(36).slice(2, 6)}` });
	const background = await createBenchSession({ renderer: "webgl", instanceId: `bench-bg-${Math.random().toString(36).slice(2, 6)}` });
	try {
		await waitReady(foreground);
		await waitReady(background);
		background.session.setActive(false);
		const start = performance.now();
		foreground.connection.send("seq 1 150000\r");
		background.connection.send("seq 1 150000\r");
		const backgroundWait = waitQuiet(background, 500, 60_000).then(result => ({ result, at: performance.now() - start }));
		const foregroundWait = waitQuiet(foreground, 500, 60_000).then(result => ({ result, at: performance.now() - start }));
		const [foregroundDone, backgroundDone] = await Promise.all([foregroundWait, backgroundWait]);
		await background.session.whenIdle();
		return {
			scenario: "background-pane-throttle",
			renderer: "webgl",
			ok: backgroundDone.result.bytes > 200_000,
			metrics: {
				foregroundBytes: foregroundDone.result.bytes,
				backgroundBytes: backgroundDone.result.bytes,
				foregroundQuietMs: round(foregroundDone.at, 0),
				backgroundQuietMs: round(backgroundDone.at, 0),
				backgroundWritesCompleted: background.session.bytesWritten > 0,
			},
		};
	} finally {
		await foreground.dispose();
		await background.dispose();
	}
}

async function runGutterAndFocus(renderer: TerminalRenderer): Promise<ScenarioResult> {
	const bench = await createBenchSession({ renderer });
	try {
		await waitReady(bench);
		bench.connection.send("printf 'gutter-line-1\\ngutter-line-2\\n'\r");
		await waitQuiet(bench, 400, 10_000);
		const element = bench.session.term.element;
		const screen = element?.querySelector<HTMLElement>(".xterm-screen");
		const rows = element?.querySelector<HTMLElement>(".xterm-rows");
		const screenStyle = screen ? getComputedStyle(screen) : null;
		const rowsStyle = rows ? getComputedStyle(rows) : null;
		const screenBox = screen?.getBoundingClientRect();
		const firstRow = rows?.firstElementChild?.getBoundingClientRect();
		const containerBox = bench.container.getBoundingClientRect();
		const measure = element?.querySelector<HTMLElement>(".xterm-char-measure-element");
		const measureStyle = measure ? getComputedStyle(measure) : null;
		bench.session.focus();
		await delay(50);
		const activeIsTerminal = document.activeElement === bench.session.term.textarea || bench.container.contains(document.activeElement);
		// The WebGL renderer paints rows into a canvas, so `.xterm-rows` may be
		// absent there; absence is not a gutter. When present it must not indent.
		const rowsClean = rows === null || rows === undefined || rowsStyle?.textIndent === "0px" || rowsStyle?.textIndent === "normal";
		return {
			scenario: "gutter-focus-metrics",
			renderer,
			ok:
				(screenStyle?.paddingLeft === "0px" || screenStyle?.paddingLeft === "") &&
				(screenStyle?.paddingTop === "0px" || screenStyle?.paddingTop === "") &&
				rowsClean,
			metrics: {
				screenPaddingLeft: screenStyle?.paddingLeft ?? "",
				screenPaddingTop: screenStyle?.paddingTop ?? "",
				rowsTextIndent: rowsStyle?.textIndent ?? "",
				rowsMarginLeft: rowsStyle?.marginLeft ?? "",
				firstRowOffsetPx: screenBox && firstRow ? round(firstRow.left - screenBox.left, 2) : -1,
				containerWidth: round(containerBox.width, 1),
				screenWidth: screenBox ? round(screenBox.width, 1) : -1,
				charWidthPx: measureStyle ? round(Number.parseFloat(measureStyle.width), 2) : -1,
				dpr: window.devicePixelRatio,
				cols: bench.session.term.cols,
				rows: bench.session.term.rows,
				focusInTerminal: activeIsTerminal,
			},
		};
	} finally {
		await bench.dispose();
	}
}

function gpuInfo(): string {
	try {
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		if (!gl) return "no-webgl";
		const extension = gl.getExtension("WEBGL_debug_renderer_info");
		const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
		return String(renderer);
	} catch {
		return "no-webgl";
	}
}

// --- orchestration ---

async function runAll(): Promise<{ environment: Record<string, unknown>; results: ScenarioResult[] }> {
	if (running) throw new Error("benchmark already running");
	running = true;
	results.length = 0;
	resultsNode.textContent = "";
	try {
		const catalog = await gatewayTerminal.listProfiles();
		const profile =
			catalog.profiles.find(candidate => candidate.id === "git-bash") ??
			catalog.profiles.find(candidate => candidate.kind === "bash") ??
			catalog.profiles.find(candidate => candidate.id === catalog.defaultProfileId);
		if (catalog.warnings.length > 0) log(`profile warnings: ${catalog.warnings.join("; ")}`);
		log(`using shell profile: ${profile?.id ?? "(platform default)"}`);
		const profileId = profile?.id;
		defaultProfileId = profileId;
		const environment = {
			userAgent: navigator.userAgent,
			platform: navigator.platform,
			dpr: window.devicePixelRatio,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
			hardwareConcurrency: navigator.hardwareConcurrency,
			gpu: gpuInfo(),
			profiles: catalog.profiles.map(candidate => `${candidate.id} (${candidate.label})`),
			crossOriginIsolated: window.crossOriginIsolated,
		};

		const scenarios: Array<() => Promise<ScenarioResult[]>> = [
			() => runLatency(catalog, profileId),
			() => runGatewayThroughput("webgl", profileId),
			() => runGatewayThroughput("dom", profileId),
			() => runSeqThroughput("webgl", profileId),
			() => runSeqThroughput("dom", profileId),
			() => Promise.all([runSynthetic("webgl", "synthetic-ansi-2mb", buildAnsiStream(2 * 1024 * 1024)), runSynthetic("dom", "synthetic-ansi-2mb", buildAnsiStream(2 * 1024 * 1024))]),
			() => Promise.all([runSynthetic("webgl", "synthetic-20mb", buildSyntheticLines(20 * 1024 * 1024)), runSynthetic("dom", "synthetic-20mb", buildSyntheticLines(20 * 1024 * 1024))]),
			() => runTui("webgl", profileId, "vim").then(result => [result]),
			() => runTui("webgl", profileId, "less").then(result => [result]),
			() => runAltScreenSynthetic("webgl").then(result => [result]),
			() => runScrollbackAtlas("webgl").then(result => [result]),
			() => runContextLoss("webgl").then(result => [result]),
			() => runResizeStorm("webgl").then(result => [result]),
			() => runReconnect("webgl").then(result => [result]),
			() => runGutterAndFocus("webgl").then(result => [result]),
			() => runMultiPty(1, profileId).then(result => [result]),
			() => runMultiPty(2, profileId).then(result => [result]),
			() => runMultiPty(4, profileId).then(result => [result]),
			() => runSyntheticMany(8).then(result => [result]),
			() => runBackgroundThrottle().then(result => [result]),
		];

		for (const [index, scenario] of scenarios.entries()) {
			setStatus(`running ${index + 1}/${scenarios.length}`);
			try {
				const produced = await scenario();
				for (const item of produced) addResult(item);
			} catch (error) {
				const note = error instanceof TerminalGatewayError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
				log(`scenario ${index + 1} failed: ${note}`);
				addResult({ scenario: `scenario-${index + 1}`, renderer: "?", ok: false, metrics: {}, note });
			}
		}
		setStatus("done");
		log(`done: ${results.filter(item => item.ok).length}/${results.length} ok`);
		return { environment, results: [...results] };
	} finally {
		running = false;
	}
}

function addResult(result: ScenarioResult): void {
	results.push(result);
	log(`${result.ok ? "ok  " : "FAIL"} ${result.scenario} [${result.renderer}] ${JSON.stringify(result.metrics)}${result.note ? ` — ${result.note}` : ""}`);
	const row = document.createElement("tr");
	row.innerHTML = `<td>${result.scenario}</td><td>${result.renderer}</td><td>${result.ok ? "ok" : "fail"}</td><td><code>${JSON.stringify(result.metrics)}</code></td><td>${result.note ?? ""}</td>`;
	resultsNode.append(row);
}

async function runSingle(name: string): Promise<unknown> {
	const catalog = await gatewayTerminal.listProfiles();
	const profileId = catalog.profiles.find(candidate => candidate.id === "git-bash")?.id ?? catalog.profiles.find(candidate => candidate.id === catalog.defaultProfileId)?.id;
	defaultProfileId = profileId;
	switch (name) {
		case "smoke":
			return runSmoke("webgl", profileId);
		case "latency":
			return runLatency(catalog, profileId);
		case "throughput":
			return [...(await runGatewayThroughput("webgl", profileId)), ...(await runGatewayThroughput("dom", profileId))];
		case "synthetic":
			return [
				await runSynthetic("webgl", "synthetic-ansi-2mb", buildAnsiStream(2 * 1024 * 1024)),
				await runSynthetic("webgl", "synthetic-20mb", buildSyntheticLines(20 * 1024 * 1024)),
			];
		case "tui":
			return [await runTui("webgl", profileId, "vim"), await runTui("webgl", profileId, "less")];
		case "tui-matrix":
			return [
				await runTui("webgl", profileId, "vim"),
				await runTui("webgl", profileId, "less"),
				await runTui("webgl", profileId, "omp"),
				await runTui("webgl", profileId, "opencode"),
				await runTui("webgl", profileId, "wsl-top"),
			];
		case "atlas":
			return [await runScrollbackAtlas("webgl"), await runScrollbackAtlas("dom")];
		case "context-loss":
			return runContextLoss("webgl");
		case "resize":
			return runResizeStorm("webgl");
		case "reconnect":
			return runReconnect("webgl");
		case "multi":
			return [await runMultiPty(1, profileId), await runMultiPty(2, profileId), await runMultiPty(4, profileId), await runSyntheticMany(8)];
		case "background":
			return runBackgroundThrottle();
		case "gutter":
			return [await runGutterAndFocus("webgl"), await runGutterAndFocus("dom")];
		default:
			throw new Error(`unknown scenario: ${name}`);
	}
}

async function startSingle(name: string): Promise<boolean> {
	if (backgroundRun && !backgroundRun.done) throw new Error(`benchmark already running: ${backgroundRun.name}`);
	const state: BackgroundRun = { name, startedAt: Date.now(), done: false };
	backgroundRun = state;
	void runSingle(name)
		.then(result => {
			state.result = result;
			state.done = true;
			if (Array.isArray(result)) for (const item of result as ScenarioResult[]) addResult(item);
		})
		.catch(error => {
			state.error = error instanceof Error ? error.message : String(error);
			state.done = true;
		});
	return true;
}

(globalThis as typeof globalThis & { __termBench?: unknown }).__termBench = {
	runAll,
	run: runSingle,
	start: startSingle,
	get background() {
		return backgroundRun ? { name: backgroundRun.name, done: backgroundRun.done, elapsedMs: Date.now() - backgroundRun.startedAt, error: backgroundRun.error, result: backgroundRun.result } : null;
	},
	results,
	get environment() {
		return {
			dpr: window.devicePixelRatio,
			viewport: `${window.innerWidth}x${window.innerHeight}`,
			gpu: gpuInfo(),
			heapMb: heapUsedMb(),
		};
	},
};

document.querySelector("#run")?.addEventListener("click", () => {
	void runAll().catch(error => log(String(error)));
});
document.querySelector("#clear")?.addEventListener("click", async () => {
	const list = await gatewayTerminal.list();
	for (const terminal of list.terminals) await gatewayTerminal.remove(terminal.id).catch(() => {});
	log(`removed ${list.terminals.length} gateway terminals`);
});

const params = new URLSearchParams(location.search);
if (params.get("autorun") === "1") {
	setStatus("starting");
	void runAll().catch(error => log(String(error)));
}
log(`ready — gpu ${gpuInfo()} — dpr ${window.devicePixelRatio}`);
