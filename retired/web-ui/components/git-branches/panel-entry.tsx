"use client";

import type { ReactNode } from "react";

/**
 * Dock-registry descriptor for the git-branch panel.
 *
 * The shell owns the panel registry (`web-ui/components/shell/panel-registry`),
 * so this file only supplies the declaration and the rail icon in the shape that
 * registry expects; registering it is a one-line import there plus a `case "git"`
 * in the shell's dock body.
 *
 * The icon stays here (not in the shell) because the glyph is this panel's own.
 * It is deliberately the same branch glyph the sidebar's current-branch badge
 * uses — one concept, one glyph — while the id `git` keeps it distinct from the
 * top bar's `branches` chip, which navigates the *session's* message tree.
 */
export interface GitBranchesPanelEntry {
	id: "git";
	titleKey: string;
	surface: "rail";
	kind: "dock";
	widthTier: "regular";
	exclusive: true;
	icon: ReactNode;
}

/** Rail/dock icon: a branch, drawn with `currentColor`. */
export function GitBranchesIcon({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<line x1="6" y1="3" x2="6" y2="15" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M18 9a9 9 0 0 1-9 9" />
		</svg>
	);
}

export const gitBranchesPanelEntry: GitBranchesPanelEntry = {
	id: "git",
	titleKey: "dock.window.branches",
	surface: "rail",
	kind: "dock",
	widthTier: "regular",
	exclusive: true,
	icon: <GitBranchesIcon />,
};
