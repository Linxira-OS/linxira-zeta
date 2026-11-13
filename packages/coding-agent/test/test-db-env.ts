/**
 * Test-only serialization for the process-global `ZETA_TEAM_DB` override.
 *
 * TeamDb reads this environment variable when constructed without an explicit
 * path, so two test files that mutate it concurrently can point the same
 * process at different databases mid-suite. This mutex lets one suite hold a
 * unique temp database (and restores whatever was there before) while other
 * Team suites wait; separate-process runners are unaffected because their
 * environments are already isolated.
 *
 * Not production code: production TeamDb already accepts an explicit path.
 */
let tail: Promise<void> = Promise.resolve();

/** Acquire the env for one suite/test; the returned release restores the previous value. */
export async function holdTeamDbEnv(dbPath: string): Promise<() => void> {
	const { promise: gate, resolve: release } = Promise.withResolvers<void>();
	const waitFor = tail;
	tail = waitFor.then(() => gate);
	await waitFor;
	const previous = process.env.ZETA_TEAM_DB;
	process.env.ZETA_TEAM_DB = dbPath;
	return () => {
		if (previous === undefined) delete process.env.ZETA_TEAM_DB;
		else process.env.ZETA_TEAM_DB = previous;
		release();
	};
}
