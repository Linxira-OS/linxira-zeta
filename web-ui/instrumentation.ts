export const runtime = "nodejs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ZETA_CODING_AGENT_DIR takes priority; fall back to OMP_CODING_AGENT_DIR
  // and PI_CODING_AGENT_DIR for backward compatibility.
  if (!process.env.ZETA_CODING_AGENT_DIR && !process.env.OMP_CODING_AGENT_DIR && !process.env.PI_CODING_AGENT_DIR) {
    const osName = "os";
    const pathName = "path";
    const { homedir } = await import(osName);
    const { join } = await import(pathName);
    const defaultDir = join(homedir(), ".zeta", "agent");
    process.env.ZETA_CODING_AGENT_DIR = defaultDir;
    process.env.OMP_CODING_AGENT_DIR = defaultDir;
    process.env.PI_CODING_AGENT_DIR = defaultDir;
  } else {
    // Sync all three env vars so both Zeta and OMP runtime code can read them
    const dir = process.env.ZETA_CODING_AGENT_DIR
      ?? process.env.OMP_CODING_AGENT_DIR
      ?? process.env.PI_CODING_AGENT_DIR;
    if (dir) {
      process.env.ZETA_CODING_AGENT_DIR = dir;
      process.env.OMP_CODING_AGENT_DIR = dir;
      process.env.PI_CODING_AGENT_DIR = dir;
    }
  }

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
