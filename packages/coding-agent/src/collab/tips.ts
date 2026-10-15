/**
 * Splash gate for the collaboration tip.
 *
 * The welcome box advertises `/collab` + `/join` through a `tips.txt` line
 * (catalogue key `tip25`). While {@link isCollabEnabled} is off those commands
 * are hidden, so the tip must go with them: the host installs this filter once
 * on the interactive boot path and the splash picks from the remaining pool.
 *
 * Matching on the raw tip body keeps the gate attached to the feature rather
 * than to a line number: editing `tips.txt` cannot leave an advertisement for a
 * disabled command behind.
 */
import { setTuiTipFilter } from "@linxiraos/pi-tui/prompt/welcome";
import type { ScopeLike } from "../config/registry";
import { isCollabEnabled } from "./settings";

/** Tips that advertise the collab commands (backticked `/collab` or `/join`). */
export const COLLAB_TIP_PATTERN = /`\/(?:collab|join)`/;

/**
 * Install the splash tip gate for `scope`. Called once from the interactive
 * boot path; headless surfaces render no splash and never install it. The
 * scope is read live, so `/settings` changes apply on the next pick.
 */
export function installCollabTipsGate(scope: ScopeLike): void {
	setTuiTipFilter((_key, raw) => isCollabEnabled(scope) || !COLLAB_TIP_PATTERN.test(raw));
}
