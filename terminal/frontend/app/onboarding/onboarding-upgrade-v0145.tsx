// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_14_5_Content = () => {
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("upgrade.v0145.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-list-tree"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0145.processTitle")}
                    </div>
                    <div className="text-secondary leading-5">{t("upgrade.v0145.processDesc")}</div>
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
                                <strong>{t("upgrade.v0145.quakeTitle")}</strong> &mdash;{" "}
                                {t("upgrade.v0145.quakeDescStart")}
                                <code>app:globalhotkey</code>
                                {t("upgrade.v0145.quakeDescEnd")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0145.dragTitle")}</strong>
                                {t("upgrade.v0145.dragDesc")}
                            </li>
                            <li>
                                {t("upgrade.v0145.splitPrefix")}
                                <code>app:showsplitbuttons</code>
                                {t("upgrade.v0145.splitSuffix")}
                            </li>
                            <li>{t("upgrade.v0145.toggleSidebar")}</li>
                            <li>{t("upgrade.v0145.renameTab")}</li>
                            <li>{t("upgrade.v0145.mouseNav")}</li>
                            <li>
                                <strong>{t("upgrade.common.bugfixTag")}</strong> {t("upgrade.v0145.fixConfig")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_5_Content.displayName = "UpgradeOnboardingModal_v0_14_5_Content";

export { UpgradeOnboardingModal_v0_14_5_Content };
