import { cn, fireAndForget } from "@/util/util";
import { useI18n } from "../../i18n";
import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { acpChoiceName, acpConfigValueIsKnown, type AcpConfigOption } from "./acp-panel-config";
import { AISessionPicker } from "./aisessions";
import { AcpPanelChat } from "./useacpchat";
import { WaveAIModel } from "./waveai-model";

interface AcpConfigMenuProps {
    option: AcpConfigOption | null;
    label: string;
    title: string;
    emptyText: string;
    icon: string;
    currentName: string;
    onSelect: (value: string) => void;
}

const AcpConfigMenu = memo(({ option, label, title, emptyText, icon, currentName, onSelect }: AcpConfigMenuProps) => {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const close = () => setIsOpen(false);
        window.addEventListener("resize", close);
        return () => window.removeEventListener("resize", close);
    }, [isOpen]);

    if (!option) {
        return null;
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-zinc-700" : "bg-zinc-800/50 hover:bg-zinc-700"
                )}
                title={title}
            >
                <i className={cn("fa text-[10px]", icon)}></i>
                <span className="text-[11px]">{currentName}</span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 min-w-[200px]">
                        <div className="px-3 pt-2 pb-1 text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
                        <div className="max-h-80 overflow-y-auto">
                            {option.options.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-400">{emptyText}</div>
                            )}
                            {option.options.map((choice) => (
                                <button
                                    key={choice.value}
                                    onClick={() => {
                                        setIsOpen(false);
                                        onSelect(choice.value);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors",
                                        choice.value === option.currentValue
                                            ? "bg-zinc-700 text-white"
                                            : "text-gray-300 hover:bg-zinc-700"
                                    )}
                                >
                                    <i
                                        className={cn(
                                            "fa text-[10px] w-3",
                                            choice.value === option.currentValue ? "fa-check" : "fa-circle invisible"
                                        )}
                                    ></i>
                                    <span className="text-sm truncate">{choice.name}</span>
                                    {choice.description && choice.description !== choice.name && (
                                        <span className="ml-auto pl-3 text-[10px] text-gray-500 truncate">
                                            {choice.description}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

AcpConfigMenu.displayName = "AcpConfigMenu";

export const AIModeDropdown = memo(() => {
    const { t } = useI18n();
    const model = WaveAIModel.getInstance();
    const chat = AcpPanelChat.getInstance();
    const config = useSyncExternalStore(chat.subscribe, chat.getConfig, chat.getConfig);
    const configReady = useSyncExternalStore(chat.subscribe, chat.getConfigReady, chat.getConfigReady);

    const modelName = configReady ? acpChoiceName(config.model, t("ai.modelUnknown")) : t("ai.modelsLoading");
    const effortName = acpChoiceName(config.thinking, t("ai.effortUnknown"));

    const handleSelectModel = (selector: string) => {
        if (!acpConfigValueIsKnown(config.model, selector)) {
            return;
        }
        fireAndForget(() => chat.setModel(selector));
    };

    const handleSelectEffort = (value: string) => {
        if (!acpConfigValueIsKnown(config.thinking, value)) {
            return;
        }
        fireAndForget(() => chat.setThinking(value));
    };

    const handleNewChatClick = () => {
        model.clearChat();
    };

    const handleConfigureClick = () => {
        fireAndForget(async () => {
            await model.openWaveAIConfig();
        });
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            {config.model ? (
                <AcpConfigMenu
                    option={config.model}
                    label={t("ai.selectModel")}
                    title={t("ai.modelPickerTitle", { name: modelName })}
                    emptyText={t("ai.modelsEmpty")}
                    icon="fa-sparkles"
                    currentName={modelName}
                    onSelect={handleSelectModel}
                />
            ) : (
                <button
                    type="button"
                    disabled
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 rounded border border-gray-600/50 bg-zinc-800/50 cursor-default"
                    title={modelName}
                >
                    <i className="fa fa-sparkles text-[10px]"></i>
                    <span className="text-[11px]">{modelName}</span>
                </button>
            )}
            {config.thinking && (
                <AcpConfigMenu
                    option={config.thinking}
                    label={t("ai.selectEffort")}
                    title={t("ai.effortTitle", { name: effortName })}
                    emptyText={t("ai.effortUnavailable")}
                    icon="fa-brain"
                    currentName={effortName}
                    onSelect={handleSelectEffort}
                />
            )}
            <AISessionPicker />
            <button
                onClick={handleNewChatClick}
                className="flex items-center gap-1 px-1.5 py-1 text-xs text-gray-400 hover:text-white cursor-pointer transition-colors rounded hover:bg-zinc-700"
                title={t("ai.newChat")}
            >
                <i className="fa fa-plus text-[10px]"></i>
            </button>
            <button
                onClick={handleConfigureClick}
                className="flex items-center gap-1 px-1.5 py-1 text-xs text-gray-400 hover:text-white cursor-pointer transition-colors rounded hover:bg-zinc-700"
                title={t("ai.configureModels")}
            >
                <i className="fa fa-gear text-[10px]"></i>
            </button>
        </div>
    );
});

AIModeDropdown.displayName = "AIModeDropdown";
