/**
 * 模型可见性设置：只决定哪些模型出现在 composer/选择器中。
 *
 * 隐藏不会删除模型、Provider，也不会改写 `modelRoles` / `retry.fallbackChains`；
 * 模型配置页、角色与回退链仍然完整可见、可编辑。持久化写入共享设置
 * `hiddenModels`，TUI 与 WebUI 读取同一份配置。
 *
 * 数据源：`models.get` 可用时用它的完整目录；该查询在当前 Host 版本尚未
 * 实现时回退到网关的 `/api/models` + `/api/settings`，让这个设置页先可用。
 */
import { useEffect, useMemo, useState } from "react";

import { BUILTIN_MODEL_ROLES, type ModelConfigReadModel, type StudioClient } from "@linxiraos/studio-contract";

import { Icon } from "../icons";
import { useI18n } from "../i18n";
import { hostErrorMessage, waitReceipt } from "../hostError";
import {
	hasProviderWideHiddenRule,
	hiddenSelectorsForProvider,
	isModelHidden,
	revealModel,
	selectorWithoutThinking,
} from "./modelVisibility";
import { loadVisibilitySnapshot, saveHiddenModels } from "./modelVisibilityGateway";
import "./model-visibility.css";

interface VisibilityRow {
	readonly provider: string;
	readonly id: string;
	readonly selector: string;
	readonly name: string;
	readonly kind: string;
	readonly roles: ReadonlyArray<string>;
}

/** Canonical kind order from the TUI model browser; unknown kinds append. */
const KIND_ORDER = ["chat", "tiny", "image", "tts", "stt", "search", "judge", "embedding", "rerank", "video"];

function sortKinds(kinds: Iterable<string>): string[] {
	const set = new Set(kinds);
	const ordered = KIND_ORDER.filter(kind => set.delete(kind));
	return [...ordered, ...[...set].sort((a, b) => a.localeCompare(b))];
}

function toRow(
	model: ModelConfigReadModel["availableModels"][number],
	rolesBySelector: ReadonlyMap<string, ReadonlyArray<string>>,
): VisibilityRow {
	return {
		provider: model.provider,
		id: model.id,
		selector: model.selector,
		name: model.name,
		kind: model.kind ?? "chat",
		roles: rolesBySelector.get(model.selector) ?? [],
	};
}

function providerName(data: ModelConfigReadModel | null, providerId: string): string {
	return data?.providers.find(provider => provider.id === providerId)?.name ?? providerId;
}

