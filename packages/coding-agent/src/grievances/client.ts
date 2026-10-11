/**
 * Shared GitHub Issues transport for Auto-QA grievances.
 *
 * Downstream Zeta ships no upstream feedback collector: user feedback is filed
 * as a **GitHub issue** on {@link DEFAULT_ISSUE_REPO} through the REST API. One
 * issue is posted per grievance.
 *
 * Resolution rules (the decision of record for the downstream port):
 * - repo: `ZETA_ISSUE_REPO` (`owner/repo`) else {@link DEFAULT_ISSUE_REPO}.
 * - token: `GITHUB_TOKEN`, then `GH_TOKEN`, then a caller-supplied settings
 *   token (`dev.autoqaPush.token`), then `gh auth token`. The token is never
 *   logged or echoed.
 * - no token: nothing is sent and nothing pretends to be sent — the caller
 *   gets the fully composed issue plus a prefilled `.../issues/new` URL and a
 *   plain "not submitted" reason.
 *
 * The composed body is a public artefact: it carries a line stating that the
 * report is posted publicly and keeps the diagnostics the upstream client
 * already attached (agent, version, model, platform, arch, install id).
 */
import { $env, $which, getInstallId, logger, VERSION } from "@linxiraos/pi-utils";
import type { FetchImpl } from "@linxiraos/pi-ai";
import { $ } from "bun";
import { M } from "../i18n";

/** Default destination repository for user feedback. */
export const DEFAULT_ISSUE_REPO = "Linxira-OS/linxira-zeta";

/** GitHub REST API base. */
export const GITHUB_API_BASE = "https://api.github.com";

const SUBMIT_TIMEOUT_MS = 10_000;
/** GitHub truncates issue titles around 256 characters; stay clear of the edge. */
const MAX_TITLE_CHARS = 200;

/** Body line every public report carries so users know where it lands. */
const PUBLIC_NOTICE =
	"> Note: this report is posted publicly on GitHub Issues. Do not include secrets or personal data.";

/** Which label a report carries — bug for tool defects, feedback otherwise. */
export type GrievanceKind = "bug" | "feedback";

/** Host fingerprint attached to a report for triage. */
export interface GrievanceDiagnostics {
	agent: string;
	version: string;
	platform: string;
	arch: string;
	installId: string;
}

/** A single grievance to file. */
export interface GrievanceInput {
	/** Tool that misbehaved; becomes the title prefix. */
	tool: string;
	/** Free-form report body. */
	report: string;
	/** Active model string, when known. */
	model?: string;
	/** Recorded agent version, when known (defaults to the running {@link VERSION}). */
	version?: string;
	/** Label selector; defaults to `"bug"`. */
	kind?: GrievanceKind;
}

/** The issue as it will be posted (also what the manual fallback prints). */
export interface ComposedIssue {
	title: string;
	body: string;
	labels: string[];
}

/** Submitting an issue succeeded. */
export interface SubmitGrievanceOk {
	ok: true;
	/** `html_url` of the created issue. */
	url: string;
	/** Issue number. */
	number: number;
	composed: ComposedIssue;
}

/**
 * Submitting an issue failed without a created issue.
 *
 * `reason` classifies the failure for the queue worker:
 * - `unauthenticated` — no token; nothing was sent.
 * - `permanent` — GitHub refused the payload; retrying the same bytes is pointless.
 * - `retry` — transient (network, 5xx, rate limit, auth/permission, missing repo).
 */
export interface SubmitGrievanceFail {
	ok: false;
	reason: "unauthenticated" | "permanent" | "retry";
	error: string;
	/** Prefilled `https://github.com/<repo>/issues/new?...` URL. */
	manualUrl: string;
	composed: ComposedIssue;
	/** HTTP status when a response was received. */
	status?: number;
}

export type SubmitGrievanceResult = SubmitGrievanceOk | SubmitGrievanceFail;

/** Runs `gh auth token`; injectable so tests never shell out. */
export type GhTokenRunner = (ghPath: string) => Promise<string | undefined>;

