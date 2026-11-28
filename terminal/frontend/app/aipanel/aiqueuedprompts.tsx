// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";
import { memo } from "react";
import type { AcpQueuedPrompt } from "./useacpchat";

interface AIQueuedPromptsProps {
    prompts: AcpQueuedPrompt[];
    onRemove: (id: string) => void;
}

export const AIQueuedPrompts = memo(({ prompts, onRemove }: AIQueuedPromptsProps) => {
    const { t } = useI18n();
    if (prompts.length === 0) {
        return null;
    }

    return (
        <div className="border-t border-gray-600 bg-zinc-900/60 px-2 py-1">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">
                {t("ai.queuedPrompts", { count: prompts.length })}
            </div>
            <div className="mt-0.5 space-y-0.5">
                {prompts.map((prompt) => (
                    <div key={prompt.id} className="flex items-center gap-2 min-w-0">
                        <i className="fa fa-clock text-[10px] text-gray-500 flex-shrink-0"></i>
                        <span className="flex-1 truncate text-xs text-gray-300" title={prompt.text}>
                            {prompt.text || t("ai.queuedEmptyPrompt")}
                        </span>
                        <button
                            type="button"
                            onClick={() => onRemove(prompt.id)}
                            className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-white cursor-pointer"
                            title={t("ai.removeQueuedPrompt")}
                            aria-label={t("ai.removeQueuedPrompt")}
                        >
                            <i className="fa fa-times text-[10px]"></i>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
});

AIQueuedPrompts.displayName = "AIQueuedPrompts";
