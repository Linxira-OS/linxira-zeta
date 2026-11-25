// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_14_4_Content = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("upgrade.v0144.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-table-columns"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0144.tabsTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0144.verticalTitle")}</strong> -{" "}
                                {t("upgrade.v0144.verticalDesc")}
                            </li>
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
                                <strong>{t("upgrade.v0144.xtermTitle")}</strong> - {t("upgrade.v0144.xtermDesc")}
                            </li>
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
                            <li>
                                <strong>{t("upgrade.v0144.macTitle")}</strong> - {t("upgrade.v0144.macDesc")}
                            </li>
                            <li>
                                <strong>
                                    <code>backgrounds.json</code>
                                </strong>{" "}
                                - {t("upgrade.v0144.backgroundsDescStart")}
                                <code>presets/bg.json</code>
                                {t("upgrade.v0144.backgroundsDescMid")}
                                <code>backgrounds.json</code>
                            </li>
                            <li>
                                <strong>{t("upgrade.v0144.configTitle")}</strong> - {t("upgrade.v0144.configDesc")}
                            </li>
                            <li>{t("upgrade.v0144.unsaved")}</li>
                            <li>{t("upgrade.v0144.preview")}</li>
                            <li>{t("upgrade.v0144.legacyAi")}</li>
                            <li>
                                {t("upgrade.common.bugfixTag")} {t("upgrade.v0144.fixFocus")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_4_Content.displayName = "UpgradeOnboardingModal_v0_14_4_Content";

export { UpgradeOnboardingModal_v0_14_4_Content };
