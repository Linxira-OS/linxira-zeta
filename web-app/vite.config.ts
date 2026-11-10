import { fileURLToPath } from "node:url";
import { graphicVendorPlugin } from "./graphic-vendor-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Must stay in lockstep with packages/coding-agent/src/server/studio-web-app.ts
// (STUDIO_RENDERER_CSP), which sends the same policy as a response header when
// `zeta serve` serves this build.
// file:// loads do not reliably get webRequest CSP headers, so the packaged
// index.html carries the policy as a meta tag. `frame-ancestors` is enforced
// by the desktop response header because browsers ignore it in meta CSP; the
// statistics page's loopback frame lives in `frame-src` here because listing
// any source there replaces the `default-src` fallback.
// Vite dev still needs HMR.
const PACKAGED_RENDERER_CSP =
	"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: zeta-artifact:; media-src 'self' blob: zeta-artifact:; font-src 'self' data:; connect-src 'self' zeta-artifact:; frame-src 'self' http://127.0.0.1:3847; object-src 'none'; base-uri 'self'; form-action 'self'";

function packagedCspPlugin() {
	return {
		name: "omp-packaged-csp",
		apply: "build" as const,
		transformIndexHtml(html: string) {
			if (html.includes("Content-Security-Policy")) return html;
			return html.replace(
				"<head>",
				`<head>\n    <meta http-equiv="Content-Security-Policy" content="${PACKAGED_RENDERER_CSP}" />`,
			);
		},
	};
}

// P0 renderer: a pure browser build with no host-specific coupling. The
// relative base keeps the same bundle loadable from any origin the shell
// later serves it from (including file:// during early desktop bring-up).
export default defineConfig({
	resolve: {
		alias: {
			"@/lib/studio-protocol/contract": fileURLToPath(new URL("./src/protocol/contract/index.ts", import.meta.url)),
			"@/lib/studio-protocol/protocol": fileURLToPath(new URL("./src/protocol/protocol/index.ts", import.meta.url)),
			"@linxiraos/studio-contract": fileURLToPath(
				new URL("./src/vendor/client-contract/src/index.ts", import.meta.url),
			),
			"@linxiraos/studio-protocol": fileURLToPath(
				new URL("./src/vendor/studio-protocol/src/index.ts", import.meta.url),
			),
			"@linxiraos/studio-client": fileURLToPath(new URL("./src/vendor/client/src/index.ts", import.meta.url)),
			"@linxiraos/studio-transport-web": fileURLToPath(
				new URL("./src/vendor/transport-web/src/index.ts", import.meta.url),
			),
			"@linxiraos/studio-platform": fileURLToPath(new URL("./src/vendor/platform/src/index.ts", import.meta.url)),
			"@linxiraos/studio-transport-desktop": fileURLToPath(
				new URL("./src/zeta/transport-desktop.ts", import.meta.url),
			),
			"@linxiraos/studio-runtime-installer": fileURLToPath(
				new URL("./src/zeta/runtime-installer.ts", import.meta.url),
			),
		},
	},
	plugins: [react(), packagedCspPlugin(), graphicVendorPlugin()],
	base: "./",
	server: {
		// Terminal panes and Studio events ride WebSockets on the gateway, so the
		// dev proxy must forward upgrades as well as HTTP.
		proxy: {
			"/api": { target: "http://127.0.0.1:43143", ws: true },
			"/health": { target: "http://127.0.0.1:43143", ws: true },
		},
		cors: { origin: ["null", /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] },
	},
	build: {
		rollupOptions: {
			input: { index: fileURLToPath(new URL("./index.html", import.meta.url)) },
			output: {
				// Keep the entry under the 500 kB warning: React, xterm, and the
				// Studio client stay on their own cacheable vendor chunks.
				// Mermaid is only imported lazily for fenced "mermaid" blocks, so its
				// whole dependency tree rides its own chunk instead of inflating vendor.
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					if (id.includes("/three/") || id.includes("\\three\\")) return "three";
					if (id.includes("@xterm")) return "xterm";
					if (id.includes("@codemirror") || id.includes("@lezer") || /node_modules[/\\]codemirror[/\\]/.test(id)) {
						return "codemirror";
					}
					const mermaidPackages = [
						"mermaid",
						"@mermaid-js",
						"d3",
						"dagre",
						"dagre-d3",
						"graphlib",
						"cytoscape",
						"khroma",
						"dompurify",
						"katex",
						"dayjs",
						"@braintree",
						"non-layered-tidy-tree-layout",
						"@iconify",
						"langium",
						"stylis",
						"ts-dedent",
						"uuid",
						"delaunator",
						"internmap",
						"robust-predicates",
					];
					const pkg = id.split(/node_modules[/\\]/)[1] ?? "";
					if (mermaidPackages.some(name => pkg.startsWith(name))) return "mermaid";
					if (id.includes("@linxiraos/studio-")) return "studio-client";
					if (/node_modules[/\\](?:react-dom|react|scheduler)[/\\]/.test(id)) return "react";
					return "vendor";
				},
			},
		},
	},
});
