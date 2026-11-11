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

// Packages that only the diagram renderer pulls in. Mermaid is reached solely
// through `import("mermaid")` (LazyMermaid.tsx, markdown.tsx), so its tree may
// ride a chunk that the entry never imports statically. Anything the entry does
// import statically belongs in `vendor`/`react`/`xterm`/`codemirror` instead —
// otherwise the whole tree below moves into the first load and Vite emits a
// `modulepreload` for it (the 3.36 MB regression this list guards against).
const MERMAID_ONLY_PACKAGES = [
	"mermaid",
	"@mermaid-js",
	"d3",
	"dagre",
	"dagre-d3",
	"graphlib",
	"cytoscape",
	"@upsetjs",
	"khroma",
	"non-layered-tidy-tree-layout",
	"@braintree",
	"@iconify",
	"langium",
	"stylis",
	"ts-dedent",
	"delaunator",
	"internmap",
	"robust-predicates",
	"roughjs",
	"marked",
	"fastdom",
	"es-toolkit",
	"dompurify",
	"dayjs",
	"uuid",
];

// First segment under `node_modules` is the package name, or the scope of a
// scoped package (`@mermaid-js/parser` → `@mermaid-js`). Prefix matching is
// deliberate: the diagram tree is made of families (`d3-*`, `dagre*`,
// `@iconify*`), so an exact-name list would leave parts of it in `vendor` and
// pull them into the first load.
const isMermaidOnlyPackage = (id: string): boolean => {
	const pkg = /node_modules[\\/]([^\\/]+)/.exec(id)?.[1] ?? "";
	return pkg !== "" && MERMAID_ONLY_PACKAGES.some(name => pkg.startsWith(name));
};

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
		rolldownOptions: {
			input: { index: fileURLToPath(new URL("./index.html", import.meta.url)) },
			output: {
				// `codeSplitting.groups`, not `manualChunks`: Vite 8 accepts the
				// deprecated function form and then silently discards its result for
				// the modules its own import-analysis injects, which is exactly how
				// the async diagram chunk turned into a boot dependency. The groups
				// below are the supported Vite 8 path and are honoured for every id.
				codeSplitting: {
					groups: [
						// Vite's dynamic-import preload helper (`\0vite/preload-helper.js`)
						// is required by the entry (modulepreload polyfill plus the entry's
						// own `import()` calls) and by every lazy chunk that preloads its
						// dependencies. Left unassigned, Rolldown parks it inside an async
						// chunk, the entry then imports that chunk statically, and the
						// whole payload (3 MB of Mermaid) lands in the first load. As its
						// own always-loaded chunk it stays out of every lazy chunk.
						{ name: "preload-helper", test: /vite[\\/]preload-helper/, priority: 100 },
						{ name: "three", test: /node_modules[\\/]three[\\/]/, priority: 10 },
						{ name: "xterm", test: /node_modules[\\/]@xterm[\\/]/, priority: 10 },
						{ name: "codemirror", test: /node_modules[\\/](?:@codemirror|@lezer|codemirror)[\\/]/, priority: 10 },
						// KaTeX typesets math inside Mermaid here; packages/export-web
						// bundles its own copy. A separate lazy chunk means a future
						// static KaTeX import cannot drag the whole diagram tree along.
						{ name: "katex", test: /node_modules[\\/]katex[\\/]/, priority: 10 },
						{ name: "mermaid", test: isMermaidOnlyPackage, priority: 10 },
						{ name: "react", test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 10 },
						// Keep the entry under the 500 kB warning: everything else
						// cacheable stays in one static vendor chunk.
						{ name: "vendor", test: /node_modules[\\/]/, priority: 0 },
					],
				},
			},
		},
	},
});
