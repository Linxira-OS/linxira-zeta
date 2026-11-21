"use client";

/**
 * StudioSecondaryPage — the frame every non-workbench page sits in.
 *
 * Ported from OMP Studio (`apps/renderer/src/HomePage.tsx` → `SecondaryPage`,
 * MIT). Studio's version also rendered the top-level route nav and the theme
 * toggle in the header; the Zeta shell owns navigation (topbar + sidebar) and
 * theme (one `<html data-theme>` store), so those slots are gone and `actions`
 * takes the right-hand side instead.
 *
 * The body keeps Studio's deferred-key transition: the previous page's children
 * stay mounted for `PAGE_EXIT_MS` while the new key fades in, so a route switch
 * never flashes an empty column. First mount is intentionally still (Studio's
 * `bodyMotionLive` guard) — a page opening should not animate itself.
 */

import { useRef, type ReactNode } from "react";
import { Icon } from "../primitives/icons";
import { pagePhaseClass, useDeferredKey } from "../primitives/pageTransition";
import { useI18n } from "@/hooks/useI18n";

export interface StudioSecondaryPageProps {
	title: string;
	/** Icon name from `primitives/icons`; rendered before the title when set. */
	icon?: string;
	onBack(): void;
	/** Stable key for the body transition + the `data-route` CSS hooks. */
	route?: string;
	actions?: ReactNode;
	children: ReactNode;
}

export function StudioSecondaryPage({ title, icon, onBack, route, actions, children }: StudioSecondaryPageProps) {
	const { t } = useI18n();
	const key = route ?? title;
	const { shown, phase } = useDeferredKey(key);

	const heldChildren = useRef(children);
	if (key === shown) heldChildren.current = children;
	const body = key === shown ? children : heldChildren.current;

	const motionLive = useRef(false);
	if (key !== shown) motionLive.current = true;
	const bodyPhase = motionLive.current ? phase : null;

	return (
		<section className="page" id="studioPageRoot" data-route={shown}>
			<header className="page-head page-head-chrome">
				<button
					type="button"
					className="icon-btn"
					data-tip={t("studio.chrome.page.back")}
					aria-label={t("studio.chrome.page.back")}
					onClick={onBack}
				>
					<Icon name="arrow-l" />
				</button>
				<span className="ph-title">
					{icon ? <Icon name={icon} extra="sm" /> : null}
					{title}
				</span>
				<span className="spacer" />
				{actions}
			</header>
			<div
				className={bodyPhase ? `page-body ${pagePhaseClass(bodyPhase)}` : "page-body"}
				tabIndex={-1}
				data-route={shown}
			>
				{body}
			</div>
		</section>
	);
}
