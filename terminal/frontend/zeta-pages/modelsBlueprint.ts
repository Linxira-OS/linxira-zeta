/**
 * Blueprint projection for the model-control page.
 *
 * The Blueprint is a *view* of the exact same `ModelsControlSnapshot` the
 * tables render. It deliberately projects to typed nodes/edges and holds no
 * state of its own: an edit (or a refresh) that changes the snapshot changes
 * both views because there is nowhere else for them to read from.
 */
import type { ControlModelKind, ModelControlChain, ModelControlTarget, ModelsControlSnapshot } from "./modelsControl";

export type BlueprintNodeKind = "provider" | "role" | "agent" | "team" | "kind" | "model" | "fallback";

export interface BlueprintNode {
	readonly id: string;
	readonly kind: BlueprintNodeKind;
	readonly label: string;
	readonly detail?: string;
	readonly state?: string;
}

export interface BlueprintEdge {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly label?: string;
}

export interface ModelsBlueprint {
	readonly nodes: readonly BlueprintNode[];
	readonly edges: readonly BlueprintEdge[];
}

/** One state object plus its projection; the page never renders a second copy. */
export interface ModelsControlView {
	readonly snapshot: ModelsControlSnapshot;
	readonly blueprint: ModelsBlueprint;
}

const THINKING_SUFFIXES: Readonly<Record<string, true>> = {
	off: true,
	minimal: true,
	low: true,
	med: true,
	medium: true,
	hi: true,
	high: true,
	xhigh: true,
	max: true,
	auto: true,
	inherit: true,
};

