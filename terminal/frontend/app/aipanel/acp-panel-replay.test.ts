// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { replayAcpSessionUpdates } from "./acp-panel-replay";

describe("ACP session replay mapping", () => {
    it("rebuilds user, assistant, reasoning, and tool transcript entries", () => {
        const messages = replayAcpSessionUpdates([
            {
                sessionUpdate: "user_message_chunk",
                messageId: "user-1",
                content: { type: "text", text: "hello" },
            },
            {
                sessionUpdate: "agent_thought_chunk",
                messageId: "assistant-1",
                content: { type: "text", text: "thinking" },
            },
            {
                sessionUpdate: "agent_message_chunk",
                messageId: "assistant-1",
                content: { type: "text", text: "answer" },
            },
            {
                sessionUpdate: "tool_call",
                toolCallId: "tool-1",
                title: "Reading a file",
                kind: "read",
                status: "pending",
            },
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-1",
                status: "completed",
            },
            {
                sessionUpdate: "user_message_chunk",
                messageId: "user-2",
                content: { type: "text", text: "second" },
            },
            {
                sessionUpdate: "agent_message_chunk",
                messageId: "assistant-2",
                content: { type: "text", text: "second answer" },
            },
        ]);

        expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
        expect(messages[0].parts).toEqual([{ type: "text", text: "hello" }]);
        expect(messages[1].parts[0]).toEqual({ type: "reasoning", text: "thinking" });
        expect(messages[1].parts[1]).toEqual({ type: "text", text: "answer" });
        expect(messages[1].parts[2]).toMatchObject({
            type: "data-tooluse",
            data: {
                toolcallid: "tool-1",
                toolname: "read",
                tooldesc: "Reading a file · read",
                status: "completed",
            },
        });
        expect(messages[3].parts).toEqual([{ type: "text", text: "second answer" }]);
    });

    it("attaches tool updates to the existing part and creates a host when needed", () => {
        const messages = replayAcpSessionUpdates([
            {
                sessionUpdate: "tool_call",
                toolCallId: "tool-a",
                title: "Run",
                kind: "execute",
                status: "pending",
            },
            {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-a",
                title: "Run tests",
                status: "failed",
            },
            {
                sessionUpdate: "tool_call",
                toolCallId: "tool-b",
                name: "read_text_file",
                status: "completed",
            },
        ]);

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe("assistant");
        expect(messages[0].parts).toHaveLength(2);
        expect(messages[0].parts[0]).toMatchObject({
            data: { toolcallid: "tool-a", tooldesc: "Run tests · execute", status: "error" },
        });
        expect(messages[0].parts[1]).toMatchObject({
            data: { toolcallid: "tool-b", toolname: "read_text_file", status: "completed" },
        });
    });

    it("ignores unknown and malformed updates", () => {
        const messages = replayAcpSessionUpdates([
            null,
            "nope",
            { sessionUpdate: "available_commands_update" },
            { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "x" } },
            { sessionUpdate: "tool_call", toolCallId: "" },
        ]);

        expect(messages).toEqual([]);
    });
});
