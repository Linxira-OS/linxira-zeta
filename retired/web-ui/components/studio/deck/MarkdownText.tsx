"use client";

/**
 * Markdown for the deck and plan surfaces.
 *
 * Ported from OMP Studio (MIT) `conversation/markdown.tsx` — only the static
 * subset: plan bodies and ask questions never stream, so the upstream
 * incremental block scanner, syntax highlighting worker, mermaid and graphic
 * previews are not carried. Rendering stays `react-markdown` + GFM so the
 * output matches Studio's shape (`.ev-body` + `.studio-md`, `.md-inline`).
 */

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK = [remarkGfm];

/** `http(s)`, `mailto:` and absolute paths only; `javascript:`/`data:` links are dropped. */
function isSafeMarkdownUrl(url: string, allowImageData = false): boolean {
	if (url.length === 0) return false;
	const lowered = url.toLowerCase();
	if (lowered.startsWith("javascript:") || lowered.startsWith("vbscript:")) return false;
	if (allowImageData && lowered.startsWith("data:image/")) return true;
	return (
		lowered.startsWith("http://") ||
		lowered.startsWith("https://") ||
		lowered.startsWith("mailto:") ||
		lowered.startsWith("/") ||
		lowered.startsWith("#")
	);
}

/** Same component map for block and inline use; inline wraps through `unwrapDisallowed`. */
function componentsFor(options: { links: boolean }): Components {
	return {
		a: ({ href, children }: { href?: string | undefined; children?: ReactNode }) => {
			const url = typeof href === "string" ? href.trim() : "";
			return options.links && isSafeMarkdownUrl(url) ? (
				<a href={url} target="_blank" rel="noreferrer noopener">
					{children}
				</a>
			) : (
				<span>{children}</span>
			);
		},
		img: ({ src, alt }: { src?: string | Blob | undefined; alt?: string | undefined }) => {
			const url = typeof src === "string" ? src.trim() : "";
			return isSafeMarkdownUrl(url, true) ? (
				<img src={url} alt={alt ?? ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
			) : null;
		},
		code: ({ className, children }: { className?: string | undefined; children?: ReactNode }) =>
			className ? <code className={className}>{children}</code> : <code className="chip-code">{children}</code>,
	};
}

const BLOCK_COMPONENTS = componentsFor({ links: true });
const INLINE_COMPONENTS = componentsFor({ links: true });

/** Block markdown (plan bodies, long ask text). Static: no streaming split. */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
	return (
		<div className="ev-body">
			<div className="studio-md">
				<ReactMarkdown remarkPlugins={REMARK} components={BLOCK_COMPONENTS}>
					{text}
				</ReactMarkdown>
			</div>
		</div>
	);
});

/** Inline markdown for a single line (ask questions, option labels). */
export const MarkdownInline = memo(function MarkdownInline({ text }: { text: string; /** Render key, accepted so ported call sites keep passing it. */ k?: string }) {
	return (
		<span className="md-inline">
			<ReactMarkdown remarkPlugins={REMARK} components={INLINE_COMPONENTS} unwrapDisallowed>
				{text}
			</ReactMarkdown>
		</span>
	);
});
