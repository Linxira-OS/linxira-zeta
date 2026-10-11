import { beforeEach, describe, expect, test, vi } from "bun:test";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { executeAcpBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/acp-builtins";
import type { SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";
import { setLanguage } from "@linxiraos/zeta/i18n/index";
import { Settings } from "@linxiraos/zeta/config/settings";
import { isDynamicToolEnabled, timeInjectInterval } from "@linxiraos/zeta/tools/dynamic-tools";

function createRuntime() {
	const settings = Settings.isolated();
	const sendCustomMessage = vi.fn(async () => false);
	const session = {
		settings,
		sendCustomMessage,
		getModeState: (mode: string) => (mode === "plan" ? { enabled: true } : undefined),
	} as unknown as AgentSession;
	const output = vi.fn();
	const runtime: SlashCommandRuntime = {
		session,
		sessionManager: { getSessionId: () => "s1", getCwd: () => process.cwd() } as never,
		settings,
		cwd: process.cwd(),
		output,
		refreshCommands: () => {},
		reloadPlugins: async () => {},
	};
	return { runtime, sendCustomMessage, output, settings };
}

describe("/tool slash command", () => {
	beforeEach(() => {
		setLanguage("zh");
	});

	test("enabling a dynamic tool persists the entry and injects the model notice", async () => {
		const h = createRuntime();
		const result = await executeAcpBuiltinSlashCommand("/tool time on", h.runtime);
		expect(result).toEqual({ consumed: true });
		expect(isDynamicToolEnabled(h.settings, "time")).toBe(true);
		expect(h.output).toHaveBeenCalledWith("time: on");
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(1);
		const [message, options] = h.sendCustomMessage.mock.calls[0] as unknown as [
			{ customType: string; content: string; display: boolean },
			{ deliverAs?: string },
		];
		expect(message.customType).toBe("dynamic-tool-notice");
		expect(message.display).toBe(false);
		expect(message.content).toBe("time已启用。获取当前准确日期时间（本地/UTC/epoch 毫秒，支持时区）。当前模式：plan");
		expect(options?.deliverAs).toBe("nextTurn");
	});

	test("disabling sends exactly one farewell notice and clears the entry", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/tool time on", h.runtime);
		await executeAcpBuiltinSlashCommand("/tool time off", h.runtime);
		expect(isDynamicToolEnabled(h.settings, "time")).toBe(false);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(2);
		const [offMessage] = h.sendCustomMessage.mock.calls[1] as unknown as [{ content: string }];
		expect(offMessage.content).toBe("time已关闭，后续不再提供相关能力。");
		expect(h.output).toHaveBeenLastCalledWith("time: off");
	});

	test("a repeated toggle changes nothing and injects no notice", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/tool time on", h.runtime);
		await executeAcpBuiltinSlashCommand("/tool time on", h.runtime);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(1);
	});

	test("an unknown tool name reports the registered categories", async () => {
		const h = createRuntime();
		const result = await executeAcpBuiltinSlashCommand("/tool bogus on", h.runtime);
		expect(result).toEqual({ consumed: true });
		expect(h.output).toHaveBeenCalledWith("未知动态工具：bogus。可用：time");
		expect(h.sendCustomMessage).not.toHaveBeenCalled();
	});

	test("a missing action prints usage", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/tool time", h.runtime);
		expect(h.output).toHaveBeenCalledWith("用法：/tool <name> on|off");
		expect(isDynamicToolEnabled(h.settings, "time")).toBe(false);
	});
});

describe("/time slash command", () => {
	beforeEach(() => {
		setLanguage("zh");
	});

	test("bare /time reports on/off state, interval, and policy without a notice", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/time", h.runtime);
		const status = String(h.output.mock.calls[0]?.[0]);
		expect(status).toContain("time: off");
		expect(status).toContain("50");
		expect(h.sendCustomMessage).not.toHaveBeenCalled();
	});

	test("on/off reuse the /tool toggle and inject the model notice", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/time on", h.runtime);
		expect(isDynamicToolEnabled(h.settings, "time")).toBe(true);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(1);
		const [message] = h.sendCustomMessage.mock.calls[0] as unknown as [{ customType: string; content: string }];
		expect(message.customType).toBe("dynamic-tool-notice");
		expect(message.content).toBe("time已启用。获取当前准确日期时间（本地/UTC/epoch 毫秒，支持时区）。当前模式：plan");

		await executeAcpBuiltinSlashCommand("/time off", h.runtime);
		expect(isDynamicToolEnabled(h.settings, "time")).toBe(false);
		expect(h.sendCustomMessage).toHaveBeenCalledTimes(2);
	});

	test("interval sets the persisted value and confirms it", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/time interval 5", h.runtime);
		expect(timeInjectInterval(h.settings)).toBe(5);
		const status = String(h.output.mock.calls[0]?.[0]);
		expect(status).toContain("time: off");
		expect(status).toContain("5");
	});

	test("interval rejects non-numeric and out-of-range values without writing", async () => {
		const h = createRuntime();
		for (const bad of ["abc", "0", "-3", "1.5"]) {
			h.output.mockClear();
			await executeAcpBuiltinSlashCommand(`/time interval ${bad}`, h.runtime);
			const status = String(h.output.mock.calls[0]?.[0]);
			expect(status).toContain(bad);
			expect(timeInjectInterval(h.settings)).toBe(50);
		}
	});

	test("a malformed invocation prints usage and writes nothing", async () => {
		const h = createRuntime();
		await executeAcpBuiltinSlashCommand("/time interval 2 3", h.runtime);
		expect(h.output).toHaveBeenCalledWith("用法：/time [status|on|off|interval <n>]");
		expect(timeInjectInterval(h.settings)).toBe(50);
	});
});
