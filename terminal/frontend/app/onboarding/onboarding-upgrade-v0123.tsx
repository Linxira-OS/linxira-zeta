// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_12_3_Content = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("upgrade.v0123.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.common.aiTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0123.gptTitle")}</strong> - {t("upgrade.v0123.gptDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0123.thinkingTitle")}</strong> -{" "}
                                {t("upgrade.v0123.thinkingDesc")}
                            </li>
                            <li>{t("upgrade.v0123.pathMismatch")}</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.common.terminalTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0123.inputTitle")}</strong> - {t("upgrade.v0123.inputDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0123.imagePasteTitle")}</strong> -{" "}
                                {t("upgrade.v0123.imagePasteDesc")}
                            </li>
                            <li>{t("upgrade.v0123.shiftEnter")}</li>
                            <li>{t("upgrade.v0123.ime")}</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-key"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0123.secretTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0123.secretWidgetTitle")}</strong> -{" "}
                                {t("upgrade.v0123.secretWidgetDesc")}
                            </li>
                            <li>
                                {t("upgrade.v0123.secretCliPrefix")}
                                <span className="font-mono">wsh secret list/get/set</span>
                                {t("upgrade.v0123.secretCliSuffix")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_12_3_Content.displayName = "UpgradeOnboardingModal_v0_12_3_Content";

export { UpgradeOnboardingModal_v0_12_3_Content };
