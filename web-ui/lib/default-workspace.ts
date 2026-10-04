import { join } from "path";

/** Stable workspace used by the desktop shell before the user selects a project. */
export function defaultWorkspacePath(home: string): string {
  return join(home, ".zeta", "workspace");
}

/**
 * True when two paths denote the same workspace entry (separator and
 * trailing-slash insensitive). Shared by the sidebar groups, the project
 * dropdown and the workspace picker so all three agree on identity.
 */
export function isSameWorkspacePath(a: string, b: string): boolean {
  const ka = a.replaceAll("\\", "/").replace(/\/+$/, "");
  const kb = b.replaceAll("\\", "/").replace(/\/+$/, "");
  return ka === kb;
}

/**
 * Prepend the default workspace to a project list when it is not already
 * present, so the anchor workspace stays listed (sidebar groups, picker
 * recents) even before any session exists in it. Returns a new array.
 */
export function withDefaultWorkspace(projects: readonly string[], defaultWorkspace: string | null): string[] {
  if (!defaultWorkspace) return [...projects];
  return projects.some(p => isSameWorkspacePath(p, defaultWorkspace))
    ? [...projects]
    : [defaultWorkspace, ...projects];
}
