import { beforeAll, describe, expect, it } from "bun:test";
import { visibleWidth } from "@linxiraos/pi-tui";
import { createGallerySegmentContext } from "../../../src/cli/gallery-fixtures/segments";
import { Settings } from "../../../src/config/settings";
import {
	SIDEBAR_WIDTH,
	SidebarComponent,
	type SidebarMcpSource,
	type SidebarSessionSource,
	type SidebarSources,
} from "../../../src/modes/components/sidebar";
import type { SegmentContext } from "../../../src/modes/components/status-line/types";
import type { ObservableSession } from "../../../src/modes/session-observer-registry";
import { getThemeByName, setThemeInstance, theme } from "../../../src/modes/theme/theme";
import type { TodoPhase } from "../../../src/tools/todo";

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	const loaded = await getThemeByName("dark");
	if (!loaded) throw new Error("theme unavailable");
	setThemeInstance(loaded);
});

function statusLineWith(overrides: Partial<SegmentContext> = {}): SidebarSources["statusLine"] {
	return {
		getSidebarContext: (width: number): SegmentContext => ({
			...createGallerySegmentContext(),
			...overrides,
			width,
		}),
	};
}

function sessionWith(phases: TodoPhase[] = [], name?: string): SidebarSessionSource {
	return {
		sessionName: name,
		sessionId: "ab12cd34ef56ab12",
		getTodoPhases: () => phases,
	};
}

function subagent(status: ObservableSession["status"], label: string): ObservableSession {
	return { id: label, kind: "subagent", label, status, lastUpdate: 0 };
}

function mcpSource(connected: number, pending: number, failed: number): SidebarMcpSource {
	return {
		connected: new Set(Array.from({ length: connected }, (_, i) => `c${i}`)),
		pending: new Set(Array.from({ length: pending }, (_, i) => `p${i}`)),
		failed: new Map(Array.from({ length: failed }, (_, i) => [`f${i}`, { error: "boom" }])),
	};
}

function renderSidebar(sources: SidebarSources, width: number = SIDEBAR_WIDTH): string[] {
	return [...new SidebarComponent(sources).render(width)];
}

function bareSessionSources(sources: Omit<SidebarSources, "statusLine" | "session">): SidebarSources {
	return {
		statusLine: statusLineWith({ planMode: null, contextPercent: null }),
		session: sessionWith(),
		...sources,
	};
}

