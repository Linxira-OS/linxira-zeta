import { join } from "path";

/** Stable workspace used by the desktop shell before the user selects a project. */
export function defaultWorkspacePath(home: string): string {
  return join(home, ".zeta", "workspace");
}
