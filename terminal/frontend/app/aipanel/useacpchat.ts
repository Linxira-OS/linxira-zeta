// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AgentService } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import type { ChatStatus } from "ai";
import { useEffect, useSyncExternalStore } from "react";
import {
    type UseChatSendMessageType,
    type UseChatSetMessagesType,
    type WaveUIMessage,
    type WaveUIMessagePart,
} from "./aitypes";

// Keep in sync with agentservice.PanelEventScope.
const PanelEventScope = "agent:panel";

type AcpSessionUpdate = {
    sessionUpdate?: string;
    content?: unknown;
    toolCallId?: string;
    title?: string;
    name?: string;
    kind?: string;
    status?: string;
};

type AcpToolState = {
    toolCallId: string;
    title: string;
    name: string;
    kind: string;
    status: string;
    approval?: "needs-approval" | "user-approved" | "user-denied";
};

type PendingPermission = {
    requestId: string;
    options: PermissionOption[];
};

type AcpTurn = {
    assistantId: string;
    text: string;
    reasoning: string;
    tools: Map<string, AcpToolState>;
    promptSent: boolean;
    lastStatus: string;
};

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

function isWaveMessagePart(value: unknown): value is WaveUIMessagePart {
    if (value == null || typeof value !== "object") {
        return false;
    }
    const record = value as { type?: unknown };
    return typeof record.type === "string";
}

function toError(value: unknown): Error {
    if (value instanceof Error) {
        return value;
    }
    return new Error(String(value));
}

function toolStatus(value: string | undefined): "pending" | "error" | "completed" {
    if (value === "completed") {
        return "completed";
    }
    if (value === "failed" || value === "error") {
        return "error";
    }
    return "pending";
}

function pickPermissionOption(options: PermissionOption[], prefix: "allow" | "reject"): string {
    const exact = prefix === "allow" ? "allow_once" : "reject_once";
    const fallback = prefix === "allow" ? "allow_always" : "reject_always";
    const matching = options.find((option) => option.kind === exact);
    if (matching) {
        return matching.optionId;
    }
    const fallbackMatch = options.find((option) => option.kind === fallback);
    if (fallbackMatch) {
        return fallbackMatch.optionId;
    }
    const anyMatch = options.find((option) => option.kind?.startsWith(prefix));
    if (anyMatch) {
        return anyMatch.optionId;
    }
    return prefix === "reject" ? "" : (options[0]?.optionId ?? "");
}

export class AcpPanelChat {
    private static instance: AcpPanelChat | null = null;

    private messages: WaveUIMessage[] = [];
    private status: ChatStatus = "ready";
    private error: Error | null = null;
    private listeners = new Set<() => void>();
    private unsubs: (() => void)[] = [];
    private subscribed = false;
    private startPromise: Promise<void> | null = null;
    private turn: AcpTurn | null = null;
    private pendingPermissions = new Map<string, PendingPermission>();

    static getInstance(): AcpPanelChat {
        if (!AcpPanelChat.instance) {
            AcpPanelChat.instance = new AcpPanelChat();
        }
        return AcpPanelChat.instance;
    }

