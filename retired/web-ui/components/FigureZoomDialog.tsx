"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

interface FigureZoomDialogProps {
	/** Figure markup the caller has already trusted (Mermaid's own output, or a sanitized ```svg fence). */
	svg: string;
	/** Visible toolbar label, e.g. 「Mermaid 图表」/「SVG 图形」. */
	title: string;
	/** Accessible label for the dialog itself. */
	ariaLabel: string;
	/** Extra class on the canvas, for figure-family styling (e.g. the ```svg token aliases). */
	canvasClassName?: string;
	onClose: () => void;
}

/** Full-screen viewer shared by Mermaid blocks and ```svg figures. */
export function FigureZoomDialog({ svg, title, ariaLabel, canvasClassName, onClose }: FigureZoomDialogProps) {
	const { t } = useI18n();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [zoom, setZoom] = useState(1);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		dialog.showModal();

		return () => {
			document.body.style.overflow = previousOverflow;
			if (dialog.open) dialog.close();
		};
	}, []);

	return (
		<dialog
			ref={dialogRef}
			className="figure-zoom-dialog"
			aria-label={ariaLabel}
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
			onKeyDown={event => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				onClose();
			}}
		>
			<div className="figure-zoom-layout">
				<div className="figure-zoom-toolbar">
					<span className="figure-zoom-title">{title}</span>
					<div className="figure-zoom-actions">
						<div className="figure-zoom-stepper">
							<button
								type="button"
								onClick={() => setZoom(value => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
								disabled={zoom <= ZOOM_MIN}
								title={t("figure.zoom-out")}
								aria-label={t("figure.zoom-out")}
							>
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M5 12h14" />
								</svg>
							</button>
							<span className="figure-zoom-value">{Math.round(zoom * 100)}%</span>
							<button
								type="button"
								onClick={() => setZoom(value => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
								disabled={zoom >= ZOOM_MAX}
								title={t("figure.zoom-in")}
								aria-label={t("figure.zoom-in")}
							>
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M12 5v14M5 12h14" />
								</svg>
							</button>
						</div>
						<button
							type="button"
							className="figure-zoom-icon-button"
							onClick={() => setZoom(1)}
							title={t("figure.fit-width")}
							aria-label={t("figure.fit-width")}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
							</svg>
						</button>
						<button
							type="button"
							className="figure-zoom-icon-button"
							onClick={onClose}
							title={t("chat.close")}
							aria-label={t("chat.close")}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<path d="M6 6l12 12M18 6 6 18" />
							</svg>
						</button>
					</div>
				</div>
				<div
					className="figure-zoom-viewport"
					onClick={event => {
						if (event.target === event.currentTarget) onClose();
					}}
				>
					<div
						className={["figure-zoom-canvas", canvasClassName].filter(Boolean).join(" ")}
						style={{ width: `${zoom * 100}%` }}
						dangerouslySetInnerHTML={{ __html: svg }}
					/>
				</div>
			</div>
		</dialog>
	);
}
