// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { UseChatSendMessageType, UseChatSetMessagesType, WaveUIMessagePart } from "@/app/aipanel/aitypes";
import { FocusManager } from "@/app/store/focusManager";
import { atoms, createBlock, getOrefMetaKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { t } from "../../i18n";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { BuilderFocusManager } from "@/builder/store/builder-focusmanager";
import { base64ToArrayBuffer } from "@/util/util";
import * as jotai from "jotai";
import type React from "react";
import {
    createImagePreview,
    formatFileSizeError,
    isAcceptableFile,
    normalizeMimeType,
    resizeImage,
    validateFileSizeFromInfo,
} from "./ai-utils";
import type { AIPanelInputRef } from "./aipanelinput";
import { AcpPanelChat } from "./useacpchat";

export interface DroppedFile {
    id: string;
    file: File;
    name: string;
    type: string;
    size: number;
    previewUrl?: string;
}

export class WaveAIModel {
    private static instance: WaveAIModel | null = null;
    inputRef: React.RefObject<AIPanelInputRef> | null = null;
    scrollToBottomCallback: (() => void) | null = null;
    useChatSendMessage: UseChatSendMessageType | null = null;
    useChatSetMessages: UseChatSetMessagesType | null = null;
    useChatStop: (() => void) | null = null;
    orefContext: ORef;
    inBuilder: boolean = false;
    isAIStreaming = jotai.atom(false);

    widgetAccessAtom!: jotai.Atom<boolean>;
    droppedFiles: jotai.PrimitiveAtom<DroppedFile[]> = jotai.atom([]);
    chatId!: jotai.PrimitiveAtom<string>;
    errorMessage: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    containerWidth: jotai.PrimitiveAtom<number> = jotai.atom(0);
    codeBlockMaxWidth!: jotai.Atom<number>;
    inputAtom: jotai.PrimitiveAtom<string> = jotai.atom("");
    isLoadingChatAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    isChatEmptyAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(true);
    isWaveAIFocusedAtom!: jotai.Atom<boolean>;
    panelVisibleAtom!: jotai.Atom<boolean>;
    restoreBackupModalToolCallId: jotai.PrimitiveAtom<string | null> = jotai.atom(null) as jotai.PrimitiveAtom<
        string | null
    >;
    restoreBackupStatus: jotai.PrimitiveAtom<"idle" | "processing" | "success" | "error"> = jotai.atom("idle");
    restoreBackupError: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;

    private constructor(orefContext: ORef, inBuilder: boolean) {
        this.orefContext = orefContext;
        this.inBuilder = inBuilder;
        this.chatId = jotai.atom(null) as jotai.PrimitiveAtom<string>;

        this.widgetAccessAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            const widgetAccessMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:widgetcontext");
            const value = get(widgetAccessMetaAtom);
            return value ?? true;
        });

        this.codeBlockMaxWidth = jotai.atom((get) => {
            const width = get(this.containerWidth);
            return width > 0 ? width - 35 : 0;
        });

        this.isWaveAIFocusedAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return get(BuilderFocusManager.getInstance().focusType) === "waveai";
            }
            return get(FocusManager.getInstance().focusType) === "waveai";
        });

        this.panelVisibleAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            return get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
        });
    }

    getPanelVisibleAtom(): jotai.Atom<boolean> {
        return this.panelVisibleAtom;
    }

    static getInstance(): WaveAIModel {
        if (!WaveAIModel.instance) {
            let orefContext: ORef;
            if (isBuilderWindow()) {
                const builderId = globalStore.get(atoms.builderId);
                orefContext = WOS.makeORef("builder", builderId);
            } else {
                const tabId = globalStore.get(atoms.staticTabId);
                orefContext = WOS.makeORef("tab", tabId);
            }
            WaveAIModel.instance = new WaveAIModel(orefContext, isBuilderWindow());
            (window as any).WaveAIModel = WaveAIModel.instance;
        }
        return WaveAIModel.instance;
    }

    static resetInstance(): void {
        WaveAIModel.instance = null;
    }

    async addFile(file: File): Promise<DroppedFile> {
        // Resize images before storing
        const processedFile = await resizeImage(file);

        const droppedFile: DroppedFile = {
            id: crypto.randomUUID(),
            file: processedFile,
            name: processedFile.name,
            type: processedFile.type,
            size: processedFile.size,
        };

        // Create 128x128 preview data URL for images
        if (processedFile.type.startsWith("image/")) {
            const previewDataUrl = await createImagePreview(processedFile);
            if (previewDataUrl) {
                droppedFile.previewUrl = previewDataUrl;
            }
        }

        const currentFiles = globalStore.get(this.droppedFiles);
        globalStore.set(this.droppedFiles, [...currentFiles, droppedFile]);

        return droppedFile;
    }

    async addFileFromRemoteUri(draggedFile: DraggedFile): Promise<void> {
        if (draggedFile.isDir) {
            this.setError(t("ai.cannotAddDirectory"));
            return;
        }

        try {
            const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (fileInfo.notfound) {
                this.setError(t("ai.fileNotFound", { name: draggedFile.relName }));
                return;
            }
            if (fileInfo.isdir) {
                this.setError(t("ai.cannotAddDirectory"));
                return;
            }

            const mimeType = fileInfo.mimetype || "application/octet-stream";
            const fileSize = fileInfo.size || 0;
            const sizeError = validateFileSizeFromInfo(draggedFile.relName, fileSize, mimeType);
            if (sizeError) {
                this.setError(formatFileSizeError(sizeError));
                return;
            }

            const fileData = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (!fileData.data64) {
                this.setError(t("ai.failedReadFile", { name: draggedFile.relName }));
                return;
            }

            const buffer = base64ToArrayBuffer(fileData.data64);
            const file = new File([buffer], draggedFile.relName, { type: mimeType });
            if (!isAcceptableFile(file)) {
                this.setError(
                    t("ai.unsupportedType", { name: draggedFile.relName })
                );
                return;
            }

            await this.addFile(file);
        } catch (error) {
            console.error("Error handling FILE_ITEM drop:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.setError(t("ai.failedAddFile", { error: errorMsg }));
        }
    }

    removeFile(fileId: string) {
        const currentFiles = globalStore.get(this.droppedFiles);
        const updatedFiles = currentFiles.filter((f) => f.id !== fileId);
        globalStore.set(this.droppedFiles, updatedFiles);
    }

    clearFiles() {
        const currentFiles = globalStore.get(this.droppedFiles);

        // Cleanup all preview URLs
        currentFiles.forEach((file) => {
            if (file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
        });

        globalStore.set(this.droppedFiles, []);
    }

    clearChat() {
        this.useChatStop?.();
        this.clearFiles();
        this.clearError();
        globalStore.set(this.isChatEmptyAtom, true);
        const newChatId = crypto.randomUUID();
        globalStore.set(this.chatId, newChatId);

        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:chatid": newChatId },
        });

        this.useChatSetMessages?.([]);
    }

    setError(message: string) {
        globalStore.set(this.errorMessage, message);
    }

    clearError() {
        globalStore.set(this.errorMessage, null);
    }

    registerInputRef(ref: React.RefObject<AIPanelInputRef>) {
        this.inputRef = ref;
    }

    registerScrollToBottom(callback: () => void) {
        this.scrollToBottomCallback = callback;
    }

    registerUseChatData(
        sendMessage: UseChatSendMessageType,
        setMessages: UseChatSetMessagesType,
        stop: () => void
    ) {
        this.useChatSendMessage = sendMessage;
        this.useChatSetMessages = setMessages;
        this.useChatStop = stop;
    }

    scrollToBottom() {
        this.scrollToBottomCallback?.();
    }

    focusInput() {
        if (!this.inBuilder && !WorkspaceLayoutModel.getInstance().getAIPanelVisible()) {
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
        }
        if (this.inputRef?.current) {
            this.inputRef.current.focus();
        }
    }

    stopResponse() {
        this.useChatStop?.();
    }

    hasNonEmptyInput(): boolean {
        const input = globalStore.get(this.inputAtom);
        return input != null && input.trim().length > 0;
    }

    appendText(text: string, newLine?: boolean, opts?: { scrollToBottom?: boolean }) {
        const currentInput = globalStore.get(this.inputAtom);
        let newInput = currentInput;

        if (newInput.length > 0) {
            if (newLine) {
                if (!newInput.endsWith("\n")) {
                    newInput += "\n";
                }
            } else if (!newInput.endsWith(" ") && !newInput.endsWith("\n")) {
                newInput += " ";
            }
        }

        newInput += text;
        globalStore.set(this.inputAtom, newInput);

        if (opts?.scrollToBottom && this.inputRef?.current) {
            setTimeout(() => this.inputRef.current.scrollToBottom(), 10);
        }
    }

    setModel(model: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:model": model },
        });
    }

    setWidgetAccess(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:widgetcontext": enabled },
        });
    }

    async handleSubmit() {
        const input = globalStore.get(this.inputAtom);
        const droppedFiles = globalStore.get(this.droppedFiles);

        if (input.trim() === "/clear" || input.trim() === "/new") {
            this.clearChat();
            globalStore.set(this.inputAtom, "");
            return;
        }

        if (
            (!input.trim() && droppedFiles.length === 0) ||
            globalStore.get(this.isLoadingChatAtom)
        ) {
            return;
        }

        this.clearError();

        const uiMessageParts: WaveUIMessagePart[] = [];

        if (input.trim()) {
            uiMessageParts.push({ type: "text", text: input.trim() });
        }

        for (const droppedFile of droppedFiles) {
            const normalizedMimeType = normalizeMimeType(droppedFile.file);
            uiMessageParts.push({
                type: "data-userfile",
                data: {
                    filename: droppedFile.name,
                    mimetype: normalizedMimeType,
                    size: droppedFile.file.size,
                    previewurl: droppedFile.previewUrl,
                },
            });
        }

        await this.useChatSendMessage?.({ parts: uiMessageParts });

        globalStore.set(this.isChatEmptyAtom, false);
        globalStore.set(this.inputAtom, "");
        this.clearFiles();
    }

    async uiLoadInitialChat() {
        globalStore.set(this.isLoadingChatAtom, true);
        const messages = AcpPanelChat.getInstance().getMessages();
        this.useChatSetMessages?.(messages);
        globalStore.set(this.isChatEmptyAtom, messages.length === 0);
        globalStore.set(this.isLoadingChatAtom, false);
        setTimeout(() => {
            this.scrollToBottom();
        }, 100);
    }

    handleAIFeedback(feedback: "good" | "bad") {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "waveai:feedback",
                props: {
                    "waveai:feedback": feedback,
                },
            },
            { noresponse: true }
        );
    }

    requestWaveAIFocus() {
        if (this.inBuilder) {
            BuilderFocusManager.getInstance().setWaveAIFocused();
        } else {
            FocusManager.getInstance().requestWaveAIFocus();
        }
    }

    requestNodeFocus() {
        if (this.inBuilder) {
            BuilderFocusManager.getInstance().setAppFocused();
        } else {
            FocusManager.getInstance().requestNodeFocus();
        }
    }

    getChatId(): string {
        return globalStore.get(this.chatId);
    }

    toolUseSendApproval(toolcallid: string, approval: string) {
        AcpPanelChat.getInstance().respondToToolApproval(toolcallid, approval);
    }

    async openDiff(fileName: string, toolcallid: string) {
        const chatId = this.getChatId();

        if (!chatId || !fileName) {
            console.error("Missing chatId or fileName for opening diff", chatId, fileName);
            return;
        }

        const blockDef: BlockDef = {
            meta: {
                view: "aifilediff",
                file: fileName,
                "aifilediff:chatid": chatId,
                "aifilediff:toolcallid": toolcallid,
            },
        };
        await createBlock(blockDef, false, true);
    }

    async openWaveAIConfig() {
        const blockDef: BlockDef = {
            meta: {
                view: "waveconfig",
                file: "waveai.json",
            },
        };
        await createBlock(blockDef, false, true);
    }

    openRestoreBackupModal(toolcallid: string) {
        globalStore.set(this.restoreBackupModalToolCallId, toolcallid);
    }

    closeRestoreBackupModal() {
        globalStore.set(this.restoreBackupModalToolCallId, null);
        globalStore.set(this.restoreBackupStatus, "idle");
        globalStore.set(this.restoreBackupError, null);
    }

    async restoreBackup(toolcallid: string, backupFilePath: string, restoreToFileName: string) {
        globalStore.set(this.restoreBackupStatus, "processing");
        globalStore.set(this.restoreBackupError, null);
        try {
            await RpcApi.FileRestoreBackupCommand(TabRpcClient, {
                backupfilepath: backupFilePath,
                restoretofilename: restoreToFileName,
            });
            console.log("Backup restored successfully:", { toolcallid, backupFilePath, restoreToFileName });
            globalStore.set(this.restoreBackupStatus, "success");
        } catch (error) {
            console.error("Failed to restore backup:", error);
            const errorMsg = error?.message || String(error);
            globalStore.set(this.restoreBackupError, errorMsg);
            globalStore.set(this.restoreBackupStatus, "error");
        }
    }

    canCloseWaveAIPanel(): boolean {
        if (this.inBuilder) {
            return false;
        }
        return true;
    }

    closeWaveAIPanel() {
        if (this.inBuilder) {
            return;
        }
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
    }
}
