/**
 * Embedded terminal gateway contract (spec §15): session create/list/delete
 * with the live cap of 4, the 64KB replay ring, one-time connect tickets,
 * the WS upgrade auth gate (loopback pass / cross-site reject / ticket for
 * remote), resize validation, exit retention, and zetaide injection
 * command building. The PTY backend is faked, so no real shell spawns.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshDirsFromEnv } from "@linxiraos/pi-utils";
import {
	DEFAULT_TERMINAL_INSTANCE,
	MAX_LIVE_TERMINALS,
	RETAINED_EXITED_TERMINALS,
	TerminalRingBuffer,
	buildZetaIdeCommand,
	controlFrame,
	handleTerminalCreate,
	handleTerminalDelete,
	handleTerminalEnsure,
	handleTerminalList,
	handleTerminalResize,
	handleTerminalTicket,
	handleTerminalWsUpgrade,
	isTerminalWsUpgradeRequest,
	parseFrame,
	resetPtyBackend,
	resetTerminalManagerForTests,
	resolveSessionProgram,
	sessionSlotKey,
	setPtyBackendForTests,
	terminalWebSocketHandler,
	shellSpawnArgs,
	type TerminalPtyFactory,
	type TerminalSpawnSpec,
	type TerminalWsData,
	type TerminalWsUpgradeServer,
} from "../../src/server/web-gateway/terminal";
import type { OpenProbeContext } from "../../src/utils/bin-discovery";
import type { ResolvedTerminal } from "../../src/server/web-gateway/open";

const ENV_KEYS = ["ZETA_CODING_AGENT_DIR"];
const savedEnv = new Map<string, string | undefined>();
const cleanups: Array<() => Promise<void>> = [];

/** Point the config dir at a fresh temp dir; optionally seed remote.token. */
async function setup(token?: string): Promise<string> {
	const agentDir = await mkdtemp(join(tmpdir(), "zeta-gw-terminal-"));
	cleanups.push(() => rm(agentDir, { recursive: true, force: true }));
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	process.env.ZETA_CODING_AGENT_DIR = agentDir;
	if (token) {
		await writeFile(join(agentDir, "web.yml"), `remote:\n  token: ${token}\n`, "utf8");
	}
	refreshDirsFromEnv();
	return agentDir;
}

afterEach(async () => {
	for (const key of ENV_KEYS) {
		const saved = savedEnv.get(key);
		if (saved === undefined) delete process.env[key];
		else process.env[key] = saved;
	}
	savedEnv.clear();
	refreshDirsFromEnv();
	await Promise.all(cleanups.splice(0).map(fn => fn()));
	resetTerminalManagerForTests();
	resetPtyBackend();
});

// --- fake PTY ---

interface FakePtyRecord {
	spec: TerminalSpawnSpec;
	written: string[];
	resized: Array<{ cols: number; rows: number }>;
	killed: boolean;
}

const fakePtys: FakePtyRecord[] = [];

function installFakePty(): void {
	fakePtys.length = 0; // fresh per test — records from earlier tests are stale
	const factory: TerminalPtyFactory = spec => {
		const record: FakePtyRecord = { spec, written: [], resized: [], killed: false };
		fakePtys.push(record);
		return {
			write: data => record.written.push(data),
			resize: (cols, rows) => record.resized.push({ cols, rows }),
			kill: () => {
				record.killed = true;
				spec.onExit(137);
			},
		};
	};
	setPtyBackendForTests(factory);
}

