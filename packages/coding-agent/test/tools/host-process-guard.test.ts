import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@linxiraos/zeta/config/settings";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { BashTool } from "@linxiraos/zeta/tools/bash";
import {
	__resetHostProcessChainCacheForTests,
	checkHostProcessCommands,
	collectHostProcessChain,
	evaluateHostProcessCommand,
	type HostProcessChain,
	type HostProcessGuardKind,
} from "@linxiraos/zeta/tools/host-process-guard";

/**
 * Fixed chain: pid 1000 is the agent, 2000 the `bun` host, 3000 the shell the
 * bash tool spawns commands in, 4000 the terminal. Refusal text is asserted
 * verbatim, so the chain is injected rather than enumerated.
 */
const CHAIN: HostProcessChain = {
	pids: [1000, 2000, 3000, 4000],
	names: new Map([
		[1000, "bun.exe"],
		[2000, "bun.exe"],
		[3000, "pwsh.exe"],
		[4000, "wt.exe"],
	]),
	source: "native",
};

const ALTERNATIVE =
	'Safe alternative: record the PID when you spawn it — `$!`, a `Start-Process … -PassThru` handle, or the pid the job reports — and stop only that PID: `kill "$pid"`, `Stop-Process -Id $pid`, `taskkill /PID <pid>`.';

function makeSession(): ToolSession {
	return {
		cwd: os.tmpdir(),
		hasUI: false,
		skills: [],
		getSessionFile: () => null,
		settings: Settings.isolated({
			"async.enabled": false,
			"bash.autoBackground.enabled": false,
			"bash.autoBackground.thresholdMs": 60_000,
			"bashInterceptor.enabled": false,
		}),
		getClientBridge: () => undefined,
	} as unknown as ToolSession;
}

afterAll(() => {
	__resetHostProcessChainCacheForTests();
});

