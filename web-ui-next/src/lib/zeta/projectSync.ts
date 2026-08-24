import { useProjectsStore } from "@/stores/useProjectsStore";
import type { ZetaSessionInfo } from "./convert";

/**
 * Seed the client-local projects registry from zeta session roots.
 *
 * OpenChamber keeps a user-curated project list in localStorage; zeta instead
 * derives project scope from the sessions themselves (projectRoot/cwd on every
 * SessionInfo). Without this seed, a fresh browser profile has an empty
 * project registry and the config store refuses to load providers for any
 * directory (`resolveConfigDirectory` → null), which silently disables
 * sending. Seeding through the store's own `addProject` keeps persistence and
 * directory activation consistent with manual adds.
 */

const SYNC_INTERVAL_MS = 30_000;

function labelForRoot(root: string): string {
	const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
	const base = normalized.split("/").pop() ?? normalized;
	return base || normalized;
}

export function startZetaProjectSync(): () => void {
	let stopped = false;
	const attempted = new Set<string>();

	const sync = async (): Promise<void> => {
		if (stopped) return;
		try {
			const res = await fetch("/api/sessions");
			if (!res.ok) return;
			const data = await res.json() as { sessions?: ZetaSessionInfo[] };
			const roots = new Map<string, string>();
			for (const info of data.sessions ?? []) {
				const root = info.projectRoot || info.cwd;
				if (!root) continue;
				if (!roots.has(root)) roots.set(root, root);
			}
			const store = useProjectsStore.getState();
			for (const [root] of roots) {
				if (attempted.has(root)) continue;
				if (store.projects.some((project) => project.path === root)) {
					attempted.add(root);
					continue;
				}
				attempted.add(root);
				if (!stopped) store.addProject(root, { label: labelForRoot(root) });
			}
		} catch {
			// Registry seeding is best-effort; the UI degrades to manual add.
		}
	};

	void sync();
	const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
