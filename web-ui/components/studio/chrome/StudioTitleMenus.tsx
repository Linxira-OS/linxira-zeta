"use client";

/**
 * StudioTitleMenus — the titlebar's File / Edit / View menus.
 *
 * Ported from OMP Studio (`App.tsx` → the `Titlebar menus={...}` composition and
 * `execEditCommand`, MIT). Items are filtered against the callbacks the shell
 * supplied, so a menu never shows an entry that cannot act: with no sidebar
 * callback there is no "toggle sidebar" row.
 *
 * Studio's Help menu (About / keyboard shortcuts dialogs) is not ported — those
 * dialogs belong to the About surface, not the window chrome.
 */

import type { StudioRoute } from "../adapters/types";
import { useI18n } from "@/hooks/useI18n";
import { TitleMenu } from "./TitleMenu";
import type { StudioPaletteActions } from "./palette-catalog";
import { SHORTCUTS, formatShortcut } from "./shortcuts";

type EditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

const EDIT_ITEMS: ReadonlyArray<{ command: EditCommand; key: string; shortcut?: keyof typeof SHORTCUTS }> = [
	{ command: "undo", key: "studio.chrome.menu.undo", shortcut: "undo" },
	{ command: "redo", key: "studio.chrome.menu.redo", shortcut: "redo" },
	{ command: "cut", key: "studio.chrome.menu.cut", shortcut: "cut" },
	{ command: "copy", key: "studio.chrome.menu.copy", shortcut: "copy" },
	{ command: "paste", key: "studio.chrome.menu.paste", shortcut: "paste" },
	{ command: "selectAll", key: "studio.chrome.menu.selectAll", shortcut: "selectAll" },
];

const ROUTE_ITEMS: ReadonlyArray<{ route: StudioRoute; icon: string }> = [
	{ route: "skills", icon: "book" },
	{ route: "models", icon: "server" },
	{ route: "agents", icon: "bot" },
	{ route: "git", icon: "branch" },
	{ route: "usage", icon: "pulse" },
	{ route: "settings", icon: "settings" },
];

/** Drive the focused field's native editing command (Studio's behaviour). */
function execEditCommand(command: EditCommand): void {
	try {
		document.execCommand(command);
	} catch {
		// Chromium may reject an unsupported edit command; the field is unchanged.
	}
}

export function StudioTitleMenus({ actions }: { actions: StudioPaletteActions }) {
	const { t } = useI18n();

	return (
		<>
			<TitleMenu id="file" label={t("studio.chrome.menu.file")}>
				{actions.newSession ? (
					<button type="button" className="menu-item" role="menuitem" onClick={actions.newSession}>
						{t("studio.chrome.palette.newSession")}
						<span className="kbd">{formatShortcut(SHORTCUTS.newSession)}</span>
					</button>
				) : null}
				{ROUTE_ITEMS.map(item => (
					<button
						key={item.route}
						type="button"
						className="menu-item"
						role="menuitem"
						onClick={() => actions.go(item.route)}
					>
						{t(`studio.route.${item.route}`)}
					</button>
				))}
				<div className="menu-sep" />
				{actions.openPalette ? (
					<button type="button" className="menu-item" role="menuitem" onClick={actions.openPalette}>
						{t("studio.chrome.menu.commandPalette")}
						<span className="kbd">{formatShortcut(SHORTCUTS.commandPalette)}</span>
					</button>
				) : null}
				{actions.refresh ? (
					<button type="button" className="menu-item" role="menuitem" onClick={actions.refresh}>
						{t("studio.chrome.menu.refresh")}
					</button>
				) : null}
			</TitleMenu>

			<TitleMenu id="edit" label={t("studio.chrome.menu.edit")}>
				{EDIT_ITEMS.map((item, index) => (
					<div key={item.command}>
						{index === 2 ? <div className="menu-sep" /> : null}
						<button
							type="button"
							className="menu-item"
							role="menuitem"
							onClick={() => execEditCommand(item.command)}
						>
							{t(item.key)}
							{item.shortcut ? <span className="kbd">{formatShortcut(SHORTCUTS[item.shortcut])}</span> : null}
						</button>
					</div>
				))}
			</TitleMenu>

			<TitleMenu id="view" label={t("studio.chrome.menu.view")}>
				{actions.toggleSidebar ? (
					<button type="button" className="menu-item" role="menuitem" onClick={actions.toggleSidebar}>
						{t("studio.chrome.menu.toggleSidebar")}
					</button>
				) : null}
				{actions.cycleTheme ? (
					<button type="button" className="menu-item" role="menuitem" onClick={actions.cycleTheme}>
						{t("studio.chrome.menu.cycleTheme")}
						<span className="kbd">{formatShortcut(SHORTCUTS.cycleTheme)}</span>
					</button>
				) : null}
			</TitleMenu>
		</>
	);
}
