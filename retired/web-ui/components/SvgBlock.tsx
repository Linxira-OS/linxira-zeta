"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import { FigureZoomDialog } from "./FigureZoomDialog";
import { CodeBlock } from "./MermaidBlock";

interface SvgBlockProps {
	code: string;
	defaultPreview?: boolean;
}

type FigureState = { status: "ready"; svg: string } | { status: "error" };

/**
 * A ```svg fence drawn as an inline figure.
 *
 * The markup is model-authored, so it goes through DOMPurify (see
 * `lib/svg-sanitize`) before it reaches the DOM: on the server, and on the
 * first client paint, only the placeholder exists. The source stays one click
 * away, and is what an unrenderable figure falls back to.
 */
export function SvgBlock({ code, defaultPreview = false }: SvgBlockProps) {
	const { t } = useI18n();
	const [showPreview, setShowPreview] = useState(defaultPreview);
	const [figure, setFigure] = useState<FigureState | null>(null);
	const [zoomOpen, setZoomOpen] = useState(false);

	useEffect(() => {
		if (!showPreview) return;
		let clean: string | null = null;
		try {
			clean = sanitizeSvg(code);
		} catch {
			clean = null;
		}
		setFigure(clean === null ? { status: "error" } : { status: "ready", svg: clean });
	}, [code, showPreview]);

	const previewButton = (
		<button
			type="button"
			onClick={() => setShowPreview(value => !value)}
			title={showPreview ? t("svg.show-source") : t("svg.preview-figure")}
			className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
		>
			{showPreview ? t("source") : t("preview")}
		</button>
	);

	if (!showPreview) {
		return <CodeBlock code={code} lang="svg" headerAction={previewButton} />;
	}

	const body =
		figure === null ? (
			<div className="figure-block figure-block-loading" aria-label={t("svg.rendering")} />
		) : figure.status === "error" ? (
			<div className="figure-block figure-block-error">{t("invalid-svg-figure")}</div>
		) : (
			<>
				{!zoomOpen && (
					<button
						type="button"
						className="figure-block figure-preview-button svg-figure"
						title={t("svg.open-viewer")}
						aria-label={t("svg.open-viewer")}
						onClick={() => setZoomOpen(true)}
						dangerouslySetInnerHTML={{ __html: figure.svg }}
					/>
				)}
				{zoomOpen && (
					<FigureZoomDialog
						svg={figure.svg}
						title={t("svg-figure")}
						ariaLabel={t("svg.viewer")}
						canvasClassName="svg-figure"
						onClose={() => setZoomOpen(false)}
					/>
				)}
			</>
		);

	return (
		<div className="markdown-code-block">
			<div className="markdown-code-header">
				<span className="markdown-code-lang">svg</span>
				{previewButton}
			</div>
			{body}
		</div>
	);
}
