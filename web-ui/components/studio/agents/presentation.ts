/**
 * Agent Hub presentation helpers.
 *
 * Ported from OMP Studio (MIT) `AgentHub.tsx` (formatting, status pills, the
 * parent/child grouping used by the tree view). Studio also merged preview and
 * historical snapshots here; Zeta has one roster, so the helpers take
 * `HubAgent` directly.
 */

import type { HubAgent, HubStatus, HubView } from "./types";

/** Chinese wording for the Hub's fixed labels, mirroring Studio's `hubWord`. */
const HUB_WORDS: Record<string, string> = {
	running: "运行中",
	idle: "空闲",
	parked: "已停驻",
	aborted: "已中止",
	starting: "启动中",
	reviving: "恢复中",
	failed: "失败",
	released: "已释放",
	Subagent: "子代理",
	Advisor: "顾问",
};

export function hubWord(value: string, zh: boolean): string {
	if (!zh) return value;
	return HUB_WORDS[value] ?? value;
}

export function hubStatus(agent: HubAgent): HubStatus {
	if (agent.rawStatus === "failed" || agent.rawStatus === "released") {
		return agent.rawStatus === "failed" ? "failed" : "released";
	}
	return agent.status;
}

/** The colored pill on a roster row: what the child is doing right now. */
export function activityPill(agent: HubAgent, zh = false): { cls: string; label: string } {
	const copy = (cn: string, en: string) => (zh ? cn : en);
	if (agent.status === "aborted" || agent.status === "failed" || agent.status === "released") {
		return {
			cls: "aborted",
			label:
				agent.status === "failed"
					? copy("失败", "Failed")
					: agent.status === "released"
						? copy("已释放", "Released")
						: copy("已中止", "Aborted"),
		};
	}
	if (agent.status === "running") {
		return agent.stage
			? { cls: "tool", label: `${copy("工具执行中", "Running tool")} · ${agent.stage}` }
			: { cls: "thinking", label: copy("思考中", "Thinking") };
	}
	if (agent.status === "idle") return { cls: "idle", label: copy("空闲", "Idle") };
	if (agent.status === "parked") return { cls: "parked", label: copy("已停驻", "Parked") };
	if (agent.status === "starting") return { cls: "waiting", label: copy("启动中", "Starting") };
	if (agent.status === "reviving") return { cls: "waiting", label: copy("恢复中", "Reviving") };
	return { cls: "parked", label: agent.status };
}

export function fmtAge(ts: number, now: number, zh = true): string {
	if (!Number.isFinite(ts) || ts <= 0) return "—";
	const delta = Math.max(0, now - ts);
	const minute = 60_000;
	if (delta < minute) return zh ? "刚刚" : "just now";
	const minutes = Math.floor(delta / minute);
	if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return zh ? `${days} 天前` : `${days}d ago`;
}

export function fmtDur(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}

export function fmtClock(ts: number): string {
	if (!Number.isFinite(ts) || ts <= 0) return "—";
	return new Date(ts).toLocaleTimeString();
}

export function fmtHM(ts: number): string {
	if (!Number.isFinite(ts) || ts <= 0) return "—";
	const date = new Date(ts);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function fmtCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "—";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(2)}`;
}

export function fmtNum(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
	return String(Math.round(value));
}

/** Token spark bars: 1–3 lit, so a glance tells a busy child from an idle one. */
export function sparkLevel(tokens: number): number {
	if (!Number.isFinite(tokens) || tokens <= 0) return 0;
	if (tokens >= 100_000) return 3;
	if (tokens >= 20_000) return 2;
	return 1;
}

/**
 * Parent/child grouping for the tree view: an agent that spawned others is a
 * group head, its direct children are the leaves, everything else is an orphan
 * row. Mirrors Studio's `treeGroups`.
 */
export function treeGroups(rows: readonly HubAgent[]): {
	groups: Array<{ head: HubAgent; kids: HubAgent[] }>;
	orphans: HubAgent[];
} {
	const byId = new Map(rows.map(agent => [agent.id, agent]));
	const hasVisibleParent = (agent: HubAgent) => Boolean(agent.parentId && byId.has(agent.parentId));
	const heads = rows.filter(agent => !hasVisibleParent(agent) && rows.some(row => row.parentId === agent.id));
	const used = new Set(heads.map(head => head.id));
	const groups = heads.map(head => {
		const kids = rows.filter(row => row.parentId === head.id);
		for (const kid of kids) used.add(kid.id);
		return { head, kids };
	});
	return { groups, orphans: rows.filter(agent => !used.has(agent.id)) };
}

/** Row order for the list, flattened for keyboard navigation. */
export function linearSeq(rows: readonly HubAgent[], view: HubView): HubAgent[] {
	if (view !== "tree") return [...rows];
	const tree = treeGroups(rows);
	return [...tree.groups.flatMap(group => [group.head, ...group.kids]), ...tree.orphans];
}

export function countByStatus(rows: readonly HubAgent[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const agent of rows) {
		const key = hubStatus(agent);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

/* These are `.dot` / chip variant class *names*, never paint. */
/* zeta-style-literal-allow-start: chip and dot variant class names, not colours */
export const STATUS_DOT: Record<string, string> = {
	running: "green",
	idle: "blue",
	parked: "amber",
	aborted: "red",
	failed: "red",
	released: "gray",
	starting: "blue",
	reviving: "amber",
};

/** Chip variant for an agent kind, matching Studio's picker. */
export function kindChip(kind: "sub" | "advisor"): string {
	return kind === "advisor" ? "gray" : "purple";
}

/** `.dot` variant for a status, with the neutral fallback Studio uses. */
export function statusDot(status: string): string {
	return STATUS_DOT[status] ?? "gray";
}
/* zeta-style-literal-allow-end */
