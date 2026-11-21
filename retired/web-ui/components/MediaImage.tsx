"use client";

/**
 * `<img>` for conversation media that understands deferred blob URLs.
 *
 * Inline base64 still renders immediately. A `/api/blobs/<hash>` source is
 * fetched on demand — only once the image scrolls near the viewport — through
 * the authenticated fetch path, then rendered from an object URL (see
 * `lib/lazy-media.ts` for why an element-initiated request cannot be used on a
 * remote origin). Failures fall back to a muted placeholder instead of a
 * broken-image icon.
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { blobMediaCache, isDeferredMediaUrl } from "@/lib/lazy-media";

export interface MediaImageProps {
  src: string;
  alt?: string;
  style?: CSSProperties;
  className?: string;
  /** Viewport pre-load distance for deferred sources (default 240px). */
  rootMargin?: string;
  /** Placeholder box while the bytes are in flight. */
  placeholderSize?: { width: number; height: number };
}

export function MediaImage({
  src,
  alt = "",
  style,
  className,
  rootMargin = "240px",
  placeholderSize = { width: 160, height: 100 },
}: MediaImageProps) {
  const deferred = isDeferredMediaUrl(src);
  const targetRef = useRef<Element | null>(null);
  const [nearViewport, setNearViewport] = useState(!deferred);
  const [resolved, setResolved] = useState(deferred ? "" : src);
  const [failed, setFailed] = useState(false);

  // A new source resets the load state; inline sources skip the fetch path.
  useEffect(() => {
    setFailed(false);
    if (!isDeferredMediaUrl(src)) {
      setResolved(src);
      setNearViewport(true);
      return;
    }
    setResolved("");
    setNearViewport(false);
  }, [src]);

  useEffect(() => {
    if (!deferred || nearViewport) return;
    const node = targetRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [deferred, nearViewport, rootMargin]);

  useEffect(() => {
    if (!deferred || !nearViewport) return;
    let cancelled = false;
    blobMediaCache.load(src).then(
      (objectUrl) => {
        if (!cancelled) setResolved(objectUrl);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deferred, nearViewport, src]);

  if (failed) {
    return (
      <span
        className={className}
        data-zeta-media="failed"
        style={{
          display: "inline-block",
          width: placeholderSize.width,
          height: placeholderSize.height,
          borderRadius: 6,
          border: "1px solid var(--zeta-alias-border)",
          background: "var(--zeta-alias-bg)",
        }}
      />
    );
  }

  if (deferred && !resolved) {
    // The observed node while out of view; `img` with no src would still fire
    // a request in some browsers, so the placeholder owns the ref instead.
    return (
      <span
        ref={(node) => {
          // The observer target while the bytes are not requested yet.
          targetRef.current = node;
        }}
        className={className}
        data-zeta-media={nearViewport ? "loading" : "deferred"}
        style={{
          display: "inline-block",
          width: placeholderSize.width,
          height: placeholderSize.height,
          borderRadius: 6,
          border: "1px solid var(--zeta-alias-border)",
          background: "var(--zeta-alias-bg)",
        }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={(node) => {
        targetRef.current = node;
      }}
      src={resolved}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      data-zeta-media="ready"
      onError={() => setFailed(true)}
      style={style}
    />
  );
}
