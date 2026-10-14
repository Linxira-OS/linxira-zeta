/**
 * Service readiness diagnostics for the desktop shell.
 *
 * Pure decision + text logic (no Electron imports), same pattern as
 * service-supervision.ts, so the failure dialog and the deregistration decision
 * are unit-testable without launching the app.
 *
 * The three surfaces come from the failure this module exists to name (v1.2.1):
 *
 *   gateway API   `GET <webUiUrl>/api/sessions` — answered *in process* by the
 *                 serve gateway, so it stays 200 while the Web UI is dead;
 *   Web UI page   `GET <webUiUrl>/`             — proxied to the serve process's
 *                 Web UI child; 502 means the proxy could not reach that child
 *                 (the release log's `Proxy request failed … ECONNREFUSED`);
 *   stats         `GET <statsUrl>/`             — the stats dashboard listener.
 *
 * A reused instance that answers the first and fails the second is a corpse:
 * the shell must not keep its registration (the next launch adopted it again,
 * forever) and must say which surface failed instead of "did not answer".
 */

/** One probed surface, named for the dialog. */
export interface ServiceProbe {
	label: string;
	url: string;
	ok: boolean;
	/** HTTP status of the answer; null when the request never produced one. */
	status: number | null;
	/** Transport error when the request failed outright. */
	error: string | null;
}

/** Verdict of one readiness pass: every surface the window needs. */
export interface ServiceReadiness {
	ready: boolean;
	probes: ServiceProbe[];
}

/** Per-surface budget: a hung child must not stall the whole ready wait. */
export const READINESS_PROBE_TIMEOUT_MS = 5_000;

/** Probe all three surfaces in parallel; `ready` only when every one answers. */
export async function probeServiceReadiness(args: {
	webUiUrl: string;
	statsUrl: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}): Promise<ServiceReadiness> {
	const doFetch = args.fetchImpl ?? fetch;
	const timeoutMs = args.timeoutMs ?? READINESS_PROBE_TIMEOUT_MS;
	const webUi = args.webUiUrl.replace(/\/+$/, "");
	const stats = args.statsUrl.replace(/\/+$/, "");
	const targets: Array<Pick<ServiceProbe, "label" | "url">> = [
		{ label: "gateway API", url: `${webUi}/api/sessions` },
		{ label: "Web UI page", url: `${webUi}/` },
		{ label: "stats dashboard", url: `${stats}/` },
	];
	const probes = await Promise.all(
		targets.map(async target => {
			try {
				const response = await doFetch(target.url, {
					headers: { accept: "text/html,application/json" },
					signal: AbortSignal.timeout(timeoutMs),
				});
				return { ...target, ok: response.ok, status: response.status, error: null } satisfies ServiceProbe;
			} catch (err) {
				return {
					...target,
					ok: false,
					status: null,
					error: err instanceof Error ? err.message : String(err),
				} satisfies ServiceProbe;
			}
		}),
	);
	return { ready: probes.every(probe => probe.ok), probes };
}

/**
 * Which registration a failed readiness pass must retire, or null to keep it.
 *
 * Only a registration that still names the instance the shell reused is
 * removable: with none, or with one already taken over by another pid, there is
 * nothing of ours to drop (`clearServeRegistrationForPid` re-checks the file
 * before deleting, so a successor written between the two steps survives).
 */
export function registrationPidToRetire(args: {
	reusedPid: number | null;
	registrationPid: number | null;
}): number | null {
	const { reusedPid, registrationPid } = args;
	if (reusedPid === null || registrationPid === null || reusedPid !== registrationPid) return null;
	return reusedPid;
}

/** `HTTP 502 Bad Gateway` / `ECONNREFUSED …` — one line per probe. */
function describeProbe(probe: ServiceProbe): string {
	const answer = probe.status === null ? (probe.error ?? "no answer") : `HTTP ${probe.status}`;
	return `  ${probe.label.padEnd(15)} GET ${probe.url} → ${answer}`;
}

/**
 * The message the failure dialog shows. Names the surface that failed, the URL
 * it tried, what the other two surfaces answered, and what was done with the
 * registration — the three facts that turned the v1.2.1 loop into a guess.
 */
export function describeReadinessFailure(args: {
	readiness: ServiceReadiness;
	/** Instance the shell reused, when the failure happened after adoption. */
	reused: { pid: number; version: string; webUrl: string } | null;
	/** Registration retirement outcome for a reused instance. */
	retire: { pid: number; retired: boolean } | null;
}): string {
	const { readiness, reused, retire } = args;
	const lines = [
		reused
			? `The running Zeta service at ${reused.webUrl} is not serving its Web UI.`
			: "The Zeta service did not become ready in time.",
		"",
		...readiness.probes.map(describeProbe),
	];
	const gateway = readiness.probes.find(probe => probe.label === "gateway API");
	const page = readiness.probes.find(probe => probe.label === "Web UI page");
	if (gateway?.ok && page && !page.ok) {
		lines.push(
			"",
			`The gateway answered, so the service process is running — ${page.url} is proxied to its`,
			"Web UI child process, and that child did not answer (HTTP 5xx from the serve reverse",
			"proxy). The service log (~/.zeta/logs/zeta.<date>.<pid>.log) names the child target it tried.",
		);
	}
	if (reused && retire) {
		lines.push(
			"",
			retire.retired
				? `Its registration was removed, so this shell will not adopt that service again.`
				: `Its registration names another instance, so it was left untouched.`,
		);
		lines.push(
			`Quit that service (pid ${reused.pid}, version ${reused.version}) and start Zeta again, or keep using it`,
			"in a browser — the gateway and stats dashboard still answer.",
		);
	}
	return lines.join("\n");
}
