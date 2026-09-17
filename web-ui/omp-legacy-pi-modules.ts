// Compile-time stub for the Bun build plugin's `omp-legacy-pi-modules`
// virtual module. The real module only exists inside zeta compiled binaries
// (see @linxiraos/zeta/src/extensibility/plugins/legacy-pi-compat.ts); this
// Next.js bundle never runs in compiled mode, so the stub is only loaded by
// webpack to satisfy the dynamic import edge.
export const BUNDLED_PI_MODULE_LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {};