/**
 * `/pages/models` — read-only model-control surface.
 *
 * The page renders one `ModelsControlSnapshot` fetched from
 * `GET /api/models/control`. The form/detail view and the Blueprint toggle
 * both take that same state object (and the Blueprint is a pure projection of
 * it), so there is no second source of truth and no config writer here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { pickLocale } from "./i18n";
import {
	type ControlModelKind,
	fetchModelsControl,
	type ModelControlChain,
	type ModelControlRole,
	type ModelControlSectionModel,
	type ModelControlTarget,
	type ModelsControlFetcher,
	type ModelsControlSnapshot,
} from "./modelsControl";
import { buildModelsControlView, layoutModelsBlueprint, type ModelsBlueprintLayout } from "./modelsBlueprint";
import "./models.css";

const KIND_LABELS: Readonly<Record<ControlModelKind, readonly [string, string]>> = {
	chat: ["对话", "Chat"],
	image: ["图像", "Image"],
	tts: ["语音合成", "TTS"],
	stt: ["语音转写", "STT"],
	decision: ["决策", "Decision"],
	embedding: ["向量", "Embedding"],
	search: ["搜索", "Search"],
	rerank: ["重排", "Rerank"],
	video: ["视频", "Video"],
};

const SCOPE_LABELS: Readonly<Record<string, readonly [string, string]>> = {
	resume: ["恢复", "Resume"],
	retry: ["重试", "Retry"],
	role: ["角色", "Role"],
	agent: ["子代理", "Agent"],
	mode: ["模式", "Mode"],
	"legacy-retry": ["旧版重试", "Legacy retry"],
};

const SOURCE_LABELS: Readonly<Record<ModelControlTarget["source"], readonly [string, string]>> = {
	agent: ["代理覆盖", "Agent override"],
	role: ["角色", "Role"],
	default: ["默认", "Default"],
};

function kindLabel(kind: ControlModelKind): string {
	return pickLocale(...KIND_LABELS[kind]);
}

function GroupedModels({ models }: { models: readonly ModelControlSectionModel[] }) {
	const grouped = new Map<string, ModelControlSectionModel[]>();
	for (const model of models) {
		const entries = grouped.get(model.provider) ?? [];
		entries.push(model);
		grouped.set(model.provider, entries);
	}
	return (
		<div className="models-provider-groups">
			{[...grouped.entries()].map(([provider, entries]) => (
				<details key={provider} className="models-provider-group">
					<summary>
						<span className="mono">{provider}</span>
						<span className="chip gray xs">{entries.length}</span>
					</summary>
					<ul>
						{entries.map(model => (
							<li key={`${model.provider}/${model.id}`}>
								<span>{model.name}</span>
								<span className="mono muted">
									{model.provider}/{model.id}
								</span>
								<span className={model.available ? "chip green xs" : "chip gray xs"}>
									{model.available ? pickLocale("可用", "available") : pickLocale("不可用", "unavailable")}
								</span>
							</li>
						))}
					</ul>
				</details>
			))}
		</div>
	);
}

function FallbackChainList({ chains }: { chains: readonly ModelControlChain[] }) {
	if (chains.length === 0) return <p className="models-empty">{pickLocale("未配置", "Not configured")}</p>;
	return (
		<ul className="models-chains">
			{chains.map(chain => (
				<li key={chain.key}>
					<code className="models-chain-key">{chain.key}</code>
					<div className="models-chain-entries">
						{chain.chain.length === 0 ? (
							<span className="muted">{pickLocale("显式禁用", "explicitly disabled")}</span>
						) : (
							chain.chain.map((entry, index) => (
								<span key={`${entry}:${index}`} className="chip outline sm mono">
									{entry}
								</span>
							))
						)}
					</div>
					{chain.duplicates.length > 0 ? (
						<p className="models-duplicates">
							{pickLocale("已折叠重复项：", "duplicates collapsed: ")}
							{chain.duplicates.map(duplicate => `${duplicate.removed} → ${duplicate.kept}`).join("; ")}
						</p>
					) : null}
					{chain.sameModelDifferentEffort.length > 0 ? (
						<p className="models-duplicates">
							{pickLocale("同一模型不同推理档：", "same model at different effort: ")}
							{chain.sameModelDifferentEffort
								.map(entry => `${entry.modelKey} (${entry.thinkingLevels.join(", ")})`)
								.join("; ")}
						</p>
					) : null}
				</li>
			))}
		</ul>
	);
}

function RoleTable({ roles }: { roles: readonly ModelControlRole[] }) {
	if (roles.length === 0)
		return <p className="models-empty">{pickLocale("没有已配置的角色", "No configured roles")}</p>;
	return (
		<div className="models-table-wrap">
			<table className="models-table">
				<thead>
					<tr>
						<th>{pickLocale("角色", "Role")}</th>
						<th>{pickLocale("选择器", "Selector")}</th>
						<th>{pickLocale("解析结果", "Resolved")}</th>
						<th>{pickLocale("回退链", "Fallback")}</th>
					</tr>
				</thead>
				<tbody>
					{roles.map(role => (
						<tr key={role.role}>
							<td>
								<span className="chip purple sm">{role.role}</span>
							</td>
							<td className="mono">{role.selector ?? "—"}</td>
							<td>
								{role.resolved ? (
									<span>
										<span className="mono">{role.resolved.name}</span>{" "}
										<span className="chip gray xs">{kindLabel(role.resolved.kind)}</span>
										{role.thinkingLevel ? <span className="chip blue xs">{role.thinkingLevel}</span> : null}
									</span>
								) : (
									<span className="muted">{pickLocale("未解析", "unresolved")}</span>
								)}
								{role.warning ? <p className="models-warning">{role.warning}</p> : null}
							</td>
							<td>
								{role.fallback.length === 0 ? (
									<span className="muted">—</span>
								) : (
									<span className="models-chain-entries">
										{role.fallback.map((entry, index) => (
											<span key={`${entry}:${index}`} className="chip outline xs mono">
												{entry}
											</span>
										))}
									</span>
								)}
								{role.fallbackSource ? (
									<p className="models-source">
										{pickLocale("来源：", "source: ")}
										{role.fallbackSource}
									</p>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TargetTable({
	title,
	empty,
	targets,
}: {
	title: string;
	empty: string;
	targets: readonly ModelControlTarget[];
}) {
	return (
		<section className="models-section card">
			<header className="models-section-head">
				<h2>{title}</h2>
				<span className="chip gray xs">{targets.length}</span>
			</header>
			{targets.length === 0 ? (
				<p className="models-empty">{empty}</p>
			) : (
				<div className="models-table-wrap">
					<table className="models-table">
						<thead>
							<tr>
								<th>{pickLocale("目标", "Target")}</th>
								<th>{pickLocale("角色", "Role")}</th>
								<th>{pickLocale("选择器", "Selector")}</th>
								<th>{pickLocale("解析结果", "Resolved")}</th>
								<th>{pickLocale("来源", "Source")}</th>
								<th>{pickLocale("回退链", "Fallback")}</th>
							</tr>
						</thead>
						<tbody>
							{targets.map(target => (
								<tr key={`${target.kind}:${target.target}`}>
									<td>
										<span className="chip purple sm">{target.target}</span>
									</td>
									<td className="mono">{target.role}</td>
									<td className="mono">{target.selector}</td>
									<td>
										{target.resolved ? (
											<span>
												<span className="mono">{target.resolved.name}</span>{" "}
												<span className="chip gray xs">{kindLabel(target.resolved.kind)}</span>
											</span>
										) : (
											<span className="muted">{pickLocale("未解析", "unresolved")}</span>
										)}
										{target.thinkingLevel ? (
											<span className="chip blue xs">{target.thinkingLevel}</span>
										) : null}
										{target.warning ? <p className="models-warning">{target.warning}</p> : null}
									</td>
									<td>{pickLocale(...SOURCE_LABELS[target.source])}</td>
									<td>
										{target.fallback.length === 0 ? (
											<span className="muted">—</span>
										) : (
											<span className="models-chain-entries">
												{target.fallback.map((entry, index) => (
													<span key={`${entry}:${index}`} className="chip outline xs mono">
														{entry}
													</span>
												))}
											</span>
										)}
										{target.fallbackSource ? (
											<p className="models-source">
												{pickLocale("来源：", "source: ")}
												{target.fallbackSource}
											</p>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

function Blueprint({ layout, snapshot }: { layout: ModelsBlueprintLayout; snapshot: ModelsControlSnapshot }) {
	return (
		<section className="models-section card models-blueprint-section">
			<header className="models-section-head">
				<h2>{pickLocale("蓝图", "Blueprint")}</h2>
				<span className="models-blueprint-meta">
					{layout.nodes.length} {pickLocale("节点", "nodes")} · {layout.edges.length} {pickLocale("边", "edges")} ·{" "}
					{snapshot.totals.fallbackChains} {pickLocale("回退链", "fallback chains")}
				</span>
			</header>
			<p className="models-readonly">
				{pickLocale(
					"同一快照的节点/边投影——没有第二份状态。",
					"Typed nodes/edges projected from the same snapshot — no second state.",
				)}
			</p>
			{layout.nodes.length === 0 ? (
				<p className="models-empty">{pickLocale("没有可投影的节点", "No nodes to project")}</p>
			) : (
				<div className="models-blueprint" tabIndex={0}>
					<svg
						role="img"
						aria-label={pickLocale("模型控制蓝图", "Model control blueprint")}
						width={layout.width}
						height={layout.height}
						viewBox={`0 0 ${layout.width} ${layout.height}`}
					>
						<g className="models-bp-edges">
							{layout.edges.map(edge => (
								<g key={edge.id}>
									<path d={edge.path} />
									<title>{edge.label ?? `${edge.from} → ${edge.to}`}</title>
								</g>
							))}
						</g>
						<g className="models-bp-nodes">
							{layout.nodes.map(node => {
								const label = node.label.length > 30 ? `${node.label.slice(0, 29)}…` : node.label;
								const detail =
									node.detail !== undefined && node.detail.length > 30
										? `${node.detail.slice(0, 29)}…`
										: node.detail;
								return (
									<g key={node.id} className={`models-bp-node models-bp-${node.kind}`}>
										<title>
											{node.kind}: {node.label}
											{node.detail ? ` — ${node.detail}` : ""}
											{node.state ? ` (${node.state})` : ""}
										</title>
										<rect x={node.x} y={node.y} width={node.width} height={node.height} rx={9} />
										<text x={node.x + 10} y={node.y + 18} className="models-bp-label">
											{label}
										</text>
										{detail ? (
											<text x={node.x + 10} y={node.y + 34} className="models-bp-detail">
												{detail}
											</text>
										) : null}
									</g>
								);
							})}
						</g>
					</svg>
				</div>
			)}
		</section>
	);
}

export function ModelsPage({ fetcher }: { fetcher?: ModelsControlFetcher }) {
	const [snapshot, setSnapshot] = useState<ModelsControlSnapshot | null>(null);
	const [mode, setMode] = useState<"details" | "blueprint">("details");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			setSnapshot(await fetchModelsControl(fetcher));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [fetcher]);

	useEffect(() => {
		void load();
	}, [load]);

	const view = useMemo(() => (snapshot === null ? null : buildModelsControlView(snapshot)), [snapshot]);
	const layout = useMemo(
		() => (mode === "blueprint" && view !== null ? layoutModelsBlueprint(view.blueprint) : null),
		[mode, view],
	);

	if (loading && snapshot === null) {
		return <div className="zp-center muted">{pickLocale("正在加载模型控制…", "Loading model control…")}</div>;
	}
	if (error !== "" && snapshot === null) {
		return (
			<div className="zp-center">
				<div className="zp-card">
					<h1>{pickLocale("模型控制加载失败", "Model control failed to load")}</h1>
					<p className="zp-error">{error}</p>
					<div className="zp-actions">
						<button type="button" className="btn primary" onClick={() => void load()}>
							{pickLocale("重试", "Retry")}
						</button>
					</div>
				</div>
			</div>
		);
	}
	if (view === null) return null;

	const { snapshot: state, blueprint } = view;
	return (
		<div className="models-page">
			<header className="models-head">
				<div>
					<h1>{pickLocale("模型控制", "Model control")}</h1>
					<p className="models-subtitle">
						{pickLocale(
							"只读快照：供应商可见性、角色、回退链、代理与类型化模型。",
							"Read-only snapshot: providers, roles, fallback chains, agents and typed models.",
						)}
					</p>
				</div>
				<div className="models-actions">
					<div className="models-toggle" role="group" aria-label={pickLocale("视图", "View")}>
						<button
							type="button"
							className={mode === "details" ? "btn primary" : "btn outline"}
							aria-pressed={mode === "details"}
							onClick={() => setMode("details")}
						>
							{pickLocale("表单", "Form")}
						</button>
						<button
							type="button"
							className={mode === "blueprint" ? "btn primary" : "btn outline"}
							aria-pressed={mode === "blueprint"}
							onClick={() => setMode("blueprint")}
						>
							{pickLocale("蓝图", "Blueprint")}
						</button>
					</div>
					<button type="button" className="btn" onClick={() => void load()} disabled={loading}>
						{loading ? pickLocale("刷新中…", "Refreshing…") : pickLocale("刷新", "Refresh")}
					</button>
				</div>
			</header>

			{error !== "" ? <div className="banner red">{error}</div> : null}
			{state.modelError ? <div className="banner amber">{state.modelError}</div> : null}
			<p className="models-readonly">
				{pickLocale(
					"此页面只读；网关回答中不含任何 API key 或凭据。",
					"This page is read-only; the gateway response never contains API keys or credentials.",
				)}
			</p>

			<div className="models-totals">
				{[
					...([
						[pickLocale("供应商", "providers"), state.totals.providers],
						[pickLocale("模型", "models"), state.totals.models],
						[pickLocale("角色", "roles"), state.totals.roles],
						[pickLocale("子代理", "agents"), state.totals.agents],
						[pickLocale("目标", "targets"), state.totals.targets],
						[pickLocale("回退链", "fallback chains"), state.totals.fallbackChains],
					] as const),
				].map(([label, value]) => (
					<div key={label} className="models-total card">
						<span>{label}</span>
						<strong>{value}</strong>
					</div>
				))}
			</div>

			{mode === "blueprint" && layout !== null ? (
				<Blueprint layout={layout} snapshot={state} />
			) : (
				<>
					<section className="models-section card">
						<header className="models-section-head">
							<h2>{pickLocale("供应商", "Providers")}</h2>
							<span className="chip gray xs">{state.providers.length}</span>
						</header>
						{state.providers.length === 0 ? (
							<p className="models-empty">{pickLocale("目录中没有供应商", "No providers in the catalog")}</p>
						) : (
							<div className="models-table-wrap">
								<table className="models-table">
									<thead>
										<tr>
											<th>{pickLocale("供应商", "Provider")}</th>
											<th>{pickLocale("可见性", "Visibility")}</th>
											<th>{pickLocale("凭据", "Credentials")}</th>
											<th>{pickLocale("能力", "Capabilities")}</th>
											<th>{pickLocale("模型", "Models")}</th>
										</tr>
									</thead>
									<tbody>
										{state.providers.map(provider => (
											<tr key={provider.id}>
												<td>
													<span>{provider.name}</span>
													<span className="mono muted"> {provider.id}</span>
												</td>
												<td>
													<span className={provider.enabled ? "chip green xs" : "chip red xs"}>
														{provider.enabled
															? pickLocale("可见", "visible")
															: pickLocale("已禁用", "disabled")}
													</span>
												</td>
												<td>
													<span className={provider.configured ? "chip green xs" : "chip gray xs"}>
														{provider.configured
															? pickLocale("已配置", "configured")
															: pickLocale("无凭据", "no credential")}
													</span>
												</td>
												<td>
													<span className="models-chain-entries">
														{provider.capabilities.map(kind => (
															<span key={kind} className="chip outline xs">
																{kindLabel(kind)}
															</span>
														))}
														{provider.paused.map(kind => (
															<span key={`paused:${kind}`} className="chip amber xs">
																{kindLabel(kind)} · {pickLocale("暂停", "paused")}
															</span>
														))}
														{provider.capabilities.length === 0 && provider.paused.length === 0 ? (
															<span className="muted">—</span>
														) : null}
													</span>
												</td>
												<td>{provider.modelCount}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>

					<section className="models-section card">
						<header className="models-section-head">
							<h2>{pickLocale("模型角色", "Model roles")}</h2>
							<span className="chip gray xs">{state.roles.length}</span>
						</header>
						<RoleTable roles={state.roles} />
					</section>

					<section className="models-section card">
						<header className="models-section-head">
							<h2>{pickLocale("回退链", "Fallback chains")}</h2>
							<span className="chip gray xs">{state.totals.fallbackChains}</span>
						</header>
						<div className="models-scopes">
							{[...state.fallbackScopes, { scope: "legacy-retry" as const, chains: state.legacyRetry }].map(
								scope => (
									<div key={scope.scope} className="models-scope">
										<h3>{pickLocale(...(SCOPE_LABELS[scope.scope] ?? [scope.scope, scope.scope]))}</h3>
										<FallbackChainList chains={scope.chains} />
									</div>
								),
							)}
						</div>
					</section>

					<TargetTable
						title={pickLocale("子代理", "Agents")}
						empty={pickLocale("没有配置 modelAgents", "No modelAgents configured")}
						targets={state.agents}
					/>
					<TargetTable
						title={pickLocale("Vibe/Team 目标", "Vibe/Team targets")}
						empty={pickLocale("没有目标", "No targets")}
						targets={state.teamTargets}
					/>
					<TargetTable
						title={pickLocale("Vibe 模式目标", "Vibe mode targets")}
						empty={pickLocale("没有目标", "No targets")}
						targets={state.vibeTargets}
					/>

					<section className="models-section card">
						<header className="models-section-head">
							<h2>{pickLocale("类型化模型", "Typed models")}</h2>
							<span className="chip gray xs">{state.kinds.length}</span>
						</header>
						{state.kinds.length === 0 ? (
							<p className="models-empty">
								{pickLocale("目录没有类型化模型", "No typed models in the catalog")}
							</p>
						) : (
							<div className="models-kinds">
								{state.kinds.map(section => (
									<article key={section.kind} className="models-kind">
										<header>
											<h3>{kindLabel(section.kind)}</h3>
											<span className="chip gray xs">{section.models.length}</span>
											{section.paused ? (
												<span className="chip amber xs">{pickLocale("暂停", "paused")}</span>
											) : (
												<span className="chip green xs">{pickLocale("可见", "visible")}</span>
											)}
										</header>
										<GroupedModels models={section.models} />
									</article>
								))}
							</div>
						)}
					</section>

					<p className="models-readonly">
						{pickLocale(
							`蓝图为同一状态的投影（${blueprint.nodes.length} 节点 / ${blueprint.edges.length} 边）。`,
							`Blueprint is a projection of this state (${blueprint.nodes.length} nodes / ${blueprint.edges.length} edges).`,
						)}
					</p>
				</>
			)}
		</div>
	);
}
