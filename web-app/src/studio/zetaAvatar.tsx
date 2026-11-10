/**
 * Default AI/Zeta avatar for the Work Studio surfaces that used to draw a
 * generic badge or icon for the assistant identity. The drawing is the product
 * mark (concept 04 Cluster): two tiles from 32px up, the declared single-tile
 * LZ fallback at 16/24 — see `document/agents/brand/registry.md`.
 *
 * The mark is *identity*, not a status icon: role-specific glyphs (PM,
 * engineer, subagent, project/folder) keep their own icons.
 *
 * Both SVGs are committed copies of `assets/` in `web-app/public/` (the export
 * chain in `desktop/scripts/generate-icon.mjs` keeps them byte-identical), and
 * `zetaMarkFallback` draws the same geometry inline so a missing or blocked
 * asset still leaves a readable mark instead of a broken image.
 */

import { useState, type CSSProperties } from "react";

/** Below this the two tiles stop reading; `zeta-mark-16.svg` is the declared fallback. */
export const ZETA_CLUSTER_MIN_PX = 32;

/** Accessible name of the default AI identity. `nav.brand` is the same word in both locales. */
export const ZETA_AVATAR_LABEL = "Zeta";

function assetBase(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly BASE_URL?: string } }).env;
  return env?.BASE_URL ?? "/";
}

/** Public URL of the mark that stays legible at `size`. */
export function zetaMarkSrc(size: number): string {
  const file = size < ZETA_CLUSTER_MIN_PX ? "zeta-mark-16.svg" : "zeta-mark.svg";
  const base = assetBase();
  return `${base}${base.endsWith("/") ? "" : "/"}${file}`;
}

interface ZetaAvatarProps {
  /** Rendered edge in CSS pixels. 16–24 use the single-tile fallback drawing. */
  readonly size?: number | undefined;
  /** Visible name next to the mark: the avatar is decorative then (no duplicate announcement). */
  readonly decorative?: boolean | undefined;
  /** Accessible name when the avatar stands alone; defaults to the product name. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

function markStyle(size: number): CSSProperties {
  return { width: size, height: size };
}

/** Inline single-tile LZ mark: the same geometry as `assets/zeta-mark-16.svg`. */
export function ZetaMarkFallback({
  size = 18,
  decorative = false,
  label = ZETA_AVATAR_LABEL,
  className,
}: ZetaAvatarProps) {
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": label };
  return (
    <svg
      className={`zeta-avatar zeta-avatar-fallback${className === undefined ? "" : ` ${className}`}`}
      viewBox="0 0 512 512"
      style={markStyle(size)}
      {...a11y}
    >
      {decorative ? null : <title>{label}</title>}
      <rect width="512" height="512" rx="112" fill="#0E1417" />
      <rect x="48" y="48" width="416" height="416" rx="112" fill="#2AC9C1" />
      <path
        d="M368 368H128V128H368L224 368H368"
        fill="none"
        stroke="#0E1417"
        strokeWidth="76"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Default AI/Zeta avatar. Decorative when the row already prints the name
 * (`decorative`), labelled "Zeta" otherwise. Falls back to the inline mark if
 * the SVG does not load.
 */
export function ZetaAvatar({
  size = 18,
  decorative = false,
  label = ZETA_AVATAR_LABEL,
  className,
}: ZetaAvatarProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <ZetaMarkFallback size={size} decorative={decorative} label={label} className={className} />
    );
  }
  const classes = `zeta-avatar${className === undefined ? "" : ` ${className}`}`;
  return (
    <img
      className={classes}
      src={zetaMarkSrc(size)}
      style={markStyle(size)}
      width={size}
      height={size}
      alt={decorative ? "" : label}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { title: label })}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
