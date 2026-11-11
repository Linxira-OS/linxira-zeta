/** One rendered plugin page: `/plugins/view/<plugin>/<page>`. */
export type PluginViewRoute = { readonly plugin: string; readonly page: string };

/** Decode a plugin page deep link, or `undefined` for any other path. */
export function parsePluginViewRoute(pathname: string): PluginViewRoute | undefined {
  const match = /^\/plugins\/view\/([^/]+)\/([^/]+)\/?$/u.exec(pathname);
  if (match === null) return undefined;
  try {
    const plugin = decodeURIComponent(match[1] ?? "");
    const page = decodeURIComponent(match[2] ?? "");
    return plugin === "" || page === "" ? undefined : { plugin, page };
  } catch {
    return undefined;
  }
}
