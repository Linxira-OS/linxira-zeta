/**
 * Operator-facing reporting for `zetacode grievances push` after the port to
 * GitHub Issues: the success line must print the created issue URL, and the
 * unauthenticated path must print the composed issue plus a prefilled
 * new-issue URL while stating plainly that nothing was submitted.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as piUtils from "@linxiraos/pi-utils";
import { pushGrievances } from "@linxiraos/zeta/cli/grievances-cli";
import { Settings } from "@linxiraos/zeta/config/settings";
import { DEFAULT_ISSUE_REPO } from "@linxiraos/zeta/grievances/client";
import * as reportIssue from "@linxiraos/zeta/tools/report-tool-issue";

const ENV_KEYS = ["GITHUB_TOKEN", "GH_TOKEN", "ZETA_ISSUE_REPO", "PI_AUTO_QA"] as const;
let savedEnv: Record<string, string | undefined> = {};
let originalExitCode: string | number | null | undefined;

function openTempDb(): Database {
	const db = new Database(":memory:");
	db.run(`
		CREATE TABLE IF NOT EXISTS grievances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			model TEXT NOT NULL,
			version TEXT NOT NULL,
			tool TEXT NOT NULL,
			report TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			pushed INTEGER NOT NULL DEFAULT 0,
			push_error TEXT
		);
	`);
	db.prepare("INSERT INTO grievances (model, version, tool, report) VALUES (?, ?, ?, ?)").run(
		"test-model",
		"test-version",
		"glob",
		"weird ordering",
	);
	return db;
}

function createdIssue(number: number): Response {
	return new Response(
		JSON.stringify({ html_url: `https://github.com/${DEFAULT_ISSUE_REPO}/issues/${number}`, number }),
		{ status: 201 },
	);
}

beforeEach(() => {
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = Bun.env[key];
		delete Bun.env[key];
	}
	Bun.env.ZETA_ISSUE_REPO = DEFAULT_ISSUE_REPO;
	originalExitCode = process.exitCode;
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete Bun.env[key];
		else Bun.env[key] = savedEnv[key];
	}
	process.exitCode = originalExitCode as number | undefined;
	vi.restoreAllMocks();
});

describe("pushGrievances", () => {
	it("prints the created issue URL on success", async () => {
		const db = openTempDb();
		vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		vi.spyOn(Settings, "init").mockResolvedValue(
			Settings.isolated({
				"dev.autoqa": true,
				"dev.autoqaConsent": "granted",
				"dev.autoqaPush.token": "settings-token",
			}),
		);
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createdIssue(42));
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		});

		try {
			await pushGrievances({});

			const output = lines.join("\n");
			expect(output).toContain(`https://github.com/${DEFAULT_ISSUE_REPO}/issues/42`);
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(process.exitCode ?? 0).toBe(0);
		} finally {
			db.close();
		}
	});

	it("prints the composed issue and a prefilled URL without submitting when unauthenticated", async () => {
		const db = openTempDb();
		vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		vi.spyOn(Settings, "init").mockResolvedValue(
			Settings.isolated({ "dev.autoqa": true, "dev.autoqaConsent": "granted" }),
		);
		// Force the token chain to come up empty: no env token, no settings
		// token, and no `gh` binary to fall back to.
		vi.spyOn(piUtils, "$which").mockReturnValue(null);
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createdIssue(1));
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		});

		try {
			await pushGrievances({});

			const output = lines.join("\n");
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(output).toContain("https://github.com/");
			expect(output).toContain("/issues/new?");
			expect(output).toContain("[auto-qa] glob: weird ordering");
			expect(process.exitCode).toBe(1);
		} finally {
			db.close();
		}
	});

	it("emits the machine-readable result as JSON", async () => {
		const db = openTempDb();
		vi.spyOn(reportIssue, "openAutoQaDb").mockReturnValue(db);
		vi.spyOn(Settings, "init").mockResolvedValue(
			Settings.isolated({
				"dev.autoqa": true,
				"dev.autoqaConsent": "granted",
				"dev.autoqaPush.token": "settings-token",
			}),
		);
		vi.spyOn(globalThis, "fetch").mockResolvedValue(createdIssue(9));
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			lines.push(args.map(String).join(" "));
		});

		try {
			await pushGrievances({ json: true });

			const parsed = JSON.parse(lines.join("\n")) as { pushed: number; ok: boolean; urls?: string[] };
			expect(parsed.pushed).toBe(1);
			expect(parsed.ok).toBe(true);
			expect(parsed.urls).toEqual([`https://github.com/${DEFAULT_ISSUE_REPO}/issues/9`]);
		} finally {
			db.close();
		}
	});
});
