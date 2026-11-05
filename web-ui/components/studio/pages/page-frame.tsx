"use client";

/**
 * Studio page frame — title row plus an independently scrolling body.
 *
 * Same markup as Studio's `Page` shell (`page`, `page-head`, `page-title`,
 * `page-subtitle`, `page-actions`, `page-body`), whose rules are already in
 * `styles/studio/pages.css`. Pages render only their own content.
 */

import type { ReactNode } from "react";

export function PageFrame({
	title,
	subtitle,
	actions,
	children,
}: {
	title: string;
	subtitle?: string | null;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="page">
			<header className="page-head">
				<div className="page-head-text">
					<h1 className="page-title">{title}</h1>
					{subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
				</div>
				{actions ? <div className="page-actions">{actions}</div> : null}
			</header>
			<div className="page-body">{children}</div>
		</section>
	);
}

/** Inline error/notice banner; `className` carries `banner red` / `banner amber`. */
export function PageBanner({ className, children }: { className: string; children: ReactNode }) {
	return (
		<div className={className} role="alert">
			{children}
		</div>
	);
}

/** Empty state for a page region with no rows. */
export function PageEmpty({ children }: { children: ReactNode }) {
	return <p className="muted small">{children}</p>;
}
