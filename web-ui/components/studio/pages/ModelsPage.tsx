"use client";

/**
 * ModelsPage — providers, catalog and role assignments.
 *
 * The page is a Studio-styled overview over the live model family, and it
 * opens Zeta's provider editor for edits:
 *
 *   `GET  /api/models`              resolved catalog, default model, thinking levels
 *   `GET  /api/models-config`       providers from the writable layers (+ origin)
 *   `GET  /api/settings`            `modelRoles` / `providerLimits` rows
 *   POST `/api/models-config/test`  connection smoke test button lives in the editor
 *
 * Editing itself is `ModelsConfig`: it already owns the provider form,
 * OAuth/API-key flow, discovery, catalog import and role matrix against the
 * same routes, and `/api/models-config` is a single `{providers}` document
 * with no per-field write path — a second editor would write the whole file
 * behind its back. Studio's `ModelConfigPage` read model (`models.get`) also
 * carries benchmark/pool/runtime-install facts Zeta never exposes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/studio/i18n";
import { hostErrorMessage } from "@/components/studio/primitives/hostError";
import { ModelsConfig } from "@/components/ModelsConfig";
import type { ModelsData } from "@/lib/models-cache";
import { fetchSettings, type SettingEntry } from "@/lib/settings-client";
import { PageBanner, PageEmpty, PageFrame } from "./page-frame";

interface ProviderRecord {
	api?: string;
	baseUrl?: string;
	models?: Record<string, unknown> | ReadonlyArray<unknown>;
	origin?: string;
	apiKey?: string;
	auth?: string;
}

interface ModelsConfigResponse {
	providers?: Record<string, ProviderRecord>;
}

function modelCount(provider: ProviderRecord): number {
	if (Array.isArray(provider.models)) return provider.models.length;
	return Object.keys(provider.models ?? {}).length;
}

function roleRows(entry: SettingEntry | undefined): Array<[string, string]> {
	if (!entry || typeof entry.value !== "object" || entry.value === null) return [];
	return Object.entries(entry.value as Record<string, unknown>)
		.filter(([, value]) => typeof value === "string" && value.length > 0)
		.map(([role, value]) => [role, String(value)]);
}

export function ModelsPage({ title }: { title?: string }) {
	const { t } = useI18n();
	const [models, setModels] = useState<ModelsData | null>(null);
	const [providers, setProviders] = useState<Array<[string, ProviderRecord]>>([]);
	const [roleEntry, setRoleEntry] = useState<SettingEntry | undefined>();
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const [catalog, configRes, settings] = await Promise.all([
				fetch("/api/models", { cache: "no-store" }).then(async res => {
					if (!res.ok) throw new Error(`models: HTTP ${res.status}`);
					return (await res.json()) as ModelsData;
				}),
				fetch("/api/models-config", { cache: "no-store" })
					.then(res => (res.ok ? ((res.json() as Promise<ModelsConfigResponse>)) : { providers: {} }))
					.catch(() => ({ providers: {} }) as ModelsConfigResponse),
				fetchSettings("en").catch(() => null),
			]);
			setModels(catalog);
			setProviders(
				Object.entries(configRes.providers ?? {}).sort(([left], [right]) => left.localeCompare(right)),
			);
			setRoleEntry(settings?.settings.find(entry => entry.type === "modelRoles"));
			setError(null);
		} catch (cause) {
			setError(hostErrorMessage(cause, t("studio.models.loadError")));
		}
	}, [t]);

	useEffect(() => {
		void load();
	}, [load]);

	const byProvider = useMemo(() => {
		const map = new Map<string, number>();
		for (const model of models?.modelList ?? []) map.set(model.provider, (map.get(model.provider) ?? 0) + 1);
		return map;
	}, [models]);

	const roles = roleRows(roleEntry);

	return (
		<PageFrame
			title={title ?? t("studio.route.models")}
			subtitle={models?.defaultModel ? `${models.defaultModel.provider}/${models.defaultModel.modelId}` : null}
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
			{error ? <PageBanner className="banner red">{error}</PageBanner> : null}
			{models?.modelError ? <PageBanner className="banner amber">{models.modelError}</PageBanner> : null}

			<div className="cap-layout">
				<div className="cap-main">
					{providers.length === 0 ? (
						<PageEmpty>{t("studio.models.noProviders")}</PageEmpty>
					) : (
						<ul className="cap-skills">
							{providers.map(([name, provider]) => (
								<li key={name} className="cap-item">
									<div className="cap-item-main">
										<div className="cap-item-name-row">
											<span className="cap-item-name">{name}</span>
											<span className="cap-source">{provider.origin ?? "user"}</span>
											{provider.api ? <span className="chip gray xs">{provider.api}</span> : null}
										</div>
										<p className="cap-item-desc mono ellipsis">{provider.baseUrl ?? "—"}</p>
										<p className="cap-item-meta">
											{modelCount(provider)} {t("studio.models.configured")} ·{" "}
											{byProvider.get(name) ?? 0} {t("studio.models.resolved")}
										</p>
									</div>
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
										<th>{t("studio.models.thinking")}</th>
									</tr>
								</thead>
								<tbody>
									{models.modelList.slice(0, 200).map(model => (
										<tr key={`${model.provider}/${model.id}`}>
											<td>{model.name || model.id}</td>
											<td className="muted">{model.provider}</td>
											<td className="muted small">
												{(models.thinkingLevels[`${model.provider}/${model.id}`] ?? []).join(" / ") || "—"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					) : null}
				</div>

				<aside className="cap-side">
					<section className="cap-item">
						<div className="cap-item-main">
							<div className="cap-item-name-row">
								<span className="cap-item-name">{t("studio.models.roles")}</span>
							</div>
							{roles.length === 0 ? (
								<PageEmpty>{t("studio.models.rolesEmpty")}</PageEmpty>
							) : (
								<ul className="cap-slash-list">
									{roles.map(([role, selector]) => (
										<li key={role} className="cap-slash-row">
											<span className="cap-slash-name">{role}</span>
											<span className="cap-slash-desc mono">{selector}</span>
										</li>
									))}
								</ul>
							)}
							<p className="cap-item-meta">{t("studio.models.rolesHint")}</p>
						</div>
					</section>
				</aside>
			</div>

			{editing ? (
				<ModelsConfig
					onClose={() => {
						setEditing(false);
						void load();
					}}
				/>
			) : null}
		</PageFrame>
	);
}