async function createTerminal(body: Record<string, unknown>): Promise<Response> {
	const req = new Request("http://127.0.0.1/api/terminal", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return handleTerminalCreate(req);
}

// --- ring buffer ---

describe("TerminalRingBuffer", () => {
	test("accumulates chunks and reports UTF-8 byte length", () => {
		const ring = new TerminalRingBuffer(1024);
		ring.push("hello ");
		ring.push("世界");
		expect(ring.byteLength).toBe(6 + 6);
		expect(ring.replay()).toBe("hello 世界");
	});

	test("drops oldest whole chunks on overflow, keeping recent bytes", () => {
		const ring = new TerminalRingBuffer(16);
		ring.push("aaaaaaaa"); // 8 bytes
		ring.push("bbbbbbbb"); // 8 bytes → 16, at budget
		ring.push("cccccccc"); // pushes out the first chunk
		expect(ring.replay()).toBe("bbbbbbbbcccccccc");
		expect(ring.byteLength).toBe(16);
	});

	test("a single oversized chunk is tail-truncated to the budget", () => {
		const ring = new TerminalRingBuffer(8);
		ring.push("abcdefghijklmnop");
		expect(ring.replay()).toBe("ijklmnop");
		expect(ring.byteLength).toBe(8);
	});
});

// --- control frames ---

describe("frame protocol", () => {
	test("control frames are 0x00-prefixed JSON and parse back", () => {
		const frame = controlFrame({ replayedBytes: 42 });
		expect(frame[0]).toBe(0);
		const parsed = parseFrame(frame);
		expect(parsed).toEqual({ control: { replayedBytes: 42 } });
	});

	test("raw frames parse as data", () => {
		const parsed = parseFrame(new Uint8Array([104, 105]));
		expect(parsed).toEqual({ data: new Uint8Array([104, 105]) });
	});
});

// --- shell argv ---

describe("shellSpawnArgs", () => {
	const base = { label: "shell", command: "shell" };
	test("pwsh and powershell get -NoLogo", () => {
		expect(shellSpawnArgs({ ...base, kind: "pwsh", args: [] })).toEqual(["-NoLogo"]);
		expect(shellSpawnArgs({ ...base, kind: "powershell", args: [] })).toEqual(["-NoLogo"]);
	});
	test("git-bash gets a login interactive shell", () => {
		expect(shellSpawnArgs({ ...base, kind: "git-bash", args: [] })).toEqual(["-l", "-i"]);
	});
	test("posix shells keep their resolved args", () => {
		expect(shellSpawnArgs({ ...base, kind: "shell", args: ["-Z"] })).toEqual(["-Z"]);
	});
});

// --- buildZetaIdeCommand ---

describe("buildZetaIdeCommand", () => {
	// ZETA_IDE_BINS is ["zetaide"] — one bin name per product, so the fixture
	// uses the canonical name (the retired hyphenated aliases are gone).
	const ctx = {
		platform: "linux" as NodeJS.Platform,
		env: { PATH: "/bin" },
		exists: (candidate: string) => candidate === "/bin/zetaide",
		now: () => 0,
	};

	test("builds file[:line[:col]] against a resolved zetaide binary", () => {
		// The resolved absolute PATH hit is used so injection works even when
		// the session shell's PATH differs from the server's.
		expect(buildZetaIdeCommand({ file: "src/a.ts" }, ctx)).toBe('/bin/zetaide "src/a.ts"');
		expect(buildZetaIdeCommand({ file: "src/a.ts", line: 10 }, ctx)).toBe('/bin/zetaide "src/a.ts:10"');
		expect(buildZetaIdeCommand({ file: "src/a.ts", line: 10, col: 4 }, ctx)).toBe('/bin/zetaide "src/a.ts:10:4"');
	});

	test("returns null when no zetaide binary exists (plain shell fallback)", () => {
		expect(buildZetaIdeCommand({ file: "src/a.ts" }, { ...ctx, exists: () => false })).toBeNull();
		expect(buildZetaIdeCommand({ file: "" }, ctx)).toBeNull();
	});
});

// --- session program (workbench first, shell fallback) ---

describe("resolveSessionProgram", () => {
	const probe = (overrides: Partial<OpenProbeContext> = {}): OpenProbeContext => ({
		platform: "linux" as NodeJS.Platform,
		env: { PATH: "/bin", SHELL: "/bin/zsh" },
		exists: (candidate: string) => candidate === "/bin/zsh" || candidate === "/bin/zetawork",
		now: () => 0,
		...overrides,
	});

	test("prefers the workbench when zetawork resolves", () => {
		const program = resolveSessionProgram(probe());
		expect(program).toEqual({
			kind: "workbench",
			label: "zetawork",
			command: "/bin/zetawork",
			args: [],
			fallbackReason: null,
		});
	});

	test("falls back to the platform shell and says why", () => {
		const program = resolveSessionProgram(probe({ exists: (candidate: string) => candidate === "/bin/zsh" }));
		expect(program?.kind).toBe("shell");
		expect(program?.command).toBe("/bin/zsh");
		expect(program?.fallbackReason).toBe("workbench-not-found");
	});

	test("probes the bare `zeta` workbench name behind zetawork", () => {
		// ZETAWORK_BINS is ["zetawork", "zeta"] — one bin name per product, so the
		// only fallback the discovery loop probes is the bare `zeta` launcher.
		const program = resolveSessionProgram(
			probe({ exists: (candidate: string) => candidate === "/bin/zeta" || candidate === "/bin/bash" }),
		);
		expect(program?.kind).toBe("workbench");
		expect(program?.command).toBe("/bin/zeta");
		expect(program?.label).toBe("zeta");
	});

	test("Windows npm shims (.cmd) are started through cmd.exe", () => {
		const program = resolveSessionProgram({
			platform: "win32",
			env: { PATH: "C:\\npm", ComSpec: "C:\\WINDOWS\\system32\\cmd.exe" },
			exists: (candidate: string) => candidate === "C:\\npm\\zetawork.cmd",
			now: () => 0,
		});
		// ConPTY cannot exec a script: spawn cmd.exe with `/c <shim>` (#148).
		expect(program).toEqual({
			kind: "workbench",
			label: "zetawork",
			command: "C:\\WINDOWS\\system32\\cmd.exe",
			args: ["/c", "C:\\npm\\zetawork.cmd"],
			fallbackReason: null,
		});
	});

	test("returns null when neither the workbench nor a shell exists", () => {
		expect(resolveSessionProgram(probe({ exists: () => false }))).toBeNull();
	});
});

// --- REST surface ---

describe("terminal REST", () => {
	test("create returns id/shell/ticket; list reflects it; delete removes it", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));

		const res = await createTerminal({ cwd });
		expect(res.status).toBe(200);
		const created = (await res.json()) as { id: string; shell: string; ticket: string; cwd: string };
		expect(created.id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
		expect(created.shell.length).toBeGreaterThan(0);
		expect(created.cwd).toBe(cwd);

		const list = await handleTerminalList();
		const listed = (await list.json()) as { terminals: Array<{ id: string }> };
		expect(listed.terminals.map(term => term.id)).toContain(created.id);

		const del = await handleTerminalDelete(created.id);
		expect(del.status).toBe(200);
		const after = await handleTerminalDelete(created.id);
		expect(after.status).toBe(404);
	});

	test("create rejects a missing or non-directory cwd with 400", async () => {
		await setup();
		installFakePty();
		const missing = await createTerminal({ cwd: join(tmpdir(), "zeta-term-does-not-exist-9347") });
		expect(missing.status).toBe(400);
		const file = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		const filePath = join(file, "plain.txt");
		await writeFile(filePath, "x");
		cleanups.push(() => rm(file, { recursive: true, force: true }));
		expect((await createTerminal({ cwd: filePath })).status).toBe(400);
	});

	test(`the ${MAX_LIVE_TERMINALS}th live session gets 429 with a hint`, async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const ids: string[] = [];
		for (let i = 0; i < MAX_LIVE_TERMINALS; i++) {
			const res = await createTerminal({ cwd });
			expect(res.status).toBe(200);
			ids.push(((await res.json()) as { id: string }).id);
		}
		const fifth = await createTerminal({ cwd });
		expect(fifth.status).toBe(429);
		const body = (await fifth.json()) as { error: string };
		expect(body.error).toContain(String(MAX_LIVE_TERMINALS));

		// Exiting a session frees a slot (kill → exit → retained, not live).
		await handleTerminalDelete(ids[0]);
		expect((await createTerminal({ cwd })).status).toBe(200);
	});

	test("resize validates bounds and 404s unknown sessions", async () => {
		await setup();
		installFakePty();
		const bad = await handleTerminalResize(
			new Request("http://127.0.0.1/api/terminal/x/resize", {
				method: "POST",
				body: JSON.stringify({ cols: 1, rows: 10 }),
			}),
			"x",
		);
		expect(bad.status).toBe(400);
		const unknown = await handleTerminalResize(
			new Request("http://127.0.0.1/api/terminal/unknown-id/resize", {
				method: "POST",
				body: JSON.stringify({ cols: 80, rows: 24 }),
			}),
			"unknown-id",
		);
		expect(unknown.status).toBe(404);

		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (await createTerminal({ cwd })).json()) as { id: string };
		const ok = await handleTerminalResize(
			new Request("http://127.0.0.1/api/terminal/x/resize", {
				method: "POST",
				body: JSON.stringify({ cols: 120, rows: 40 }),
			}),
			created.id,
		);
		expect(ok.status).toBe(200);
		expect(fakePtys[0].resized).toEqual([{ cols: 120, rows: 40 }]);
	});

	test("naturally exited sessions stay listed, capped at retention", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const ids: string[] = [];
		// Natural exits (the shell terminates), not DELETEs — DELETE drops the
		// session outright; retention exists so a crashed/exited session stays
		// listable and replayable.
		for (let i = 0; i < RETAINED_EXITED_TERMINALS + 5; i++) {
			const res = await createTerminal({ cwd });
			const created = (await res.json()) as { id: string };
			ids.push(created.id);
			fakePtys[i].spec.onExit(0);
		}
		const list = await handleTerminalList();
		const body = (await list.json()) as { terminals: Array<{ id: string; exited: boolean }> };
		expect(body.terminals.filter(term => term.exited).length).toBe(RETAINED_EXITED_TERMINALS);
		// The oldest five were pruned; the newest are retained.
		const retainedIds = new Set(body.terminals.map(term => term.id));
		expect(retainedIds.has(ids[0])).toBe(false);
		expect(retainedIds.has(ids[ids.length - 1])).toBe(true);
	});

	test("DELETE kills the PTY and drops the session entirely", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (await createTerminal({ cwd })).json()) as { id: string };
		await handleTerminalDelete(created.id);
		expect(fakePtys[0].killed).toBe(true);
		const body = (await (await handleTerminalList()).json()) as {
			terminals: Array<{ id: string }>;
		};
		expect(body.terminals.find(term => term.id === created.id)).toBeUndefined();
		// Ticket issuance for a dropped session 404s.
		expect(handleTerminalTicket(created.id).status).toBe(404);
	});
});

