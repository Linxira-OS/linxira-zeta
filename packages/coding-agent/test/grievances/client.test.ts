/**
 * Unit tests for the GitHub Issues transport that carries Auto-QA grievances.
 * Behaviour-first: assert the real URL, headers, payload, status→reason
 * mapping, and the unauthenticated manual fallback rather than string
 * snapshots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
	composeIssue,
	DEFAULT_ISSUE_REPO,
	GITHUB_API_BASE,
	manualIssueUrl,
	resolveGithubToken,
	resolveIssueRepo,
	submitGrievance,
} from "@linxiraos/zeta/grievances/client";

const ENV_KEYS = ["ZETA_ISSUE_REPO", "GITHUB_TOKEN", "GH_TOKEN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = {};
	for (const key of ENV_KEYS) {
		saved[key] = Bun.env[key];
		delete Bun.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete Bun.env[key];
		else Bun.env[key] = saved[key];
	}
	vi.restoreAllMocks();
});

const DIAGNOSTICS = {
	agent: "zeta",
	version: "1.2.3",
	platform: "linux",
	arch: "x64",
	installId: "test-install-id",
};

describe("resolveIssueRepo", () => {
	it("defaults to the downstream repo", () => {
		expect(resolveIssueRepo()).toBe(DEFAULT_ISSUE_REPO);
	});

	it("honours an owner/repo override from ZETA_ISSUE_REPO", () => {
		Bun.env.ZETA_ISSUE_REPO = "acme/widgets";
		expect(resolveIssueRepo()).toBe("acme/widgets");
	});

	it("falls back to the default for a malformed override", () => {
		Bun.env.ZETA_ISSUE_REPO = "not-a-repo";
		expect(resolveIssueRepo()).toBe(DEFAULT_ISSUE_REPO);
	});
});

describe("resolveGithubToken", () => {
	it("prefers GITHUB_TOKEN, then GH_TOKEN", async () => {
		Bun.env.GITHUB_TOKEN = "from-github";
		Bun.env.GH_TOKEN = "from-gh-env";
		expect(await resolveGithubToken()).toBe("from-github");

		delete Bun.env.GITHUB_TOKEN;
		expect(await resolveGithubToken()).toBe("from-gh-env");
	});

	it("uses the configured settings token after the env vars", async () => {
		expect(await resolveGithubToken({ settingsToken: "from-settings" })).toBe("from-settings");
		Bun.env.GITHUB_TOKEN = "from-github";
		expect(await resolveGithubToken({ settingsToken: "from-settings" })).toBe("from-github");
	});

	it("falls back to `gh auth token` only when nothing else is set", async () => {
		const runGhAuthToken = vi.fn(async () => "from-gh-cli");
		expect(await resolveGithubToken({ ghPath: "/usr/bin/gh", runGhAuthToken })).toBe("from-gh-cli");
		expect(runGhAuthToken).toHaveBeenCalledWith("/usr/bin/gh");

		Bun.env.GITHUB_TOKEN = "from-github";
		expect(await resolveGithubToken({ ghPath: "/usr/bin/gh", runGhAuthToken })).toBe("from-github");
	});

	it("treats an explicit null as unauthenticated without probing gh", async () => {
		const runGhAuthToken = vi.fn(async () => "from-gh-cli");
		expect(await resolveGithubToken({ explicit: null, ghPath: "/usr/bin/gh", runGhAuthToken })).toBeUndefined();
		expect(runGhAuthToken).not.toHaveBeenCalled();
	});
});

describe("composeIssue", () => {
	it("builds a one-line title, a public notice, and the diagnostics block", () => {
		const composed = composeIssue(
			{ tool: "glob", report: "first line\nsecond line", model: "test-model" },
			DIAGNOSTICS,
		);

		expect(composed.title).toBe("[auto-qa] glob: first line");
		expect(composed.title).not.toContain("\n");
		expect(composed.labels).toEqual(["bug"]);
		expect(composed.body).toContain("posted publicly on GitHub Issues");
		expect(composed.body).toContain("first line\nsecond line");
		expect(composed.body).toContain("- tool: glob");
		expect(composed.body).toContain("- agent: zeta v1.2.3");
		expect(composed.body).toContain("- model: test-model");
		expect(composed.body).toContain("- install: test-install-id");
	});

	it("labels the general grievances path feedback and truncates long titles", () => {
		const composed = composeIssue({ tool: "x".repeat(400), report: "boom", kind: "feedback" }, DIAGNOSTICS);
		expect(composed.labels).toEqual(["feedback"]);
		expect(Array.from(composed.title).length).toBeLessThanOrEqual(200);
	});
});

describe("manualIssueUrl", () => {
	it("prefills title, body, and labels", () => {
		const composed = composeIssue({ tool: "read", report: "broken" }, DIAGNOSTICS);
		const url = manualIssueUrl("acme/widgets", composed);
		expect(url.startsWith("https://github.com/acme/widgets/issues/new?")).toBe(true);
		const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
		expect(params.get("title")).toBe(composed.title);
		expect(params.get("body")).toBe(composed.body);
		expect(params.get("labels")).toBe("bug");
	});
});

describe("submitGrievance", () => {
	it("POSTs the composed issue to the GitHub Issues API with a bearer token", async () => {
		let capturedUrl: string | undefined;
		let capturedInit: RequestInit | undefined;
		const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedInit = init;
			return new Response(JSON.stringify({ html_url: "https://github.com/acme/widgets/issues/7", number: 7 }), {
				status: 201,
			});
		});

		const result = await submitGrievance(
			{ tool: "glob", report: "unexpected empty result" },
			{ token: "ghp_secret", repo: "acme/widgets", diagnostics: DIAGNOSTICS, fetch: fetchSpy },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.url).toBe("https://github.com/acme/widgets/issues/7");
		expect(result.number).toBe(7);

		expect(capturedUrl).toBe(`${GITHUB_API_BASE}/repos/acme/widgets/issues`);
		expect(capturedInit?.method).toBe("POST");
		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer ghp_secret");
		expect(headers["content-type"]).toBe("application/json");
		expect(headers.accept).toBe("application/vnd.github+json");
		expect(headers["user-agent"]).toContain("zeta/");

		const body = JSON.parse(String(capturedInit?.body)) as { title: string; body: string; labels: string[] };
		expect(body.title).toBe("[auto-qa] glob: unexpected empty result");
		expect(body.labels).toEqual(["bug"]);
		expect(body.body).toContain("posted publicly on GitHub Issues");
	});

	it("routes to ZETA_ISSUE_REPO when no explicit repo is given", async () => {
		Bun.env.ZETA_ISSUE_REPO = "Linxira-OS/feedback-hub";
		let capturedUrl: string | undefined;
		const fetchSpy = vi.fn(async (input: string | URL | Request) => {
			capturedUrl = String(input);
			return new Response("{}", { status: 201 });
		});

		await submitGrievance(
			{ tool: "grep", report: "x" },
			{ token: "ghp_secret", diagnostics: DIAGNOSTICS, fetch: fetchSpy },
		);

		expect(capturedUrl).toBe(`${GITHUB_API_BASE}/repos/Linxira-OS/feedback-hub/issues`);
	});

	it("returns the composed issue and a prefilled URL without sending when unauthenticated", async () => {
		const fetchSpy = vi.fn(async () => new Response("{}", { status: 201 }));

		const result = await submitGrievance(
			{ tool: "read", report: "selector ignored" },
			{ token: null, repo: "acme/widgets", diagnostics: DIAGNOSTICS, fetch: fetchSpy },
		);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.reason).toBe("unauthenticated");
		expect(result.manualUrl).toContain("https://github.com/acme/widgets/issues/new?");
		expect(result.composed.title).toBe("[auto-qa] read: selector ignored");
		expect(result.error.length).toBeGreaterThan(0);
		expect(result.error).not.toContain("ghp_");
	});

	it.each([
		[401, "retry"],
		[403, "retry"],
		[404, "retry"],
		[408, "retry"],
		[429, "retry"],
		[500, "retry"],
		[422, "permanent"],
		[400, "permanent"],
	] as const)("maps HTTP %s to a %s failure", async (status, reason) => {
		const fetchSpy = vi.fn(async () => new Response("detail text", { status }));

		const result = await submitGrievance(
			{ tool: "glob", report: "x" },
			{ token: "ghp_secret", repo: "acme/widgets", diagnostics: DIAGNOSTICS, fetch: fetchSpy },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.reason).toBe(reason);
		expect(result.status).toBe(status);
		expect(result.error).toContain(String(status));
		expect(result.manualUrl).toContain("/issues/new?");
	});

	it("gives 401/403/404/422 distinct, actionable messages", async () => {
		const message = async (status: number) => {
			const result = await submitGrievance(
				{ tool: "glob", report: "x" },
				{
					token: "ghp_secret",
					repo: "acme/widgets",
					diagnostics: DIAGNOSTICS,
					fetch: vi.fn(async () => new Response("", { status })),
				},
			);
			if (result.ok) throw new Error("expected failure");
			return result.error;
		};

		const messages = [await message(401), await message(403), await message(404), await message(422)];
		for (let i = 0; i < messages.length; i++) {
			for (let j = i + 1; j < messages.length; j++) {
				expect(messages[i]).not.toBe(messages[j]);
			}
		}
		expect(messages[0]).toContain("401");
		expect(messages[1]).toContain("403");
		expect(messages[2]).toContain("404");
		expect(messages[3]).toContain("422");
	});

	it("reports a transport failure as retryable", async () => {
		const result = await submitGrievance(
			{ tool: "glob", report: "x" },
			{
				token: "ghp_secret",
				repo: "acme/widgets",
				diagnostics: DIAGNOSTICS,
				fetch: vi.fn(async () => {
					throw new Error("socket closed");
				}),
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected failure");
		expect(result.reason).toBe("retry");
		expect(result.error).toContain("socket closed");
	});
});
