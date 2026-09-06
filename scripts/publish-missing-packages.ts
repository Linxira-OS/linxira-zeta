#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
/**
 * 本地补发包脚本（统一工具，保留）——本地向 npm registry 补发 @linxiraos/* 各包版本，
 * 用于 CI 发布中断后的缺口补发，或本地先行创建新包（pi-channels/zeta-web/pi-messenger）
 * 再让 CI 的 trusted publishing 接管后续发布。
 *
 *   - publish 遇到 EOTP（需要 2FA）→ npm CLI 在 TTY 下会打印授权 URL 并等你在浏览器完成
 *     security key 确认（勾选"5 分钟内不再要求 2FA"），然后同一条命令内完成发布；
 *     5 分钟窗口内多个包无需重复 2FA（超时再 EOTP 会再次等授权）。
 *   - 401（会话过期）重新 `npm login`。
 *   - publish 遇到 EOTP（需要 2FA）→ 脚本调用 `npm login`（CLI 跳转浏览器授权），
 *     你在浏览器登录页勾选"5 分钟内不再要求 2FA"，获得临时认证后脚本继续发布
 *     （5 分钟窗口内多个包无需重复 2FA；超时再 EOTP 会再次登录）。
 *   - 401（会话过期）同样重新 `npm login`。
 *
 * 用法（新 PowerShell 窗口，先 cd 到仓库根）:
 *   cd C:\Users\ETPau\Documents\GITHUB\zeta
 *   bun scripts/publish-missing-packages.ts                     # 全部核心包（web-ui/pi-messenger 需另行确认）
 *   bun scripts/publish-missing-packages.ts --only @linxiraos/pi-channels
 *
 * 行为:
 *   - 已发布版本跳过（npm view 命中；EPUBLISHCONFLICT 视为已发）
 *   - zeta-web / pi-messenger 不在默认链路里（版本线独立，发布节奏单独决策）；
 *     如需补发，用 --only @linxiraos/zeta-web / --only @linxiraos/pi-messenger。
 *   - 1.1.9（v1.1.9 release）: CI native-leaf job 在 win32-arm64 首发时 404 中断，
 *     主包 14 个 + musl leaf 全部未发；用本脚本补发核心包，musl/win32-arm64 leaf
 *     由 CI 的 trusted publishing 补（或 npmjs.com 网页端放行后重跑 release run）。
 */
import { $ } from "bun";

const repo = path.resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const doDeprecate = args.includes("--deprecate");
const RELEASE = "1.1.9";
const deprecateVersion = (() => {
	const idx = args.indexOf("--version");
	return idx >= 0 ? args[idx + 1] : "1.1.0";
})();

const TARGETS: Array<{
	dir: string;
	name: string;
	build?: boolean;
	align?: boolean;
	rename?: boolean;
}> = [
	{ dir: "packages/utils", name: "@linxiraos/pi-utils" },
	{ dir: "packages/agent", name: "@linxiraos/pi-agent-core" },
	{ dir: "packages/catalog", name: "@linxiraos/pi-catalog" },
	{ dir: "packages/ai", name: "@linxiraos/pi-ai" },
	{ dir: "packages/tui", name: "@linxiraos/pi-tui" },
	{ dir: "packages/mnemopi", name: "@linxiraos/pi-mnemopi" },
	{ dir: "packages/snapcompact", name: "@linxiraos/pi-snapcompact" },
	{ dir: "packages/stats", name: "@linxiraos/pi-stats" },
	{ dir: "packages/coding-agent", name: "@linxiraos/zeta" },
	{ dir: "packages/channels", name: "@linxiraos/pi-channels" },
	{ dir: "packages/natives", name: "@linxiraos/pi-natives" },
	{ dir: "packages/omptype", name: "@linxiraos/pi-omptype" },
	{ dir: "packages/wire", name: "@linxiraos/pi-wire" },
	// zeta-web（web-ui）与 pi-messenger 版本线独立（1.1.5 / 1.1.1），不随 RELEASE 走；
	// 需要时 --only 单发（见头部说明）。
	// { dir: "web-ui", name: "@linxiraos/zeta-web", build: true, align: true },
	// { dir: "plugins/official/pi-messenger", name: "@linxiraos/pi-messenger", rename: true },
];

