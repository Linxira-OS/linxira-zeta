#!/usr/bin/env bun
/* eslint-disable no-template-curly-in-string -- electron-builder placeholders are compared verbatim */
/**
 * Package-linkage guard.
 *
 * `packaging/package-linkage.json` is the contract external package
 * repositories use to map this product onto their package names. It must stay
 * consistent with the identity this repository actually ships
 * (`desktop/package.json`, `desktop/electron-builder.yml`), with the release
 * job that publishes the assets, and with the legacy → Zeta migration rules.
 *
 * Exit code 1 on any problem. No network access: the manifest records the
 * versions observed at verification time, and this guard checks the parts that
 * live in the repository.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { isRecord } from "../packages/utils/src/type-guards";

const ROOT = path.resolve(import.meta.dir, "..");
const MANIFEST = "packaging/package-linkage.json";
const DOC = "docs/package-repository-linkage.md";
const DESKTOP_PACKAGE = "desktop/package.json";
const BUILDER_CONFIG = "desktop/electron-builder.yml";
const WORKFLOW = ".github/workflows/ci.yml";

type Json = Record<string, unknown>;

export interface LinkageContext {
	readonly root: string;
	readonly npmName: string;
	readonly npmVersion: string;
	readonly npmPrivate: boolean;
	readonly homepage: string;
	readonly appId: string;
	readonly productName: string;
	readonly artifactName: string;
	readonly executableName: string;
	readonly workflow: Json;
	readonly docText: string;
}

function record(value: unknown, label: string, problems: string[]): Json {
	if (!isRecord(value)) {
		problems.push(`${label} must be an object`);
		return {};
	}
	return value;
}

function strings(value: unknown, label: string, problems: string[]): string[] {
	if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) {
		problems.push(`${label} must be a string array`);
		return [];
	}
	return value as string[];
}

function text(value: unknown, label: string, problems: string[]): string {
	if (typeof value !== "string" || value.trim() === "") {
		problems.push(`${label} must be a non-empty string`);
		return "";
	}
	return value;
}

/** The release tag detector in ci.yml only sees `v<digit>` tags. */
export function tagPatternMatchesWorkflow(pattern: string): boolean {
	const sample = pattern.replace("{version}", "1.2.3");
	return sample.startsWith("v") && /^v\d/.test(sample);
}

