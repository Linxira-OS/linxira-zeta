"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useShikiHighlight } from "@/hooks/useCodeTheme";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { FigureZoomDialog } from "./FigureZoomDialog";

interface MermaidBlockProps {
	code: string;
	isStreaming?: boolean;
	defaultPreview?: boolean;
}

type RenderState =
	| { key: string; status: "loading" }
	| { key: string; status: "error" }
	| { key: string; status: "ready"; svg: string };

export function MermaidBlock({ code, isStreaming, defaultPreview = false }: MermaidBlockProps) {
	const { t } = useI18n();
	const { isDark } = useTheme();
	const [showPreview, setShowPreview] = useState(defaultPreview);
	const [renderState, setRenderState] = useState<RenderState | null>(null);
	const [zoomOpen, setZoomOpen] = useState(false);
	const currentKey = `${isDark ? "dark" : "light"}\n${code}`;
	const previewVisible = showPreview && !isStreaming;

	useEffect(() => {
		if (!previewVisible) return;

		let cancelled = false;
		setRenderState({ key: currentKey, status: "loading" });

		const render = async () => {
			const { default: mermaid } = await import("mermaid");
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: "strict",
				suppressErrorRendering: true,
				theme: isDark ? "dark" : "default",
			});

			const parsed = await mermaid.parse(code, { suppressErrors: true });
			if (!parsed) throw new Error("Invalid Mermaid diagram");

			const id =
				typeof crypto !== "undefined" && "randomUUID" in crypto
					? `mermaid-${crypto.randomUUID()}`
					: `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const result = await mermaid.render(id, code);
			if (!cancelled) {
				setRenderState({ key: currentKey, status: "ready", svg: result.svg });
			}
		};

		render().catch(() => {
			if (!cancelled) setRenderState({ key: currentKey, status: "error" });
		});

		return () => {
			cancelled = true;
		};
	}, [code, currentKey, isDark, previewVisible]);

	const previewButton = (
		<button
			type="button"
			onClick={() => setShowPreview(v => !v)}
			disabled={isStreaming}
			title={
				isStreaming
					? t("mermaid.preview-after-streaming")
					: previewVisible
						? t("mermaid.show-source")
						: t("mermaid.preview-diagram")
			}
			className={["markdown-code-action", previewVisible ? "is-active" : ""].filter(Boolean).join(" ")}
		>
			{previewVisible ? t("source") : t("preview")}
		</button>
	);

	if (!previewVisible) {
		return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
	}

	const body =
		renderState?.key === currentKey && renderState.status === "error" ? (
			<div className="figure-block figure-block-error">{t("invalid-mermaid-diagram")}</div>
		) : renderState?.key !== currentKey || renderState.status !== "ready" ? (
			<div className="figure-block figure-block-loading" aria-label={t("mermaid.rendering")} />
		) : (
			<>
				{!zoomOpen && (
					<button
						type="button"
						className="figure-block figure-preview-button"
						title={t("mermaid.open-viewer")}
						aria-label={t("mermaid.open-viewer")}
						onClick={() => setZoomOpen(true)}
						dangerouslySetInnerHTML={{ __html: renderState.svg }}
					/>
				)}
				{zoomOpen && (
					<FigureZoomDialog
						svg={renderState.svg}
						title={t("mermaid-diagram")}
						ariaLabel={t("mermaid.viewer")}
						onClose={() => setZoomOpen(false)}
					/>
				)}
			</>
		);

	return (
		<div className="markdown-code-block">
			<div className="markdown-code-header">
				<span className="markdown-code-lang">mermaid</span>
				{previewButton}
			</div>
			{body}
		</div>
	);
}

interface CodeBlockProps {
	code: string;
	lang: string;
	headerAction?: ReactNode;
}

/**
 * Syntax-highlighted code block with copy button.
 * Used as the "source" view for Mermaid blocks and ```svg figures, and for all
 * other code fences.
 */
export function CodeBlock({ code, lang, headerAction }: CodeBlockProps) {
	const { t } = useI18n();
	const { lines } = useShikiHighlight(code, lang || "text");
	const [copied, setCopied] = useState(false);

	const copy = () => {
		copyText(code).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	const headerStyle = {
		background: "var(--syntax-header)",
		borderColor: "var(--interactive-border)",
		color: "var(--syntax-foreground)",
	};

	return (
		<div className="markdown-code-block" style={{ borderColor: "var(--interactive-border)" }}>
			<div className="markdown-code-header" style={headerStyle}>
				<span className="markdown-code-lang" style={{ color: "var(--syntax-keyword)" }}>
					{lang || "text"}
				</span>
				<div className="markdown-code-actions">
					{headerAction}
					<button
						onClick={copy}
						className="markdown-code-action"
						style={{
							color: "var(--syntax-foreground)",
							borderColor: "var(--interactive-border)",
						}}
					>
						{copied ? t("copied") : t("copy")}
					</button>
				</div>
			</div>
			<pre
				style={{
					margin: 0,
					padding: "11px 13px",
					fontFamily: "var(--font-mono)",
					fontSize: 12.5,
					lineHeight: 1.62,
					borderRadius: 0,
					background: "var(--syntax-background)",
					color: "var(--md-syntax-foreground)",
					overflowX: "auto",
				}}
			>
				<code style={{ fontFamily: "var(--font-mono)" }}>
					{lines.map((tokens, lineIndex) => (
						<span key={`code-line-${lineIndex}`}>
							<span
								style={{
									display: "inline-block",
									minWidth: "1.9em",
									marginRight: "0.9em",
									textAlign: "right",
									color: "var(--syntax-line-number)",
									userSelect: "none",
								}}
							>
								{lineIndex + 1}
							</span>
							{tokens.map((token, tokenIndex) => (
								<span key={`code-token-${tokenIndex}`} style={token.style}>
									{token.text}
								</span>
							))}
							{lineIndex < lines.length - 1 ? "\n" : null}
						</span>
					))}
				</code>
			</pre>
		</div>
	);
}
