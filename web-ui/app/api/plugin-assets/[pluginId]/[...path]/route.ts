import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { resolvePluginAsset } from "@/lib/plugin-pages";

/**
 * Asset types a plugin page may pull in. Static map, no dependency: the frame
 * only has to keep the browser from guessing (`X-Content-Type-Options`), and an
 * unknown extension falls back to `application/octet-stream` (download, never
 * executed) rather than being sniffed.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function mimeFor(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

// GET /api/plugin-assets/<pluginId>/<path…>
// Serves one file out of an installed plugin package. The package root is the
// only allowed root: a path that escapes it (directly or through a symlink) is
// refused with 403 by `resolvePluginAsset`, and a missing file is a 404.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pluginId: string; path: string[] }> }
) {
  const { pluginId, path: segments } = await params;
  const asset = resolvePluginAsset(pluginId, segments ?? []);
  if (!asset.ok) return NextResponse.json({ error: asset.error }, { status: asset.status });

  // `node:stream`'s ReadableStream is structurally the web one but typed from a
  // different lib; the double cast is the documented boundary.
  const stream = Readable.toWeb(createReadStream(asset.file)) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": mimeFor(asset.file),
      "X-Content-Type-Options": "nosniff",
      // Plugin packages are upgraded in place; never let the browser hold a
      // stale page while the desktop is pointed at this URL.
      "Cache-Control": "no-store",
    },
  });
}
