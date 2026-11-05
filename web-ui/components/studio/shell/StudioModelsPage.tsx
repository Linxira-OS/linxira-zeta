"use client";

/**
 * StudioModelsPage — provider and default-model overview.
 *
 * Read-only summary over two live endpoints: `/api/models` (resolved catalog,
 * default model, thinking levels) and `/api/models-config` (the writable layer
 * plus each provider's origin). Editing stays in `ModelsConfig`, which already
 * owns the provider form, OAuth/API-key flow, discovery and role matrix against
 * the same routes — the page opens it instead of duplicating that form.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ModelsConfig } from "@/components/ModelsConfig";
import type { ModelsData } from "@/lib/models-cache";
import { StudioPage } from "./StudioPageHost";

interface ProviderRow {
	name: string;
	origin?: string;
	models: number;
	configured: boolean;
}

interface ModelsConfigResponse {
	providers?: Record<string, { models?: Record<string, unknown>; origin?: string }>;
}

export function StudioModelsPage({ title }: { title: string }) {
	const { t } = useI18n();
	const [models, setModels] = useState<ModelsData | null>(null);
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const [catalog, configRes] = await Promise.all([
				fetch("/api/models", { cache: "no-store" }).then(async res => {
					if (!res.ok) throw new Error(`models: HTTP ${res.status}`);
					return (await res.json()) as ModelsData;
				}),
				fetch("/api/models-config", { cache: "no-store" }).catch(() => null),
			]);
			setModels(catalog);
			const config = configRes?.ok ? ((await configRes.json()) as ModelsConfigResponse) : {};
			const rows = Object.entries(config.providers ?? {}).map(([name, provider]) => ({
				name,
				origin: provider.origin,
				models: Object.keys(provider.models ?? {}).length,
				configured: provider.origin !== "omp" || Object.keys(provider.models ?? {}).length > 0,
			}));
			setProviders(rows.sort((a, b) => a.name.localeCompare(b.name)));
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const byProvider = useMemo(() => {
		const map = new Map<string, number>();
		for (const model of models?.modelList ?? []) map.set(model.provider, (map.get(model.provider) ?? 0) + 1);
		return map;
	}, [models]);

	return (
		<StudioPage
			title={title}
			subtitle={
				models?.defaultModel ? `${models.defaultModel.provider}/${models.defaultModel.modelId}` : null
			}
			actions={
				<>
					<button type="button" className="btn btn-ghost" onClick={() => void load()}>
						{t("studio.action.refresh")}
					</button>
					<button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
						{t("studio.models.edit")}
					</button>
				</>
			}
		>
			{error ? (
				<div className="banner red" role="alert">
					{error}
				</div>
			) : null}
			{models?.modelError ? (
				<div className="banner amber" role="alert">
					{models.modelError}
				</div>
			) : null}

			{providers.length === 0 ? (
				<p className="muted small">{t("studio.models.noProviders")}</p>
			) : (
				<ul className="card-list">
					{providers.map(provider => (
						<li key={provider.name} className="card row">
							<div className="row-main">
								<span className="row-title">{provider.name}</span>
								<span className="chip">{provider.origin ?? "user"}</span>
							</div>
							<span className="muted small">
								{provider.models} / {byProvider.get(provider.name) ?? 0} {t("studio.models.models")}
							</span>
						</li>
					))}
				</ul>
			)}

			{models && models.modelList.length > 0 ? (
				<section className="card">
					<header className="card-head">
						<h2 className="card-title">{t("studio.models.available")}</h2>
					</header>
					<table className="table">
						<thead>
							<tr>
								<th>{t("studio.models.model")}</th>
								<th>{t("studio.models.provider")}</th>
							</tr>
						</thead>
						<tbody>
							{models.modelList.slice(0, 200).map(model => (
								<tr key={`${model.provider}/${model.id}`}>
									<td>{model.name || model.id}</td>
									<td className="muted">{model.provider}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			) : null}

			{editing ? (
				<ModelsConfig
					onClose={() => {
						setEditing(false);
						void load();
					}}
				/>
			) : null}
		</StudioPage>
	);
}
