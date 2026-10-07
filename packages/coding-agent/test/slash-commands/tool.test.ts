import { beforeEach, describe, expect, test, vi } from "bun:test";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { executeAcpBuiltinSlashCommand } from "@linxiraos/zeta/slash-commands/acp-builtins";
import type { SlashCommandRuntime } from "@linxiraos/zeta/slash-commands/types";
import { setLanguage } from "@linxiraos/zeta/i18n/index";
import { Settings } from "@linxiraos/zeta/config/settings";
import { isDynamicToolEnabled } from "@linxiraos/zeta/tools/dynamic-tools";

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
