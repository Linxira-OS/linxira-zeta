import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // 通过环境变量启用 standalone 输出模式（用于绿色版/便携版打包）
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  // 仅在 standalone 模式下设置，避免开发模式下的警告
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { outputFileTracingRoot: join(__dirname, "..") } : {}),
  serverExternalPackages: [
    "better-sqlite3",
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  // Gateway-owned /api families are served by the runtime Web Gateway
  // (in-process under `zeta serve`, standalone listener in dev). Keeping them
  // here as beforeFiles rewrites means `next dev`/`next start` reach the same
  // handler through ZETA_WEB_GATEWAY_URL. Ownership: document/web-gateway.md.
  async rewrites() {
    const gateway = process.env.ZETA_WEB_GATEWAY_URL ?? "http://127.0.0.1:30142";
    return {
      beforeFiles: [
        { source: "/api/sessions/:path*", destination: `${gateway}/api/sessions/:path*` },
      ],
    };
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
