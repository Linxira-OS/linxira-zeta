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
				nativeTag: "win32-x64",
			};
		case "linux":
			return {
				platformId: "linux",
				builderTarget: "--linux",
				unpackedDirectory: "linux-unpacked",
				zetaBinaryName: "zeta",
				nodeBinaryName: "node",
				nativeTag: "linux-x64",
			};
		case "darwin":
			return {
				platformId: "mac",
				builderTarget: "--mac",
				unpackedDirectory: "mac-unpacked",
				zetaBinaryName: "zeta",
				nodeBinaryName: "node",
				nativeTag: arch === "arm64" ? "darwin-arm64" : "darwin-x64",
			};
		default:
			throw new Error(`Unsupported desktop package platform: ${platform}`);
	}
}
