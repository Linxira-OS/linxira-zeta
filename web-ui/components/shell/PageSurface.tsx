import type { ReactNode } from "react";
import { SHELL_MODE_ATTRIBUTE, SHELL_REGION_ATTRIBUTE } from "@/lib/shell-mode";

export interface PageSurfaceProps {
	/** Accessible name of the mounted page. */
	label?: string;
	children?: ReactNode;
}

/**
 * Minimal frame a page mounts in ("panel mode"): the page's own content,
 * full-bleed — no sidebar, no top bar, no tool dock, no outer padding and no
 * border of its own. The host owns the frame, so this adds exactly one region
 * (`center`) carrying `data-shell-mode="panel"`.
 *
 * Chat-independent by construction: a web plugin's page (or any other
 * `/api`-backed page) renders inside it the same way the chat surface does when
 * mounted with `?mode=panel`. Keep chrome out of pages — a page that needs a
 * column of its own belongs in `ShellLayout`'s slot set instead.
 */
export function PageSurface({ label, children }: PageSurfaceProps) {
	return (
		<div
			className="page-surface"
			{...{ [SHELL_REGION_ATTRIBUTE]: "center", [SHELL_MODE_ATTRIBUTE]: "panel" }}
			aria-label={label}
		>
			{children}
		</div>
	);
}
