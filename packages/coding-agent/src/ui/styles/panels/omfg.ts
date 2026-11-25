/** The `/omfg` sheet's terminal look: the shared titled sheet (see `./btw`). */
import { defineRolePainter } from "@linxiraos/pi-tui/term/paint";
import { paintSheet } from "./btw";

defineRolePainter("col", "omp.overlay.omfg", paintSheet);