export function validateLinkage(raw: unknown, ctx: LinkageContext): string[] {
	const problems: string[] = [];
	const manifest = record(raw, "manifest", problems);
	if (problems.length > 0) return problems;

	if (manifest.schemaVersion !== 1) problems.push("schemaVersion must be 1");

	const product = record(manifest.product, "product", problems);
	const expected: Array<[string, unknown, string]> = [
		["id", product.id, ctx.npmName],
		["npmPackage", product.npmPackage, ctx.npmName],
		["homepage", product.homepage, ctx.homepage],
		["appId", product.appId, ctx.appId],
		["productName", product.productName, ctx.productName],
		["executable", product.executable, ctx.executableName],
	];
	for (const [field, actual, want] of expected) {
		if (actual !== want)
			problems.push(`product.${field} must be ${JSON.stringify(want)}, found ${JSON.stringify(actual)}`);
	}
	if (product.npmPublished !== false)
		problems.push("product.npmPublished must be false: the desktop shell is private");
	if (ctx.npmPrivate !== true)
		problems.push(`${DESKTOP_PACKAGE} must stay private, otherwise npm could publish a second identity`);
	if (product.license !== "MIT") problems.push("product.license must be MIT (desktop shell payload)");
	if (product.configRoot !== "~/.zeta") problems.push("product.configRoot must be ~/.zeta");

	const upstream = record(manifest.upstreamIdentity, "upstreamIdentity", problems);
	const tagPattern = text(upstream.tagPattern, "upstreamIdentity.tagPattern", problems);
	if (!tagPatternMatchesWorkflow(tagPattern)) {
		problems.push(
			`upstreamIdentity.tagPattern ${JSON.stringify(tagPattern)} must render a v<digit> tag (ci.yml detector)`,
		);
	}
	const artifactPattern = text(upstream.artifactNamePattern, "upstreamIdentity.artifactNamePattern", problems);
	const artifactRendered = artifactPattern
		.replace("{version}", "1.2.3")
		.replace("{platform}", "linux")
		.replace("{arch}", "x64")
		.replace("{ext}", "tar.gz");
	const artifactExpected = ctx.artifactName
		.replace("${version}", "1.2.3")
		.replace("${os}", "linux")
		.replace("${arch}", "x64")
		.replace("${ext}", "tar.gz");
	if (artifactRendered !== artifactExpected) {
		problems.push(
			`upstreamIdentity.artifactNamePattern renders ${artifactRendered}, electron-builder renders ${artifactExpected}`,
		);
	}
	const suffixes = record(upstream.platformSuffixes, "upstreamIdentity.platformSuffixes", problems);
	const requiredSuffixes = ["linux-x64", "linux-deb", "linux-appimage", "windows-installer", "windows-zip"];
	for (const key of requiredSuffixes) {
		const value = text(suffixes[key], `upstreamIdentity.platformSuffixes.${key}`, problems);
		if (value !== "" && !value.startsWith("zeta-desktop-")) {
			problems.push(`platformSuffixes.${key} must name a zeta-desktop-* asset`);
		}
	}
	if (upstream.normalizationRule === undefined || typeof upstream.normalizationRule !== "string") {
		problems.push("upstreamIdentity.normalizationRule must state that the external repository owns package names");
	}

	const repositories = manifest.repositories;
	if (!Array.isArray(repositories) || repositories.length === 0) {
		problems.push("repositories must be a non-empty array");
	}
	const repoIds = new Set<string>();
	for (const [index, value] of (Array.isArray(repositories) ? repositories : []).entries()) {
		const repo = record(value, `repositories[${index}]`, problems);
		if (typeof repo.id === "string") repoIds.add(repo.id);
		if (typeof repo.repository !== "string" || !repo.repository.startsWith("Linxira-OS/")) {
			problems.push(`repositories[${index}].repository must be a Linxira-OS repository`);
		}
	}
	for (const id of ["source", "binary-packages", "signed-package-db", "catalog-db"]) {
		if (!repoIds.has(id)) problems.push(`repositories is missing the ${id} entry`);
	}
	const pacmanSections = new Set<string>();
	for (const value of Array.isArray(repositories) ? repositories : []) {
		if (!isRecord(value) || value.id !== "binary-packages") continue;
		for (const section of Array.isArray(value.pacmanRepositories) ? value.pacmanRepositories : []) {
			if (isRecord(section) && typeof section.section === "string") pacmanSections.add(section.section);
		}
	}
	for (const section of ["linxira-zeta", "linxira"]) {
		if (!pacmanSections.has(section))
			problems.push(`repositories.pacmanRepositories is missing the ${section} section`);
	}
	const packages = manifest.packages;
	if (!Array.isArray(packages) || packages.length === 0) problems.push("packages must be a non-empty array");
	for (const [index, value] of (Array.isArray(packages) ? packages : []).entries()) {
		const pkg = record(value, `packages[${index}]`, problems);
		if (typeof pkg.name !== "string") problems.push(`packages[${index}].name must be a string`);
		if (pkg.repository !== undefined && !repoIds.has(String(pkg.repository))) {
			problems.push(
				`packages[${index}].repository ${JSON.stringify(pkg.repository)} is not a declared repository id`,
			);
		}
		if (pkg.ecosystem === "pacman" && typeof pkg.section === "string" && !pacmanSections.has(pkg.section)) {
			problems.push(`packages[${index}].section ${JSON.stringify(pkg.section)} is not a declared pacman section`);
		}
		// The paused workbench npm line must never read as current.
		if (pkg.name === "@linxiraos/main" && pkg.status !== "paused") {
			problems.push("@linxiraos/main must be marked paused: it is frozen and does not receive 1.5.x");
		}
		if (pkg.ecosystem === "npm" && pkg.name === "zeta-desktop") {
			if (pkg.status !== "private") problems.push("zeta-desktop must be marked private");
			if (pkg.version !== ctx.npmVersion) {
				problems.push(
					`zeta-desktop version ${JSON.stringify(pkg.version)} must match ${DESKTOP_PACKAGE} ${ctx.npmVersion}`,
				);
			}
		}
	}

	const migration = record(manifest.migration, "migration", problems);
	const productMapping = record(migration.productMapping, "migration.productMapping", problems);
	const guiMapping = record(productMapping["zetawork-gui"], "migration.productMapping.zetawork-gui", problems);
	if (guiMapping.new !== "zeta-desktop") {
		problems.push("migration.productMapping.zetawork-gui.new must be zeta-desktop");
	}
	const mainMapping = record(productMapping["@linxiraos/main"], "migration.productMapping.@linxiraos/main", problems);
	if (mainMapping.new !== "@linxiraos/zeta" || mainMapping.renamed !== false) {
		problems.push("migration.productMapping.@linxiraos/main must map to @linxiraos/zeta without claiming a rename");
	}
	const rows = migration.rows;
	if (!Array.isArray(rows) || rows.length === 0) {
		problems.push("migration.rows must be a non-empty array");
	}
	const rowList = (Array.isArray(rows) ? rows : []).map((value, index) =>
		record(value, `migration.rows[${index}]`, problems),
	);
	const findRow = (platform: string, from: string) =>
		rowList.find(row => row.platform === platform && isRecord(row.from) && row.from.package === from);
	const sameNameRow = findRow("linux-pacman", "linxira-zeta");
	if (!sameNameRow) {
		problems.push("migration.rows must state the linxira-zeta (same package name) in-place upgrade");
	} else {
		if (sameNameRow.samePackageName !== true) problems.push("linxira-zeta -> linxira-zeta must be samePackageName");
		if (sameNameRow.mechanism !== "in-place")
			problems.push("linxira-zeta -> linxira-zeta must be an in-place mechanism");
		if (sameNameRow.requiresUninstall === true)
			problems.push("linxira-zeta -> linxira-zeta must not require an uninstall");
	}
	const zetaworkRow = findRow("linux-pacman", "linxira-zetawork");
	if (!zetaworkRow) {
		problems.push("migration.rows must include the linxira-zetawork replacement");
	} else {
		if (zetaworkRow.mechanism !== "replace") problems.push("linxira-zetawork migration must be a replace mechanism");
		if (zetaworkRow.samePackageName !== false)
			problems.push("linxira-zetawork migration must not claim a same package name");
		for (const field of ["replaces", "conflicts"]) {
			const list = strings(zetaworkRow[field], `migration linxira-zetawork ${field}`, problems);
			if (!list.includes("linxira-zetawork"))
				problems.push(`linxira-zetawork migration must declare ${field} linxira-zetawork`);
		}
	}
	for (const [index, row] of rowList.entries()) {
		// The core honesty rule: a different identity can never be an automatic
		// in-place upgrade.
		if (row.sameInstallerIdentity === false && row.requiresUninstall !== true) {
			problems.push(`migration.rows[${index}] has a different installer identity but does not require an uninstall`);
		}
		if (row.samePackageName === false && row.mechanism === "in-place") {
			problems.push(`migration.rows[${index}] has a different package name but claims an in-place mechanism`);
		}
	}
	const windowsRow = rowList.find(row => row.platform === "windows");
	if (!windowsRow) {
		problems.push("migration.rows must state the Windows installer difference");
	} else if (windowsRow.appId === undefined && windowsRow.to !== undefined) {
		const to = isRecord(windowsRow.to) ? windowsRow.to : {};
		if (to.appId !== ctx.appId) problems.push(`windows migration target appId must be ${ctx.appId}`);
	}

	const pmFields = record(migration.packageManagerFields, "migration.packageManagerFields", problems);
	const pacman = record(pmFields.pacman, "migration.packageManagerFields.pacman", problems);
	const conflicts = strings(pacman.conflicts, "pacman conflicts", problems);
	if (!conflicts.includes("linxira-zetawork")) problems.push("pacman conflicts must include linxira-zetawork");
	const replaces = strings(pacman.replaces, "pacman replaces", problems);
	if (!replaces.includes("linxira-zetawork")) problems.push("pacman replaces must include linxira-zetawork");

	const config = record(manifest.configCompatibility, "configCompatibility", problems);
	if (config.configRoot !== "~/.zeta") problems.push("configCompatibility.configRoot must be ~/.zeta");
	if (config.preserved !== true) problems.push("configCompatibility.preserved must be true");
	text(config.evidence, "configCompatibility.evidence", problems);

	const channel = record(manifest.updateChannel, "updateChannel", problems);
	if (channel.inAppUpdater !== false)
		problems.push("updateChannel.inAppUpdater must be false (no app-side updater ships)");

	const release = record(manifest.release, "release", problems);
	const verifiedRelease = record(release.verifiedRelease, "release.verifiedRelease", problems);
	text(verifiedRelease.version, "release.verifiedRelease.version", problems);
	const pending = record(release.pendingRelease, "release.pendingRelease", problems);
	if (pending.status === "not-published-at-analysis-time" && pending.version === verifiedRelease.version) {
		problems.push("a pending release cannot be the verified release");
	}

	const verification = record(manifest.verification, "verification", problems);
	const procedures = record(verification.procedures, "verification.procedures", problems);
	const linuxUpgrade = record(procedures.linuxUpgrade, "verification.procedures.linuxUpgrade", problems);
	const upgradeScript = text(linuxUpgrade.script, "verification.procedures.linuxUpgrade.script", problems);
	if (upgradeScript !== "" && !fs.existsSync(path.join(ctx.root, upgradeScript))) {
		problems.push(`verification procedure script ${upgradeScript} does not exist`);
	}
	const upgradeJob = text(linuxUpgrade.ciJob, "verification.procedures.linuxUpgrade.ciJob", problems);
	if (upgradeJob !== "" && !isRecord((isRecord(ctx.workflow.jobs) ? ctx.workflow.jobs : {})[upgradeJob])) {
		problems.push(`verification.procedures.linuxUpgrade.ciJob ${upgradeJob} is not a job in ${WORKFLOW}`);
	}
	const claims = verification.claims;
	if (!Array.isArray(claims) || claims.length === 0) {
		problems.push("verification.claims must be a non-empty array");
	}
	for (const [index, value] of (Array.isArray(claims) ? claims : []).entries()) {
		const claim = record(value, `verification.claims[${index}]`, problems);
		if (claim.status !== "verified" && claim.status !== "unverified") {
			problems.push(`verification.claims[${index}].status must be verified or unverified`);
		}
		text(claim.statement, `verification.claims[${index}].statement`, problems);
		if (claim.status === "verified") text(claim.evidence, `verification.claims[${index}].evidence`, problems);
	}
	const claimIds = new Set(
		(Array.isArray(claims) ? claims : []).map(claim => (isRecord(claim) ? String(claim.id) : "")),
	);
	if (!claimIds.has("release-1.5.1")) problems.push("verification.claims must carry the pending 1.5.1 state");

	// The release job must actually ship this manifest as a release asset, so an
	// external package repository can consume the linkage from the release.
	const jobs = isRecord(ctx.workflow.jobs) ? ctx.workflow.jobs : {};
	const releaseJob = isRecord(jobs.release_github) ? jobs.release_github : {};
	const steps = Array.isArray(releaseJob.steps) ? releaseJob.steps : [];
	const fileStep = steps.find(step => isRecord(step) && isRecord(step.with) && typeof step.with.files === "string") as
		| { with: { files: string } }
		| undefined;
	if (!fileStep || !fileStep.with.files.includes(MANIFEST)) {
		problems.push(`release_github must upload ${MANIFEST}`);
	}
	const checksumStep = steps.find(
		step => isRecord(step) && typeof step.run === "string" && step.run.includes("ci:release:checksums"),
	) as { run: string } | undefined;
	if (!checksumStep || !checksumStep.run.includes(MANIFEST)) {
		problems.push(`release_github checksums must cover ${MANIFEST}`);
	}

	// The doc must call out the rolling repository and the legacy replacement.
	for (const needle of ["zeta-repo", "[linxira-zeta]", "linxira-zetawork", "~/.zeta"]) {
		if (!ctx.docText.includes(needle)) problems.push(`${DOC} must mention ${needle}`);
	}

	return problems;
}

