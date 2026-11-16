/**
 * Chromium exposes WebMCP to managed pages only when its renderer feature list
 * names the feature. Electron 45.3.0 (Chromium 156) names it `WebMCPTesting`;
 * a later Chromium renames it `WebMCP`, which this constant must follow then.
 */
export const WEBMCP_FEATURE = "WebMCPTesting";

/** The same feature list with {@link WEBMCP_FEATURE} appended once; an existing entry is preserved verbatim. */
export function withWebMCPFeature(configured: string): string {
  const features = configured.split(",").map(feature => feature.trim()).filter(Boolean);
  if (features.includes(WEBMCP_FEATURE)) return configured;
  return [...features, WEBMCP_FEATURE].join(",");
}

/** The subset of Electron's `app.commandLine` the feature merge needs. */
export interface FeatureCommandLine {
  getSwitchValue(name: string): string;
  appendSwitch(name: string, value: string): void;
}

/**
 * Enable the managed browser's page tools without dropping features the launch
 * already requested, and without appending a second `enable-features` value on
 * repeated calls. This must run before Electron creates any renderer; Chromium
 * reads the feature list for each renderer when that process starts.
 */
export function applyWebMCPFeature(commandLine: FeatureCommandLine): void {
  const configured = commandLine.getSwitchValue("enable-features");
  const merged = withWebMCPFeature(configured);
  if (merged !== configured) commandLine.appendSwitch("enable-features", merged);
}
