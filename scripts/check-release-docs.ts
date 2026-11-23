#!/usr/bin/env bun

/**
 * Release-doc consistency gate.
 *
 * A tag may not ship while the prose still describes another tree. This checks
 * the surfaces a tag bump changes mechanically:
 *   - README version badge == the release version;
 *   - README mentions the integrated OMP and Studio tags from the baseline row;
 *   - the upstream-sync header agrees with the OMP baseline row;
 *   - known stale release phrases are gone.
 *
 * It does not decide whether the integrated tags are the right ones; that is
 * owner/release review. Run after `release-v2` has bumped the version and README
 * badge, before the release commit.
 */
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const die = (message: string): never => {
	console.error(`Error: ${message}`);
	process.exit(1);
};

const argVersion = process.argv.find(arg => arg.startsWith("--version="))?.slice("--version=".length);
const pkg = JSON.parse(read("../package.json")) as { version?: unknown };
const version = argVersion ?? (typeof pkg.version === "string" ? pkg.version : undefined);
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) die("provide --version=<stable semver> or a root package version");

const readme = read("../README.md");
const baselines = read("../document/upstream-baselines.md");
const sync = read("../document/upstream-sync.md");
const problems: string[] = [];

const badge = /badge\/zeta-(\d+\.\d+\.\d+)-/.exec(readme)?.[1];
if (badge !== version) problems.push(`README badge is ${badge ?? "missing"}, expected ${version}`);

if (/Full final release accounting is still pending|acceptance and CI pending/i.test(readme)) {
	problems.push("README still contains a stale pending-accounting assertion");
}

const ompRow = baselines
	.split("\n")
	.find(line => line.startsWith("| [OMP](https://github.com/Linxira-OS/linxira-zeta)"));
const studioRow = baselines
	.split("\n")
	.find(line => line.startsWith("| [OMP Studio](https://github.com/the-snowpear/omp-studio)"));
const ompTag = /`v(\d+\.\d+\.\d+)`/.exec(ompRow ?? "")?.[1];
const studioTag = /`v(\d+\.\d+\.\d+)`/.exec(studioRow ?? "")?.[1];
if (!ompTag) problems.push("document/upstream-baselines.md has no integrated OMP tag");
if (!studioTag) problems.push("document/upstream-baselines.md has no integrated Studio tag");
if (ompTag && !readme.includes(`OMP **v${ompTag}**`)) {
	problems.push(`README does not name the integrated OMP v${ompTag}`);
}
if (studioTag && !readme.includes(`**v${studioTag}** renderer`)) {
	problems.push(`README does not name the integrated Studio v${studioTag}`);
}
const header = /^## Integrated through: v(\d+\.\d+\.\d+)$/m.exec(sync)?.[1];
if (!header) problems.push("document/upstream-sync.md has no Integrated through header");
else if (ompTag && header !== ompTag) {
	problems.push(`upstream-sync header v${header} disagrees with OMP baseline v${ompTag}`);
}

if (problems.length > 0) {
	console.error("Release documentation is not tag-ready:");
	for (const problem of problems) console.error(`- ${problem}`);
	console.error(`Workspace: ${root}`);
	process.exit(1);
}
console.log(`Release docs match ${version}: README badge, OMP v${ompTag}, Studio v${studioTag}, upstream header.`);
