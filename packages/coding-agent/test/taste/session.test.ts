/**
 * The layer through a real session: sdk injection, the backend lifecycle, and
 * the tool registry.
 *
 * These are the seams the unit tests cannot cover — `sdk.ts` decides when the
 * block is built, `session-memory.ts` decides when the layer starts and stops,
 * and `tools/index.ts` decides whether the tool exists. If any of the three
 * regresses, a user silently gets a layer that never loads.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentRegistry } from "@linxiraos/zeta/registry/agent-registry";
import { createAgentSession } from "@linxiraos/zeta/sdk";
import type { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import { TASTE_PRECEDENCE_LINE } from "@linxiraos/zeta/taste/inject";
import { resolveTasteScopes } from "@linxiraos/zeta/taste/scope";
import { readTasteScope, today, topicKey, writeTasteScope } from "@linxiraos/zeta/taste/store";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { TempDir } from "@linxiraos/pi-utils";
import { createInMemoryAuthStorage } from "../helpers/agent-session-setup";

let session: AgentSession | undefined;
let tempDir: TempDir | undefined;
afterEach(async () => {
	await session?.dispose();
	session = undefined;
	try {
		tempDir?.removeSync();
	} catch {}
	tempDir = undefined;
});

function prepareRoot(): TempDir {
	const root = TempDir.createSync("@taste-session-");
	tempDir = root;
	return root;
}

async function sessionWith(root: TempDir, values: Record<string, unknown>) {
	const authStorage = createInMemoryAuthStorage();
	authStorage.keys.setRuntime("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage);
	const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!bundled) throw new Error("Expected a bundled anthropic model");
	const settings = Settings.isolated({
		"async.enabled": false,
		"compaction.enabled": false,
		"memory.backend": "mnemopi",
		"mnemopi.noEmbeddings": true,
		"mnemopi.llmMode": "none",
		"mnemopi.autoRecall": false,
		"mnemopi.autoRetain": false,
		"taste.enabled": true,
		...values,
	});
	await settings.reloadForCwd(root.path());
	const result = await createAgentSession({
		cwd: root.path(),
		agentDir: root.path(),
		sessionManager: SessionManager.create(root.path(), root.path()),
		agentRegistry: new AgentRegistry(),
		authStorage,
		modelRegistry,
		settings,
		model: bundled,
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		workspaceTree: { rootPath: root.path(), rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
	});
	session = result.session;
	// The taste lifecycle starts with the backend; if the test disposes before the
	// first paint, nothing else here is meaningful.
	const prompt = session.agent.state.systemPrompt.join("\n");
	const names = session.agent.state.tools.map(tool => tool.name);
	// `super_memory` is discoverable, not essential: it is mounted as an `xd://`
	// device rather than in the top-level schema, so reachability is a name lookup.
	const superMemory = session.getToolByName("super_memory");
	return { session, settings, agentDir: root.path(), cwd: root.path(), prompt, names, superMemory, authStorage };
}

describe("taste layer through a session", () => {
	it("injects a stored preference into the live system prompt", async () => {
		const root = prepareRoot();
		const settings = Settings.isolated({ "memory.backend": "mnemopi", "taste.enabled": true });
		const scope = resolveTasteScopes({ cwd: root.path() }, settings)[0]!;
		const statement = "Prefers explicit return types on exported functions";
		// Seeded before startup: the block is built while the session starts.
		await writeTasteScope(
			root.path(),
			scope,
			[
				{
					topicKey: topicKey(statement),
					category: "typescript",
					statement,
					polarity: "prefer",
					confidence: 0.72,
					mentions: 3,
					lastConfirmed: today(),
					lastUsed: today(),
					evidence: ["stated×3"],
				},
			],
			{ v: 1, entries: {}, tombstones: [], lastConsolidatedAt: 0 },
		);

		const created = await sessionWith(root, {});
		expect(created.prompt).toContain(TASTE_PRECEDENCE_LINE);
		expect(created.prompt).toContain("## Preferences");
		expect(created.prompt).toContain(statement);
		expect(created.prompt).toContain("Confidence: 0.72");

		// The same rebuild path the tool triggers after a write: store changes are
		// not visible until the base prompt is rebuilt.
		const later = "Prefers named exports over default exports";
		const snapshot = await readTasteScope(root.path(), scope);
		await writeTasteScope(
			root.path(),
			scope,
			[
				...snapshot.entries,
				{
					topicKey: topicKey(later),
					category: "typescript",
					statement: later,
					polarity: "prefer",
					confidence: 0.81,
					mentions: 4,
					lastConfirmed: today(),
					lastUsed: today(),
					evidence: ["stated×4"],
				},
			],
			{ v: 1, entries: {}, tombstones: [], lastConsolidatedAt: 0 },
		);
		expect(created.session.agent.state.systemPrompt.join("\n")).not.toContain(later);
		await created.session.refreshBaseSystemPrompt();
		expect(created.session.agent.state.systemPrompt.join("\n")).toContain(later);
	});

	it("offers super_memory only while the layer is on", async () => {
		const on = await sessionWith(prepareRoot(), {});
		expect(on.superMemory?.name).toBe("super_memory");
		// Discoverable tools stay out of the top-level schema.
		expect(on.names).not.toContain("super_memory");
		await on.session.dispose();
		session = undefined;

		const off = await sessionWith(prepareRoot(), { "taste.enabled": false });
		expect(off.superMemory).toBeUndefined();
		expect(off.prompt).not.toContain("## Preferences");
	});
});
