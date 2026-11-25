/** The Spotlight notice (`text` role `zeta.tool.spotlight`) is native-only: the terminal draws nothing. */
import { defineRolePainter, EMPTY_BLOCK } from "@linxiraos/pi-tui/term/paint";

defineRolePainter("text", "zeta.tool.spotlight", () => EMPTY_BLOCK);
