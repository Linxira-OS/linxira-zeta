/** One rendered plugin page: `/plugins/view/<plugin>/<page entry>`. */
export type PluginViewRoute = { readonly plugin: string; readonly page: string };

/**
 * Decode a plugin page deep link, or `undefined` for any other path. The page
 * part is a package-relative entry (`ui/board.html`), encoded one segment at a
 * time by the Host's `pluginViewHref`; it stays a slash-joined relative path.
 */
export function parsePluginViewRoute(pathname: string): PluginViewRoute | undefined {
  const match = /^\/plugins\/view\/([^/]+)\/(.+?)\/?$/u.exec(pathname);
  if (match === null) return undefined;
  const safeSegment = (segment: string): boolean =>
    segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\") && !segment.includes("\0");
  try {
    const plugin = decodeURIComponent(match[1] ?? "");
    const segments = (match[2] ?? "").split("/").map(decodeURIComponent);
    return !safeSegment(plugin) || !segments.every(safeSegment) ? undefined : { plugin, page: segments.join("/") };
  } catch {
    return undefined;
  }
}
