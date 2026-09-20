---
name: xlsx
description: "Create, edit, and analyze Excel (.xlsx) spreadsheets with openpyxl: formulas, styled tables, multiple sheets, and data extraction. Use for any .xlsx creation, modification, or data-analysis task."
---

# Excel (.xlsx) spreadsheets

Dependency: `pip install openpyxl`. Verify with `python3 -c "import openpyxl"`.

## Route

1. **New workbook** — plan sheet structure first (one concern per sheet), then
   write data with a named style pass at the end.
2. **Edit existing** — open with `load_workbook(path)` (keep formulas:
   `data_only=False` default). To read computed values you need the cached
   results: `load_workbook(path, data_only=True)` on the same file — never mix
   the two handles when writing.
3. **Analyze/extract** — iterate `ws.iter_rows(values_only=True)`; report the
   shape (rows × cols, sheet list) before answering.

## Discipline

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
ws = wb.active
ws.title = "Summary"
ws.append(["Region", "Revenue", "Growth"])
for c in ws[1]:
    c.font = Font(bold=True)
    c.fill = PatternFill("solid", fgColor="DDDDDD")
ws.freeze_panes = "A2"  # header row stays visible
```

- Formulas as strings (`ws["C2"] = "=B2*1.1"`) — write formulas, not baked
  numbers, unless asked for static snapshots. openpyxl does NOT evaluate
  formulas; the cached value only exists after Excel/LibreOffice saves.
- Column widths: set `ws.column_dimensions["A"].width` explicitly; auto-fit
  does not exist in openpyxl.
- Dates: write `datetime` objects with a number format
  (`cell.number_format = "YYYY-MM-DD"`); never write date strings.
- Headers + `freeze_panes` on every data sheet; one table per sheet.
- Cross-sheet references use quoted names: `='Raw Data'!B2`.

## Post-checklist

1. Reopen with `load_workbook(path)` — parses clean; report sheet names and
   dimensions.
2. Formula cells have formula strings, not accidental literals.
3. No `#REF!`-prone deleted references after row/column removal.
4. Header styling consistent across sheets; widths set for content columns.

## Pitfalls

- `ws.delete_rows()` does not update formulas that referenced those rows —
  audit formulas after structural edits.
- `load_workbook(data_only=True)` returns `None` for formulas if the file was
  produced by openpyxl (never opened in a spreadsheet app) — there is no cache.
- Merged cells: only the top-left cell holds a value; writes to others are
  silently dropped.