interface PkgShape {
	name?: string;
	version?: string;
	main?: string;
	private?: boolean;
	dependencies?: Record<string, string>;
}

async function loginInteractive(label: string): Promise<boolean> {
	console.log(`\n⚠ ${label} 在下方交互式登录（浏览器授权，勾选"5 分钟内不再要求 2FA"）：`);
	const login = await $`npm login`.cwd(repo).nothrow();
	if (login.exitCode !== 0) {
		console.error("npm login 失败。请手动执行 `npm login` 后重跑本脚本。");
		return false;
	}
	console.log("npm 登录成功，继续发布。");
	return true;
}

async function ensureLogin(): Promise<void> {
	const who = await $`npm whoami`.cwd(repo).quiet().nothrow();
	if (who.exitCode === 0) {
		console.log(`npm 已登录: ${who.stdout.toString().trim()}`);
		return;
	}
	await loginInteractive("npm 未登录。");
}

async function relogin(): Promise<boolean> {
	return loginInteractive("npm 会话过期或需要 2FA。");
}

async function openUrl(url: string): Promise<void> {
	if (process.platform === "win32") {
		await $`start ${url}`.cwd(repo).quiet().nothrow();
	} else if (process.platform === "darwin") {
		await $`open ${url}`.cwd(repo).quiet().nothrow();
	} else {
		await $`xdg-open ${url}`.cwd(repo).quiet().nothrow();
	}
}

function waitForEnter(promptText: string): Promise<void> {
	return new Promise(resolve => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(promptText, () => {
			rl.close();
			resolve();
		});
	});
}

/** npm 不支持 Bun 的 catalog: 协议——发布前临时重写为实际版本，发布后恢复。 */
function rewriteCatalogDeps(pkgPath: string): Array<{ field: string; name: string; spec: string }> {
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, Record<string, string>>;
	const rootPkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as {
		workspaces?: { catalog?: Record<string, string> };
	};
	const catalog = rootPkg.workspaces?.catalog ?? {};
	const backup: Array<{ field: string; name: string; spec: string }> = [];
	for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
		const deps = pkg[field];
		if (!deps) continue;
		for (const [name, spec] of Object.entries(deps)) {
			if (spec === "catalog:") {
				backup.push({ field, name, spec });
				deps[name] = catalog[name] ?? spec;
			}
		}
	}
	if (backup.length) {
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
		console.log(`  (catalog: 依赖临时重写为实际版本——${backup.length} 处)`);
	}
	return backup;
}

