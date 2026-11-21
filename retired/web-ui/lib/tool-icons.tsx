"use client";

import type { ReactNode } from "react";

const TERMINAL_RE = /bash|shell|terminal|exec/;
const EDIT_RE = /edit|write|patch|apply/;
const FILE_RE = /read|file|glob|grep|ls|view/;

type IconCategory = "terminal" | "edit" | "file" | "default";

function categoryFor(name: string): IconCategory {
  const n = name.toLowerCase();
  if (TERMINAL_RE.test(n)) return "terminal";
  if (EDIT_RE.test(n)) return "edit";
  if (FILE_RE.test(n)) return "file";
  return "default";
}

const ICON_BODY: Record<IconCategory, ReactNode> = {
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  default: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
};

/**
 * Inline icon for a tool name. Categories (matched on the lowercased name):
 * bash/shell/terminal/exec → terminal icon; edit/write/patch/apply → pencil;
 * read/file/glob/grep/ls/view → file icon; everything else → generic wrench.
 */
export function ToolIcon({ name, size = 12 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
      aria-hidden="true"
    >
      {ICON_BODY[categoryFor(name)]}
    </svg>
  );
}
