import { beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { TempDir } from "@linxiraos/pi-utils";
import { Settings } from "@linxiraos/zeta/config/settings";
import { setLanguage } from "@linxiraos/zeta/i18n/index";
import type { ToolSession } from "@linxiraos/zeta/tools";
import { resolveBuiltinToolPlan } from "@linxiraos/zeta/tools";
import { cfgSessionDynamicTools } from "@linxiraos/zeta/tools/settings";
import {
	activeModeId,
	applyTimeSendTimestamp,
	buildDynamicToolNotice,
	buildTimeStatusLine,
	DYNAMIC_TOOL_CATEGORIES,
	isDynamicToolEnabled,
	isDynamicToolName,
	timeInjectInterval,
	toggleDynamicTool,
} from "@linxiraos/zeta/tools/dynamic-tools";
import { sendTimestampLine } from "@linxiraos/zeta/tools/time";

function toolSession(settings: Settings): ToolSession {
	return {
		cwd: process.cwd(),
		hasUI: false,
		settings,
		skipPythonPreflight: true,
	} as unknown as ToolSession;
}

function modeSession(enabled: Record<string, boolean>) {
	return {
		getModeState: (mode: string) => (enabled[mode] ? { enabled: true } : undefined),
	};
}

beforeAll(() => {
	setLanguage("zh");
});

describe("dynamic tool categories", () => {
	test("time is the registered category", () => {
		expect(Object.keys(DYNAMIC_TOOL_CATEGORIES)).toEqual(["time"]);
		expect(isDynamicToolName("time")).toBe(true);
		expect(isDynamicToolName("read")).toBe(false);
	});
});

describe("toggleDynamicTool", () => {
	test("rejects malformed invocations with the usage line", () => {
		const settings = Settings.isolated();
		for (const args of ["", "time", "time maybe", "time on off", "on"]) {
			expect(toggleDynamicTool(settings, args)).toEqual({ error: "用法：/tool <name> on|off" });
		}
	});

	test("rejects an unregistered tool name and lists the categories", () => {
		const result = toggleDynamicTool(Settings.isolated(), "bogus on");
		expect("error" in result && result.error).toBe("未知动态工具：bogus。可用：time");
	});

	test("on enables, off disables, and repeated toggles report no change", () => {
		const settings = Settings.isolated();
		expect(toggleDynamicTool(settings, "time on")).toEqual({ name: "time", enabled: true, changed: true });
		expect(isDynamicToolEnabled(settings, "time")).toBe(true);
		expect(toggleDynamicTool(settings, "time on")).toEqual({ name: "time", enabled: true, changed: false });
		expect(toggleDynamicTool(settings, "time off")).toEqual({ name: "time", enabled: false, changed: true });
		expect(isDynamicToolEnabled(settings, "time")).toBe(false);
	});
});

describe("session.dynamicTools persistence", () => {
	test("round-trips a toggled entry through the global config file", async () => {
		const tempDir = TempDir.createSync("@zeta-dynamic-tools-");
		const agentDir = tempDir.join("agent");
		const cwd = tempDir.join("project");
		for (const dir of [agentDir, cwd]) fs.mkdirSync(dir, { recursive: true });
		try {
			const settings = await Settings.loadIsolated({ cwd, agentDir });
			toggleDynamicTool(settings, "time on");
			await settings.flush();
			expect(fs.existsSync(tempDir.join("agent", "config.yml"))).toBe(true);

			const reloaded = await Settings.loadIsolated({ cwd, agentDir });
			expect(cfgSessionDynamicTools.get(reloaded)).toEqual({ time: true });
			expect(isDynamicToolEnabled(reloaded, "time")).toBe(true);
		} finally {
			// SQLite and freshly flushed config handles finalize on GC; Windows cannot delete open files.
			Bun.gc(true);
			try {
				tempDir.removeSync();
			} catch {
				// A lingering settings handle on Windows keeps the dir locked; %TEMP% reclaims it.
			}
		}
	});
});

describe("builtin tool plan gating", () => {
	test("time stays registered even while injection is off (the model needs it to enable)", async () => {
		const settings = Settings.isolated();
		const session = toolSession(settings);
		expect((await resolveBuiltinToolPlan(session)).names).toContain("time");

		toggleDynamicTool(settings, "time on");
		expect((await resolveBuiltinToolPlan(session)).names).toContain("time");

		toggleDynamicTool(settings, "time off");
		expect((await resolveBuiltinToolPlan(session)).names).toContain("time");
	});

	test("an explicit tool list still includes time", async () => {
		const settings = Settings.isolated();
		const session = toolSession(settings);
		expect((await resolveBuiltinToolPlan(session, ["read", "time"])).names).toContain("time");
	});
});

describe("time injection interval", () => {
	test("defaults to 50 tool calls", () => {
		expect(timeInjectInterval(Settings.isolated())).toBe(50);
	});

	test("clamps a hand-edited config to an integer >= 1", () => {
		expect(timeInjectInterval(Settings.isolated({ "session.timeInjectEvery": 0 }))).toBe(1);
		expect(timeInjectInterval(Settings.isolated({ "session.timeInjectEvery": -5 }))).toBe(1);
		expect(timeInjectInterval(Settings.isolated({ "session.timeInjectEvery": 12.7 }))).toBe(12);
		expect(timeInjectInterval(Settings.isolated({ "session.timeInjectEvery": 7 }))).toBe(7);
	});

	test("the status line reports state, interval, and policy", () => {
		const off = buildTimeStatusLine(Settings.isolated());
		expect(off).toContain("time: off");
		expect(off).toContain("50");
		const settings = Settings.isolated({ "session.timeInjectEvery": 10 });
		toggleDynamicTool(settings, "time on");
		const on = buildTimeStatusLine(settings);
		expect(on).toContain("time: on");
		expect(on).toContain("10");
	});
});

describe("notices", () => {
	test("enable notice names the tool, capability, and active mode", () => {
		expect(buildDynamicToolNotice("time", true, "plan")).toBe(
			"time已启用。获取当前准确日期时间（本地/UTC/epoch 毫秒，支持时区）。当前模式：plan",
		);
	});

	test("enable notice falls back to 默认 without an active mode", () => {
		expect(buildDynamicToolNotice("time", true, undefined)).toContain("当前模式：默认");
	});

	test("disable notice is the one-line farewell", () => {
		expect(buildDynamicToolNotice("time", false, "vibe")).toBe("time已关闭，后续不再提供相关能力。");
	});

	test("activeModeId picks the first enabled mode", () => {
		expect(activeModeId(modeSession({ goal: true, vibe: true }))).toBe("goal");
		expect(activeModeId(modeSession({}))).toBeUndefined();
	});
});

describe("applyTimeSendTimestamp", () => {
	const now = new Date("2026-10-07T06:30:05.123Z");

	test("appends a send-time line to user text while time is enabled", () => {
		const settings = Settings.isolated();
		toggleDynamicTool(settings, "time on");
		const stamped = applyTimeSendTimestamp(settings, "继续修 bug", { now });
		expect(stamped).toBe(`继续修 bug\n${sendTimestampLine(now)}`);
	});

	test("leaves text untouched when disabled, synthetic, or agent-attributed", () => {
		const settings = Settings.isolated();
		expect(applyTimeSendTimestamp(settings, "hi", { now })).toBe("hi");
		toggleDynamicTool(settings, "time on");
		expect(applyTimeSendTimestamp(settings, "hi", { now, synthetic: true })).toBe("hi");
		expect(applyTimeSendTimestamp(settings, "hi", { now, attribution: "agent" })).toBe("hi");
	});
});
