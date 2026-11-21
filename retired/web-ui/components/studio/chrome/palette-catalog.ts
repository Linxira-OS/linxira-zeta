/**
 * Command-palette catalog.
 *
 * Ported from OMP Studio (`apps/renderer/src/commandPaletteCatalog.ts`, MIT) and
 * cut down to what Zeta can actually do:
 *
 * - Studio's `preview/*` fixtures are gone (this build paints no fixtures);
 * - actions that name a Studio-only surface (browser / computer panes, media,
 *   evaluation, diagnostics, MCP, model-config sub-tabs) are gone — the shell
 *   routes to the pages that exist, and a page with no gateway endpoint is not
 *   in `STUDIO_ROUTES` at all;
 * - every remaining action is a callback the shell passes in, never a
 *   `StudioClient` call.
 */

import type { StudioRoute, StudioSessionSummary } from "../adapters/types";
import { SHORTCUTS, formatShortcut, shortcutSearchText } from "./shortcuts";

export type PaletteAction =
	| { kind: "route"; route: StudioRoute }
	| { kind: "openSession"; sessionId: string }
	| { kind: "newSession" }
	| { kind: "toggleSidebar" }
	| { kind: "refresh" }
	| { kind: "cycleTheme" };

/**
 * What the chrome may invoke. An absent callback drops its item entirely — a
 * menu entry never renders as a dead row.
 */
export interface StudioPaletteActions {
	go(route: StudioRoute): void;
	openSession?(sessionId: string): void;
	newSession?(): void;
	toggleSidebar?(): void;
	refresh?(): void;
	cycleTheme?(): void;
	/** Titlebar File menu only: the palette is already open when it runs. */
	openPalette?(): void;
}

export interface PaletteItem {
	id: string;
	icon: string;
	label: string;
	meta?: string;
	hint?: string;
	keywords?: string;
	recentIndex?: number;
	action: PaletteAction;
}

export interface PaletteGroup {
	id: string;
	label: string;
	items: PaletteItem[];
}

export interface PaletteCatalogInput {
	/** Studio-shaped translate from `components/studio/i18n`. */
	t(key: string): string;
	query: string;
	sessions: readonly StudioSessionSummary[];
	actions: StudioPaletteActions;
	/** Title for a session row that has never been named. */
	untitledTitle: string;
}

const PAGE_ITEMS: ReadonlyArray<{ route: StudioRoute; icon: string; keywords: string }> = [
	{ route: "workbench", icon: "layout", keywords: "workbench conversation chat 工作台 对话" },
	{ route: "skills", icon: "book", keywords: "skills capabilities 技能" },
	{ route: "models", icon: "server", keywords: "models providers 模型 供应商" },
	{ route: "agents", icon: "bot", keywords: "agents subagents 子代理" },
	{ route: "git", icon: "branch", keywords: "git branches worktree 分支 提交" },
	{ route: "usage", icon: "pulse", keywords: "usage tokens stats 用量 统计" },
	{ route: "settings", icon: "settings", keywords: "settings preferences 设置" },
];

/** Last path segment of a workspace path; the sidebar prints the same name. */
function baseName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

function matches(item: PaletteItem, query: string): boolean {
	if (!query) return true;
	const haystack = `${item.label} ${item.meta ?? ""} ${item.keywords ?? ""} ${item.hint ?? ""}`;
	return haystack.toLowerCase().includes(query);
}

function recentItems(input: PaletteCatalogInput): PaletteItem[] {
	return input.sessions.slice(0, 9).map((session, index) => {
		const recentIndex = index + 1;
		return {
			id: `recent-${session.id}`,
			icon: "message",
			label: session.title.trim() === "" ? input.untitledTitle : session.title,
			meta: session.cwd ? baseName(session.cwd) : undefined,
			hint: formatShortcut({ key: String(recentIndex) }, "hint"),
			keywords: session.cwd,
			recentIndex,
			action: { kind: "openSession", sessionId: session.id },
		};
	});
}

function pageItems(input: PaletteCatalogInput): PaletteItem[] {
	return PAGE_ITEMS.map(item => ({
		id: `page-${item.route}`,
		icon: item.icon,
		label: input.t(`studio.route.${item.route}`),
		keywords: item.keywords,
		action: { kind: "route", route: item.route },
	}));
}

function actionItems(input: PaletteCatalogInput): PaletteItem[] {
	const { actions, t } = input;
	const items: PaletteItem[] = [];
	if (actions.newSession) {
		items.push({
			id: "new-session",
			icon: "plus",
			label: t("studio.chrome.palette.newSession"),
			hint: formatShortcut(SHORTCUTS.newSession, "hint"),
			keywords: `new session chat 新建 会话 ${shortcutSearchText(SHORTCUTS.newSession)}`,
			action: { kind: "newSession" },
		});
	}
	if (actions.toggleSidebar) {
		items.push({
			id: "toggle-sidebar",
			icon: "panel",
			label: t("studio.chrome.palette.toggleSidebar"),
			keywords: "sidebar layout 侧栏",
			action: { kind: "toggleSidebar" },
		});
	}
	if (actions.refresh) {
		items.push({
			id: "refresh",
			icon: "refresh",
			label: t("studio.chrome.palette.refresh"),
			keywords: "reload refresh projects sessions 刷新",
			action: { kind: "refresh" },
		});
	}
	if (actions.cycleTheme) {
		items.push({
			id: "cycle-theme",
			icon: "light",
			label: t("studio.chrome.palette.cycleTheme"),
			hint: formatShortcut(SHORTCUTS.cycleTheme, "hint"),
			keywords: `theme dark light 主题 ${shortcutSearchText(SHORTCUTS.cycleTheme)}`,
			action: { kind: "cycleTheme" },
		});
	}
	return items;
}

export function buildPaletteGroups(input: PaletteCatalogInput): PaletteGroup[] {
	const query = input.query.trim().toLowerCase();
	const { actions, t } = input;
	const groups: PaletteGroup[] = [];

	if (actions.openSession) {
		const chat = recentItems(input).filter(item => matches(item, query));
		if (chat.length) groups.push({ id: "chat", label: t("studio.chrome.palette.groupChat"), items: chat });
	}

	const pages = pageItems(input).filter(item => matches(item, query));
	if (pages.length) groups.push({ id: "pages", label: t("studio.chrome.palette.groupPages"), items: pages });

	const commands = actionItems(input).filter(item => matches(item, query));
	if (commands.length) groups.push({ id: "actions", label: t("studio.chrome.palette.groupActions"), items: commands });

	return groups;
}

export function flattenPaletteItems(groups: ReadonlyArray<PaletteGroup>): PaletteItem[] {
	return groups.flatMap(group => group.items);
}

/** Run one palette action through the callbacks the shell supplied. */
export function runPaletteAction(action: PaletteAction, actions: StudioPaletteActions): void {
	switch (action.kind) {
		case "route":
			actions.go(action.route);
			return;
		case "openSession":
			actions.openSession?.(action.sessionId);
			return;
		case "newSession":
			actions.newSession?.();
			return;
		case "toggleSidebar":
			actions.toggleSidebar?.();
			return;
		case "refresh":
			actions.refresh?.();
			return;
		case "cycleTheme":
			actions.cycleTheme?.();
	}
}
