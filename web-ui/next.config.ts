import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@linxiraos/zeta/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // ͨ�������������� standalone ���ģʽ��������ɫ��/��Я������
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
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
        use: [{
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-typescript"],
            plugins: ["@babel/plugin-transform-explicit-resource-management"],
            cacheDirectory: false,
          },
        }],
      },
      { test: linxAsset, type: "asset/source" },
      { test: /\.(node|wasm)$/, type: "asset/source" },
      { test: /node_modules[\\/]@linxiraos[\\/](zeta|pi-hashline)[\\/]markit[\\/]NOTICE$/, type: "asset/source" },
    );
    return config;
  },
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
        { source: "/api/agent/:path*", destination: `${gateway}/api/agent/:path*` },
        { source: "/api/auth/:path*", destination: `${gateway}/api/auth/:path*` },
        { source: "/api/models/:path*", destination: `${gateway}/api/models/:path*` },
        { source: "/api/models-config/:path*", destination: `${gateway}/api/models-config/:path*` },
        { source: "/api/skills/:path*", destination: `${gateway}/api/skills/:path*` },
        { source: "/api/plugins/:path*", destination: `${gateway}/api/plugins/:path*` },
      ],
    };
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