    static resetInstance(): void {
        if (AcpPanelChat.instance) {
            AcpPanelChat.instance.dispose();
        }
        AcpPanelChat.instance = null;
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getMessages = (): WaveUIMessage[] => this.messages;

    getStatus = (): ChatStatus => this.status;

    getError = (): Error | null => this.error;

    init(): Promise<void> {
        this.subscribeEvents();
        return this.ensureStarted()
            .then(() => this.loadPendingPermissions())
            .catch((err) => {
                this.setError(toError(err));
                throw err;
            });
    }

    sendMessage = async (message?: Parameters<UseChatSendMessageType>[0]): Promise<void> => {
        if (this.status === "streaming" || this.status === "submitted") {
            return;
        }
        const candidate = message as { parts?: unknown; text?: unknown } | undefined;
        const rawParts = candidate?.parts;
        const parts: WaveUIMessagePart[] = Array.isArray(rawParts)
            ? rawParts.filter(isWaveMessagePart)
            : typeof candidate?.text === "string" && candidate.text.trim()
              ? [{ type: "text", text: candidate.text.trim() }]
              : [];
        if (parts.length === 0) {
            return;
        }
        const prompt = this.buildPrompt(parts);
        if (!prompt) {
            return;
        }

        const userMessage: WaveUIMessage = {
            id: crypto.randomUUID(),
            role: "user",
            parts,
        };
        const assistantId = crypto.randomUUID();
        const assistantMessage: WaveUIMessage = {
            id: assistantId,
            role: "assistant",
            parts: [],
        };
        this.messages = [...this.messages, userMessage, assistantMessage];
        this.error = null;
        this.setStatus("submitted");
        this.turn = {
            assistantId,
            text: "",
            reasoning: "",
            tools: new Map(),
            promptSent: false,
            lastStatus: "",
        };
        this.emit();

        try {
            await this.ensureStarted();
            await AgentService.PanelPrompt(prompt);
        } catch (err) {
            const error = toError(err);
            this.setError(error);
            this.setStatus("error");
            if (!this.turn?.text && !this.turn?.reasoning && this.turn?.tools.size === 0) {
                this.messages = this.messages.filter((item) => item.id !== assistantId);
            }
            this.turn = null;
            this.emit();
            return;
        }

        const turn = this.turn;
        if (!turn) {
            return;
        }
        turn.promptSent = true;
        if (turn.lastStatus === "idle" || turn.lastStatus === "stopped") {
            this.finishTurn();
            return;
        }
        if (turn.lastStatus === "error") {
            this.failTurn(new Error("AI panel session failed"));
            return;
        }
        this.setStatus("streaming");
    }

    setMessages: UseChatSetMessagesType = (messages) => {
        const next = typeof messages === "function" ? messages(this.messages) : messages;
        this.messages = Array.isArray(next) ? next : [];
        if (this.messages.length === 0) {
            this.turn = null;
        }
        this.emit();
    };

    stop = (): void => {
        if (!this.turn) {
            return;
        }
        this.turn = null;
        this.pendingPermissions.clear();
        this.setStatus("ready");
        void AgentService.PanelCancel().catch(() => {
            // The turn may already have completed; the status event is authoritative.
        });
        this.emit();
    };

    respondToToolApproval(toolCallId: string, approval: string): boolean {
        const pending = this.pendingPermissions.get(toolCallId);
        if (!pending) {
            return false;
        }
        const approve = approval === "user-approved";
        const optionId = approve
            ? pickPermissionOption(pending.options, "allow")
            : pickPermissionOption(pending.options, "reject");
        const tool = this.turn?.tools.get(toolCallId);
        if (tool) {
            tool.approval = approve ? "user-approved" : "user-denied";
            this.rebuildAssistant();
        }
        void AgentService.PanelRespondPermission(pending.requestId, optionId).catch((err) => {
            this.setError(toError(err));
        });
        return true;
    }

    private ensureStarted(): Promise<void> {
        if (!this.startPromise) {
            this.startPromise = AgentService.PanelStart("").catch((err) => {
                this.startPromise = null;
                throw err;
            });
        }
        return this.startPromise;
    }

    private subscribeEvents(): void {
        if (this.subscribed) {
            return;
        }
        this.subscribed = true;
        this.unsubs.push(
            waveEventSubscribeSingle({
                eventType: "agent:update",
                scope: PanelEventScope,
                handler: (event) => this.handleUpdate(event.data),
            }),
            waveEventSubscribeSingle({
                eventType: "agent:status",
                scope: PanelEventScope,
                handler: (event) => this.handleStatus(event.data),
            }),
            waveEventSubscribeSingle({
                eventType: "agent:permission",
                scope: PanelEventScope,
                handler: (event) => this.handlePermission(event.data),
            }),
            waveEventSubscribeSingle({
                eventType: "agent:permissiondone",
                scope: PanelEventScope,
                handler: (event) => this.handlePermissionDone(event.data),
            })
        );
    }

    private handleUpdate(data?: UpdateData): void {
        const update = data?.update as AcpSessionUpdate | undefined;
        const turn = this.turn;
        if (!update || !turn) {
            return;
        }
        switch (update.sessionUpdate) {
            case "agent_message_chunk": {
                const text = readTextContent(update.content);
                if (!text) {
                    return;
                }
                turn.text += text;
                this.rebuildAssistant();
                return;
            }
            case "agent_thought_chunk": {
                const text = readTextContent(update.content);
                if (!text) {
                    return;
                }
                turn.reasoning += text;
                this.rebuildAssistant();
                return;
            }
            case "tool_call":
            case "tool_call_update": {
                const toolCallId = update.toolCallId;
                if (!toolCallId) {
                    return;
                }
                const existing = turn.tools.get(toolCallId);
                const tool: AcpToolState = existing ?? {
                    toolCallId,
                    title: "",
                    name: "",
                    kind: "",
                    status: "pending",
                };
                if (update.title != null) tool.title = update.title;
                if (update.name != null) tool.name = update.name;
                if (update.kind != null) tool.kind = update.kind;
                if (update.status != null) tool.status = update.status;
                turn.tools.set(toolCallId, tool);
                this.rebuildAssistant();
                return;
            }
            default:
                return;
        }
    }

    private handleStatus(data?: StatusData): void {
        if (!data) {
            return;
        }
        const turn = this.turn;
        if (!turn) {
            if (data.status === "error" && data.error) {
                this.setError(new Error(data.error));
            }
            return;
        }
        turn.lastStatus = data.status;
        if (data.status === "waiting_permission") {
            if (turn.promptSent) {
                this.setStatus("streaming");
            }
            return;
        }
        if (data.status === "running") {
            if (turn.promptSent) {
                this.setStatus("streaming");
            }
            return;
        }
        if (data.status === "error") {
            if (turn.promptSent) {
                this.failTurn(new Error(data.error || "AI panel session failed"));
            }
            return;
        }
        if (data.status === "idle" || data.status === "stopped") {
            if (turn.promptSent) {
                this.finishTurn();
            }
        }
    }

    private handlePermission(data?: PermissionRequestData): void {
        if (!data) {
            return;
        }
        let turn = this.turn;
        if (!turn) {
            // A permission can outlive the panel component (or arrive after a
            // web reload). Restore a minimal assistant turn so the dialog is
            // actionable instead of leaving the agent blocked.
            const assistantId = crypto.randomUUID();
            const restored: AcpTurn = {
                assistantId,
                text: "",
                reasoning: "",
                tools: new Map(),
                promptSent: true,
                lastStatus: "waiting_permission",
            };
            this.messages = [...this.messages, { id: assistantId, role: "assistant", parts: [] }];
            this.turn = restored;
            turn = restored;
            this.setStatus("streaming");
        }
        const toolCallId = data.toolcall?.toolCallId || data.requestid;
        const existing = turn.tools.get(toolCallId);
        const tool: AcpToolState = existing ?? {
            toolCallId,
            title: data.toolcall?.title ?? "",
            name: data.toolcall?.name ?? "",
            kind: data.toolcall?.kind ?? "",
            status: "pending",
        };
        if (data.toolcall?.title) tool.title = data.toolcall.title;
        if (data.toolcall?.name) tool.name = data.toolcall.name;
        if (data.toolcall?.kind) tool.kind = data.toolcall.kind;
        tool.approval = "needs-approval";
        turn.tools.set(toolCallId, tool);
        this.pendingPermissions.set(toolCallId, {
            requestId: data.requestid,
            options: data.options ?? [],
        });
        this.setStatus("streaming");
        this.rebuildAssistant();
    }

    private handlePermissionDone(data?: PermissionResolutionData): void {
        const turn = this.turn;
        if (!data) {
            return;
        }
        for (const [toolCallId, pending] of this.pendingPermissions) {
            if (pending.requestId === data.requestid) {
                this.pendingPermissions.delete(toolCallId);
                const tool = turn?.tools.get(toolCallId);
                if (tool) {
                    tool.approval = data.cancelled ? "user-denied" : "user-approved";
                    this.rebuildAssistant();
                }
                break;
            }
        }
    }

    private async loadPendingPermissions(): Promise<void> {
        try {
            const pending = await AgentService.PanelPendingPermissions();
            for (const request of pending) {
                this.handlePermission(request);
            }
        } catch {
            // The panel still works; a live permission event will arrive with
            // the next turn.
        }
    }

    private buildPrompt(parts: WaveUIMessagePart[]): string {
        const text = parts
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("\n\n")
            .trim();
        const files = parts.filter(
            (part): part is WaveUIMessagePart & { type: "data-userfile" } => part.type === "data-userfile"
        );
        if (files.length === 0) {
            return text;
        }
        const lines = files.map((part) => {
            const file = part.data;
            const details = [file?.mimetype, file?.size != null ? `${file.size} bytes` : null]
                .filter(Boolean)
                .join(", ");
            return `- ${file?.filename ?? "file"}${details ? ` (${details})` : ""}`;
        });
        const note = `Attached files (reference only; contents are not uploaded):\n${lines.join("\n")}`;
        return text ? `${text}\n\n${note}` : note;
    }

    private rebuildAssistant(): void {
        const turn = this.turn;
        if (!turn) {
            return;
        }
        const parts: WaveUIMessagePart[] = [];
        if (turn.reasoning) {
            const reasoningPart: WaveUIMessagePart = { type: "reasoning", text: turn.reasoning };
            parts.push(reasoningPart);
        }
        if (turn.text) {
            const textPart: WaveUIMessagePart = { type: "text", text: turn.text };
            parts.push(textPart);
        }
        for (const tool of turn.tools.values()) {
            const description = [tool.title, tool.kind && tool.kind !== tool.title ? tool.kind : null]
                .filter(Boolean)
                .join(" · ");
            parts.push({
                type: "data-tooluse",
                data: {
                    toolcallid: tool.toolCallId,
                    toolname: tool.name || tool.kind || "tool",
                    tooldesc: description,
                    status: toolStatus(tool.status),
                    approval: tool.approval,
                },
            } as WaveUIMessagePart);
        }
        this.messages = this.messages.map((message) =>
            message.id === turn.assistantId ? { ...message, parts } : message
        );
        this.emit();
    }

    private finishTurn(): void {
        const turn = this.turn;
        this.turn = null;
        this.pendingPermissions.clear();
        if (turn && !turn.text && !turn.reasoning && turn.tools.size === 0) {
            this.messages = this.messages.filter((message) => message.id !== turn.assistantId);
        }
        this.setStatus("ready");
        this.emit();
    }

    private failTurn(error: Error): void {
        this.turn = null;
        this.pendingPermissions.clear();
        this.setError(error);
        this.setStatus("error");
        this.emit();
    }

    private setStatus(status: ChatStatus): void {
        this.status = status;
    }

    private setError(error: Error): void {
        this.error = error;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private dispose(): void {
        for (const unsub of this.unsubs) {
            unsub();
        }
        this.unsubs = [];
        this.subscribed = false;
        this.listeners.clear();
    }
}

export interface UseAcpChatOptions {
    onError?: (error: Error) => void;
}

export interface UseAcpChatResult {
    messages: WaveUIMessage[];
    sendMessage: UseChatSendMessageType;
    status: ChatStatus;
    setMessages: UseChatSetMessagesType;
    error: Error | null;
    stop: () => void;
}

export function useAcpChat(options?: UseAcpChatOptions): UseAcpChatResult {
    const chat = AcpPanelChat.getInstance();
    const messages = useSyncExternalStore(chat.subscribe, chat.getMessages, chat.getMessages);
    const status = useSyncExternalStore(chat.subscribe, chat.getStatus, chat.getStatus);
    const error = useSyncExternalStore(chat.subscribe, chat.getError, chat.getError);

    useEffect(() => {
        void chat.init().catch(() => {
            // init records the error; the panel renders it through the model.
        });
    }, [chat]);

    const onError = options?.onError;
    useEffect(() => {
        if (error && onError) {
            onError(error);
        }
    }, [error, onError]);

    return {
        messages,
        sendMessage: chat.sendMessage,
        status,
        setMessages: chat.setMessages,
        error,
        stop: chat.stop,
    };
}
