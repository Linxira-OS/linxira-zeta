// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    PanelCancel: vi.fn(async () => {}),
    PanelConfig: vi.fn(async () => ({ blockid: "", sessionid: "", configoptions: [] as unknown[] })),
    PanelListSessions: vi.fn(
        async (): Promise<{ sessions: unknown[]; nextCursor?: string }> => ({ sessions: [], nextCursor: "" })
    ),
    PanelLoadSession: vi.fn(
        async (
            _sessionId: string
        ): Promise<{ sessionid: string; configoptions?: unknown; updates: unknown[] }> => ({
            sessionid: "",
            configoptions: [],
            updates: [],
        })
    ),
    PanelPendingPermissions: vi.fn(async () => [] as unknown[]),
    PanelPrompt: vi.fn(async (_text: string) => {}),
    PanelSetConfigOption: vi.fn(async (_configId: string, _value: string) => {}),
    PanelSetModel: vi.fn(async (_modelId: string) => {}),
    PanelStart: vi.fn(async (_cwd: string) => {}),
}));

const handlers = vi.hoisted(() => new Map<string, (event: { data?: unknown }) => void>());

vi.mock("@/app/store/services", () => ({ AgentService: mocks }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: ({
        eventType,
        handler,
    }: {
        eventType: string;
        handler: (event: { data?: unknown }) => void;
    }) => {
        handlers.set(eventType, handler);
        return () => handlers.delete(eventType);
    },
}));

import { AcpPanelChat } from "./useacpchat";

const CONFIG_OPTIONS = [
    {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "fake/basic",
        options: [
            { value: "fake/basic", name: "Fake Basic" },
            { value: "fake/advanced", name: "Fake Advanced" },
        ],
    },
    {
        id: "thinking",
        name: "Thinking",
        category: "thought_level",
        type: "select",
        currentValue: "off",
        options: [
            { value: "off", name: "Off" },
            { value: "high", name: "High" },
        ],
    },
];

async function beginChat(): Promise<AcpPanelChat> {
    AcpPanelChat.resetInstance();
    const chat = AcpPanelChat.getInstance();
    await chat.init();
    return chat;
}