export function loadContext(root: string = ROOT): LinkageContext {
	const desktop = JSON.parse(fs.readFileSync(path.join(root, DESKTOP_PACKAGE), "utf8")) as Json;
	const builder = parseYaml(fs.readFileSync(path.join(root, BUILDER_CONFIG), "utf8")) as Json;
	const linux = isRecord(builder.linux) ? builder.linux : {};
	const workflow = parseYaml(fs.readFileSync(path.join(root, WORKFLOW), "utf8")) as Json;
	return {
		root,
		npmName: String(desktop.name),
		npmVersion: String(desktop.version),
		npmPrivate: desktop.private === true,
		homepage: String(desktop.homepage),
		appId: String(builder.appId),
		productName: String(builder.productName),
		artifactName: String(builder.artifactName),
		executableName: String(linux.executableName),
		workflow,
		docText: fs.readFileSync(path.join(root, DOC), "utf8"),
	};
}

export function checkPackageLinkage(root: string = ROOT): string[] {
	const manifestPath = path.join(root, MANIFEST);
	if (!fs.existsSync(manifestPath)) return [`${MANIFEST} is missing`];
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
	return validateLinkage(manifest, loadContext(root));
}

if (import.meta.main) {
	const problems = checkPackageLinkage();
	if (problems.length > 0) {
		console.error(`Package linkage check failed (${problems.length}):`);
		for (const problem of problems) console.error(`  - ${problem}`);
		process.exit(1);
	}
	console.log(`Package linkage OK: ${MANIFEST} matches desktop identity, release assets and migration rules.`);
}
