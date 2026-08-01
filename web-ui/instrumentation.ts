export const runtime = "nodejs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!process.env.OMP_CODING_AGENT_DIR && !process.env.PI_CODING_AGENT_DIR) {
    const osName = "os";
    const pathName = "path";
    const { homedir } = await import(osName);
    const { join } = await import(pathName);
    const defaultDir = join(homedir(), ".omp", "agent");
    process.env.OMP_CODING_AGENT_DIR = defaultDir;
    process.env.PI_CODING_AGENT_DIR = defaultDir;
  } else if (process.env.OMP_CODING_AGENT_DIR && !process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = process.env.OMP_CODING_AGENT_DIR;
  } else if (process.env.PI_CODING_AGENT_DIR && !process.env.OMP_CODING_AGENT_DIR) {
    process.env.OMP_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
  }

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
