---
name: pdf
description: "Extract text, merge, split, rotate, and fill PDF files with pypdf; generate simple PDFs with reportlab. Use for any .pdf manipulation or extraction task."
---

# PDF files

Dependencies: `pip install pypdf` (manipulation), `pip install reportlab`
(generation). Verify: `python3 -c "import pypdf"`.

## Route

1. **Extract** — text, metadata, page counts. Scan-based PDFs have no text
   layer: detect (empty extraction on non-trivial page count) and say so
   instead of returning garbage; OCR is out of scope for this skill.
2. **Merge/split/rotate** — pypdf `PdfWriter`; never re-write content streams.
3. **Form-fill** — inspect field names first, then set values; flatten only on
   request (flattening is irreversible).
4. **Generate** — reportlab canvas for precise layout; platypus flowables for
   document-like output. Keep it simple: text, tables, images, page numbers.

## Discipline

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("in.pdf")
print(len(reader.pages), reader.metadata)
writer = PdfWriter()
writer.append(reader, pages=(0, 3))  # page ranges are half-open
with open("out.pdf", "wb") as f:
    writer.write(f)
```

- Extract per page (`page.extract_text()`); joins across pages need the
  separator you choose — inspect a page's raw output before bulk extraction.
- Form fields: `reader.get_fields()` lists names/types; set via
  `writer.update_page_form_field_values(page, {"Name": "Value"})`.
- Encrypt/decrypt: pass `password=` to `PdfReader`; preserve encryption only
  if the user asked.

## Post-checklist

1. Reopen the output with `PdfReader` — page count matches expectation.
2. Extracted text from the output is non-empty where the input was.
3. Forms: every targeted field name existed in `get_fields()`; no silent skips.
4. Report input → output page counts and file sizes.

## Pitfalls

- `extract_text()` quality varies wildly by producer; tables and multi-column
  layouts scramble reading order — verify a sample page before bulk claims.
- pypdf page indices are 0-based; user requests like "first three pages" are
  pages (0, 3).
- Appending pages copies named destinations inconsistently — verify links and
  bookmarks after merge if the user cares about them.
