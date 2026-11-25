import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Standalone Team/Rooms bundle.
 *
 * `@linxiraos/studio-contract` stays the import specifier in the moved pages;
 * it resolves to the local contract subset so nothing here reaches into
 * web-app or packages/* source.
 */
export default defineConfig({
	root,
	base: "/zeta-pages/",
	publicDir: false,
	resolve: {
		alias: {
			"@linxiraos/studio-contract": path.resolve(root, "contract/index.ts"),
		},
	},
	build: {
		outDir: path.resolve(root, "../../dist/zeta-pages"),
		emptyOutDir: true,
		sourcemap: false,
	},
	server: {
		port: 7008,
		proxy: {
			"/api": { target: "http://127.0.0.1:43143", changeOrigin: false, ws: true },
			"/health": { target: "http://127.0.0.1:43143", changeOrigin: false },
		},
	},
});
