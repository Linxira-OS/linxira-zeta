export const runtime = "nodejs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ZETA_CODING_AGENT_DIR is the single agent-dir override key; fall back to
  // the runtime default so file reads resolve even when unset.
  if (!process.env.ZETA_CODING_AGENT_DIR) {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    process.env.ZETA_CODING_AGENT_DIR = join(homedir(), ".zeta", "agent");
  }

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