export function ModelVisibilityPane({
	client,
	data,
	preview,
	onSaved,
}: {
	client: StudioClient;
	data: ModelConfigReadModel | null;
	preview: boolean;
	onSaved?: (hiddenModels: ReadonlyArray<string>) => void;
}) {
	const { t } = useI18n();
	const persisted = data?.hiddenModels ?? [];
	const [draft, setDraft] = useState<ReadonlyArray<string>>(persisted);
	const [gateway, setGateway] = useState<{
		models: ReadonlyArray<VisibilityRow>;
		hidden: ReadonlyArray<string>;
	} | null>(null);
	const [gatewayError, setGatewayError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState("all");
	const [tagFilter, setTagFilter] = useState("all");
	const [showHidden, setShowHidden] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (preview || data) return;
		let cancelled = false;
		setGatewayError(null);
		void loadVisibilitySnapshot()
			.then(snapshot => {
				if (cancelled) return;
				const models = snapshot.models.map(model => ({ ...model, kind: model.kind ?? "chat" }));
				setGateway({ models, hidden: snapshot.hiddenModels });
				setDraft(snapshot.hiddenModels);
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				setGatewayError(hostErrorMessage(cause, t("modelConfig.visibilityLoadError")));
			});
		return () => {
			cancelled = true;
		};
	}, [data, preview, t]);

	useEffect(() => {
		setDraft(persisted);
	}, [data]);

	const rolesBySelector = useMemo(() => {
		const map = new Map<string, ReadonlyArray<string>>();
		if (data) {
			for (const role of data.roles) {
				if (!role.primary) continue;
				const selector = selectorWithoutThinking(role.primary);
				const roles = map.get(selector);
				map.set(selector, roles ? [...roles, role.id] : [role.id]);
			}
			return map;
		}
		for (const model of gateway?.models ?? []) map.set(model.selector, model.roles);
		return map;
	}, [data, gateway]);

	const models = useMemo<ReadonlyArray<VisibilityRow>>(
		() =>
			data
				? data.availableModels.map(model => toRow(model, rolesBySelector))
				: (gateway?.models ?? []).map(model => ({
						...model,
						kind: model.kind ?? "chat",
						roles: rolesBySelector.get(model.selector) ?? model.roles,
					})),
		[data, gateway, rolesBySelector],
	);
	const hiddenCount = models.filter(model => isModelHidden(model, draft)).length;
	const kinds = useMemo(() => sortKinds(models.map(model => model.kind)), [models]);
	const tags = useMemo(() => {
		const seen = new Set<string>(BUILTIN_MODEL_ROLES.map(role => role.id));
		for (const role of data?.roles ?? []) seen.add(role.id);
		for (const model of models) for (const role of model.roles) seen.add(role);
		return [...seen].sort((a, b) => a.localeCompare(b));
	}, [data, models]);

	const groups = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const byProvider = new Map<string, VisibilityRow[]>();
		for (const model of models) {
			const hidden = isModelHidden(model, draft);
			if (hidden && !showHidden) continue;
			if (kindFilter !== "all" && model.kind !== kindFilter) continue;
			if (tagFilter !== "all" && !model.roles.includes(tagFilter)) continue;
			if (needle) {
				const haystack = `${model.selector} ${model.name} ${model.kind} ${model.roles.join(" ")}`.toLowerCase();
				if (!haystack.includes(needle)) continue;
			}
			const rows = byProvider.get(model.provider);
			if (rows) rows.push(model);
			else byProvider.set(model.provider, [model]);
		}
		return [...byProvider.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([providerId, providerModels]) => ({ providerId, models: providerModels }));
	}, [models, draft, query, showHidden, kindFilter, tagFilter]);

	const knownSelectors = useMemo(() => new Set(models.map(model => model.selector)), [models]);
	const extraRules = draft.filter(rule => {
		if (rule.endsWith("/*") || rule === "*") return false;
		return !knownSelectors.has(rule);
	});
	const loading = !preview && !data && gateway === null && gatewayError === null;

	const persist = async (next: ReadonlyArray<string>) => {
		const previous = draft;
		setDraft(next);
		setError(null);
		if (preview) {
			onSaved?.(next);
			return;
		}
		setBusy(true);
		try {
			if (data) {
				const handle = await client.command("models.hidden.set", { selectors: next });
				await waitReceipt(client, handle.requestId);
			} else {
				await saveHiddenModels(next);
			}
			onSaved?.(next);
		} catch (cause) {
			setDraft(previous);
			setError(hostErrorMessage(cause, "hiddenModels save failed"));
		} finally {
			setBusy(false);
		}
	};

	const hideModel = (model: VisibilityRow) => {
		if (draft.includes(model.selector)) return;
		void persist([...draft, model.selector]);
	};

	const showModel = (model: VisibilityRow) => {
		void persist(revealModel(draft, model));
	};

	const hideProvider = (providerId: string) => {
		const selectors = hiddenSelectorsForProvider(models, providerId);
		const next = [...draft];
		for (const selector of selectors) if (!next.includes(selector)) next.push(selector);
		void persist(next);
	};

	const showProvider = (providerId: string) => {
		const providerModels = models.filter(model => model.provider === providerId);
		let next: ReadonlyArray<string> = draft;
		for (const model of providerModels) next = revealModel(next, model);
		void persist(next);
	};

	return (
		<div className="mc-view mv-root">
			<div className="mp-sec">
				<h3>{t("modelConfig.visibilityTitle")}</h3>
				<p className="sec-desc">{t("modelConfig.visibilityDesc")}</p>
				<div className="mv-toolbar">
					<input
						className="input"
						type="search"
						value={query}
						placeholder={t("modelConfig.visibilitySearch")}
						aria-label={t("modelConfig.visibilitySearch")}
						onChange={event => setQuery(event.target.value)}
					/>
					<select
						className="select"
						value={kindFilter}
						aria-label={t("modelConfig.visibilityKindFilter")}
						onChange={event => setKindFilter(event.target.value)}
					>
						<option value="all">{t("modelConfig.visibilityAllKinds")}</option>
						{kinds.map(kind => (
							<option value={kind} key={kind}>
								{kind}
							</option>
						))}
					</select>
					<select
						className="select"
						value={tagFilter}
						aria-label={t("modelConfig.visibilityTagFilter")}
						onChange={event => setTagFilter(event.target.value)}
					>
						<option value="all">{t("modelConfig.visibilityAllTags")}</option>
						{tags.map(tag => (
							<option value={tag} key={tag}>
								{tag}
							</option>
						))}
					</select>
					<label className="mv-toggle">
						<input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)} />
						<span>{t("modelConfig.visibilityShowHidden")}</span>
					</label>
					<span className="chip gray xs">
						{t("modelConfig.visibilityHiddenCount", { hidden: hiddenCount, total: models.length })}
					</span>
				</div>
				{error ? <div className="mv-error">{error}</div> : null}
				{gatewayError ? <div className="mv-error">{gatewayError}</div> : null}
			</div>

			{loading ? (
				<div className="rms-empty">{t("modelConfig.visibilityLoading")}</div>
			) : groups.length === 0 ? (
				<div className="rms-empty">{t("modelConfig.visibilityNoModels")}</div>
			) : (
				groups.map(group => {
					const providerModels = models.filter(model => model.provider === group.providerId);
					const allHidden =
						providerModels.length > 0 && providerModels.every(model => isModelHidden(model, draft));
					return (
						<section className="mp-sec mv-provider" key={group.providerId}>
							<div className="mv-provider-head">
								<b>{providerName(data, group.providerId)}</b>
								<span className="mono muted">{group.providerId}</span>
								<span className="spacer" />
								<span className="chip gray xs">{group.models.length}</span>
								<button
									type="button"
									className="btn small outline"
									disabled={busy || allHidden}
									onClick={() => hideProvider(group.providerId)}
								>
									{t("modelConfig.visibilityHideProvider")}
								</button>
								<button
									type="button"
									className="btn small outline"
									disabled={busy || hiddenCount === 0}
									onClick={() => showProvider(group.providerId)}
								>
									{t("modelConfig.visibilityShowProvider")}
								</button>
							</div>
							<ul className="mv-list">
								{group.models.map(model => {
									const hidden = isModelHidden(model, draft);
									const providerWide = hasProviderWideHiddenRule(model, draft);
									return (
										<li className={hidden ? "mv-row is-hidden" : "mv-row"} key={model.selector}>
											<span className="mv-row-copy">
												<b>{model.name}</b>
												<span className="mono">{model.selector}</span>
											</span>
											<span className="chip gray xs">{model.kind}</span>
											{model.roles.length > 0 ? (
												<span className="mv-tags">
													{model.roles.map(role => (
														<span className="chip purple xs" key={role}>
															{role}
														</span>
													))}
												</span>
											) : null}
											{hidden ? (
												<span className="chip amber xs">{t("modelConfig.visibilityHidden")}</span>
											) : null}
											{hidden && providerWide ? (
												<span className="mv-hint">{t("modelConfig.visibilityProviderRule")}</span>
											) : null}
											<button
												type="button"
												className="icon-btn"
												disabled={busy}
												aria-label={
													hidden
														? t("modelConfig.visibilityShowModel")
														: t("modelConfig.visibilityHideModel")
												}
												title={
													hidden
														? t("modelConfig.visibilityShowModel")
														: t("modelConfig.visibilityHideModel")
												}
												onClick={() => (hidden ? showModel(model) : hideModel(model))}
											>
												<Icon name={hidden ? "eye-off" : "eye"} extra="sm" />
											</button>
										</li>
									);
								})}
							</ul>
						</section>
					);
				})
			)}

			{extraRules.length > 0 ? (
				<section className="mp-sec">
					<h3>{t("modelConfig.visibilityOtherRules")}</h3>
					<p className="sec-desc">{t("modelConfig.visibilityOtherRulesDesc")}</p>
					<div className="cycle-pool">
						{extraRules.map(rule => (
							<span className="cycle-chip" key={rule}>
								<span className="mono">{rule}</span>
								<span
									className="chip-remove"
									role="button"
									tabIndex={0}
									onClick={() => void persist(draft.filter(entry => entry !== rule))}
									onKeyDown={event => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											void persist(draft.filter(entry => entry !== rule));
										}
									}}
								>
									<Icon name="x" extra="sm" />
								</span>
							</span>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
