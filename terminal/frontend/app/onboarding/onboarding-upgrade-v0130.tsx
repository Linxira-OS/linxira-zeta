// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_13_0_Content = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("upgrade.v0130.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0130.localAiTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0130.compatTitle")}</strong> - {t("upgrade.v0130.compatDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.geminiTitle")}</strong> - {t("upgrade.v0130.geminiDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.presetsTitle")}</strong> -{" "}
                                {t("upgrade.v0130.presetsDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.modesTitle")}</strong> - {t("upgrade.v0130.modesDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sliders"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0130.configTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0130.configUiTitle")}</strong> -{" "}
                                {t("upgrade.v0130.configUiDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.organizationTitle")}</strong> -{" "}
                                {t("upgrade.v0130.organizationDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.secretsTitle")}</strong> -{" "}
                                {t("upgrade.v0130.secretsDesc")}
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
                                <strong>{t("upgrade.v0130.pasteTitle")}</strong> - {t("upgrade.v0130.pasteDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.windowsPasteTitle")}</strong> -{" "}
                                {t("upgrade.v0130.windowsPasteDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0130.sshTitle")}</strong> - {t("upgrade.v0130.sshDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_13_0_Content.displayName = "UpgradeOnboardingModal_v0_13_0_Content";

export { UpgradeOnboardingModal_v0_13_0_Content };
