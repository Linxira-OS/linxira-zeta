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
	type ModelControlScenario,
	type ModelControlSectionModel,
	type ModelControlTarget,
	type ModelDataBoundary,
	type ModelsControlFetcher,
	type ModelsControlSnapshot,
	type ScenarioBoundaryOutcome,
} from "./modelsControl";
import {
	buildModelsControlView,
	layoutModelsBlueprint,
	type ModelsAnimationFrame,
	type ModelsBlueprintLayout,
} from "./modelsBlueprint";
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
	chat: ["对话", "Chat"],
	image: ["图像", "Image"],
	tts: ["语音合成", "TTS"],
	stt: ["语音转写", "STT"],
	decision: ["决策", "Decision"],
	embedding: ["向量", "Embedding"],
	"legacy-retry": ["旧版重试", "Legacy retry"],
};

const BOUNDARY_LABELS: Readonly<Record<ModelDataBoundary, readonly [string, string]>> = {
	local: ["本机", "Local"],
	private: ["私有部署", "Private"],
	public: ["公共", "Public"],
};

const OUTCOME_LABELS: Readonly<Record<ScenarioBoundaryOutcome, readonly [string, string]>> = {
	allowed: ["允许", "Allowed"],
	fallback: ["已回退", "Fell back"],
	refused: ["拒绝", "Refused"],
	advisory: ["越界告警", "Advisory"],
	unresolved: ["未解析", "Unresolved"],
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
								<span className="chip outline xs">{pickLocale(...BOUNDARY_LABELS[model.boundary])}</span>
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

const OUTCOME_CHIPS: Readonly<Record<ScenarioBoundaryOutcome, string>> = {
	allowed: "chip green xs",
	fallback: "chip blue xs",
	refused: "chip red xs",
	advisory: "chip amber xs",
	unresolved: "chip gray xs",
};

function ScenarioSection({ scenarios }: { scenarios: readonly ModelControlScenario[] }) {
	return (
		<section className="models-section card">
			<header className="models-section-head">
				<h2>{pickLocale("部署场景", "Deployment scenarios")}</h2>
				<span className="chip gray xs">{scenarios.length}</span>
			</header>
			{scenarios.length === 0 ? (
				<p className="models-empty">
					{pickLocale(
						"未配置 modelScenarios；现有模型选择保持不变。",
						"No modelScenarios configured; model selection is unchanged.",
					)}
				</p>
			) : (
				<div className="models-scenarios">
					{scenarios.map(scenario => (
						<article key={scenario.name} className="models-scenario">
							<header>
								<h3>{scenario.name}</h3>
								<span className="chip outline xs">{pickLocale(...BOUNDARY_LABELS[scenario.boundary])}</span>
								<span className={scenario.failClosed ? "chip red xs" : "chip amber xs"}>
									{scenario.failClosed
										? pickLocale("失败关闭", "fail-closed")
										: pickLocale("仅告警", "advisory")}
								</span>
								<span className="models-source">
									{scenario.appliesToAll
										? pickLocale("所有代理", "all agents")
										: scenario.allowedAgents.join(", ")}
								</span>
							</header>
							{scenario.targets.length === 0 ? (
								<p className="models-empty">
									{pickLocale(
										"此场景约束所有代理；无逐目标决策。",
										"This scenario constrains every agent; no per-target decision.",
									)}
								</p>
							) : (
								<div className="models-table-wrap">
									<table className="models-table">
										<thead>
											<tr>
												<th>{pickLocale("代理", "Agent")}</th>
												<th>{pickLocale("选择器", "Selector")}</th>
												<th>{pickLocale("决策", "Decision")}</th>
												<th>{pickLocale("选中", "Selected")}</th>
											</tr>
										</thead>
										<tbody>
											{scenario.targets.map(target => (
												<tr key={`${scenario.name}:${target.target}`}>
													<td>
														<span className="chip purple sm">{target.target}</span>
													</td>
													<td className="mono">{target.selector}</td>
													<td>
														<span className={OUTCOME_CHIPS[target.outcome]}>
															{pickLocale(...OUTCOME_LABELS[target.outcome])}
														</span>
														{target.selected ? (
															<p className="models-source mono">
																{target.selected.provider}/{target.selected.id}
																{target.selectedBoundary
																	? ` · ${pickLocale(...BOUNDARY_LABELS[target.selectedBoundary])}`
																	: ""}
															</p>
														) : null}
														{target.reason ? <p className="models-warning">{target.reason}</p> : null}
													</td>
													<td>
														{target.selected ? (
															<span>
																<span className="mono">{target.selected.name}</span>{" "}
																<span className="chip gray xs">{kindLabel(target.selected.kind)}</span>
															</span>
														) : (
															<span className="muted">{pickLocale("无", "none")}</span>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</article>
					))}
				</div>
			)}
		</section>
	);
}

function BlueprintCanvas({
	layout,
	activeNodes,
	activeEdges,
}: {
	layout: ModelsBlueprintLayout;
	activeNodes?: ReadonlySet<string>;
	activeEdges?: ReadonlySet<string>;
}) {
	return (
		<div className={`models-blueprint${activeNodes === undefined ? "" : " models-blueprint-live"}`} tabIndex={0}>
			<svg
				role="img"
				aria-label={pickLocale("模型控制蓝图", "Model control blueprint")}
				width={layout.width}
				height={layout.height}
				viewBox={`0 0 ${layout.width} ${layout.height}`}
			>
				<g className="models-bp-edges">
					{layout.edges.map(edge => (
						<g key={edge.id} className={activeEdges?.has(edge.id) === true ? "is-active" : undefined}>
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
						const active = activeNodes?.has(node.id) === true;
						return (
							<g key={node.id} className={`models-bp-node models-bp-${node.kind}${active ? " is-active" : ""}`}>
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
				<BlueprintCanvas layout={layout} />
			)}
		</section>
	);
}

/**
 * Purely presentational: it walks frames derived from the same Blueprint the
 * page already renders and highlights existing nodes/edges. It never fetches,
 * edits, or stores model configuration.
 */
function AnimationPreview({
	layout,
	frames,
}: {
	layout: ModelsBlueprintLayout;
	frames: readonly ModelsAnimationFrame[];
}) {
	const [frameIndex, setFrameIndex] = useState(0);
	useEffect(() => {
		if (frames.length < 2) return;
		const timer = setInterval(() => setFrameIndex(index => (index + 1) % frames.length), 1800);
		return () => clearInterval(timer);
	}, [frames.length]);
	const frame = frames.length === 0 ? undefined : frames[frameIndex % frames.length];
	const activeNodes = new Set(frame?.nodeIds ?? []);
	const activeEdges = new Set(frame?.edgeIds ?? []);
	return (
		<section className="models-section card models-animation-section">
			<header className="models-section-head">
				<h2>{pickLocale("动画预览", "Animation preview")}</h2>
				<span className="models-blueprint-meta">
					{frames.length} {pickLocale("帧", "frames")}
				</span>
			</header>
			<p className="models-readonly">
				{pickLocale(
					"纯展示：高亮同一快照投影中的节点与边，不持有另一份模型状态。",
					"Presentation only: highlights nodes and edges from this same snapshot projection; no second model state.",
				)}
			</p>
			{frame === undefined || layout.nodes.length === 0 ? (
				<p className="models-empty">{pickLocale("没有可播放的投影", "No projection to animate")}</p>
			) : (
				<>
					<p className="models-animation-caption">
						<strong>{frame.label}</strong>
						{frame.detail ? <span className="chip outline xs mono">{frame.detail}</span> : null}
					</p>
					<BlueprintCanvas layout={layout} activeNodes={activeNodes} activeEdges={activeEdges} />
				</>
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
	// One layout feeds both the static Blueprint and the animation preview.
	const layout = useMemo(() => (view === null ? null : layoutModelsBlueprint(view.blueprint)), [view]);

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
	if (view === null || layout === null) return null;

	const { snapshot: state, blueprint } = view;
	return (
		<div className="models-page">
			<header className="models-head">
				<div>
					<h1>{pickLocale("模型控制", "Model control")}</h1>
					<p className="models-subtitle">
						{pickLocale(
							"只读快照：供应商可见性、场景边界、角色、回退链、代理与类型化模型。",
							"Read-only snapshot: providers, scenario boundaries, roles, fallback chains, agents and typed models.",
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
						[pickLocale("场景", "scenarios"), state.totals.scenarios],
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
					<AnimationPreview layout={layout} frames={view.animation} />

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

					<ScenarioSection scenarios={state.scenarios} />

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
										<div className="models-kind-fallback">
											<h4>{pickLocale("本类回退链", "Fallback chains for this kind")}</h4>
											<FallbackChainList chains={section.fallback} />
										</div>
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
