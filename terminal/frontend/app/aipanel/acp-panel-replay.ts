// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveUIMessage, WaveUIMessagePart } from "./aitypes";

// Maps the session/update payloads captured during session/load into panel
// messages. The agent replays chunks for user/assistant messages and tool
// calls; grouping uses the ACP messageId, with tool parts attached to the
// assistant message that emitted them.

type ReplayUpdate = {
    sessionUpdate?: unknown;
    content?: unknown;
    messageId?: unknown;
    toolCallId?: unknown;
    title?: unknown;
    name?: unknown;
    kind?: unknown;
    status?: unknown;
};

function asUpdate(value: unknown): ReplayUpdate | null {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as ReplayUpdate;
}

function readTextContent(value: unknown): string {
    if (value == null || typeof value !== "object") {
        return "";
    }
    const record = value as { type?: unknown; text?: unknown };
    if (record.type !== "text" || typeof record.text !== "string") {
        return "";
    }
    return record.text;
}

function stringField(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function toolStatus(value: string): "pending" | "error" | "completed" {
    if (value === "completed") {
        return "completed";
    }
    if (value === "failed" || value === "error") {
        return "error";
    }
    return "pending";
}

function appendText(message: WaveUIMessage, text: string): void {
    const parts = message.parts as WaveUIMessagePart[];
    const last = parts[parts.length - 1];
    if (last?.type === "text") {
        last.text = `${last.text ?? ""}${text}`;
        return;
    }
    parts.push({ type: "text", text });
}

function appendReasoning(message: WaveUIMessage, text: string): void {
    const parts = message.parts as WaveUIMessagePart[];
    const last = parts[parts.length - 1];
    if (last?.type === "reasoning") {
        last.text = `${last.text ?? ""}${text}`;
        return;
    }
    parts.push({ type: "reasoning", text });
}

function toolPartDescription(title: string, kind: string): string {
    return [title, kind && kind !== title ? kind : ""].filter(Boolean).join(" · ");
}

export function replayAcpSessionUpdates(updates: unknown[]): WaveUIMessage[] {
    const messages: WaveUIMessage[] = [];
    const byId = new Map<string, WaveUIMessage>();
    const toolParts = new Map<
        string,
        { message: WaveUIMessage; index: number; title: string; kind: string; name: string }
    >();
    let lastUser: WaveUIMessage | null = null;
    let lastAssistant: WaveUIMessage | null = null;
    let generatedId = 0;

    const messageFor = (role: "user" | "assistant", messageId: string): WaveUIMessage => {
        const id = `${role}:${messageId || `replay-${++generatedId}`}`;
        const existing = byId.get(id);
        if (existing) {
            return existing;
        }
        const message: WaveUIMessage = { id, role, parts: [] };
        byId.set(id, message);
        messages.push(message);
        return message;
    };

    for (const value of updates) {
        const update = asUpdate(value);
        if (!update) {
            continue;
        }
        const kind = stringField(update.sessionUpdate);
        const messageId = stringField(update.messageId);
        const text = readTextContent(update.content);
        if (kind === "user_message_chunk") {
            if (!text) {
                continue;
            }
            const message = messageId ? messageFor("user", messageId) : (lastUser ?? messageFor("user", ""));
            appendText(message, text);
            lastUser = message;
            lastAssistant = null;
            continue;
        }
        if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
            if (!text) {
                continue;
            }
            let message: WaveUIMessage;
            if (messageId) {
                message = messageFor("assistant", messageId);
            } else if (lastAssistant) {
                message = lastAssistant;
            } else {
                message = messageFor("assistant", "");
            }
            if (kind === "agent_thought_chunk") {
                appendReasoning(message, text);
            } else {
                appendText(message, text);
            }
            lastAssistant = message;
            continue;
        }
        if (kind !== "tool_call" && kind !== "tool_call_update") {
            continue;
        }
        const toolCallId = stringField(update.toolCallId);
        if (!toolCallId) {
            continue;
        }
        const title = stringField(update.title);
        const name = stringField(update.name);
        const toolKind = stringField(update.kind);
        const status = toolStatus(stringField(update.status));
        const existing = toolParts.get(toolCallId);
        if (existing) {
            existing.title = title || existing.title;
            existing.kind = toolKind || existing.kind;
            existing.name = name || existing.name;
            const part = existing.message.parts[existing.index] as WaveUIMessagePart & { type: "data-tooluse" };
            part.data.toolname = existing.name || existing.kind || "tool";
            part.data.tooldesc = toolPartDescription(existing.title, existing.kind);
            part.data.status = status;
            continue;
        }
        const host = lastAssistant ?? messageFor("assistant", `tool:${toolCallId}`);
        const part = {
            type: "data-tooluse",
            data: {
                toolcallid: toolCallId,
                toolname: name || toolKind || "tool",
                tooldesc: toolPartDescription(title, toolKind),
                status,
            },
        } as WaveUIMessagePart;
        (host.parts as WaveUIMessagePart[]).push(part);
        toolParts.set(toolCallId, { message: host, index: host.parts.length - 1, title, kind: toolKind, name });
        lastAssistant = host;
    }

    return messages;
}