// --- connect tickets + WS upgrade ---

describe("terminal WS upgrade gate", () => {
	function upgradeRequest(pathname: string, headers: Record<string, string> = {}): Request {
		return new Request(`http://127.0.0.1${pathname}`, {
			headers: { upgrade: "websocket", connection: "Upgrade", ...headers },
		});
	}

	function fakeServer(handler: (data: TerminalWsData) => void): TerminalWsUpgradeServer {
		return {
			upgrade: (req: Request, options: { data: TerminalWsData }) => {
				handler(options.data);
				return true;
			},
		};
	}

	test("non-terminal routes fall through (null) and plain GETs are 400", async () => {
		await setup();
		const srv = fakeServer(() => {});
		expect(await handleTerminalWsUpgrade(upgradeRequest("/api/sessions"), srv, "127.0.0.1")).toBeNull();
		const notWs = await handleTerminalWsUpgrade(
			new Request("http://127.0.0.1/api/terminal/abcdefgh/ws"),
			srv,
			"127.0.0.1",
		);
		expect(notWs?.status).toBe(400);
	});

	test("loopback upgrades pass; cross-site Origin on loopback is rejected", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (await createTerminal({ cwd })).json()) as { id: string };

		const captured: { data: TerminalWsData | null } = { data: null };
		const srv = fakeServer(data => {
			captured.data = data;
		});
		const ok = await handleTerminalWsUpgrade(upgradeRequest(`/api/terminal/${created.id}/ws`), srv, "127.0.0.1");
		expect(ok).toBeNull();
		expect(captured.data).toEqual({ sessionId: created.id });

		const csrf = await handleTerminalWsUpgrade(
			upgradeRequest(`/api/terminal/${created.id}/ws`, { origin: "https://evil.example" }),
			srv,
			"127.0.0.1",
		);
		expect(csrf?.status).toBe(403);

		const unknown = await handleTerminalWsUpgrade(upgradeRequest("/api/terminal/zzzzzzzz/ws"), srv, "127.0.0.1");
		expect(unknown?.status).toBe(404);
	});

	test("non-loopback without a token or ticket is rejected (WS 403)", async () => {
		await setup(); // no remote.token configured
		installFakePty();
		// The REST-side 403 for non-loopback callers is covered by
		// access-gate.test.ts (webGatewayFetch gate); here only the WS gate.

		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (await createTerminal({ cwd })).json()) as { id: string };
		const srv = fakeServer(() => {});
		const denied = await handleTerminalWsUpgrade(
			upgradeRequest(`/api/terminal/${created.id}/ws`),
			srv,
			"192.168.1.5",
		);
		expect(denied?.status).toBe(403);
		// Wrong ticket: also denied.
		const badTicket = await handleTerminalWsUpgrade(
			upgradeRequest(`/api/terminal/${created.id}/ws?ticket=nope`),
			srv,
			"192.168.1.5",
		);
		expect(badTicket?.status).toBe(403);
	});

	test("a valid one-time ticket authenticates a remote upgrade exactly once", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (await createTerminal({ cwd })).json()) as { id: string; ticket: string };
		const srv = fakeServer(() => {});
		const first = await handleTerminalWsUpgrade(
			upgradeRequest(`/api/terminal/${created.id}/ws?ticket=${encodeURIComponent(created.ticket)}`),
			srv,
			"192.168.1.5",
		);
		expect(first).toBeNull();
		// One-time: second use is denied even for the same terminal.
		const second = await handleTerminalWsUpgrade(
			upgradeRequest(`/api/terminal/${created.id}/ws?ticket=${encodeURIComponent(created.ticket)}`),
			srv,
			"192.168.1.5",
		);
		expect(second?.status).toBe(403);
		// Fresh tickets come from the (token-gated) REST surface.
		const ticketRes = handleTerminalTicket(created.id);
		const { ticket } = (await ticketRes.json()) as { ticket: string };
		expect(typeof ticket).toBe("string");
		const third = await handleTerminalWsUpgrade(
			upgradeRequest(`/api/terminal/${created.id}/ws?ticket=${encodeURIComponent(ticket)}`),
			srv,
			"192.168.1.5",
		);
		expect(third).toBeNull();
	});

	test("isTerminalWsUpgradeRequest matches only terminal WS paths", () => {
		expect(isTerminalWsUpgradeRequest(upgradeRequest("/api/terminal/abcdefgh/ws"))).toBe(true);
		expect(isTerminalWsUpgradeRequest(new Request("http://127.0.0.1/api/terminal/abcdefgh/ws"))).toBe(false);
		expect(isTerminalWsUpgradeRequest(upgradeRequest("/api/sessions"))).toBe(false);
	});
});

