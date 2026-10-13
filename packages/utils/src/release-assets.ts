/**
 * Published CLI release-asset naming — the one contract shared by the release
 * build (`scripts/ci-release-build-binaries.ts` outfiles), the CI upload matrix
 * (`.github/workflows/ci.yml` `release_binary.binary_path`), the installers
 * (`scripts/install.sh` / `install.ps1`) and the updater's binary fallback.
 *
 * Assets are `zeta-cli-<os>-<arch>[.exe]`. `zeta-cli` is the *file-name* face
 * of the package and deliberately does NOT follow {@link CLI_BIN_NAME}
 * (`zetacode`, the user-visible command face): the brand cutover moved the
 * command name, and the updater's asset name drifted with it, so every binary
 * fallback asked GitHub for `zetacode-*` assets no release carries (v1.1.27 /
 * main). `scripts/check-release-asset-names.ts` pins both sides together.
 */

/**
 * Leading token of every published CLI binary asset, separator included:
 * assets are `<prefix><os>[-musl]-<arch>[.exe]`.
 */
export const RELEASE_CLI_ASSET_PREFIX = "zeta-cli-";

/** Asset-name OS token per platform; Linux additionally has a musl build. */
const RELEASE_OS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "darwin",
	linux: "linux",
	win32: "windows",
};

const RELEASE_ARCH: Record<string, string> = { x64: "x64", arm64: "arm64" };

/** Release asset for a CLI binary, e.g. `zeta-cli-windows-x64.exe`. */
export function releaseCliAssetName(platform: NodeJS.Platform, arch: string, options: { musl?: boolean } = {}): string {
	const os = RELEASE_OS[platform];
	if (!os) throw new Error(`Unsupported platform: ${platform}`);
	if (options.musl && platform !== "linux") throw new Error(`musl builds exist on linux only: ${platform}`);
	const archName = RELEASE_ARCH[arch];
	if (!archName) throw new Error(`Unsupported architecture: ${arch}`);
	const libc = options.musl ? "-musl" : "";
	const suffix = platform === "win32" ? ".exe" : "";
	return `${RELEASE_CLI_ASSET_PREFIX}${os}${libc}-${archName}${suffix}`;
}
