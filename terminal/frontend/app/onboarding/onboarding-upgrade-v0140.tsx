// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useI18n } from "../../i18n";

const UpgradeOnboardingModal_v0_14_0_Content = () => {
    const waveEnv = useWaveEnv();
    const { t } = useI18n();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("upgrade.v0140.intro")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-sky-500 fa-sharp fa-solid fa-shield"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0140.durableTitle")}{" "}
                        <button
                            onClick={() => waveEnv.electron.openExternal("https://linxira-os.github.io/zh/docs/")}
                            className="text-accent text-sm font-normal cursor-pointer hover:underline"
                        >
                            {t("upgrade.common.seeDocs")}
                        </button>
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0140.protectTitle")}</strong> -{" "}
                                {t("upgrade.v0140.protectDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0140.statusTitle")}</strong> - {t("upgrade.v0140.statusDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0140.configTitle")}</strong> - {t("upgrade.v0140.configDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-network-wired"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("upgrade.v0140.monitorTitle")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>{t("upgrade.v0140.keepaliveTitle")}</strong> -{" "}
                                {t("upgrade.v0140.keepaliveDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0140.stalledTitle")}</strong> -{" "}
                                {t("upgrade.v0140.stalledDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
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
                                <strong>{t("upgrade.v0140.imageTitle")}</strong> - {t("upgrade.v0140.imageDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0140.stopTitle")}</strong> - {t("upgrade.v0140.stopDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0140.autoscroll")}</strong>
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
                                <strong>{t("upgrade.v0140.contextMenuTitle")}</strong> -{" "}
                                {t("upgrade.v0140.contextMenuDesc")}
                            </li>
                            <li>
                                <strong>{t("upgrade.v0140.oscTitle")}</strong> - {t("upgrade.v0140.oscDesc")}
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_0_Content.displayName = "UpgradeOnboardingModal_v0_14_0_Content";

export { UpgradeOnboardingModal_v0_14_0_Content };
