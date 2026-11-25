// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useI18n } from "../../../i18n";
import { memo } from "react";

interface WaveAIVisualContentProps {
    model: WaveConfigViewModel;
}

export const WaveAIVisualContent = memo(({ model }: WaveAIVisualContentProps) => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col gap-4 p-6 h-full">
            <div className="text-lg font-semibold">{t("waveconfig.visualTitle")}</div>
            <div className="text-muted-foreground">{t("waveconfig.visualSoon")}</div>
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";