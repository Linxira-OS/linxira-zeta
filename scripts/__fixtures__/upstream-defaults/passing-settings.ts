/**
 * Fixture: settings defaults that must pass `check-no-upstream-defaults.ts`.
 *
 * Covers every shape a legitimate default takes — blank, our own site,
 * loopback, an enum value, a bare host name that is not a URL, and an
 * identifier default the guard deliberately does not resolve.
 */
export const SETTINGS_SCHEMA = {
	"fixture.blank": { type: "string", default: "" },
	"fixture.ownSite": { type: "string", default: "https://linxira-os.github.io/install.sh" },
	"fixture.loopback": { type: "string", default: "http://127.0.0.1:6806" },
	"fixture.enumValue": { type: "string", default: "per-project" },
	"fixture.bareWord": { type: "string", default: "omp" },
	"fixture.identifier": { type: "string", default: DEFAULT_RELAY_URL },
};
