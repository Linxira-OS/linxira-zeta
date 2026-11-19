# DSM analysis backends

DSM is the database interface in JavaScript and Python Eval. Use [read](./read.md#executables-and-analysis-databases) for on-disk executable metadata or an explicit analysis view. A bare executable read never opens a database or downloads a backend.

| Setting | Effect |
| --- | --- |
| `disassembler.backend` | `auto` prefers an installed IDA Pro with idalib, then Ghidra. Choose `ida`, `ghidra` or `none` to make the selection explicit. |
| `disassembler.maxOpen` | Caps open databases across both backends per project. |
| `disassembler.idleCloseSec` | Saves and closes unreferenced idle databases. `0` disables idle closing. |
| `ida.installDir`, `ida.python` | Select a local idalib installation and its Python runtime. |
| `ghidra.installDir`, `ghidra.python` | Select a local Ghidra installation and PyGhidra runtime. First explicit analysis may provision the configured Ghidra runtime when it is absent. |

Managed databases leave source executables intact. Existing IDA `.i64` and `.idb` files open in place. Work Studio's IDA page requires the IDA backend.

Each Eval `dsm.open` or `dsm.get` holds one reference. Close it when finished. Retained references pin the database against eviction and idle closing. A portable string from `db.handle()` identifies a live database in its originating project on the same machine. A recipient must open its own reference. Expired handles fail and do not create or reopen databases. Session disposal and conversation or backend changes release the session's references.

`zetacode ps` lists the backend workers as `zeta.ida.<id>` or `zeta.ghidra.<id>`. Changes are saved on request or during orderly cleanup. Crashes and forced stops can lose changes since the last save.

Implementation lives in `packages/coding-agent/src/disasm/`. The model-facing contract is `packages/coding-agent/src/prompts/tools/dsm.md`.