async function readGhAuthToken(ghPath: string): Promise<string | undefined> {
	try {
		const result = await $`${ghPath} auth token --hostname github.com`.quiet().nothrow();
		if (result.exitCode !== 0) return undefined;
		const token = result.text().trim();
		return token.length > 0 ? token : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolve the destination repo. `owner/repo` only; anything else falls back to
 * the default so a malformed override can never break reporting.
 */
export function resolveIssueRepo(override?: string): string {
	const candidate = (override ?? $env.ZETA_ISSUE_REPO ?? "").trim();
	if (candidate.length === 0) return DEFAULT_ISSUE_REPO;
	if (/^[^\s/]+\/[^\s/]+$/.test(candidate)) return candidate;
	logger.warn("Ignoring invalid ZETA_ISSUE_REPO (expected owner/repo)", { value: candidate });
	return DEFAULT_ISSUE_REPO;
}

/**
 * Resolve the GitHub token. `explicit` (when a string) wins; `null` forces the
 * unauthenticated path. Otherwise the chain is `GITHUB_TOKEN` → `GH_TOKEN` →
 * `settingsToken` → `gh auth token`.
 */
export async function resolveGithubToken(
	options: {
		explicit?: string | null;
		settingsToken?: string;
		ghPath?: string | null;
		runGhAuthToken?: GhTokenRunner;
	} = {},
): Promise<string | undefined> {
	if (options.explicit === null) return undefined;
	if (options.explicit && options.explicit.trim().length > 0) return options.explicit.trim();
	const envToken = ($env.GITHUB_TOKEN || $env.GH_TOKEN || "").trim();
	if (envToken) return envToken;
	const settingsToken = options.settingsToken?.trim();
	if (settingsToken) return settingsToken;
	const ghPath = options.ghPath === null ? undefined : (options.ghPath ?? $which("gh"));
	if (!ghPath) return undefined;
	return await (options.runGhAuthToken ?? readGhAuthToken)(ghPath);
}

/** First non-empty line, used to keep the title one line. */
function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return (newline >= 0 ? text.slice(0, newline) : text).trim();
}

function truncateTitle(text: string): string {
	const chars = Array.from(text);
	if (chars.length <= MAX_TITLE_CHARS) return text;
	return `${chars.slice(0, MAX_TITLE_CHARS - 1).join("")}…`;
}

/**
 * Compose the issue title/body/labels for a grievance. The body is a public
 * artefact: it states the public destination and keeps the upstream
 * diagnostics. Kept English on purpose — maintainers read it regardless of the
 * reporter's UI language.
 */
export function composeIssue(
	input: GrievanceInput,
	diagnostics: GrievanceDiagnostics = {
		agent: "zeta",
		version: VERSION,
		platform: process.platform,
		arch: process.arch,
		installId: getInstallId(),
	},
): ComposedIssue {
	const label: GrievanceKind = input.kind ?? "bug";
	const title = truncateTitle(`[auto-qa] ${input.tool}: ${firstLine(input.report)}`);
	const body = [
		PUBLIC_NOTICE,
		"",
		input.report,
		"",
		"---",
		"",
		"### Diagnostics",
		`- agent: ${diagnostics.agent} v${input.version ?? diagnostics.version}`,
		`- model: ${input.model ?? "unknown"}`,
		`- tool: ${input.tool}`,
		`- platform: ${diagnostics.platform} ${diagnostics.arch}`,
		`- install: ${diagnostics.installId}`,
	].join("\n");
	return { title, body, labels: [label] };
}

/** Build the prefilled "new issue" URL used when no token is available. */
export function manualIssueUrl(repo: string, composed: ComposedIssue): string {
	const params = new URLSearchParams({ title: composed.title, body: composed.body });
	if (composed.labels.length > 0) params.set("labels", composed.labels.join(","));
	return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

async function readErrorDetail(response: Response): Promise<string> {
	try {
		const text = (await response.text()).trim();
		if (text.length === 0) return "";
		return text.length > 300 ? `${text.slice(0, 300)}…` : text;
	} catch {
		return "";
	}
}

/** Options for {@link submitGrievance}. */
export interface SubmitGrievanceOptions {
	/** Explicit repo override; falls back to {@link resolveIssueRepo}. */
	repo?: string;
	/** API base override (GitHub Enterprise); defaults to {@link GITHUB_API_BASE}. */
	apiBase?: string;
	/** Explicit token; `null` forces the unauthenticated path. */
	token?: string | null;
	/** User-configured token consulted after `GITHUB_TOKEN`/`GH_TOKEN`. */
	settingsToken?: string;
	/** Fetch implementation; defaults to global fetch. */
	fetch?: FetchImpl;
	/** Per-request timeout. */
	timeoutMs?: number;
	/** Diagnostics override (tests). */
	diagnostics?: Partial<GrievanceDiagnostics>;
	/** `gh` binary path; `null` disables the `gh auth token` fallback. */
	ghPath?: string | null;
	/** `gh auth token` runner (tests). */
	runGhAuthToken?: GhTokenRunner;
}

function failureMessage(status: number, repo: string, detail: string): string {
	switch (status) {
		case 401:
			return M.grErrTokenRejected;
		case 403:
			return M.grErrForbiddenFmt.replace("%s", repo);
		case 404:
			return M.grErrRepoNotFoundFmt.replace("%s", repo);
		case 422:
			return M.grErrUnprocessableFmt.replace("%s", detail || M.grErrNoDetail);
		default:
			return detail
				? M.grErrHttpFmt.replace("%s", String(status)).replace("%s", detail)
				: M.grErrHttpStatusFmt.replace("%s", String(status));
	}
}

/**
 * File one grievance as a GitHub issue.
 *
 * Never throws: every failure is reported through {@link SubmitGrievanceResult}
 * so the queue worker can park or retry without a try/catch around each row.
 */
export async function submitGrievance(
	input: GrievanceInput,
	options: SubmitGrievanceOptions = {},
): Promise<SubmitGrievanceResult> {
	const repo = resolveIssueRepo(options.repo);
	const composed = composeIssue(input, {
		agent: "zeta",
		version: VERSION,
		platform: process.platform,
		arch: process.arch,
		installId: getInstallId(),
		...options.diagnostics,
	});
	const manualUrl = manualIssueUrl(repo, composed);

	const token = await resolveGithubToken({
		explicit: options.token,
		settingsToken: options.settingsToken,
		ghPath: options.ghPath,
		runGhAuthToken: options.runGhAuthToken,
	});
	if (!token) {
		return { ok: false, reason: "unauthenticated", error: M.grNoToken, manualUrl, composed };
	}

	const url = `${options.apiBase ?? GITHUB_API_BASE}/repos/${repo}/issues`;
	const fetchImpl = options.fetch ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				"user-agent": `zeta/${VERSION}`,
				"x-github-api-version": "2022-11-28",
			},
			body: JSON.stringify({ title: composed.title, body: composed.body, labels: composed.labels }),
			signal: AbortSignal.timeout(options.timeoutMs ?? SUBMIT_TIMEOUT_MS),
		});
	} catch (error) {
		return {
			ok: false,
			reason: "retry",
			error: M.grErrNetworkFmt.replace("%s", String(error)),
			manualUrl,
			composed,
		};
	}

	if (response.ok) {
		let created: { html_url?: unknown; number?: unknown } | undefined;
		try {
			created = (await response.json()) as { html_url?: unknown; number?: unknown };
		} catch {
			created = undefined;
		}
		const createdUrl = typeof created?.html_url === "string" ? created.html_url : `https://github.com/${repo}/issues`;
		const number = typeof created?.number === "number" ? created.number : 0;
		return { ok: true, url: createdUrl, number, composed };
	}

	const status = response.status;
	const detail = await readErrorDetail(response);
	return {
		ok: false,
		// 400/413/422 are payload rejections — the same bytes can only fail
		// again. Everything else (401/403/404/408/429/5xx) says nothing about
		// the payload and stays retryable.
		reason: status === 400 || status === 413 || status === 422 ? "permanent" : "retry",
		error: failureMessage(status, repo, detail),
		manualUrl,
		composed,
		status,
	};
}