/** Split a fallback selector into its catalog identity; role aliases stay literal. */
export function selectorIdentity(selector: string): { provider: string; id: string } | undefined {
	let value = selector.trim();
	if (value === "" || value.startsWith("@")) return undefined;
	const colon = value.lastIndexOf(":");
	if (colon > 0 && THINKING_SUFFIXES[value.slice(colon + 1).toLowerCase()] === true) {
		value = value.slice(0, colon);
	}
	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return undefined;
	return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

/**
 * Project the snapshot onto typed nodes/edges. Providers expose capability
 * kind edges, roles/targets point at their primary and fallback models, and
 * every configured fallback scope contributes key → entry edges.
 */
export function projectModelsBlueprint(snapshot: ModelsControlSnapshot): ModelsBlueprint {
	const nodes = new Map<string, BlueprintNode>();
	const edges = new Map<string, BlueprintEdge>();

	const ensureNode = (node: BlueprintNode): string => {
		const existing = nodes.get(node.id);
		if (existing === undefined) nodes.set(node.id, node);
		return node.id;
	};
	const addEdge = (from: string, to: string, label?: string): void => {
		if (from === to) return;
		const id = label === undefined ? `${from}->${to}` : `${from}->${to}:${label}`;
		if (!edges.has(id)) edges.set(id, { id, from, to, ...(label === undefined ? {} : { label }) });
	};
	const ensureKind = (kind: ControlModelKind, detail?: string): string =>
		ensureNode({
			id: `kind:${kind}`,
			kind: "kind",
			label: kind,
			...(detail === undefined ? {} : { detail }),
		});
	const ensureModel = (provider: string, id: string, name?: string): string =>
		ensureNode({
			id: `model:${provider}/${id}`,
			kind: "model",
			label: name ?? `${provider}/${id}`,
			detail: `${provider}/${id}`,
		});
	const ensureSelector = (selector: string, scope: string): string => {
		const identity = selectorIdentity(selector);
		if (identity !== undefined) return ensureModel(identity.provider, identity.id);
		return ensureNode({
			id: `fallback:${scope}:${selector}`,
			kind: "fallback",
			label: selector,
			detail: scope,
		});
	};
	const addTarget = (target: ModelControlTarget, prefix: string, label: string): void => {
		const targetId = ensureNode({
			id: `${prefix}:${target.target}`,
			kind: target.kind,
			label,
			detail: target.selector,
			state: target.source,
		});
		if (target.resolved !== undefined) {
			addEdge(targetId, ensureModel(target.resolved.provider, target.resolved.id, target.resolved.name), "selects");
		}
		for (const entry of target.fallback) addEdge(targetId, ensureSelector(entry, "fallback"), "fallback");
	};
	const addChains = (chains: readonly ModelControlChain[], scope: string): void => {
		for (const chain of chains) {
			const keyId =
				nodes.get(`role:${chain.key}`)?.id ??
				nodes.get(`provider:${chain.key}`)?.id ??
				(chain.key.endsWith("/*") ? nodes.get(`provider:${chain.key.slice(0, -2)}`)?.id : undefined) ??
				nodes.get(`agent:${chain.key}`)?.id ??
				nodes.get(`team:${chain.key}`)?.id ??
				ensureSelector(chain.key, scope);
			for (const entry of chain.chain) addEdge(keyId, ensureSelector(entry, scope), `fallback:${scope}`);
		}
	};

	for (const section of snapshot.kinds) {
		ensureKind(section.kind, String(section.models.length));
	}

	for (const provider of snapshot.providers) {
		const providerId = ensureNode({
			id: `provider:${provider.id}`,
			kind: "provider",
			label: provider.name,
			detail: String(provider.modelCount),
			state: provider.state,
		});
		for (const kind of provider.capabilities) addEdge(providerId, ensureKind(kind), "supports");
		for (const kind of provider.paused) addEdge(providerId, ensureKind(kind), "paused");
	}

	for (const role of snapshot.roles) {
		const roleId = ensureNode({
			id: `role:${role.role}`,
			kind: "role",
			label: role.role,
			detail: role.selector ?? "unassigned",
			state: role.resolved === undefined ? "unresolved" : (role.resolved.kind ?? "model"),
		});
		if (role.resolved !== undefined) {
			addEdge(roleId, ensureModel(role.resolved.provider, role.resolved.id, role.resolved.name), "selects");
		}
		for (const entry of role.fallback) addEdge(roleId, ensureSelector(entry, "fallback"), "fallback");
	}

	for (const agent of snapshot.agents) addTarget(agent, agent.kind === "team" ? "team" : "agent", agent.target);
	for (const target of snapshot.teamTargets) addTarget(target, "team", target.target);
	for (const target of snapshot.vibeTargets) addTarget(target, "vibe", `${target.target} (vibe)`);

	for (const scope of snapshot.fallbackScopes) addChains(scope.chains, scope.scope);
	addChains(snapshot.legacyRetry, "legacy-retry");

	return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export interface BlueprintLayoutNode extends BlueprintNode {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly column: number;
}

export interface BlueprintLayoutEdge extends BlueprintEdge {
	readonly path: string;
}

export interface ModelsBlueprintLayout {
	readonly width: number;
	readonly height: number;
	readonly nodes: readonly BlueprintLayoutNode[];
	readonly edges: readonly BlueprintLayoutEdge[];
}

const COLUMN_ORDER: readonly BlueprintNodeKind[] = ["provider", "role", "agent", "team", "kind", "model", "fallback"];
const NODE_WIDTH = 190;
const NODE_HEIGHT = 46;
const COLUMN_GAP = 88;
const ROW_GAP = 12;
const PADDING = 24;

/** Deterministic column layout; the renderer draws exactly these nodes/edges. */
export function layoutModelsBlueprint(blueprint: ModelsBlueprint): ModelsBlueprintLayout {
	const byKind = new Map<BlueprintNodeKind, BlueprintNode[]>();
	for (const node of blueprint.nodes) {
		const entries = byKind.get(node.kind) ?? [];
		entries.push(node);
		byKind.set(node.kind, entries);
	}
	const positioned: BlueprintLayoutNode[] = [];
	const positions = new Map<string, BlueprintLayoutNode>();
	let maxRows = 0;
	for (const [column, kind] of COLUMN_ORDER.entries()) {
		const entries = byKind.get(kind) ?? [];
		maxRows = Math.max(maxRows, entries.length);
		for (const [row, node] of entries.entries()) {
			const positionedNode: BlueprintLayoutNode = {
				...node,
				x: PADDING + column * (NODE_WIDTH + COLUMN_GAP),
				y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
				column,
			};
			positioned.push(positionedNode);
			positions.set(node.id, positionedNode);
		}
	}
	const edges: BlueprintLayoutEdge[] = [];
	for (const edge of blueprint.edges) {
		const from = positions.get(edge.from);
		const to = positions.get(edge.to);
		if (from === undefined || to === undefined) continue;
		const x1 = from.x + from.width;
		const y1 = from.y + from.height / 2;
		const x2 = to.x;
		const y2 = to.y + to.height / 2;
		const bend = Math.max(28, Math.abs(x2 - x1) / 2);
		edges.push({
			...edge,
			path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
		});
	}
	const columns = COLUMN_ORDER.length;
	return {
		width: PADDING * 2 + columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP,
		height: PADDING * 2 + Math.max(1, maxRows) * NODE_HEIGHT + (Math.max(1, maxRows) - 1) * ROW_GAP,
		nodes: positioned,
		edges,
	};
}

/** The page's one derived view: the original state plus its Blueprint. */
export function buildModelsControlView(snapshot: ModelsControlSnapshot): ModelsControlView {
	return { snapshot, blueprint: projectModelsBlueprint(snapshot) };
}
