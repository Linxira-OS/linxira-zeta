/**
 * `@image.png` mentions are image attachments: with `images.describeForTextModels`
 * a text-only model must receive the vision-role description, same as images sent
 * as prompt content (#16853).
 */
import { afterEach, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@linxiraos/pi-agent-core";
import type { Model } from "@linxiraos/pi-ai";
import { createMockModel } from "@linxiraos/pi-ai/providers/mock";
import { getBundledModel } from "@linxiraos/pi-catalog/models";
import { ModelRegistry } from "@linxiraos/zeta/config/model-registry";
import { Settings } from "@linxiraos/zeta/config/settings";
import { AgentSession } from "@linxiraos/zeta/session/agent-session";
import { AuthStorage } from "@linxiraos/zeta/session/auth-storage";
import { convertToLlm } from "@linxiraos/zeta/session/messages";
import { SessionManager } from "@linxiraos/zeta/session/session-manager";
import * as imageVisionFallback from "@linxiraos/zeta/utils/image-vision-fallback";
import { removeWithRetries } from "@linxiraos/pi-utils";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const cleanups: Array<() => unknown> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("describes an @-mentioned image for a text-only model", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-file-mention-vision-"));
	cleanups.push(() => removeWithRetries(dir));
	const imagePath = path.join(dir, "shot.png");
	await Bun.write(imagePath, Buffer.from(PNG_BASE64, "base64"));

	const authStorage = await AuthStorage.create(":memory:");
	cleanups.push(() => authStorage.close());
	authStorage.keys.setRuntime("anthropic", "test-key");
	const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!bundled) throw new Error("Expected claude-sonnet-4-5 model to exist");
	const textOnly: Model = { ...bundled, input: ["text"] };
	const mock = createMockModel({ responses: [{ content: ["ok"] }] });
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: { model: textOnly, systemPrompt: ["Test"], tools: [] },
			streamFn: mock.stream,
			convertToLlm,
		}),
		sessionManager: SessionManager.inMemory(),
		settings: Settings.isolated({ "compaction.enabled": false, "todo.enabled": false }),
		modelRegistry: new ModelRegistry(authStorage),
	});
	cleanups.push(() => session.dispose());
	const describe = spyOn(imageVisionFallback, "describeAttachedImagesForTextModel").mockResolvedValue([
		{ type: "text", text: "a single grey pixel" },
	]);
	cleanups.push(() => describe.mockRestore());

	await session.prompt(`@${imagePath} what does this say?`);

	expect(describe).toHaveBeenCalledTimes(1);
	expect(describe.mock.calls[0]?.[0]).toHaveLength(1);
	expect(JSON.stringify(mock.calls[0]?.context.messages)).toContain("a single grey pixel");
});
