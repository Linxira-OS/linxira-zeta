import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { resolveGatewayUrl, resolveStatsUrl } from "./lib/proxy-targets";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
	const piPkgPath = join(__dirname, "node_modules/@linxiraos/zeta/package.json");
	piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch {
	/* package not found, use default */
}

const nextConfig: NextConfig = {
	// 通过环境变量切换 standalone 打包模式（桌面角色/可携带部署）
	output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
	// Pin file tracing to this directory. Without it Next infers the workspace
	// root from the outer bun.lock and traces the monorepo root, which walks
	// the runner's junctioned profile dirs on Windows (EPERM scandir
	// "Application Data", vercel/next.js#40760). Also silences the
	// multiple-lockfiles warning.
	outputFileTracingRoot: __dirname,
	// Desktop packaging traces from this directory only: web-ui's npm deps
	// live in web-ui/node_modules, and tracing the monorepo root walks the
	// runner's junctioned profile dirs on Windows (EPERM scandir "Application
	// Data", vercel/next.js#40760).
	serverExternalPackages: [
		"better-sqlite3",
		"undici",
		"fastembed",
		"onnxruntime-node",
		"tar",
		"@anush008/tokenizers",
		"@anush008/tokenizers-win32-x64-msvc",
		"@anush008/tokenizers-darwin-arm64",
		"@anush008/tokenizers-linux-x64-gnu",
	],
	webpack(config) {
		config.resolve.alias = {
			...config.resolve.alias,
			"omp-legacy-pi-modules": require.resolve("./omp-legacy-pi-modules.ts"),
			"fastembed/package.json": join(dirname(require.resolve("fastembed")), "package.json"),
		};
		config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
		const linxAsset = /node_modules[\\/]@linxiraos[\\/].*\.(md|lark|py|jl|rb|sh|txt|html|css|applescript|node|wasm)$/;
		config.module.rules.push(
			{
				test: /node_modules[\\/]@linxiraos[\\/].*\.tsx?$/,
				exclude: /\.d\.ts$/,
				use: [
					{
						loader: "babel-loader",
						options: {
							presets: ["@babel/preset-typescript"],
							plugins: ["@babel/plugin-transform-explicit-resource-management"],
							cacheDirectory: false,
						},
					},
				],
			},
			{ test: linxAsset, type: "asset/source" },
			{ test: /\.(node|wasm)$/, type: "asset/source" },
			{ test: /node_modules[\\/]@linxiraos[\\/](zeta|pi-hashline)[\\/]markit[\\/]NOTICE$/, type: "asset/source" },
		);
		return config;
	},
	allowedDevOrigins: ["192.168.*.*"],
	async headers() {
		return [
			{
				source: "/",
				headers: [
					{ key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
					// Clickjacking defense: the agent UI can approve plans / run bash, so
					// it must never be embedded by a third-party page.
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
				],
			},
		];
	},
	// Gateway-owned /api families reach the runtime Web Gateway through
	// resolveGatewayUrl() (injected ZETA_WEB_GATEWAY_URL, else
	// ZETA_WEB_GATEWAY_PORT, else the default) — never a hardcoded port.
	// Note the timing: Next evaluates this function when the config is loaded
	// (web-ui build for `next start`), so the origin is only adoptable for the
	// families listed here when it is known then. `zeta serve` therefore
	// dispatches the gateway-owned families in-process (see zeta-server.ts
	// classifyRequest) and Next owns request-time proxies (/api/git, /api/tracking)
	// for the paths it serves itself. Ownership: document/web-gateway.md.
	async rewrites() {
		const gateway = resolveGatewayUrl();
		const stats = resolveStatsUrl();
		return {
			beforeFiles: [
				{ source: "/api/sessions/:path*", destination: `${gateway}/api/sessions/:path*` },
				{ source: "/api/agent/:path*", destination: `${gateway}/api/agent/:path*` },
				{ source: "/api/auth/:path*", destination: `${gateway}/api/auth/:path*` },
				{ source: "/api/models/:path*", destination: `${gateway}/api/models/:path*` },
				{ source: "/api/models-config/:path*", destination: `${gateway}/api/models-config/:path*` },
				{ source: "/api/settings/:path*", destination: `${gateway}/api/settings/:path*` },
				{ source: "/api/skills/:path*", destination: `${gateway}/api/skills/:path*` },
				{ source: "/api/plugins/:path*", destination: `${gateway}/api/plugins/:path*` },
				{ source: "/api/web-config/:path*", destination: `${gateway}/api/web-config/:path*` },
				{ source: "/api/channels/:path*", destination: `${gateway}/api/channels/:path*` },
				{ source: "/api/tracking/:path*", destination: `${gateway}/api/tracking/:path*` },
				{ source: "/api/open/:path*", destination: `${gateway}/api/open/:path*` },
				{ source: "/api/update/:path*", destination: `${gateway}/api/update/:path*` },
				{ source: "/api/docs/:path*", destination: `${gateway}/api/docs/:path*` },
				{ source: "/api/projects/:path*", destination: `${gateway}/api/projects/:path*` },
				// `/api/git/*` is NOT rewritten: Next serves the whole family —
				// `status`/`diff` from local Node handlers, `branches`/`checkout`/
				// `branch` through request-time proxies (app/api/git/*) that
				// resolve the gateway origin per request. A beforeFiles rewrite
				// here would both shadow those handlers and pin the gateway port
				// at build time.
				// Session blob bytes (agent screenshots in tool results). The
				// `zeta serve` listener routes /api/* to the gateway already; this
				// covers `next dev` / standalone `next start` against it.
				{ source: "/api/blobs/:path*", destination: `${gateway}/api/blobs/:path*` },
				// Stats Dashboard is a separate service (default :3847). Under
				// `zeta serve` the unified listener already routes /api/stats; this
				// rewrite covers `next dev` / standalone `next start` against the
				// gateway-only topology. Same rule as the gateway: the port comes
				// from the injected URL, never a literal (`--stats-port`).
				{ source: "/api/stats/:path*", destination: `${stats}/api/stats/:path*` },
			],
		};
	},
	env: {
		// Desktop packaging (desktop/scripts/prepare-runtime.mjs) injects
		// ZETA_APP_VERSION from desktop/package.json so the UI shows the release
		// version instead of this snapshot's own (upstream-derived) version.
		NEXT_PUBLIC_APP_VERSION: process.env.ZETA_APP_VERSION ?? version,
		NEXT_PUBLIC_ZETA_VERSION: piVersion,
	},
};

export default nextConfig;