describe("host-process guard: unscoped kills", () => {
	it("refuses the recency sweep that killed the user's console", () => {
		const verdict = evaluateHostProcessCommand(
			"Get-Process cmd | Where-Object { $_.StartTime -gt (Get-Date).AddSeconds(-30) } | Stop-Process -Force",
			CHAIN,
		);

		expect(verdict.block).toBe(true);
		expect(verdict.message).toBe(
			[
				"Refused by the host-process guard: `Stop-Process -Force` — no explicit `-Id`/`-InputObject` target.",
				"Why: the pipeline feeding it decides what dies: the shell running this command, the terminal the user is typing in, this agent process and the user's unrelated processes all share those names, and there is no undo.",
				ALTERNATIVE,
			].join("\n"),
		);
		expect(verdict.refusal?.kind).toBe("sweep");
	});

	it("refuses name, pattern, group and pipeline sweeps", () => {
		const cases: Array<{ command: string; kind: HostProcessGuardKind; subject: string }> = [
			{
				command: "taskkill /F /IM powershell.exe",
				kind: "sweep",
				subject: "`taskkill /F /IM powershell.exe` — a `/IM` image-name match over every running process",
			},
			{
				command: "pkill -f bun",
				kind: "sweep",
				subject: "`pkill -f bun` — a name/pattern match over every running process",
			},
			{
				command: "kill -9 -1",
				kind: "sweep",
				subject: "`kill -9 -1` — a negative pid (`-1`), which addresses a whole process group",
			},
			{ command: "kill 0", kind: "sweep", subject: "`kill 0` — pid `0`, this command's whole process group" },
			{
				command: "killall node",
				kind: "sweep",
				subject: "`killall node` — a name match over every running process",
			},
			{
				command: "Stop-Process -Name powershell",
				kind: "sweep",
				subject: "`Stop-Process -Name powershell` — a name match over every running process",
			},
			{
				command: "Get-Process notepad | Stop-Process",
				kind: "sweep",
				subject: "`Stop-Process` — no explicit `-Id`/`-InputObject` target",
			},
			{ command: "taskkill /F", kind: "sweep", subject: "`taskkill /F` — no explicit `/PID` target" },
			{
				command: "wmic process where name='bun.exe' delete",
				kind: "sweep",
				subject: "`wmic process where name=bun.exe delete` — a `where` sweep over every running process",
			},
			{
				command: "ps -ef | grep bun | awk '{print $2}' | xargs kill",
				kind: "sweep",
				subject: "`kill` — no explicit target",
			},
			{
				command: "Get-CimInstance Win32_Process | Invoke-CimMethod -MethodName Terminate",
				kind: "sweep",
				subject: "`Invoke-CimMethod -MethodName Terminate` — a class-wide `Terminate` over every matched process",
			},
			{
				command: "bash -c 'Stop-Process -Force'",
				kind: "sweep",
				subject: "`Stop-Process -Force` — no explicit `-Id`/`-InputObject` target",
			},
		];

		for (const { command, kind, subject } of cases) {
			const verdict = evaluateHostProcessCommand(command, CHAIN);
			expect({ command, block: verdict.block }).toEqual({ command, block: true });
			expect({ command, kind: verdict.refusal?.kind }).toEqual({ command, kind });
			expect({ command, subject: verdict.refusal?.subject }).toEqual({ command, subject });
			expect(verdict.message).toContain(ALTERNATIVE);
		}
	});

	it("refuses a kill aimed at the agent's own process chain", () => {
		const verdict = evaluateHostProcessCommand("kill -9 3000", CHAIN);

		expect(verdict.block).toBe(true);
		expect(verdict.message).toBe(
			[
				"Refused by the host-process guard: `kill` targeting pid 3000 (`pwsh.exe`), part of this agent's own process chain.",
				"Why: that chain is 1000 bun.exe ← 2000 bun.exe ← 3000 pwsh.exe ← 4000 wt.exe — stopping a member of it kills the agent session or the terminal the user is working in, and their unsent work with it.",
				ALTERNATIVE,
			].join("\n"),
		);
		expect(verdict.refusal?.kind).toBe("host");
	});

	it("refuses the agent's own pid and pid 0 through taskkill as well", () => {
		expect(evaluateHostProcessCommand("taskkill /PID 2000 /F", CHAIN).refusal?.kind).toBe("host");
		expect(evaluateHostProcessCommand("Stop-Process -Id 1000 -Force", CHAIN).refusal?.kind).toBe("host");
		expect(evaluateHostProcessCommand("taskkill /PID 3000 /T /F", CHAIN).refusal?.kind).toBe("host");
	});

	it("refuses the shell this command runs in", () => {
		const ppid = evaluateHostProcessCommand("kill $PPID", CHAIN);
		const pid = evaluateHostProcessCommand("Stop-Process -Id $PID", CHAIN);

		expect(ppid.refusal?.kind).toBe("host");
		expect(ppid.refusal?.subject).toBe("`kill` targeting `$PPID`, the shell this command is running in");
		expect(pid.refusal?.kind).toBe("host");
		expect(pid.refusal?.subject).toBe("`Stop-Process` targeting `$PID`, the shell this command is running in");
	});

	it("refuses targets it cannot resolve to a pid", () => {
		const cases: Array<[string, string]> = [
			[
				"kill $(pgrep bun)",
				"`kill` targeting a command substitution, which the guard cannot resolve to a pid it can prove safe",
			],
			[
				"Stop-Process -Id (Get-Process cmd).Id",
				"`Stop-Process` targeting `-Id <expression>`, which the guard cannot resolve to a pid it can prove safe",
			],
			[
				"find . -name '*.pid' -exec kill -9 {} +",
				"`kill` targeting `{}`, which the guard cannot resolve to a pid it can prove safe",
			],
			[
				"(Get-Process notepad).Kill()",
				"`.Kill` targeting the handle built by the preceding expression, which the guard cannot resolve to a pid it can prove safe",
			],
		];

		for (const [command, subject] of cases) {
			const verdict = evaluateHostProcessCommand(command, CHAIN);
			expect({ command, kind: verdict.refusal?.kind }).toEqual({ command, kind: "unverifiable" });
			expect({ command, subject: verdict.refusal?.subject }).toEqual({ command, subject });
		}
	});
});

