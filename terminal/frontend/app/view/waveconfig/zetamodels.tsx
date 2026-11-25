// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AgentService } from "@/app/store/services";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { memo, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n";

interface CatalogModel {
    provider: string;
    id: string;
    selector: string;
    name: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    input?: string[];
    cost?: { input?: number; output?: number };
}

const ZetaModelsSettings = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    const { t } = useI18n();
    const [models, setModels] = useState<CatalogModel[]>([]);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        AgentService.ListModels()
            .then(raw => {
                if (cancelled) return;
                const parsed = JSON.parse(raw) as { models?: CatalogModel[] };
                setModels(Array.isArray(parsed.models) ? parsed.models : []);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return models;
        return models.filter(
            m =>
                m.name.toLowerCase().includes(needle) ||
                m.selector.toLowerCase().includes(needle) ||
                m.provider.toLowerCase().includes(needle)
        );
    }, [models, query]);

    const copy = async (selector: string) => {
        try {
            await navigator.clipboard.writeText(selector);
            setCopied(selector);
            setTimeout(() => setCopied(current => (current === selector ? null : current)), 1600);
        } catch {
            setCopied(null);
        }
    };

    return (
        <div className="flex flex-col gap-4 p-6 overflow-auto h-full">
            <div>
                <div className="text-lg font-semibold">{t("settings.zetaModels")}</div>
                <div className="text-sm text-muted mt-1">{t("settings.zetaModelsDesc")}</div>
            </div>
            <input
                className="w-full max-w-md px-3 py-2 rounded border border-border bg-background"
                placeholder={t("settings.modelsSearch")}
                value={query}
                onChange={event => setQuery(event.target.value)}
            />
            {loading && <div className="text-muted">{t("settings.modelsLoading")}</div>}
            {error && <div className="text-error">{error}</div>}
            {!loading && !error && filtered.length === 0 && (
                <div className="text-muted">{t("settings.modelsEmpty")}</div>
            )}
            <div className="flex flex-col divide-y divide-border border border-border rounded overflow-hidden">
                {filtered.map(model => (
                    <div key={model.selector} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="font-medium truncate">{model.name}</span>
                                <span className="text-xs text-muted shrink-0">{model.provider}</span>
                            </div>
                            <div className="text-xs text-muted mt-0.5 font-mono truncate">{model.selector}</div>
                            <div className="text-xs text-muted mt-1 flex gap-3">
                                {model.contextWindow ? (
                                    <span>{t("settings.modelsContext", { tokens: formatTokens(model.contextWindow) })}</span>
                                ) : null}
                                {model.maxTokens ? (
                                    <span>{t("settings.modelsOutput", { tokens: formatTokens(model.maxTokens) })}</span>
                                ) : null}
                                {model.cost?.input !== undefined && model.cost?.output !== undefined ? (
                                    <span>
                                        {t("settings.modelsCost", {
                                            input: formatCost(model.cost.input),
                                            output: formatCost(model.cost.output),
                                        })}
                                    </span>
                                ) : null}
                                {model.reasoning ? <span>{t("settings.modelsReasoning")}</span> : null}
                            </div>
                        </div>
                        <button
                            className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary/50"
                            onClick={() => copy(model.selector)}
                        >
                            {copied === model.selector ? t("settings.modelsCopied") : t("settings.modelsCopy")}
                        </button>
                    </div>
                ))}
            </div>
            <div className="text-xs text-muted">{t("settings.modelsHint")}</div>
        </div>
    );
});

ZetaModelsSettings.displayName = "ZetaModelsSettings";

function formatTokens(value: number): string {
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
    return String(value);
}

function formatCost(value: number): string {
    return `$${value % 1 === 0 ? value : value.toFixed(2)}`;
}

export { ZetaModelsSettings };
