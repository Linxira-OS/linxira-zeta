# Zeta logo archive — 2026

Superseded by the 2026-11 identity pass. This directory is **history only**:
no runtime, build, packaging or CI path imports anything from it.

## What was chosen

**Concept 04 — Cluster** was selected for production:

- Two rounded tiles on the 64-unit grid: teal tile A carries an L aperture,
  coral tile B carries a Z aperture, separated by a 2.5u transparent gap.
- Explicit L and Z; reads as a cluster (team / multi-agent) without text.
- The gap is a knockout, so the mark still reads in a single ink.

Production assets live outside this archive:

| Asset | Role |
|---|---|
| `assets/zeta-mark.svg` | primary mark, 512, colour on ink plate |
| `assets/zeta-mark-light.svg` | colour on paper plate |
| `assets/zeta-mark-mono.svg` / `-mono-inverse.svg` | one-ink variants, transparent |
| `assets/zeta-mark-16.svg` | 16px single-tile fallback |
| `assets/icon.svg` | app icon (rounded ink plate) |
| `assets/icon-maskable.svg` | maskable / apple-touch (full-bleed, 80% safe area) |

**Size threshold:** the two-tile cluster is used at **32px and above**. At 16
and 24 the mark collapses to `assets/zeta-mark-16.svg` (one tile, 9.5u LZ
aperture); below 32px the cluster's strokes fall apart.

## What was rejected

| Concept | Verdict | Why |
|---|---|---|
| 01 Fold | runner-up | Safest evolution and a clean 16px Z, but it is a monogram only — it says nothing about the multi-agent story, and the product front door is the Team surface. Kept as the fallback direction if Cluster's size threshold becomes a burden. |
| 02 Aperture | rejected | Strong app-icon alternate, but the negative-space Z reads as a solid tile at small sizes, and the widened 16px cut is a second geometry to maintain. Not worth a second mark in the icon pipeline. |
| 03 Prompt | rejected | Terminal bracket plus a coral cursor dot; the dot is decorative and was repeatedly at risk of being read as a status light. Too product-chrome-specific for the app icon. |
| 05 Loop | rejected | Most expressive and least literal; needs 32px minimum and a separate plain-Z 16px asset, and its loop closes into a blob at taskbar sizes. Campaign use only, which this product does not currently need. |
| 06 Lockup | rejected | Depends on a rounded wordmark drawn in Arial Rounded MT Bold with no licensed outline; shipping live system-font text as a logo was ruled out. No lockup asset is produced. |

The startup ASCII art (`ZETA_LOGO` / `ZETA_WORDMARK` / `ZETA_SUBLINE`) is
frozen separately and is **not** part of this archive; it is unchanged.

## Files

- `concept-board.html` — the original concept board, self-contained (inline CSS
  and an inline SVG sprite; no external references, fonts, or scripts).
- `concepts/01-fold.svg` … `06-lockup.svg` — one drawing per concept, plus each
  concept's declared 16px variant where the board defined one. Every file is
  standalone: explicit fills, no `currentColor`, no external references.

These SVGs reproduce the board geometry; they are not production assets and
carry no build guarantee.