describe("host-process guard: kills scoped to a recorded spawn", () => {
	it("allows the spawn → capture → stop idiom", () => {
		const allowed = [
			"sleep 30 & kill $!",
			'pid=$!; sleep 1; kill -9 "$pid"',
			'nohup ./app > app.log 2>&1 & jobpid=$!; kill "$jobpid"',
			"$p = Start-Process notepad -PassThru; Stop-Process -Id $p.Id",
			"$p = Start-Process notepad -PassThru; Stop-Process -InputObject $p",
			"$p = Start-Process notepad -PassThru; $p.Kill()",
			"$p = Start-Process notepad -PassThru; Get-CimInstance Win32_Process | Invoke-CimMethod -MethodName Terminate -InputObject $p",
			"Stop-Process -Id (Start-Process notepad -PassThru).Id",
		];

		for (const command of allowed) {
			const verdict = evaluateHostProcessCommand(command, CHAIN);
			expect({ command, block: verdict.block, message: verdict.message }).toEqual({
				command,
				block: false,
				message: undefined,
			});
		}
	});

	it("allows an explicit numeric id outside the agent's chain", () => {
		const allowed = [
			"kill 4321",
			"kill -TERM 4321",
			"kill 4321 8765",
			"kill -9 4321 2>/dev/null",
			"taskkill /PID 4321 /T /F",
			"taskkill /PID 4321 8765 /F",
			"Stop-Process -Id 4321 -Force",
			"Stop-Process -Id 4321,8765",
			"wmic process where processid=4321 delete",
			"tskill 4321",
		];

		for (const command of allowed) {
			expect({ command, block: evaluateHostProcessCommand(command, CHAIN).block }).toEqual({
				command,
				block: false,
			});
		}
	});

	it("allows probes, listings and kill verbs mentioned in text", () => {
		const allowed = [
			"kill -0 4321",
			"kill -l",
			"echo kill -9 -1",
			"git log --grep=kill",
			"grep -rn pkill src/",
			"bun run check:ts",
		];

		for (const command of allowed) {
			expect({ command, block: evaluateHostProcessCommand(command, CHAIN).block }).toEqual({
				command,
				block: false,
			});
		}
	});

	it("leaves a container's process namespace to the container", () => {
		expect(evaluateHostProcessCommand("docker exec web kill -9 -1", CHAIN).block).toBe(false);
		expect(evaluateHostProcessCommand("kubectl exec pod -- kill -9 -1", CHAIN).block).toBe(false);
	});
});

describe("host-process guard: process-chain collection", () => {
	it("collects the agent process and its ancestors", async () => {
		__resetHostProcessChainCacheForTests();
		const chain = await collectHostProcessChain();

		expect(chain.pids[0]).toBe(process.pid);
		expect(chain.pids).toContain(process.ppid);
		expect(["native", "procfs", "ps", "cim", "self"]).toContain(chain.source);
		expect(chain.names.get(process.pid)?.length).toBeGreaterThan(0);
	});

	it("stays off when the user's environment disabled it", async () => {
		const incident =
			"Get-Process cmd | Where-Object { $_.StartTime -gt (Get-Date).AddSeconds(-30) } | Stop-Process -Force";

		expect((await checkHostProcessCommands([incident], { ZETA_HOST_PROCESS_GUARD: "off" })).block).toBe(false);
		expect((await checkHostProcessCommands([incident], { ZETA_HOST_PROCESS_GUARD: "OFF" })).block).toBe(false);
		expect((await checkHostProcessCommands([incident], {})).block).toBe(true);
	});
});

describe("host-process guard: bash tool wiring", () => {
	/** The shell is POSIX-ish on every platform this suite runs on, so the marker needs forward slashes. */
	const markerPath = path.join(os.tmpdir(), `zeta-host-guard-${process.pid}-${Date.now()}`);
	const markerArg = markerPath.replaceAll("\\", "/");

	it("refuses the sweep before the command runs", async () => {
		const tool = new BashTool(makeSession());
		const command = `pkill -f zeta-host-guard-no-such-process; touch ${markerArg}`;

		await expect(tool.execute("call-guard", { command })).rejects.toThrow("Refused by the host-process guard");

		expect(fs.existsSync(markerPath)).toBe(false);
	});

	it("refuses a kill of the shell's own parent", async () => {
		const tool = new BashTool(makeSession());

		await expect(tool.execute("call-guard-parent", { command: `kill -9 ${process.ppid}` })).rejects.toThrow(
			"part of this agent's own process chain",
		);
	});

	it("runs a kill scoped to a spawn recorded in the same command", async () => {
		const tool = new BashTool(makeSession());
		const result = await tool.execute("call-scoped", {
			command: `sleep 30 & p=$!; kill -9 "$p"; touch ${markerArg}; echo stopped`,
		});

		expect(result.isError).toBeFalsy();
		expect(result.content.find(part => part.type === "text")?.text).toContain("stopped");
		// The same marker the refusal test watches, so one bare `pkill` regression
		// cannot pass both halves.
		expect(fs.existsSync(markerPath)).toBe(true);
		fs.rmSync(markerPath, { force: true });
	});
});
