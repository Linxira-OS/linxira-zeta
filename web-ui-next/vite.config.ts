import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

// Zeta web gateway (zeta serve). All /api traffic is proxied there in dev;
// in production the same gateway serves this app statically.
const ZETA_GATEWAY = process.env.ZETA_GATEWAY_URL || 'http://127.0.0.1:30141';

// Theme JSON lives under src/lib/theme/themes — push updates over HMR as
// custom events instead of full page reloads (ported from OpenChamber).
const themeDirectory = path.resolve(__dirname, 'src/lib/theme/themes');
const themeJsonHmrPlugin = () => ({
  name: 'zeta-theme-json-hmr',
  handleHotUpdate({ file, server }: { file: string; server: { ws: { send: (payload: unknown) => void } } }) {
    if (!file.startsWith(`${themeDirectory}${path.sep}`) || path.extname(file) !== '.json') {
      return undefined;
    }
    try {
      server.ws.send({
        type: 'custom',
        event: 'openchamber:theme-updated',
        data: JSON.parse(readFileSync(file, 'utf-8')),
      });
      return [];
    } catch {
      return [];
    }
  },
});

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    themeJsonHmrPlugin(),
  ],
  resolve: {
    alias: [
      // npm layout exposes ./v2 directly; the upstream bun-layout pin is only
      // needed if resolution fails (kept as a safety net).
      { find: '@opencode-ai/sdk/v2', replacement: path.resolve(__dirname, 'node_modules/@opencode-ai/sdk/dist/v2/client.js') },
      { find: '@openchamber/ui', replacement: path.resolve(__dirname, 'src') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  worker: {
    format: 'es',
  },
  define: {
    'process.env': {},
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  optimizeDeps: {
    include: ['@opencode-ai/sdk/v2'],
  },
  server: {
    port: 5199,
    proxy: {
      '/api': {
        target: ZETA_GATEWAY,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      external: ['node:child_process', 'node:fs', 'node:path', 'node:url'],
      output: {
        manualChunks(id) {
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) {
            return 'vendor-vite-runtime';
          }
          if (!id.includes('node_modules')) return undefined;

          const lastNodeModules = id.lastIndexOf('node_modules/');
          const match = id.slice(lastNodeModules + 'node_modules/'.length);
          if (!match) return undefined;

          const segments = match.split('/');
          const packageName = match.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];

          if (
            packageName === '@shikijs/langs' ||
            packageName === '@shikijs/themes' ||
            packageName === '@codemirror/legacy-modes'
          ) {
            return undefined;
          }

          if (packageName === '@pierre/diffs') {
            return undefined;
          }

          if (packageName === 'react' || packageName === 'react-dom') return 'vendor-react';
          if (packageName === 'zustand' || packageName === 'zustand/middleware') return 'vendor-zustand';
          if (packageName === '@opencode-ai/sdk') return 'vendor-opencode-sdk';
          if (packageName.includes('remark') || packageName.includes('rehype')) return 'vendor-markdown';
          if (packageName === '@base-ui/react' || packageName.startsWith('@base-ui')) return 'vendor-base-ui';

          const sanitized = packageName.replace(/^@/, '').replace(/\//g, '-');
          return `vendor-${sanitized}`;
        },
      },
    },
  },
});
