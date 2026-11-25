// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AgentService } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { cn, fireAndForget } from "@/util/util";
import { useI18n } from "../../i18n";
import { memo, useEffect, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

// Keep in sync with agentservice.PanelEventScope.
const PanelEventScope = "agent:panel";

interface CatalogModel {
    provider: string;
    id: string;
    selector: string;
    name: string;
    reasoning?: boolean;
}

const AIModeMenuItem = memo(({ config, isSelected, isDisabled, isPremiumDisabled, onClick, isFirst, isLast }: AIModeMenuItemProps) => {
    return (
        <button
            key={config.mode}
            onClick={onClick}
            disabled={isDisabled}
            className={cn(
                "w-full flex flex-col gap-0.5 px-3 transition-colors text-left",
                isFirst ? "pt-1 pb-0.5" : isLast ? "pt-0.5 pb-1" : "pt-0.5 pb-0.5",
                isDisabled ? "text-zinc-500" : "text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            )}
        >
            <div className="flex items-center gap-2 w-full">
                <i className={makeIconClass(config["display:icon"] || "sparkles", false)}></i>
                <span className={cn("text-sm", isSelected && "font-bold")}>
                    {getModeDisplayName(config)}
                    {isPremiumDisabled && t("ai.premium")}
                </span>
                {isSelected && <i className="fa fa-check ml-auto"></i>}
            </div>
            {config["display:description"] && (
                <div
                    className={cn("text-xs pl-5", isDisabled ? "text-gray-500" : "text-muted")}
                    style={{ whiteSpace: "pre-line" }}
                >
                    {config["display:description"]}
                </div>
            )}
        </button>
    );
});

AIModeMenuItem.displayName = "AIModeMenuItem";

interface ConfigSection {
    sectionName: string;
    configs: AIModeConfigWithMode[];
    isIncompatible?: boolean;
    noTelemetry?: boolean;
}

function computeCompatibleSections(
    currentMode: string,
    aiModeConfigs: Record<string, AIModeConfigType>,
    waveProviderConfigs: AIModeConfigWithMode[],
    otherProviderConfigs: AIModeConfigWithMode[]
): ConfigSection[] {
    const currentConfig = aiModeConfigs[currentMode];
    const allConfigs = [...waveProviderConfigs, ...otherProviderConfigs];

    if (!currentConfig) {
        return [{ sectionName: t("ai.sectionIncompatible"), configs: allConfigs, isIncompatible: true }];
    }

    const currentSwitchCompat = currentConfig["ai:switchcompat"] || [];
    const compatibleConfigs: AIModeConfigWithMode[] = [{ ...currentConfig, mode: currentMode }];
    const incompatibleConfigs: AIModeConfigWithMode[] = [];

    if (currentSwitchCompat.length === 0) {
        allConfigs.forEach((config) => {
            if (config.mode !== currentMode) {
                incompatibleConfigs.push(config);
            }
        });
    } else {
        allConfigs.forEach((config) => {
            if (config.mode === currentMode) return;

            const configSwitchCompat = config["ai:switchcompat"] || [];
            const hasMatch = currentSwitchCompat.some((currentTag: string) => configSwitchCompat.includes(currentTag));

            if (hasMatch) {
                compatibleConfigs.push(config);
            } else {
                incompatibleConfigs.push(config);
            }
        });
    }

    const sections: ConfigSection[] = [];
    const compatibleSectionName =
        compatibleConfigs.length === 1 ? t("ai.sectionCurrent") : t("ai.sectionCompatible");
    sections.push({ sectionName: compatibleSectionName, configs: compatibleConfigs });

    if (incompatibleConfigs.length > 0) {
        sections.push({ sectionName: t("ai.sectionIncompatible"), configs: incompatibleConfigs, isIncompatible: true });
    }
    return parsed.models.map(toCatalogModel).filter((model): model is CatalogModel => model != null);
}

function currentModelFromConfig(config: ConfigData | undefined): string | null {
    const options: unknown = config?.configoptions;
    if (!Array.isArray(options)) {
        return null;
    }
    if (otherProviderConfigs.length > 0) {
        sections.push({ sectionName: t("ai.sectionCustom"), configs: otherProviderConfigs });
    }
    return null;
}

interface AIModeDropdownProps {
    compatibilityMode?: boolean;
}

export const AIModeDropdown = memo(({ compatibilityMode = false }: AIModeDropdownProps) => {
    const { t } = useI18n();
    const model = WaveAIModel.getInstance();
    const [models, setModels] = useState<CatalogModel[]>([]);
    const [currentModel, setCurrentModel] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([AgentService.ListModels(), AgentService.PanelConfig()])
            .then(([raw, config]) => {
                if (cancelled) {
                    return;
                }
                setModels(parseCatalog(raw));
                setCurrentModel(currentModelFromConfig(config));
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return waveEventSubscribeSingle({
            eventType: "agent:config",
            scope: PanelEventScope,
            handler: (event) => {
                const value = currentModelFromConfig(event.data);
                if (value) {
                    setCurrentModel(value);
                }
            },
        });
    }, []);

    const displayModel = models.find((item) => item.selector === currentModel);
    const displayName = displayModel?.name ?? currentModel ?? t("ai.modelUnknown");

    const handleSelect = (selector: string) => {
        setCurrentModel(selector);
        setIsOpen(false);
        setError(null);
        fireAndForget(async () => {
            try {
                await AgentService.PanelStart("");
                await AgentService.PanelSetModel(selector);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : String(err));
            }
        });
    };

    const handleNewChatClick = () => {
        model.clearChat();
        setIsOpen(false);
    };

    const handleConfigureClick = () => {
        fireAndForget(async () => {
            await model.openWaveAIConfig();
            setIsOpen(false);
        });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-zinc-700" : "bg-zinc-800/50 hover:bg-zinc-700"
                )}
                title={t("ai.modelPickerTitle", { name: displayName })}
            >
                <i className="fa fa-sparkles text-[10px]"></i>
                <span className="text-[11px]">{displayName}</span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 min-w-[280px]">
                        <div className="px-3 pt-2 pb-1 text-[10px] text-gray-400 uppercase tracking-wide">
                            {t("ai.selectModel")}
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {loading && <div className="px-3 py-2 text-sm text-gray-400">{t("ai.modelsLoading")}</div>}
                            {!loading && error && <div className="px-3 py-2 text-sm text-red-300">{error}</div>}
                            {!loading && !error && models.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-400">{t("ai.modelsEmpty")}</div>
                            )}
                            {!loading &&
                                models.map((item) => (
                                    <button
                                        key={item.selector}
                                        onClick={() => handleSelect(item.selector)}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors",
                                            item.selector === currentModel
                                                ? "bg-zinc-700 text-white"
                                                : "text-gray-300 hover:bg-zinc-700"
                                        )}
                                    >
                                        <i
                                            className={cn(
                                                "fa text-[10px] w-3",
                                                item.selector === currentModel ? "fa-check" : "fa-circle invisible"
                                            )}
                                        ></i>
                                        <span className="text-sm truncate">{item.name}</span>
                                        {item.reasoning && (
                                            <i className="fa fa-brain text-[10px] text-gray-500" title={t("settings.modelsReasoning")}></i>
                                        )}
                                        <span className="ml-auto text-[10px] text-gray-500">{item.provider}</span>
                                    </button>
                                ))}
                        </div>
                        <div className="border-t border-gray-600 my-1" />
                        <button
                            onClick={handleNewChatClick}
                            className="w-full flex items-center gap-2 px-3 pt-1 pb-1 text-gray-300 hover:bg-zinc-700 cursor-pointer transition-colors text-left"
                        >
                            <i className="fa fa-plus"></i>
                            <span className="text-sm">{t("ai.newChat")}</span>
                        </button>
                        <button
                            onClick={handleConfigureClick}
                            className="w-full flex items-center gap-2 px-3 pt-1 pb-2 text-gray-300 hover:bg-zinc-700 cursor-pointer transition-colors text-left"
                        >
                            <i className="fa fa-gear"></i>
                            <span className="text-sm">{t("ai.configureModels")}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
});

AIModeDropdown.displayName = "AIModeDropdown";
