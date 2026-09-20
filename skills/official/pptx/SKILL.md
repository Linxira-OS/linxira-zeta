---
name: pptx
description: "Create and edit PowerPoint (.pptx) presentations with python-pptx: title slides, bullet layouts, native charts, and speaker notes with consistent layouts. Use for any .pptx creation or modification task."
---

# PowerPoint (.pptx) presentations

Dependency: `pip install python-pptx`. Verify with `python3 -c "import pptx"`.

## Route

1. **New deck** — pick a slide size (16:9 default: `Presentation(); prs.slide_width = Inches(13.333)`), then use built-in layouts; never hand-position text boxes when a layout placeholder exists.
2. **Edit existing** — open, iterate `prs.slides`, mutate placeholders in place.
3. **Inspect** — enumerate slide/shape trees first; report before modifying.

## Layout discipline

```python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[1])  # Title and Content
slide.shapes.title.text = "Quarterly Review"
body = slide.placeholders[1].text_frame
body.text = "First point"
```

- One topic per slide; ≤ 6 bullet lines per slide, ≤ 2 lines each.
- Charts: `slide.shapes.add_chart(...)` native charts (editable in PowerPoint) —
  never paste chart screenshots.
- Speaker notes: `slide.notes_slide.notes_text_frame.text = "..."` for every
  content slide.
- Consistent font sizes via layout placeholders; title 28–36pt, body 16–20pt.

## Post-checklist

1. Reopen with `Presentation(path)` — parses clean.
2. No placeholder boilerplate left ("Click to add text").
3. Every text frame's font family is one of the deck's two families max.
4. Slide count matches the requested outline; every content slide has notes.

## Pitfalls

- Layout indices differ per template — enumerate `prs.slide_layouts` by name.
- `slide.placeholders[idx]` keys are layout-specific; check `placeholder_format.idx`.
- Images: `add_picture(path, left, top, width=...)` — always pass width OR height,
  never both (aspect distortion).
