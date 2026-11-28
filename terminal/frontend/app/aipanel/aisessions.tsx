// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import { sessionDisplayTitle, sessionUpdatedLabel, shortSessionId } from "./acp-panel-sessions";
import { AcpPanelChat } from "./useacpchat";

export const AISessionPicker = memo(() => {
    const { t } = useI18n();
    const chat = AcpPanelChat.getInstance();
    const config = useSyncExternalStore(chat.subscribe, chat.getConfig, chat.getConfig);
    const sessions = useSyncExternalStore(chat.subscribe, chat.getSessions, chat.getSessions);
    const sessionsLoading = useSyncExternalStore(chat.subscribe, chat.getSessionsLoading, chat.getSessionsLoading);
    const sessionError = useSyncExternalStore(chat.subscribe, chat.getSessionError, chat.getSessionError);
    const switchingSessionId = useSyncExternalStore(
        chat.subscribe,
        chat.getSwitchingSessionId,
        chat.getSwitchingSessionId
    );
    const status = useSyncExternalStore(chat.subscribe, chat.getStatus, chat.getStatus);
    const queuedPrompts = useSyncExternalStore(chat.subscribe, chat.getQueuedPrompts, chat.getQueuedPrompts);
    const [isOpen, setIsOpen] = useState(false);

    const busy = status === "streaming" || status === "submitted" || queuedPrompts.length > 0;
    const currentId = config.sessionId;
    const current = sessions.find((session) => session.sessionId === currentId) ?? null;
    const currentTitle = current ? sessionDisplayTitle(current, t("ai.sessionUntitled")) : shortSessionId(currentId);
    const currentShort = shortSessionId(currentId);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        void chat.listSessions().catch(() => {
            // The picker renders the error from the shared session state.
        });
    }, [isOpen, chat]);

    const handleSelect = async (sessionId: string) => {
        if (busy || switchingSessionId != null) {
            return;
        }
        try {
            await chat.switchSession(sessionId);
            setIsOpen(false);
        } catch {
            // Keep the picker open; sessionError carries the reason.
        }
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-zinc-700" : "bg-zinc-800/50 hover:bg-zinc-700"
                )}
                title={currentId || t("ai.sessionUnknown")}
            >
                <i className="fa fa-clock-rotate-left text-[10px]"></i>
                <span className="max-w-[140px] truncate text-[11px]">{currentTitle || t("ai.sessionUnknown")}</span>
                {current?.title && currentShort && <span className="text-[9px] text-gray-500">{currentShort}</span>}
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 w-[340px]">
                        <div className="flex items-center justify-between px-3 pt-2 pb-1">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                                {t("ai.sessions")}
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    void chat.listSessions().catch(() => {});
                                }}
                                disabled={sessionsLoading}
                                className={cn(
                                    "w-5 h-5 flex items-center justify-center rounded transition-colors",
                                    sessionsLoading
                                        ? "text-gray-600"
                                        : "text-gray-400 hover:text-white hover:bg-zinc-700 cursor-pointer"
                                )}
                                title={t("ai.sessionRefresh")}
                                aria-label={t("ai.sessionRefresh")}
                            >
                                <i
                                    className={cn(
                                        "fa text-[10px]",
                                        sessionsLoading ? "fa-spinner fa-spin" : "fa-rotate"
                                    )}
                                ></i>
                            </button>
                        </div>
                        {busy && (
                            <div className="px-3 pb-1 text-[11px] text-amber-300">{t("ai.sessionSwitchBlocked")}</div>
                        )}
                        {sessionError && (
                            <div className="mx-2 mb-1 px-2 py-1 rounded bg-red-900/30 text-[11px] text-red-300 break-words">
                                {sessionError.message}
                            </div>
                        )}
                        <div className="max-h-80 overflow-y-auto pb-1">
                            {sessionsLoading && (
                                <div className="px-3 py-2 text-sm text-gray-400">{t("ai.sessionsLoading")}</div>
                            )}
                            {!sessionsLoading && sessions.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-400">{t("ai.sessionsEmpty")}</div>
                            )}
                            {sessions.map((session) => {
                                const isCurrent = session.sessionId === currentId;
                                const isSwitching = session.sessionId === switchingSessionId;
                                const updated = sessionUpdatedLabel(session.updatedAt);
                                return (
                                    <button
                                        key={session.sessionId}
                                        type="button"
                                        disabled={busy || switchingSessionId != null}
                                        onClick={() => {
                                            void handleSelect(session.sessionId);
                                        }}
                                        className={cn(
                                            "w-full px-3 py-1.5 text-left transition-colors",
                                            isCurrent ? "bg-zinc-700/70" : "hover:bg-zinc-700",
                                            busy || switchingSessionId != null
                                                ? "cursor-default opacity-70"
                                                : "cursor-pointer"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="flex-1 truncate text-sm text-gray-200">
                                                {sessionDisplayTitle(session, t("ai.sessionUntitled"))}
                                            </span>
                                            {isSwitching && (
                                                <i className="fa fa-spinner fa-spin text-[10px] text-accent"></i>
                                            )}
                                            {isCurrent && (
                                                <i
                                                    className="fa fa-check text-[10px] text-accent"
                                                    title={t("ai.sessionCurrent")}
                                                ></i>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                                            <span className="font-mono">{shortSessionId(session.sessionId)}</span>
                                            {updated && <span>{updated}</span>}
                                            {session.messageCount != null && (
                                                <span>
                                                    {t("ai.sessionMessageCount", { count: session.messageCount })}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

AISessionPicker.displayName = "AISessionPicker";