describe("AcpPanelChat panel state", () => {
    beforeEach(() => {
        handlers.clear();
        mocks.PanelCancel.mockClear();
        mocks.PanelConfig.mockClear();
        mocks.PanelListSessions.mockClear();
        mocks.PanelLoadSession.mockClear();
        mocks.PanelPendingPermissions.mockClear();
        mocks.PanelPrompt.mockClear();
        mocks.PanelSetConfigOption.mockClear();
        mocks.PanelSetModel.mockClear();
        mocks.PanelStart.mockClear();
        mocks.PanelConfig.mockResolvedValue({
            blockid: "",
            sessionid: "panel-session",
            configoptions: CONFIG_OPTIONS,
        });
        mocks.PanelListSessions.mockResolvedValue({ sessions: [], nextCursor: "" });
        mocks.PanelLoadSession.mockResolvedValue({
            sessionid: "panel-session",
            configoptions: CONFIG_OPTIONS,
            updates: [],
        });
    });

    it("loads model and thinking state from PanelConfig", async () => {
        const chat = await beginChat();

        expect(chat.getConfigReady()).toBe(true);
        expect(chat.getConfig().sessionId).toBe("panel-session");
        expect(chat.getConfig().model?.currentValue).toBe("fake/basic");
        expect(chat.getConfig().thinking?.currentValue).toBe("off");
    });

    it("applies agent:config snapshots pushed after setup", async () => {
        const chat = await beginChat();
        const handler = handlers.get("agent:config");
        expect(handler).toBeTypeOf("function");

        handler?.({
            data: {
                sessionid: "panel-session",
                configoptions: [
                    {
                        id: "thinking",
                        name: "Thinking",
                        category: "thought_level",
                        type: "select",
                        currentValue: "high",
                        options: [
                            { value: "off", name: "Off" },
                            { value: "high", name: "High" },
                        ],
                    },
                ],
            },
        });

        expect(chat.getConfig().thinking?.currentValue).toBe("high");
        expect(chat.getConfig().model).toBeNull();
    });

    it("serializes effort changes through PanelSetConfigOption", async () => {
        const chat = await beginChat();

        await chat.setThinking("high");

        expect(mocks.PanelSetConfigOption).toHaveBeenCalledTimes(1);
        expect(mocks.PanelSetConfigOption).toHaveBeenCalledWith("thinking", "high");
    });

    it("serializes model changes through PanelSetModel", async () => {
        const chat = await beginChat();

        await chat.setModel("fake/advanced");

        expect(mocks.PanelSetModel).toHaveBeenCalledTimes(1);
        expect(mocks.PanelSetModel).toHaveBeenCalledWith("fake/advanced");
    });

    it("queues a prompt while a turn is active and dispatches it on idle", async () => {
        const chat = await beginChat();

        await chat.sendMessage({ parts: [{ type: "text", text: "first" }] });
        await chat.sendMessage({ parts: [{ type: "text", text: "second" }] });

        expect(mocks.PanelPrompt).toHaveBeenCalledTimes(1);
        expect(mocks.PanelPrompt).toHaveBeenNthCalledWith(1, "first");
        expect(chat.getQueuedPrompts().map((prompt) => prompt.text)).toEqual(["second"]);

        handlers.get("agent:status")?.({ data: { status: "idle" } });
        await vi.waitFor(() => expect(mocks.PanelPrompt).toHaveBeenCalledTimes(2));
        expect(mocks.PanelPrompt).toHaveBeenNthCalledWith(2, "second");
        expect(chat.getQueuedPrompts()).toHaveLength(0);
    });

    it("keeps queued prompts visible and lets the user remove one", async () => {
        const chat = await beginChat();

        await chat.sendMessage({ parts: [{ type: "text", text: "first" }] });
        await chat.sendMessage({ parts: [{ type: "text", text: "second" }] });
        chat.removeQueuedPrompt(chat.getQueuedPrompts()[0].id);

        expect(chat.getQueuedPrompts()).toHaveLength(0);
        expect(mocks.PanelPrompt).toHaveBeenCalledTimes(1);
    });

    it("clears the queue when the user stops the turn", async () => {
        const chat = await beginChat();

        await chat.sendMessage({ parts: [{ type: "text", text: "first" }] });
        await chat.sendMessage({ parts: [{ type: "text", text: "second" }] });
        chat.stop();

        expect(chat.getQueuedPrompts()).toHaveLength(0);
        expect(mocks.PanelCancel).toHaveBeenCalledTimes(1);
        expect(mocks.PanelPrompt).toHaveBeenCalledTimes(1);
    });

    it("lists and stores sessions for the picker", async () => {
        mocks.PanelListSessions.mockResolvedValue({
            sessions: [
                { sessionId: "older-session", title: "Older Chat", _meta: { messageCount: 4 } },
                { sessionId: "panel-session", title: "Current Chat" },
            ],
            nextCursor: "",
        });
        const chat = await beginChat();

        const sessions = await chat.listSessions();

        expect(sessions.map((session) => session.sessionId)).toEqual(["older-session", "panel-session"]);
        expect(chat.getSessions()).toEqual(sessions);
        expect(chat.getSessionsLoading()).toBe(false);
    });

    it("switches sessions with the replayed transcript and loaded config", async () => {
        mocks.PanelLoadSession.mockResolvedValue({
            sessionid: "older-session",
            configoptions: [
                {
                    id: "model",
                    name: "Model",
                    category: "model",
                    type: "select",
                    currentValue: "fake/advanced",
                    options: [{ value: "fake/advanced", name: "Fake Advanced" }],
                },
                {
                    id: "thinking",
                    name: "Thinking",
                    category: "thought_level",
                    type: "select",
                    currentValue: "high",
                    options: [{ value: "high", name: "High" }],
                },
            ],
            updates: [
                {
                    sessionUpdate: "user_message_chunk",
                    messageId: "user-1",
                    content: { type: "text", text: "old question" },
                },
                {
                    sessionUpdate: "agent_message_chunk",
                    messageId: "assistant-1",
                    content: { type: "text", text: "old answer" },
                },
            ],
        });
        const chat = await beginChat();

        await chat.switchSession("older-session");

        expect(mocks.PanelLoadSession).toHaveBeenCalledWith("older-session");
        expect(chat.getMessages().map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(chat.getConfig().sessionId).toBe("older-session");
        expect(chat.getConfig().model?.currentValue).toBe("fake/advanced");
        expect(chat.getConfig().thinking?.currentValue).toBe("high");
        expect(chat.getStatus()).toBe("ready");
        expect(chat.getSwitchingSessionId()).toBeNull();
    });

    it("reloads the current session transcript through load", async () => {
        mocks.PanelLoadSession.mockResolvedValue({
            sessionid: "panel-session",
            configoptions: CONFIG_OPTIONS,
            updates: [
                {
                    sessionUpdate: "user_message_chunk",
                    messageId: "user-1",
                    content: { type: "text", text: "restored question" },
                },
            ],
        });
        const chat = await beginChat();

        await chat.switchSession("panel-session");

        expect(mocks.PanelLoadSession).toHaveBeenCalledWith("panel-session");
        expect(chat.getMessages()).toHaveLength(1);
        expect(chat.getConfig().sessionId).toBe("panel-session");
    });

    it("keeps the panel state when a session cannot be loaded", async () => {
        mocks.PanelLoadSession.mockRejectedValue(new Error("ACP session not found: gone"));
        const chat = await beginChat();
        const previousMessages = chat.getMessages();
        const previousConfig = chat.getConfig();

        await expect(chat.switchSession("gone")).rejects.toThrow("ACP session not found");

        expect(chat.getMessages()).toBe(previousMessages);
        expect(chat.getConfig()).toBe(previousConfig);
        expect(chat.getStatus()).toBe("ready");
        expect(chat.getSessionError()?.message).toContain("ACP session not found");
        expect(chat.getSwitchingSessionId()).toBeNull();
    });

    it("refuses to switch sessions while a response is active", async () => {
        const chat = await beginChat();
        await chat.sendMessage({ parts: [{ type: "text", text: "first" }] });
        await chat.sendMessage({ parts: [{ type: "text", text: "second" }] });

        await expect(chat.switchSession("older-session")).rejects.toThrow("Stop the current response");
        expect(mocks.PanelLoadSession).not.toHaveBeenCalled();
        expect(chat.getQueuedPrompts().map((prompt) => prompt.text)).toEqual(["second"]);
    });
});
