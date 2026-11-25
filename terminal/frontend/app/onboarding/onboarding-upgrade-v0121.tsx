// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_12_1_Content = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("upgrade.v0121.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0121.shellTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0121.osc7Title")}</strong> - {t("upgrade.v0121.osc7Desc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0121.contextTitle")}</strong> - {t("upgrade.v0121.contextDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0121.aiTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("upgrade.v0121.aiReasoning")}</li>
                            <li>{t("upgrade.v0121.aiTerminalContext")}</li>
                            <li>{t("upgrade.v0121.aiFeedback")}</li>
                            <li>{t("upgrade.v0121.aiCopy")}</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.common.otherTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("upgrade.v0121.mobileUa")}</li>
                            <li>{t("upgrade.v0121.headerPadding")}</li>
                            <li>{t("upgrade.v0121.syntaxHighlight")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_12_1_Content.displayName = "UpgradeOnboardingModal_v0_12_1_Content";

export { UpgradeOnboardingModal_v0_12_1_Content };
