// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_14_2_Content = () => {
    const waveEnv = useWaveEnv();
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("upgrade.v0142.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-bell"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0142.badgesTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0142.rollupTitle")}</strong> -{" "}
                                {t("upgrade.v0142.rollupDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0142.bellTitle")}</strong> - {t("upgrade.v0142.bellPrefix")}
                                <code>term:bellindicator</code>
                                {t("upgrade.v0142.bellSuffix")}
                            </li>
                            <li>
                                <strong>
                                    <code>wsh badge</code>
                                </strong>{" "}
                                - {t("upgrade.v0142.wshBadgeDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0142.claudeTitle")}</strong> -{" "}
                                {t("upgrade.v0142.claudePrefix")}
                                <code>wsh badge</code>
                                {t("upgrade.v0142.claudeSuffix")}
                                <button
                                    onClick={() =>
                                        waveEnv.electron.openExternal("https://linxira-os.github.io/zh/docs/")
                                    }
                                    className="text-accent text-sm font-normal cursor-pointer hover:underline"
                                >
                                    {t("upgrade.common.seeDocs")}
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-folder-open"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.common.otherTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>[v0.14.3] </strong>
                                {t("upgrade.common.bugfixTag")} {t("upgrade.v0142.fixOnboarding")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0142.directoryTitle")}</strong> -{" "}
                                {t("upgrade.v0142.directoryDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0142.searchTitle")}</strong> -{" "}
                                {t("upgrade.v0142.searchDesc")}
                            </li>
                            <li>
                                {t("upgrade.common.bugfixTag")} {t("upgrade.v0142.fixNewWindow")}
                            </li>
                            <li>
                                {t("upgrade.common.bugfixTag")} {t("upgrade.v0142.fixSaveSession")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_2_Content.displayName = "UpgradeOnboardingModal_v0_14_2_Content";

export { UpgradeOnboardingModal_v0_14_2_Content };
