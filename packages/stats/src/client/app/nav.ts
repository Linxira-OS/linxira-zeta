import {
	Activity,
	CircleAlert,
	Coins,
	Cpu,
	FolderGit2,
	Frown,
	LayoutGrid,
	type LucideIcon,
	PlugZap,
	Sparkles,
	SquareChartGantt,
	Wrench,
} from "lucide-react";
import type { MessageKey } from "../i18n";

export type DashboardSection =
	| "overview"
	| "models"
	| "providers"
	| "costs"
	| "requests"
	| "errors"
	| "traces"
	| "tools"
	| "frustration"
	| "projects"
	| "gain";

export interface NavItem {
	id: DashboardSection;
	/** Message key of the sidebar label; render through `t`. */
	labelKey: MessageKey;
	icon: LucideIcon;
	/** Second key of the `g <key>` jump shortcut. */
	hotkey: string;
}

export interface NavGroup {
	/** Message key of the group heading; render through `t`. */
	headingKey: MessageKey;
	items: readonly NavItem[];
}

/** Sidebar structure; the order here is the order on screen. */
export const NAV: readonly NavGroup[] = [
	{
		headingKey: "nav.usage",
		items: [
			{ id: "overview", labelKey: "nav.overview", icon: LayoutGrid, hotkey: "o" },
			{ id: "models", labelKey: "nav.models", icon: Cpu, hotkey: "m" },
			{ id: "providers", labelKey: "nav.providers", icon: PlugZap, hotkey: "p" },
			{ id: "costs", labelKey: "nav.costs", icon: Coins, hotkey: "c" },
		],
	},
	{
		headingKey: "nav.activity",
		items: [
			{ id: "requests", labelKey: "nav.requests", icon: Activity, hotkey: "r" },
			{ id: "errors", labelKey: "nav.errors", icon: CircleAlert, hotkey: "e" },
			{ id: "traces", labelKey: "nav.traces", icon: SquareChartGantt, hotkey: "t" },
		],
	},
	{
		headingKey: "nav.insights",
		items: [
			{ id: "tools", labelKey: "nav.tools", icon: Wrench, hotkey: "l" },
			{ id: "frustration", labelKey: "nav.frustration", icon: Frown, hotkey: "f" },
			{ id: "projects", labelKey: "nav.projects", icon: FolderGit2, hotkey: "j" },
			{ id: "gain", labelKey: "nav.gain", icon: Sparkles, hotkey: "g" },
		],
	},
];

export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap(group => group.items);

export const SECTIONS: readonly DashboardSection[] = NAV_ITEMS.map(item => item.id);

export function navItem(section: DashboardSection): NavItem {
	return NAV_ITEMS.find(item => item.id === section) ?? NAV_ITEMS[0];
}
