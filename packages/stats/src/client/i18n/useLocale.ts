import { useSyncExternalStore } from "react";
import { getLocale, subscribeLocale, type StatsLocale } from "./index";

/**
 * Subscribe a component to the active locale. `t()` reads the module-level
 * catalogue, so a component that renders translated copy must call this —
 * the topbar switch re-renders subscribers, and everything under them.
 */
export function useLocale(): StatsLocale {
	return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
