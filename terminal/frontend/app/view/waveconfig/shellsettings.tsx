// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import type { WaveConfigEnv } from "@/app/view/waveconfig/waveconfigenv";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { t, useI18n } from "../../../i18n";

const shellPresets = [
    { id: "nu", labelKey: "shell.nu" as const, path: "nu" },
    { id: "bash", labelKey: "shell.bash" as const, path: "/bin/bash" },
    { id: "zsh", labelKey: "shell.zsh" as const, path: "/bin/zsh" },
    { id: "fish", labelKey: "shell.fish" as const, path: "fish" },
    { id: "pwsh", labelKey: "shell.pwsh" as const, path: "pwsh" },
];

const ShellSettings = memo(({ model }: { model: WaveConfigViewModel }) => {
    const { t } = useI18n();
    const env = useWaveEnv<WaveConfigEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const configured = fullConfig?.settings?.["term:localshellpath"] ?? "";
    const [shellPath, setShellPath] = useState(configured);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setShellPath(configured);
    }, [configured]);

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await env.rpc.SetConfigCommand(TabRpcClient, {
                "term:localshellpath": shellPath.trim(),
            });
            setSaved(true);
            model.clearError();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-5 p-5 max-w-[720px] overflow-y-auto">
            <div>
                <div className="text-lg font-semibold">{t("shell.title")}</div>
                <div className="text-secondary text-sm mt-1">{t("settings.shellDescription")}</div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">{t("shell.default")}</div>
                <div className="flex flex-wrap gap-2">
                    {shellPresets.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                                setShellPath(preset.path);
                                setSaved(false);
                            }}
                            className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                                shellPath === preset.path
                                    ? "border-accent/70 bg-accent/15 text-primary"
                                    : "border-border hover:bg-hoverbg"
                            }`}
                        >
                            {t(preset.labelKey)}
                        </button>
                    ))}
                </div>
                <input
                    value={shellPath}
                    onChange={(event) => {
                        setShellPath(event.target.value);
                        setSaved(false);
                    }}
                    placeholder="nu"
                    className="w-full mt-1 px-3 py-2 rounded border border-border bg-background font-mono text-sm outline-none focus:border-accent/60"
                />
                <div className="text-xs text-muted-foreground">{t("settings.shellHint")}</div>
            </div>

            {error && (
                <div className="px-3 py-2 rounded border border-error/40 bg-error/10 text-error text-sm">{error}</div>
            )}

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={save}
                    disabled={saving || shellPath === configured}
                    className="px-4 py-1.5 rounded bg-accent/80 text-primary text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {saving ? t("settings.saving") : t("settings.save")}
                </button>
                {saved && <span className="text-sm text-success">{t("settings.shellSaved")}</span>}
            </div>

            <div className="border-t border-border pt-4 flex flex-col gap-2 text-sm">
                <div className="font-medium">{t("settings.installShell")}</div>
                <a
                    className="text-accent hover:underline"
                    href="https://www.nushell.sh/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Nushell — https://www.nushell.sh/
                </a>
                <a
                    className="text-accent hover:underline"
                    href="https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {t("settings.pwshGuide")}
                </a>
                <div className="text-muted-foreground text-xs mt-1">{t("shell.unsupported")}</div>
            </div>
        </div>
    );
});

ShellSettings.displayName = "ShellSettings";

export { ShellSettings };