function restoreCatalogDeps(pkgPath: string, backup: Array<{ field: string; name: string; spec: string }>): void {
	if (!backup.length) return;
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, Record<string, string>>;
	for (const b of backup) pkg[b.field][b.name] = b.spec;
	fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
function walk(dir: string): string[] {
	const out: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

/**
 * pi-messenger 来自 OMP 上游（依赖/源码引用 @earendil-works/*）——发布前把包名依赖和
 * 源码 import 全部改写到 @linxiraos/*，让扩展 peer 到 Zeta 运行时而不是上游运行时；
 * 发布后恢复原状。
 */
function rewriteEarendilDeps(dir: string): Array<{ path: string; original: string }> {
	const backup: Array<{ path: string; original: string }> = [];
	const manifestPath = path.join(dir, "package.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, Record<string, string>>;
	for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
		const deps = manifest[field];
		if (!deps) continue;
		for (const name of Object.keys(deps)) {
			if (!name.startsWith("@earendil-works/")) continue;
			const renamed =
				name === "@earendil-works/pi-coding-agent"
					? "@linxiraos/zeta"
					: `@linxiraos/${name.slice("@earendil-works/".length)}`;
			deps[renamed] = deps[name];
			delete deps[name];
			console.log(`  (@earendil-works → @linxiraos in ${field}: ${name} → ${renamed})`);
		}
	}
	const originalManifest = fs.readFileSync(manifestPath, "utf8");
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	backup.push({ path: manifestPath, original: originalManifest });

	for (const file of walk(dir)) {
		if (!/\.(ts|mjs|js|tsx|jsx)$/.test(file)) continue;
		const content = fs.readFileSync(file, "utf8");
		if (!content.includes("@earendil-works/")) continue;
		fs.writeFileSync(
			file,
			content
				.replaceAll("@earendil-works/pi-coding-agent", "@linxiraos/zeta")
				.replaceAll("@earendil-works/", "@linxiraos/"),
		);
		backup.push({ path: file, original: content });
		console.log(`  (source import rewrite: ${path.relative(repo, file)})`);
	}
	return backup;
}

function restoreFiles(backup: Array<{ path: string; original: string }>): void {
	for (const b of backup) fs.writeFileSync(b.path, b.original);
}

async function alreadyPublished(name: string, version: string): Promise<boolean> {
	const r = await $`npm view ${name}@${version} version`.cwd(repo).quiet().nothrow();
	return r.exitCode === 0;
}

/** deprecate 坏版本。1.1.0: catalog: 协议依赖；1.1.2: native addon sentinel 不匹配。 */
async function deprecateBroken(version: string): Promise<void> {
	let names: string[];
	let message: string;
	if (version === "1.1.2") {
		// 10 个已发核心包 + 5 个 leaf（1.1.1 addon 顶替 1.1.2，sentinel 不匹配）。
		names = [
			"@linxiraos/pi-utils",
			"@linxiraos/pi-ai",
			"@linxiraos/pi-tui",
			"@linxiraos/pi-hashline",
			"@linxiraos/pi-mnemopi",
			"@linxiraos/pi-snapcompact",
			"@linxiraos/pi-stats",
			"@linxiraos/pi-channels",
			"@linxiraos/pi-omptype",
			"@linxiraos/pi-wire",
			"@linxiraos/pi-natives-linux-x64",
			"@linxiraos/pi-natives-linux-arm64",
			"@linxiraos/pi-natives-win32-x64",
			"@linxiraos/pi-natives-darwin-x64",
			"@linxiraos/pi-natives-darwin-arm64",
		];
		message = "Broken: native addon sentinel mismatch (1.1.1 addon in 1.1.2). Use 1.1.3.";
	} else {
		// 14 个核心包 + zeta-web 的 1.1.0 都是坏的；pi-messenger@1.1.0 零依赖、完整，不处理。
		names = TARGETS.filter(t => t.name !== "@linxiraos/pi-messenger").map(t => t.name);
		message = "Broken in 1.1.0: dependencies use Bun's catalog: protocol which npm cannot resolve. Upgrade to 1.1.1.";
	}
	for (const name of names) {
		// npm 12 in TTY prints the REAL auth URL and waits for ENTER to open the
		// browser; non-TTY stderr masks it as auth/cli/*** (useless). Keep npm
		// fully interactive so the real URL opens and the 5-min window applies.
		// Bun Shell splits the message on spaces — pass it as a single argv.
		const proc = Bun.spawn(["npm", "deprecate", `${name}@${version}`, message], {
			cwd: repo,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const code = await proc.exited;
		console.log(`${name}@${version} ${code === 0 ? "已 deprecate" : "失败（见上方输出）"}`);
	}
}

/** 返回 0 成功；1 最终失败；2 已存在（视为成功）。 */
async function publishWithRetry(dir: string, name: string, version: string): Promise<number> {
	for (let attempt = 1; attempt <= 4; attempt++) {
		// npm 在非 TTY 下遇到 EOTP 会打印授权 URL 后立即失败（不会自己等待授权）。
		// 脚本捕获 URL、打开浏览器，等你完成 security key 确认（勾选
		// "5 分钟内不再要求 2FA"）并回车后重试——5 分钟窗口内重试应免 2FA。
		const proc = Bun.spawn(["npm", "publish", path.join(repo, dir), "--access", "public"], {
			cwd: repo,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "pipe",
		});
		const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
		if (code === 0) return 0;
		if (/EPUBLISHCONFLICT|already exists|You cannot publish over the previously published versions/.test(stderr)) {
			console.log(`  ${name}@${version} 已存在（并发发布），视为已发。`);
			return 2;
		}
		if (/EOTP|one-time password|requires a one-time password/.test(stderr)) {
			const url = stderr.match(/https:\/\/www\.npmjs\.com\/auth\/cli\/[^\s]+/)?.[0];
			if (url) {
				console.log(`  ✗ ${name} 需要发包授权（attempt ${attempt}/4）。`);
				console.log(`    已在浏览器打开发包授权页：${url}`);
				await openUrl(url);
				await waitForEnter("    完成 security key 确认（勾选「5 分钟内不再要求 2FA」）后按回车继续...");
				continue;
			}
			console.log(`  ✗ ${name} 授权未完成（attempt ${attempt}/4）。`);
			continue;
		}
		if (/401|E401|Unauthorized/.test(stderr)) {
			console.log(`  publish 401（attempt ${attempt}/4）`);
			const ok = await relogin();
			if (!ok) return 1;
			continue;
		}
		console.log(`  publish 失败（attempt ${attempt}/4）--错误详情（stderr 末尾）：`);
		console.log(stderr.split("\n").filter(Boolean).slice(-15).join("\n"));
		return 1;
	}
	return 1;
}

if (doDeprecate) {
	await ensureLogin();
	await deprecateBroken(deprecateVersion);
	process.exit(0);
}

const results: string[] = [];
await ensureLogin();
for (const t of TARGETS) {
	if (only && t.name !== only) continue;
	const pkgPath = path.join(repo, t.dir, "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as PkgShape;
	const version = t.align || t.rename ? RELEASE : (pkg.version ?? "");
	console.log(`\n=== ${t.name}@${version} ===`);

	if (t.rename) {
		pkg.name = t.name;
		pkg.version = version;
		pkg.main = pkg.main ?? "index.ts";
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
		console.log("  (临时改名 + version 1.1.0)");
	}
	if (t.align) {
		pkg.version = version;
		for (const dep of Object.keys(pkg.dependencies ?? {})) {
			if (dep.startsWith("@linxiraos/")) pkg.dependencies![dep] = `^${version}`;
		}
		fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
		console.log(`  (version 对齐 ${RELEASE} + @linxiraos 依赖 ^${RELEASE})`);
	}

	if (await alreadyPublished(t.name, version)) {
		console.log("  已发布，跳过");
		results.push(`${t.name}@${version}: already published`);
		continue;
	}

	if (t.build) {
		console.log("  npm install（装 fastembed、更新 lock）...");
		const r1 = await $`npm install`.cwd(path.join(repo, "web-ui")).quiet().nothrow();
		if (r1.exitCode !== 0) {
			console.log("  npm install 失败，重试一次...");
			const r1b = await $`npm install`.cwd(path.join(repo, "web-ui")).quiet().nothrow();
			if (r1b.exitCode !== 0) {
				console.log("  npm install 仍失败（检查网络/registry/fastembed）");
				results.push(`${t.name}: npm install FAIL`);
				continue;
			}
		}
		console.log("  next build...");
		const r2 = await $`npm run build`.cwd(path.join(repo, "web-ui")).quiet().nothrow();
		if (r2.exitCode !== 0) {
			console.log("  next build 失败（检查 fastembed）");
			results.push(`${t.name}: build FAIL`);
			continue;
		}
	}

	// pi-messenger 来自 OMP 上游（@earendil-works/*）：发布前把依赖/源码 import 改写为
	// @linxiraos/*，发布后恢复，保证扩展 peer 到 Zeta 运行时。
	const earendilBackup = t.rename ? rewriteEarendilDeps(path.join(repo, t.dir)) : [];
	const catalogBackup = rewriteCatalogDeps(pkgPath);
	const code = await publishWithRetry(t.dir, t.name, version);
	restoreCatalogDeps(pkgPath, catalogBackup);
	if (earendilBackup.length) {
		restoreFiles(earendilBackup);
		console.log("  (已恢复 @earendil-works 原名)");
	}
	results.push(`${t.name}@${version}: ${code === 0 ? "OK" : code === 2 ? "already published" : "FAIL"}`);
}

console.log("\n=== 汇总 ===");
for (const r of results) console.log(`  ${r}`);
