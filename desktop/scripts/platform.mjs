export function desktopPlatformInfo(platform, arch) {
	if (arch !== "x64" && !(platform === "darwin" && arch === "arm64")) {
		throw new Error(`Unsupported desktop architecture: ${arch}`);
	}
	switch (platform) {
		case "win32":
			return {
				platformId: "win",
				builderTarget: "--win",
				unpackedDirectory: "win-unpacked",
				zetaBinaryName: "zeta.exe",
				nodeBinaryName: "node.exe",
			};
		case "linux":
			return {
				platformId: "linux",
				builderTarget: "--linux",
				unpackedDirectory: "linux-unpacked",
				zetaBinaryName: "zeta",
				nodeBinaryName: "node",
			};
		case "darwin":
			return {
				platformId: "mac",
				builderTarget: "--mac",
				unpackedDirectory: "mac-unpacked",
				zetaBinaryName: "zeta",
				nodeBinaryName: "node",
			};
		default:
			throw new Error(`Unsupported desktop package platform: ${platform}`);
	}
}
