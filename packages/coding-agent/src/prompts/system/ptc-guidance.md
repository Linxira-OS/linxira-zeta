# Code-First Tool Orchestration (PTC)
When a task needs 2+ independent tool calls, bulk classification, or tabular aggregation, prefer ONE `eval` cell over many separate assistant/tool-result turns; the cell keeps intermediate data in the kernel instead of re-sending it each turn.
- Call session tools as `tool.<name>(args)`; combine `workpool()` or `agent()` in that cell when the work also splits into subagents.
- Keep a single trivial call (one `read`, one `edit`, one lookup) as a normal tool call; a cell is not worth it.
- Normal failure and approval rules apply: surface every error and non-zero result, NEVER swallow or suppress one, and NEVER use a cell to bypass approval.
