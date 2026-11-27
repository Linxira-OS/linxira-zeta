# TSP acceptance criteria

Two independent gates. Passing one does not imply the other.

## Gate A — Zeta Terminal is a TSP host

The product terminal (`terminal/`, the Wave fork) must run the agent natively,
not as an ANSI TUI fallback.

Pass criteria:

- `zetacode` launched inside a Zeta Terminal pane performs the TSP `hello`
  handshake: `app=zetacode`, negotiated version, kinds and features.
- Transcript, model/status rows, tool cards, diff views, pickers, dialogs and
  the composer render from TSP nodes; no full-screen ANSI repaint path is used
  while the TSP surface is healthy.
- Input, edit/undo/send, key routing, resize, focus changes, credits/acks and
  image/blob frames round-trip without duplicated or lost updates.
- A normal working day — prompt, tool call, approval, plan review, resume,
  settings, session switch — completes inside the product terminal.
- Killing/restarting the terminal reflows and reconnects without corrupting the
  session.

Current status: **not implemented**. The Wave fork does not yet speak the TSP
host protocol; it can run `zetacode` only through its ANSI TUI. This gate is the
TSP migration work, not a Wave upstream feature.

## Gate B — zetacode is a correct TSP guest under upstream Tern

The agent must render correctly inside the upstream closed-source Tern terminal
(and compatible TSP hosts), without relying on Zeta Terminal.

Pass criteria:

- The `hello` query advertises `app=zetacode`, supported kinds/features, and the
  terminal's replies are honored (version, kinds, features, credits, APC limit,
  cell metrics).
- Rows/text/markdown/code/cards/spinners/lists/pickers/editors render without
  clipping, overlap, wrong cell widths, or raw ANSI escape leakage.
- Prompt input, `edit`/`undo`/`send`, key events, paste, resize, abort and
  focus/blur match ANSI behaviour.
- Interactive surfaces work in Tern: model picker, session resume picker,
  settings, plan review/approval, ask/confirm/input dialogs, BTW and images.
- Unknown/unsupported kinds degrade gracefully; a TSP host that stops acking
  frames does not wedge the agent.
- Evidence is recorded against a real Tern build, not only a unit test or a
  synthetic terminal.

Current status: the guest implementation exists in `packages/tui/src/native`
and is covered by fake-host tests. Real-Tern acceptance evidence is still
required for the dialogs/resume/settings matrix above.

## Non-goals

- Treating ANSI fallback inside Zeta Terminal as Gate A.
- Treating a synthetic TSP host as Gate B.
- Sharing one pass result across both gates.
