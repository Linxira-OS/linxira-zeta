import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { graphicVendorPlugin } from "./graphic-vendor-plugin";

// Measurement build only: one input, its own output directory. The product
// build stays on `vite.config.ts` / `dist/` and is never touched here.
// The alias table must stay in lockstep with the product config so the same
// modules resolve; it is copied because a measurement build must not inherit
// product-only plugins (CSP injection and chunk policy are not needed).
function indexHtmlOutput(): Plugin {
  return {
    name: "perf-index-html",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const entry = bundle["perf-harness.html"];
      if (entry === undefined || entry.type !== "asset") return;
      delete bundle["perf-harness.html"];
      entry.fileName = "index.html";
      bundle["index.html"] = entry;
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@/lib/studio-protocol/contract": fileURLToPath(new URL("./src/protocol/contract/index.ts", import.meta.url)),
      "@/lib/studio-protocol/protocol": fileURLToPath(new URL("./src/protocol/protocol/index.ts", import.meta.url)),
      "@linxiraos/studio-contract": fileURLToPath(new URL("./src/vendor/client-contract/src/index.ts", import.meta.url)),
      "@linxiraos/studio-protocol": fileURLToPath(new URL("./src/vendor/studio-protocol/src/index.ts", import.meta.url)),
      "@linxiraos/studio-client": fileURLToPath(new URL("./src/vendor/client/src/index.ts", import.meta.url)),
      "@linxiraos/studio-transport-web": fileURLToPath(new URL("./src/vendor/transport-web/src/index.ts", import.meta.url)),
      "@linxiraos/studio-platform": fileURLToPath(new URL("./src/vendor/platform/src/index.ts", import.meta.url)),
      "@linxiraos/studio-transport-desktop": fileURLToPath(new URL("./src/zeta/transport-desktop.ts", import.meta.url)),
      "@linxiraos/studio-runtime-installer": fileURLToPath(new URL("./src/zeta/runtime-installer.ts", import.meta.url)),
    },
  },
  plugins: [react(), graphicVendorPlugin(), indexHtmlOutput()],
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist-perf", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: { perf: fileURLToPath(new URL("./perf-harness.html", import.meta.url)) },
    },
  },
});
