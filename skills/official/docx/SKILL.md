---
name: docx
description: "Create, edit, and inspect Word (.docx) documents with python-docx: reports, contracts, and formatted documents with styles, TOC, headers/footers, and tables. Use for any .docx creation or modification task."
---

# Word (.docx) documents

Dependency: `pip install python-docx`. Verify with `python3 -c "import docx"`.

## Route

1. **New document** — define the style sheet FIRST, then write content (see Styles).
2. **Edit existing** — open, locate target runs/paragraphs, mutate in place; never rebuild the file unless asked.
3. **Extract/inspect** — read paragraphs/tables; report structure before answering.

## Styles before content

Never format paragraphs inline. Modify the style sheet once, then use styles:

```python
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
normal = doc.styles["Normal"]
normal.font.name = "Calibri"
normal.font.size = Pt(11)
normal.paragraph_format.space_after = Pt(6)
# East-asian body text needs the eastasia font name too:
normal.element.rPr.rFonts.set(docx.oxml.ns.qn("w:eastAsia"), "宋体")
```

- Headings: use `doc.add_heading(..., level=N)` (maps to Heading N styles) so
  the navigation pane and TOC work.
- Cover page: centered title paragraph + page break; keep it one section.
- Page numbers/headers: edit `doc.sections[0].header` / `.footer`; a page-number
  field needs the raw fldSimple XML — prefer `header.paragraphs[0].text` only
  for static text, use field XML for `PAGE`.
- Tables: `doc.add_table(rows, cols, style="Table Grid")`; set column widths on
  every cell (Word ignores table-level widths).

## Post-checklist (run before delivering)

1. Reopen with `Document(path)` — must parse without error.
2. Every paragraph uses a style; no direct run-level font on body text.
3. TOC (if present) marked dirty so Word refreshes: set `w:updateFields` in settings.xml.
4. Tables render within page width; images embedded (not linked).
5. File opens in a fresh process; report file size and paragraph count.

## Pitfalls

- `add_heading` with level 0 produces the Title style, not Heading 1.
- Setting `font.name` alone does not change East-asian glyphs — set `w:eastAsia`.
- Deleting content via `paragraph._element.getparent().remove(...)` — clearing
  `.text` leaves the paragraph mark and style behind.