describe("SidebarComponent", () => {
	it("renders a session header with the session name and active duration", () => {
		const rows = renderSidebar({
			statusLine: statusLineWith({ activeMs: 90_000, contextPercent: null }),
			session: sessionWith([], "Refactor parser"),
		});
		expect(rows.some(row => row.includes("Refactor parser"))).toBe(true);
		expect(rows.some(row => row.includes("1m30s"))).toBe(true);
	});

	it("falls back to the short session id when the session is unnamed", () => {
		const rows = renderSidebar({
			statusLine: statusLineWith({ contextPercent: null }),
			session: sessionWith([]),
		});
		expect(rows.some(row => row.includes("ab12cd34"))).toBe(true);
	});

	it("renders the compact context gauge without the legacy token-detail row", () => {
		const rows = renderSidebar({
			statusLine: statusLineWith({ contextPercent: 62 }),
			session: sessionWith([]),
		});
		const gaugeRow = rows.find(row => row.includes("62%"));
		expect(gaugeRow).toBeDefined();
		expect(gaugeRow).toContain("▰".repeat(6));
		expect(rows.every(row => !/tok\b/.test(row))).toBe(true);
	});

	it("renders todo progress with status icons and the checked box for completed work", () => {
		const phases: TodoPhase[] = [
			{
				name: "Phase 1",
				tasks: [
					{ content: "Scaffold project", status: "completed" },
					{ content: "Write parser tests", status: "in_progress" },
					{ content: "Wire the CLI", status: "pending" },
				],
			},
		];
		const rows = renderSidebar({
			statusLine: statusLineWith({ planMode: null, contextPercent: null }),
			session: sessionWith(phases),
		});
		expect(rows.some(row => row.includes("Todos"))).toBe(true);
		expect(rows.some(row => row.includes("1/3"))).toBe(true);
		const completedRow = rows.find(row => row.includes("Scaffold project"));
		expect(completedRow).toContain(theme.checkbox.checked);
		const inProgressIdx = rows.findIndex(row => row.includes("Write parser tests"));
		const pendingIdx = rows.findIndex(row => row.includes("Wire the CLI"));
		expect(inProgressIdx).toBeGreaterThanOrEqual(0);
		expect(pendingIdx).toBeGreaterThan(inProgressIdx);
	});

	it("labels the todo panel as plan mode while plan mode is enabled", () => {
		const phases: TodoPhase[] = [{ name: "Phase 1", tasks: [{ content: "Draft the spec", status: "in_progress" }] }];
		const rows = renderSidebar({
			statusLine: statusLineWith({ contextPercent: null }),
			session: sessionWith(phases),
		});
		expect(rows.some(row => row.includes("Plan Mode"))).toBe(true);
		expect(rows.every(row => !row.includes("Todos"))).toBe(true);
	});

	it("summarizes hidden todo rows instead of overflowing the panel", () => {
		const phases: TodoPhase[] = [
			{
				name: "Phase 1",
				tasks: Array.from({ length: 6 }, (_, i) => ({ content: `Task ${i}`, status: "pending" as const })),
			},
		];
		const rows = renderSidebar({
			statusLine: statusLineWith({ planMode: null, contextPercent: null }),
			session: sessionWith(phases),
		});
		const todoRows = rows.filter(row => row.includes("Task "));
		expect(todoRows.length).toBeLessThanOrEqual(4);
		expect(rows.some(row => row.includes("2 more todos"))).toBe(true);
	});

	it("hides the todo panel when the session has no phases", () => {
		const rows = renderSidebar(bareSessionSources({}));
		expect(rows.every(row => !row.includes("Todos"))).toBe(true);
		expect(rows.every(row => !row.includes("Plan Mode"))).toBe(true);
	});

	it("renders subagent status dots with active work first and caps the rows", () => {
		const sessions = [
			subagent("completed", "reviewer-alpha"),
			subagent("active", "worker-one"),
			subagent("active", "worker-two"),
		];
		const rows = renderSidebar(bareSessionSources({ subagents: () => sessions }));
		expect(rows.some(row => row.includes("Subagents") && row.includes("2/3 running"))).toBe(true);
		const oneIdx = rows.findIndex(row => row.includes("worker-one"));
		const twoIdx = rows.findIndex(row => row.includes("worker-two"));
		const doneIdx = rows.findIndex(row => row.includes("reviewer-alpha"));
		expect(oneIdx).toBeGreaterThan(0);
		expect(oneIdx).toBeLessThan(doneIdx);
		expect(twoIdx).toBeLessThan(doneIdx);
	});

	it("caps subagent rows at the visible limit", () => {
		const sessions = Array.from({ length: 11 }, (_, i) => subagent("active", `agent-${String(i).padStart(2, "0")}`));
		const rows = renderSidebar(bareSessionSources({ subagents: () => sessions }));
		const labeled = rows.filter(row => /agent-\d{2}/.test(row));
		expect(labeled.length).toBe(8);
	});

	it("hides the subagent panel when the registry tracks no subagents", () => {
		const rows = renderSidebar(bareSessionSources({ subagents: () => [] }));
		expect(rows.every(row => !row.includes("Subagents"))).toBe(true);
	});

	it("renders MCP server counts with per-state dots and hides when all zero", () => {
		const rows = renderSidebar(bareSessionSources({ mcp: mcpSource(2, 1, 1) }));
		expect(rows.some(row => row.includes("MCP") && row.includes("4 servers"))).toBe(true);
	});

	it("hides the MCP panel when every set is empty", () => {
		const rows = renderSidebar(bareSessionSources({ mcp: mcpSource(0, 0, 0) }));
		expect(rows.every(row => !row.includes("MCP"))).toBe(true);
	});

	it("never renders the removed status-line duplicate rows (model, usage, git)", () => {
		const rows = renderSidebar({
			statusLine: statusLineWith(),
			session: sessionWith([], "Full session"),
		});
		expect(rows.every(row => !row.includes(theme.icon.model))).toBe(true);
		expect(rows.every(row => !row.includes(theme.icon.branch))).toBe(true);
		expect(rows.every(row => !/\$\d+\.\d{2}/.test(row))).toBe(true);
		expect(rows.every(row => !/tok\b/.test(row))).toBe(true);
	});

	it("truncates every row to the sidebar width without throwing on long content", () => {
		const longPhases: TodoPhase[] = [
			{
				name: "P",
				tasks: [{ content: "x".repeat(200), status: "in_progress" }],
			},
		];
		const rows = renderSidebar({
			statusLine: statusLineWith({ contextPercent: 62 }),
			session: sessionWith(longPhases, `${"long-session-name-".repeat(6)}`),
			subagents: () => [subagent("active", `${"y".repeat(120)}`)],
			mcp: mcpSource(1, 0, 0),
		});
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(visibleWidth(row)).toBeLessThanOrEqual(SIDEBAR_WIDTH);
		}
	});
});
