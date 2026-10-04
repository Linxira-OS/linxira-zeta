/**
 * Throwaway smoke seed: simulate a pre-migration install — a coordinator
 * transcript (zeta-bot.jsonl) in the serve-cwd session dir plus a web.yml
 * relay registry entry pointing at it. Deleted after the smoke run.
 */
import { renameSync } from "node:fs";
import { join } from "node:path";
import { WebConfig } from "./src/config/web-config";
import { SessionManager } from "./src/session/session-manager";

const serveCwd = process.cwd();
const dir = SessionManager.getDefaultSessionDir(serveCwd);
const seeded = SessionManager.createEmptySessionFile(serveCwd);
const legacy = join(dir, "zeta-bot.jsonl");
renameSync(seeded, legacy);
const config = await WebConfig.load();
await config.upsertBotSession({
	id: "relay",
	name: "Zeta Bot (Relay)",
	tag: "relay",
	sessionFile: legacy,
	createdAt: new Date().toISOString(),
});
console.log("SEEDED_LEGACY", legacy);
