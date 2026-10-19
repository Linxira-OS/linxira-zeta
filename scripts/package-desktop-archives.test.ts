import { describe, expect, it } from "bun:test";
import { desktopAssetNames, normalizeVersion } from "./package-desktop-archives";

describe("normalizeVersion", () => {
	it("strips the release tag's leading v", () => {
		expect(normalizeVersion("v1.3.2")).toBe("1.3.2");
		expect(normalizeVersion("1.3.2")).toBe("1.3.2");
		expect(normalizeVersion(" v1.3.2\n")).toBe("1.3.2");
	});
});

describe("desktopAssetNames", () => {
	it("names all four release assets with the numeric version", () => {
		expect(desktopAssetNames("v1.3.2")).toEqual({
			installer: "zetawork-1.3.2-setup-x64.exe",
			windowsZip: "zetawork-1.3.2-windows-x64.zip",
			appImage: "zetawork-1.3.2-x86_64.AppImage",
			archPackage: "zetawork-1.3.2-1-x86_64.pkg.tar.zst",
		});
	});
});
