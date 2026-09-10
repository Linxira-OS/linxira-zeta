import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { AuthStorage, Effort, SqliteAuthCredentialStore } from "@linxiraos/pi-ai";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { runAgenticCommit } from "@linxiraos/zeta";
import * as agentModule from "@linxiraos/zeta";
import type { CommitAgentInput } from "@linxiraos/zeta";
import type { CommitAgentState } from "@linxiraos/zeta";
import * as modelSelection from "@linxiraos/zeta";
import { ModelRegistry } from "@linxiraos/zeta";
import { Settings } from "@linxiraos/zeta";
import * as sdkModule from "@linxiraos/zeta";
import type { VcsGitRepo } from "@linxiraos/pi-natives";
import * as vcs from "@linxiraos/pi-natives/vcs";

let authStorage: AuthStorage | undefined;

afterEach(() => {
	authStorage?.close();
	authStorage = undefined;
	vi.restoreAllMocks();
});

describe("agentic commit model routing", () => {
	it("runs the parent commit agent on the selected commit model", async () => {
		const primaryModel = getBundledModel("anthropic", "claude-opus-4-5");
		const smolModel = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!primaryModel || !smolModel) throw new Error("Expected bundled commit test models");

		authStorage = new AuthStorage(new SqliteAuthCredentialStore(new Database(":memory:")));
		await authStorage.reload();
		vi.spyOn(Settings, "init").mockResolvedValue(Settings.isolated());
		vi.spyOn(ModelRegistry.prototype, "refresh").mockResolvedValue(undefined);
		vi.spyOn(sdkModule, "discoverAuthStorage").mockResolvedValue(authStorage);
		vi.spyOn(sdkModule, "discoverContextFiles").mockResolvedValue([]);
		vi.spyOn(sdkModule, "loadCliExtensionProviders").mockResolvedValue(undefined);
		vi.spyOn(modelSelection, "resolvePrimaryModel").mockResolvedValue({
			model: primaryModel,
			apiKey: "primary-key",
			thinkingLevel: Effort.High,
		});
		vi.spyOn(modelSelection, "resolveSmolModel").mockResolvedValue({
			model: smolModel,
			apiKey: "smol-key",
			thinkingLevel: Effort.Minimal,
		});
		vi.spyOn(vcs, "requireGit").mockReturnValue({
			changedFiles: async () => ["src/a.ts"],
			commitCreate: async () => "0123456789abcdef0123456789abcdef01234567",
			diffText: async () => "diff --git a/src/a.ts b/src/a.ts\n+export const value = 1;\n",
			numstat: async () => [{ path: "src/a.ts", added: 1, removed: 0 }],
		} as unknown as VcsGitRepo);
		const runSession = vi
			.spyOn(agentModule, "runCommitAgentSession")
			.mockImplementation(async (input: CommitAgentInput) => {
				const state: CommitAgentState = {
					proposal: {
						analysis: { type: "fix", scope: "test", details: [], issueRefs: [] },
						summary: "fixed model routing",
						warnings: [],
					},
				};
				await input.onComplete?.(state);
				return state;
			});

		await runAgenticCommit({
			noChangelog: true,
			push: false,
			dryRun: true,
			model: `${primaryModel.provider}/${primaryModel.id}`,
		});

		expect(runSession).toHaveBeenCalledWith(
			expect.objectContaining({ model: primaryModel, thinkingLevel: Effort.High }),
		);
	});
});
