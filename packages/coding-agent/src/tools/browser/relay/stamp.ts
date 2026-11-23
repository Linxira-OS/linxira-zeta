/**
 * Extension install stamps, kept dependency-free so the browser-relay build
 * script can run in the generated-freshness guard without `bun install`.
 */

/** Prefix `background.js` with the Zeta version and extension build that installed it. */
export function stampRelayExtensionScript(script: string, zetaVersion: string, build: string): string {
	return `const ZETA_INSTALL_VERSION = ${JSON.stringify(zetaVersion)};\nconst ZETA_INSTALL_BUILD = ${JSON.stringify(build)};\n${script}`;
}

/** The extension's manifest text with `zetaVersion` as its `version_name`, which chrome://extensions shows. */
export function stampRelayExtensionManifest(manifestJson: string, zetaVersion: string): string {
	return `${JSON.stringify({ ...JSON.parse(manifestJson), version_name: zetaVersion }, null, "\t")}\n`;
}