// --- attachment broadcast (handler-level, no real server) ---

describe("WS attachment frames", () => {
	test("open sends meta frame with replayedBytes then the replay payload", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (await createTerminal({ cwd })).json()) as { id: string };
		// Simulate PTY output before attach.
		fakePtys[0].spec.onData("boot output");
		const sent: Array<string | Uint8Array> = [];
		const closed: Array<number | undefined> = [];
		const ws = {
			send: (data: string | Uint8Array) => sent.push(data),
			close: (code?: number) => closed.push(code),
		};
		// Bun's WebSocketHandler type is wide (optional methods, lib-specific ws
		// shape); the test drives it through the narrow contract it must satisfy.
		interface WsStub {
			data: TerminalWsData;
			send: (data: string | Uint8Array) => unknown;
			close: (code?: number, reason?: string) => unknown;
		}
		const handler = terminalWebSocketHandler as {
			open: (ws: WsStub) => void;
			message: (ws: WsStub, message: string | Uint8Array) => void;
			close: (ws: WsStub) => void;
		};
		const stubFor = (sessionId: string): WsStub => ({ data: { sessionId }, send: ws.send, close: ws.close });
		// Bind the handlers to their contract shape.
		handler.open(stubFor(created.id));
		const frames = sent.map(data => parseFrame(typeof data === "string" ? new TextEncoder().encode(data) : data));
		expect(frames[0]).toEqual({ control: { replayedBytes: Buffer.byteLength("boot output") } });
		expect(frames[1]).toEqual({ data: new Uint8Array(Buffer.from("boot output")) });

		// Live data broadcast reaches the attached socket.
		fakePtys[0].spec.onData(" live");
		expect(new TextDecoder().decode(sent[2] as Uint8Array)).toBe(" live");

		// Inbound text is written to the PTY.
		handler.message(stubFor(created.id), "ls\r");
		expect(fakePtys[0].written).toContain("ls\r");

		// Unknown session is closed with 4004; exit closes with 1000.
		handler.open(stubFor("missing000"));
		expect(closed).toContain(4004);
		handler.close(stubFor(created.id));
		await handleTerminalDelete(created.id);
		expect(closed).toContain(1000);
	});
});

