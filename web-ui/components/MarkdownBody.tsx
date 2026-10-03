"use client";

import { useMemo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  normalizeDisplayMath,
} from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  /** Right-click on a local file chip: 「打开文件」/「在终端打开」 menu (U9). */
  onOpenFileContextMenu?: (filePath: string, point: { x: number; y: number }) => void;
}

export function MarkdownBody({
  children,
  className,
  isStreaming,
  cwd,
  onOpenFile,
  onOpenFileContextMenu,
}: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(
    () => normalizeDisplayMath(children),
    [children],
  );
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(
    () => ({
      code({ className, children, ...props }) {
        const lang = className?.replace("language-", "").toLowerCase() ?? "";
        const raw = String(children);
        const isBlock = className?.includes("language-") || raw.includes("\n");
        if (isBlock) {
          if (lang === "mermaid") {
            return (
              <MermaidBlock
                code={raw.replace(/\n$/, "")}
                isStreaming={isStreaming}
              />
            );
          }
          return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
        }
        return (
          <code className="markdown-inline-code" {...props}>
            {children}
          </code>
        );
      },
      pre({ children }) {
        return <>{children}</>;
      },
      a({ href, children, ...props }) {
        // `node` is react-markdown metadata, not a DOM attribute.
        delete props.node;
        const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
        const openFile = onOpenFile;
        if (!filePath || !openFile) {
          return (
            <a href={href} {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        }

        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          const target = event.currentTarget.getAttribute("target");
          if (target && target !== "_self") return;
          event.preventDefault();
          openFile(filePath);
        };

        const handleContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
          if (!onOpenFileContextMenu) return;
          event.preventDefault();
          onOpenFileContextMenu(filePath, { x: event.clientX, y: event.clientY });
        };

        return (
          <a href={href} {...props} onClick={handleClick} onContextMenu={handleContextMenu}>
            {children}
          </a>
        );
      },
      img({ src, alt, ...props }) {
        delete props.node;
        const filePath =
          typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
        const imageSrc = filePath
          ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
          : src;
        // Dynamic local paths are served directly by the file API.
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
      },
      table({ children }) {
        return (
          <div className="markdown-table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [cwd, isStreaming, onOpenFile, onOpenFileContextMenu],
  );

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
