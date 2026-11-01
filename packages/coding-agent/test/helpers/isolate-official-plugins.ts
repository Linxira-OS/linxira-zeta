import path from "node:path";

// Point the built-in `official` plugin catalog at a nonexistent path for the
// whole test process. Chunked CI runs load many test files into one process;
// without this, any suite that lists marketplaces or reads plugin state would
// see the real `plugins/official` tree next to this package — leaking a
// `pi-messenger@official` install into temp plugin roots and an extra entry into
// `listAvailablePlugins()` expectations of unrelated suites.
//
// official-catalog.test.ts opts back in by pointing the variable at a fixture,
// and deletes it when it asserts on the repository's own manifests.
process.env.ZETA_OFFICIAL_PLUGINS_DIR = path.join(
	path.dirname(process.execPath),
	"__zeta_test_no_official_plugins__",
);
// A bundle/binary build defines this; a source run must never inherit one, or the
// snapshot would shadow the fixture each test points the catalog at.
delete process.env.ZETA_OFFICIAL_PLUGINS_EMBED;
