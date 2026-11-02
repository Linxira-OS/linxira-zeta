/**
 * Fixture: settings defaults that must fail `check-no-upstream-defaults.ts`.
 *
 * Never imported — the guard is pointed at this file explicitly to prove the
 * two rules still bite after a refactor.
 */
export const SETTINGS_SCHEMA = {
	"fixture.upstreamHost": { type: "string", default: "https://my.omp.sh/s" },
	"fixture.upstreamDocs": { type: "string", default: "https://build.stencil.so" },
	"fixture.foreignUrl": { type: "string", default: "https://example.com/api" },
	"fixture.ownUrl": { type: "string", default: "https://linxira-os.github.io/zeta/" },
};
