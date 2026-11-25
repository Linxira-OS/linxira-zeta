// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useI18n } from "../../i18n";
import { cn } from "@/util/util";
import { useState } from "react";
import { WaveAIModel } from "./waveai-model";

interface TelemetryRequiredMessageProps {
    className?: string;
}

const TelemetryRequiredMessage = ({ className }: TelemetryRequiredMessageProps) => {
    const { t } = useI18n();
    const [isEnabling, setIsEnabling] = useState(false);

    const handleEnableTelemetry = async () => {
        setIsEnabling(true);
        try {
            await RpcApi.WaveAIEnableTelemetryCommand(TabRpcClient);
            setTimeout(() => {
                WaveAIModel.getInstance().focusInput();
            }, 100);
        } catch (error) {
            console.error("Failed to enable telemetry:", error);
            setIsEnabling(false);
        }
    };

    return (
        <div className={cn("flex flex-col h-full", className)}>
            <div className="flex-grow"></div>
            <div className="flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-6">
                    <div className="space-y-4">
                        <i className="fa fa-sparkles text-accent text-5xl"></i>
                        <h2 className="text-2xl font-semibold text-foreground">{t("ai.telemetryTitle")}</h2>
                        <p className="text-secondary leading-relaxed">
                            {t("ai.telemetryDesc")}
                        </p>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-500 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa fa-info-circle text-blue-400 text-lg mt-0.5"></i>
                            <div className="text-left">
                                <div className="text-blue-400 font-medium mb-1">{t("ai.telemetryKeepsFree")}</div>
                                <div className="text-secondary text-sm mb-3">
                                    <p className="mb-2">
                                        {t("ai.telemetryPrivacy")}
                                    </p>
                                    <p className="mb-2">
                                        {t("ai.telemetryAbuse")}
                                    </p>
                                    <p className="mb-2">
                                        {t("ai.telemetryNoFiles")}
                                    </p>
                                    <p>
                                        {t("ai.telemetryByok")}{" "}
                                        <a
                                            href="https://linxira-os.github.io/zh/docs/"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                                        >
                                            https://linxira-os.github.io/zh/docs/
                                        </a>
                                        .
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnableTelemetry}
                                    disabled={isEnabling}
                                    className="bg-accent/80 hover:bg-accent disabled:bg-accent/50 text-background px-4 py-2 rounded-lg font-medium cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {isEnabling ? t("ai.enabling") : t("ai.enableTelemetry")}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-secondary">
                        <a
                            href="https://linxira-os.github.io/zh/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                        >
                            {t("ai.privacyPolicy")}
                        </a>
                    </div>
                </div>
            </div>
            <div className="flex-grow-[2]"></div>
        </div>
    );
};

TelemetryRequiredMessage.displayName = "TelemetryRequiredMessage";

export { TelemetryRequiredMessage };