// --- P1 slots: ensure/reattach, workspace isolation, lifecycle signals ---

describe("terminal ensure (P1 slots)", () => {
	async function ensureTerminal(body: Record<string, unknown>): Promise<Response> {
		return handleTerminalEnsure(
			new Request("http://127.0.0.1/api/terminal/ensure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	}

	interface EnsureBody {
		id: string;
		instance: string;
		program: "workbench" | "shell";
		fallbackReason: string | null;
		reused: boolean;
		injected: boolean;
		ticket: string;
		cwd: string;
		error?: string;
		code?: string;
		limit?: number;
	}

	async function ensureOk(body: Record<string, unknown>): Promise<EnsureBody> {
		const res = await ensureTerminal(body);
		expect(res.status).toBe(200);
		return (await res.json()) as EnsureBody;
	}

	async function makeCwd(): Promise<string> {
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-slot-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		return cwd;
	}

	test("reopening a slot reattaches the same PTY and spawns nothing", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();

		const first = await ensureOk({ cwd, instanceId: "t1" });
		expect(first.reused).toBe(false);
		expect(first.instance).toBe("t1");
		expect(fakePtys.length).toBe(1);

		// Closing the dock and reopening it is just another ensure for the slot.
		const again = await ensureOk({ cwd, instanceId: "t1" });
		expect(again.id).toBe(first.id);
		expect(again.reused).toBe(true);
		expect(fakePtys.length).toBe(1);
		expect(fakePtys[0].killed).toBe(false);
	});

	test("a reused slot does not consume another live-terminal budget entry", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();
		const ids: string[] = [];
		for (let i = 0; i < MAX_LIVE_TERMINALS; i++) {
			ids.push((await ensureOk({ cwd, instanceId: `t${i + 1}` })).id);
		}
		// The budget is full; reattaching an existing slot must still work.
		const reused = await ensureOk({ cwd, instanceId: "t1" });
		expect(reused.id).toBe(ids[0]);
		expect(reused.reused).toBe(true);

		const fifth = await ensureTerminal({ cwd, instanceId: `t${MAX_LIVE_TERMINALS + 1}` });
		expect(fifth.status).toBe(429);
		const body = (await fifth.json()) as EnsureBody;
		expect(body.code).toBe("terminal_limit");
		expect(body.limit).toBe(MAX_LIVE_TERMINALS);
	});

	test("an explicit second slot spawns a second session in the same workspace", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();
		const first = await ensureOk({ cwd, instanceId: "t1" });
		const second = await ensureOk({ cwd, instanceId: "t2" });
		expect(second.id).not.toBe(first.id);
		expect(second.reused).toBe(false);
		expect(fakePtys.length).toBe(2);
		expect(fakePtys[1].spec.cwd).toBe(cwd);
		const list = (await (await handleTerminalList()).json()) as { terminals: Array<{ instance: string }> };
		expect(list.terminals.map(term => term.instance).sort()).toEqual(["t1", "t2"]);
	});

	test("two workspaces never share a session for the same slot id", async () => {
		await setup();
		installFakePty();
		const cwdA = await makeCwd();
		const cwdB = await makeCwd();
		const a = await ensureOk({ cwd: cwdA, instanceId: "t1" });
		const b = await ensureOk({ cwd: cwdB, instanceId: "t1" });
		expect(b.id).not.toBe(a.id);
		expect(fakePtys[0].spec.cwd).toBe(cwdA);
		expect(fakePtys[1].spec.cwd).toBe(cwdB);
		// Switching back reattaches workspace A's own session.
		expect((await ensureOk({ cwd: cwdA, instanceId: "t1" })).id).toBe(a.id);
	});

	test("the slot key is the absolute cwd plus the instance id", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();
		const created = await ensureOk({ cwd: join(cwd, ".") });
		const info = (await (await handleTerminalList()).json()) as { terminals: Array<{ id: string; cwd: string }> };
		expect(info.terminals[0].id).toBe(created.id);
		// "." resolves to the same absolute directory → the same slot.
		expect(created.id).toBe((await ensureOk({ cwd, instanceId: DEFAULT_TERMINAL_INSTANCE })).id);
		expect(sessionSlotKey(cwd, DEFAULT_TERMINAL_INSTANCE)).toBe(`${cwd}\u0000${DEFAULT_TERMINAL_INSTANCE}`);
	});

	test("a slot whose session exited spawns a fresh one", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();
		const first = await ensureOk({ cwd, instanceId: "t1" });
		fakePtys[0].spec.onExit(0);
		const next = await ensureOk({ cwd, instanceId: "t1" });
		expect(next.id).not.toBe(first.id);
		expect(next.reused).toBe(false);
		expect(fakePtys.length).toBe(2);
	});

	test("replace ends the slot's live session before spawning the new one", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();
		const first = await ensureOk({ cwd, instanceId: "t1" });
		const replacement = await ensureOk({ cwd, instanceId: "t1", replace: true });
		expect(replacement.id).not.toBe(first.id);
		expect(replacement.reused).toBe(false);
		expect(fakePtys[0].killed).toBe(true);
		expect(fakePtys.length).toBe(2);
		// The dead session is gone from the list, not merely exited.
		const list = (await (await handleTerminalList()).json()) as { terminals: Array<{ id: string }> };
		expect(list.terminals.map(term => term.id)).toEqual([replacement.id]);
	});

	test("cwd problems and bad instance ids carry a code the UI can translate", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();

		const missing = await ensureTerminal({ cwd: join(cwd, "gone"), instanceId: "t1" });
		expect(missing.status).toBe(400);
		expect(((await missing.json()) as EnsureBody).code).toBe("cwd_missing");

		const badInstance = await ensureTerminal({ cwd, instanceId: "t 1/../x" });
		expect(badInstance.status).toBe(400);
		expect(((await badInstance.json()) as EnsureBody).code).toBe("invalid_instance");
		expect(fakePtys.length).toBe(0);
	});

	test("ensure reports the workbench program and the shell fallback", async () => {
		await setup();
		installFakePty();
		const cwd = await makeCwd();
		// The PTY backend is faked but program resolution is real: whichever way
		// this machine resolves, the payload must state it.
		const body = await ensureOk({ cwd, instanceId: "t1" });
		expect(["workbench", "shell"]).toContain(body.program);
		expect(body.fallbackReason).toBe(body.program === "shell" ? "workbench-not-found" : null);
		expect(fakePtys[0].spec.application.length).toBeGreaterThan(0);
	});
});

