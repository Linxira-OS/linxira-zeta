/**
 * Version-line consistency check for the Zeta monorepo.
 *
 * Zeta rides ONE version line across every published surface: the 14
 * @linxiraos/* packages, the root workspaces.catalog keys, the Rust workspace
 * version, the pi-natives sentinel (__piNativesVX_Y_Z), the desktop app, and
 * the README version badge. Any drift is a release-blocking bug (the
 * 1.0.6/1.0.7 era shipped natives at 1.0.2/1.0.4 and broke `zeta update` with
 * ETARGET).
 *
 * Usage:
 *   bun scripts/check-version-consistency.ts
 *
 * Exits non-zero listing every drifted surface. Kept in lock-step with the
 * package/catalog/sentinel lists in scripts/release-v2.ts and
 * scripts/set-version.ts (update all three together).
 *
 * web-ui/ is intentionally NOT checked: it only aligns to the release version
 * at publish time via set-version.ts, and stays on its own version between
 * releases.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "..");

// Must match ALL_PACKAGES in scripts/release-v2.ts / set-version.ts.
const ALL_PACKAGES = [
	"utils",
	"agent",
	"catalog",
	"ai",
	"tui",
	"hashline",
	"mnemopi",
	"snapcompact",
	"stats",
	"coding-agent",
	"channels",
	"natives",
	"omptype",
	"wire",
] as const;

// Must match CATALOG_KEYS in scripts/release-v2.ts / set-version.ts.
const CATALOG_KEYS: ReadonlyArray<string> = [
	"@linxiraos/pi-utils",
	"@linxiraos/pi-agent-core",
	"@linxiraos/pi-catalog",
	"@linxiraos/pi-ai",
	"@linxiraos/pi-tui",
	"@linxiraos/pi-hashline",
	"@linxiraos/pi-mnemopi",
	"@linxiraos/pi-snapcompact",
	"@linxiraos/pi-stats",
	"@linxiraos/zeta",
	"@linxiraos/pi-channels",
	"@linxiraos/pi-natives",
	"@linxiraos/pi-omptype",
	"@linxiraos/pi-wire",
];

// Must match SENTINEL_FILES in scripts/release-v2.ts / set-version.ts.
const SENTINEL_FILES = [
	"crates/pi-natives/src/lib.rs",
	"packages/natives/native/index.d.ts",
	"packages/natives/native/index.js",
] as const;

const problems: string[] = [];

function readVersion(file: string): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
		return pkg.version as string;
	} catch {
		problems.push(`${file}: unreadable`);
		return "";
	}
}

function main(): void {
	const versions = new Map<string, string>();
	for (const pkg of ALL_PACKAGES) {
		versions.set(pkg, readVersion(`packages/${pkg}/package.json`));
	}

	const distinct = new Set(versions.values()).size;
	if (distinct !== 1) {
		const baseline = versions.get(ALL_PACKAGES[0]) ?? "";
		for (const [pkg, v] of versions) {
			if (v !== baseline) problems.push(`packages/${pkg}: ${v} != ${baseline}`);
		}
	}

	const expected = versions.get(ALL_PACKAGES[0]) ?? "";

	// Root workspaces.catalog — exactly the 14 @linxiraos/* keys, all at the line version.
	const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const catalog = rootPkg.workspaces?.catalog ?? {};
	const catalogKeys = Object.keys(catalog).filter((k) => k.startsWith("@linxiraos/"));
	if (catalogKeys.length !== CATALOG_KEYS.length) {
		problems.push(
			`workspaces.catalog: ${catalogKeys.length} @linxiraos/* keys, expected ${CATALOG_KEYS.length}: ${catalogKeys.join(", ")}`,
		);
	}
	for (const key of CATALOG_KEYS) {
		if (catalog[key] !== expected) problems.push(`workspaces.catalog ${key}: ${catalog[key]} != ${expected}`);
	}

	// Rust workspace version.
	const cargoToml = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
	const cargoVersion = cargoToml.match(/^\s*version = "([^"]+)"/m)?.[1];
	if (cargoVersion !== expected) problems.push(`Cargo.toml workspace: ${cargoVersion} != ${expected}`);

	// pi-natives sentinel.
	const sentinel = `__piNativesV${expected.replace(/\./g, "_")}`;
	for (const file of SENTINEL_FILES) {
		const content = fs.readFileSync(path.join(root, file), "utf8");
		if (!content.includes(sentinel)) problems.push(`${file}: missing ${sentinel}`);
	}

	// Desktop rides the same line (electron-builder + ZETA_APP_VERSION read it).
	const desktopVersion = readVersion("desktop/package.json");
	if (desktopVersion !== expected) problems.push(`desktop/package.json: ${desktopVersion} != ${expected}`);

	// README shields.io version badge must show the line version.
	const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
	if (!readme.includes(`badge/zeta-${expected}-`)) {
		problems.push(`README.md: version badge not at ${expected}`);
	}

	if (problems.length > 0) {
		console.error(`Version line drift (expected ${expected}):`);
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log(
		`Version line consistent at ${expected}: ${ALL_PACKAGES.length} packages + ${CATALOG_KEYS.length} catalog keys + Cargo + sentinel + desktop + README badge`,
	);
}

main();
