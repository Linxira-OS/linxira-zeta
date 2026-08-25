#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
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
 *   bun scripts/publish-missing-packages.ts                     # 全部（14 包 → zeta-web → pi-messenger）
 *   bun scripts/publish-missing-packages.ts --only @linxiraos/pi-channels
 *
 * 行为:
 *   - 已发布版本跳过（npm view 命中；EPUBLISHCONFLICT 视为已发）
 *   - zeta-web: version 1.1.0 + @linxiraos 依赖 ^1.1.0 + npm install（装 fastembed、更新 lock）
 *     + next build + publish；会改动 web-ui/package.json（正式提交前请确认）
 *   - pi-messenger（temp/pi-messenger 浅克隆参考）: 临时改名 @linxiraos/pi-messenger
 *     + version 1.1.0 + main=index.ts + publish；仅发 npm 模块，不进入 Zeta 主软件打包
 */
import { $ } from "bun";

const repo = path.resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const RELEASE = "1.1.0";

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
	{ dir: "packages/hashline", name: "@linxiraos/pi-hashline" },
	{ dir: "packages/mnemopi", name: "@linxiraos/pi-mnemopi" },
	{ dir: "packages/snapcompact", name: "@linxiraos/pi-snapcompact" },
	{ dir: "packages/stats", name: "@linxiraos/pi-stats" },
	{ dir: "packages/coding-agent", name: "@linxiraos/zeta" },
	{ dir: "packages/channels", name: "@linxiraos/pi-channels" },
	{ dir: "packages/natives", name: "@linxiraos/pi-natives" },
	{ dir: "packages/omptype", name: "@linxiraos/pi-omptype" },
	{ dir: "packages/wire", name: "@linxiraos/pi-wire" },
	{ dir: "web-ui", name: "@linxiraos/zeta-web", build: true, align: true },
	{ dir: "temp/pi-messenger", name: "@linxiraos/pi-messenger", rename: true },
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

async function alreadyPublished(name: string, version: string): Promise<boolean> {
	const r = await $`npm view ${name}@${version} version`.cwd(repo).quiet().nothrow();
	return r.exitCode === 0;
}

/** 返回 0 成功；1 最终失败；2 已存在（视为成功）。 */
async function publishWithRetry(dir: string, name: string, version: string): Promise<number> {
	for (let attempt = 1; attempt <= 4; attempt++) {
		// Run npm publish with stdin on the terminal (TTY). npm then prints the
		// auth URL and WAITS in the same command for the browser approval
		// (security key + "skip 2FA for 5 minutes"), then completes the publish.
		// Non-TTY shells (Bun $) make npm fail EOTP immediately, so re-running
		// still needs a fresh approval every time.
		const proc = Bun.spawn(["npm", "publish", path.join(repo, dir)], {
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
			console.log(`  ✗ ${name} 授权未完成（attempt ${attempt}/4）。`);
			console.log(
				"    请在上面的浏览器授权页完成 security key 确认；若多次失败，确认勾选了「5 分钟内不再要求 2FA」。",
			);
			continue;
		}
		if (/401|E401|Unauthorized/.test(stderr)) {
			console.log(`  publish 401（attempt ${attempt}/4）`);
			const ok = await relogin();
			if (!ok) return 1;
			continue;
		}
		console.log(`  publish 失败（attempt ${attempt}/4）：`);
		console.log(stderr.split("\n").slice(0, 8).join("\n"));
		return 1;
	}
	return 1;
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
		console.log("  (version 对齐 1.1.0 + @linxiraos 依赖 ^1.1.0)");
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

	const code = await publishWithRetry(t.dir, t.name, version);
	results.push(`${t.name}@${version}: ${code === 0 ? "OK" : code === 2 ? "already published" : "FAIL"}`);
}

console.log("\n=== 汇总 ===");
for (const r of results) console.log(`  ${r}`);
