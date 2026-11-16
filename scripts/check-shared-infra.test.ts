import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const fixtures: string[] = [];

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await fs.rm(fixture, { recursive: true, force: true });
});

async function checkLocalArchive(options: { declared?: boolean; integrity?: string; resolved?: string } = {}) {
	const fixture = await fs.mkdtemp(path.join(ROOT, "temp/shared-infra-"));
	fixtures.push(fixture);
	await fs.mkdir(path.join(fixture, "scripts"));
	for (const name of ["check-shared-infra.ts", "shared-infra-inventory.ts"]) {
		await fs.copyFile(path.join(ROOT, "scripts", name), path.join(fixture, "scripts", name));
	}
	const bytes = new TextEncoder().encode("locked archive fixture");
	const resolved = options.resolved ?? "file:vendor/parser.tgz";
	const integrity = options.integrity ?? `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
	await Bun.write(path.join(fixture, "web-app/vendor/parser.tgz"), bytes);
	await Bun.write(path.join(fixture, "outside.tgz"), bytes);
	await Bun.write(
		path.join(fixture, "web-app/package.json"),
		JSON.stringify({ dependencies: options.declared === false ? {} : { parser: resolved } }),
	);
	await Bun.write(
		path.join(fixture, "web-app/package-lock.json"),
		JSON.stringify({ packages: { "node_modules/parser": { resolved, integrity } } }),
	);
	await Bun.$`git init -q ${fixture}`.quiet();
	await Bun.$`git -C ${fixture} add web-app/package-lock.json`.quiet();
	return Bun.$`${process.execPath} scripts/check-shared-infra.ts`.cwd(fixture).quiet().nothrow();
}

describe("shared infrastructure lockfile sources", () => {
	test("accepts directly declared local bytes and rejects altered archive integrity", async () => {
		expect((await checkLocalArchive()).exitCode).toBe(0);
		const altered = await checkLocalArchive({ integrity: "sha512-altered" });
		expect(altered.exitCode).toBe(1);
		expect(altered.text()).toContain("SHA-512 integrity does not match");
	}, 30_000);

	test("rejects local archives outside the package root", async () => {
		const result = await checkLocalArchive({ resolved: "file:../outside.tgz" });
		expect(result.exitCode).toBe(1);
		expect(result.text()).toContain("outside its package root");
	}, 30_000);

	test("rejects undeclared local dependencies", async () => {
		const result = await checkLocalArchive({ declared: false });
		expect(result.exitCode).toBe(1);
		expect(result.text()).toContain("not a directly declared local tarball");
	}, 30_000);

	test("continues rejecting off-registry remote tarballs", async () => {
		const result = await checkLocalArchive({ resolved: "https://cdn.example.test/parser.tgz" });
		expect(result.exitCode).toBe(1);
		expect(result.text()).toContain("resolves against cdn.example.test");
	}, 30_000);
});
