// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_14_1_Content = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("upgrade.v0141.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0141.fixesTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0141.claudeTitle")}</strong> -{" "}
                                {t("upgrade.v0141.claudeDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0141.imeTitle")}</strong> - {t("upgrade.v0141.imeDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0141.resizeTitle")}</strong> - {t("upgrade.v0141.resizeDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0141.scrollbackTitle")}</strong> -{" "}
                                {t("upgrade.v0141.scrollbackPrefix")}
                                <code>wsh</code>
                                {t("upgrade.v0141.scrollbackSuffix")}
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
                        {t("upgrade.v0141.configTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0141.focusTitle")}</strong> -{" "}
                                {t("upgrade.v0141.focusPrefix")}
                                <code>app:focusfollowscursor</code>
                                {t("upgrade.v0141.focusSuffix")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0141.cursorTitle")}</strong> -{" "}
                                {t("upgrade.v0141.cursorDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0141.vimTitle")}</strong> - {t("upgrade.v0141.vimDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0141.providersTitle")}</strong> -{" "}
                                {t("upgrade.v0141.providersDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_1_Content.displayName = "UpgradeOnboardingModal_v0_14_1_Content";

export { UpgradeOnboardingModal_v0_14_1_Content };