describe("terminal session end signals", () => {
	function attach(sessionId: string, closed: Array<number | undefined>, sent: Array<string | Uint8Array>): unknown {
		const ws = {
			data: { sessionId } as TerminalWsData,
			send: (data: string | Uint8Array) => sent.push(data),
			close: (code?: number) => closed.push(code),
		};
		const handler = terminalWebSocketHandler as { open: (socket: unknown) => void };
		handler.open(ws);
		return ws;
	}

	test("DELETE emits session_ended/killed once and frees the slot", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));
		const created = (await (
			await handleTerminalEnsure(
				new Request("http://127.0.0.1/api/terminal/ensure", {
					method: "POST",
					body: JSON.stringify({ cwd, instanceId: "t1" }),
				}),
			)
		).json()) as { id: string };

		const sent: Array<string | Uint8Array> = [];
		const closed: Array<number | undefined> = [];
		attach(created.id, closed, sent);

		await handleTerminalDelete(created.id);
		const frames = sent.map(data => parseFrame(typeof data === "string" ? new TextEncoder().encode(data) : data));
		const control = frames.filter(frame => "control" in frame).map(frame => frame.control);
		expect(control).toContainEqual({ replayedBytes: 0 });
		expect(control).toContainEqual({ event: "session_ended", reason: "killed" });
		// One end signal only: the PTY's own exit callback must not also fire.
		expect(control.some(payload => payload.event === "exit")).toBe(false);
		expect(closed).toContain(1000);

		// The slot is free again: the next ensure spawns a new PTY.
		const next = (await (
			await handleTerminalEnsure(
				new Request("http://127.0.0.1/api/terminal/ensure", {
					method: "POST",
					body: JSON.stringify({ cwd, instanceId: "t1" }),
				}),
			)
		).json()) as { id: string; reused: boolean };
		expect(next.reused).toBe(false);
		expect(next.id).not.toBe(created.id);
	});

	test("a retained exited session ageing out emits session_ended/expired", async () => {
		await setup();
		installFakePty();
		const cwd = await mkdtemp(join(tmpdir(), "zeta-term-cwd-"));
		cleanups.push(() => rm(cwd, { recursive: true, force: true }));

		const ensure = async (instanceId: string): Promise<{ id: string }> =>
			(await (
				await handleTerminalEnsure(
					new Request("http://127.0.0.1/api/terminal/ensure", {
						method: "POST",
						body: JSON.stringify({ cwd, instanceId }),
					}),
				)
			).json()) as { id: string };

		// The oldest session exits and stays listable (retention); a client
		// reattaches to that retained record, which is exactly the window the
		// `expired` signal exists for.
		const oldest = (await ensure("t1")).id;
		fakePtys[0].spec.onExit(0);
		const sent: Array<string | Uint8Array> = [];
		const closed: Array<number | undefined> = [];
		attach(oldest, closed, sent);

		// Fill the retention set past its cap so the oldest record ages out.
		for (let i = 0; i < RETAINED_EXITED_TERMINALS; i++) {
			await ensure(`t${i + 2}`);
			fakePtys[i + 1].spec.onExit(0);
		}

		const control = sent
			.map(data => parseFrame(typeof data === "string" ? new TextEncoder().encode(data) : data))
			.filter(frame => "control" in frame)
			.map(frame => frame.control);
		expect(control).toContainEqual({ event: "session_ended", reason: "expired" });
		expect(closed).toContain(1000);
		const list = (await (await handleTerminalList()).json()) as { terminals: Array<{ id: string }> };
		expect(list.terminals.map(term => term.id)).not.toContain(oldest);
	});
});

// --- resolved shell typing sanity ---

describe("resolved terminal", () => {
	test("ResolvedTerminal carries command and args for spawn", () => {
		const shell: ResolvedTerminal = { kind: "pwsh", label: "PowerShell", command: "pwsh", args: [] };
		expect(shell.command).toBe("pwsh");
	});
});
