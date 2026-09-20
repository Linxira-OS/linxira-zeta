# ttt — hero demo tape
# Record from the repo root:
#     make build && vhs docs-web/public/demo/demo.tape
# The Hide block generates a throwaway TypeScript project in /tmp/ttt-demo and
# an isolated config in /tmp/ttt-demo-cfg (both via docs-web/demo/setup.sh), so
# recording mutates nothing tracked and needs nothing from your real config.

Output docs-web/public/demo/demo.gif
Output docs-web/public/demo/demo.webm

Set Shell "bash"
Set FontSize 14
Set Width 1400
Set Height 800
Set Padding 10
Set Theme "Catppuccin Mocha"
Set TypingSpeed 32ms

# ── Setup (hidden): build fixture + config, open ttt already on a file ──
Hide
Type "bash docs-web/demo/setup.sh /tmp/ttt-demo /tmp/ttt-demo-cfg; TTT=$PWD/bin/ttt; cd /tmp/ttt-demo; TTT_CONFIG_DIR=/tmp/ttt-demo-cfg $TTT src/tasks.ts ."
Enter
Sleep 2.4s
Show

# ════════════════════════════════════════════════════════════════════
# ACT 1 — THE HOOK: select every occurrence, rename them all at once
# ════════════════════════════════════════════════════════════════════
Sleep 1s
Ctrl+f
Type "task"
Enter
Escape
Sleep 400ms
Ctrl+k
Type "l"
Sleep 650ms
Type "entry"
Sleep 1.1s

# ════════════════════════════════════════════════════════════════════
# ACT 2 — CODE FOLDING: collapse the whole file, then reopen
# ════════════════════════════════════════════════════════════════════
Ctrl+k
Type "0"
Sleep 1s
Ctrl+k
Type "9"
Sleep 800ms

# ════════════════════════════════════════════════════════════════════
# ACT 3 — LIVE GIT: the rename ripples into a side-by-side diff
# ════════════════════════════════════════════════════════════════════
Ctrl+p
Type "Save File"
Sleep 250ms
Enter
Sleep 400ms
Ctrl+k
Type "c"
Sleep 900ms
Down
Sleep 200ms
Enter
Sleep 1.6s

# ════════════════════════════════════════════════════════════════════
# ACT 4 — THEME: three live theme previews, one keystroke apart
# ════════════════════════════════════════════════════════════════════
Ctrl+p
Type "Switch Theme"
Sleep 300ms
Enter
Sleep 500ms
# Jump between dark themes by unique substrings (typing filters + previews
# live), so we never render a light theme in passing. Land on zenith.
Type "turbo"
Sleep 700ms
Backspace 5
Type "hot"
Sleep 700ms
Backspace 3
Type "zen"
Sleep 700ms
Enter
Sleep 900ms

# ════════════════════════════════════════════════════════════════════
# ACT 5 — FINALE: fullscreen terminal running btop, then slide it all away
# ════════════════════════════════════════════════════════════════════
# Back to the code view
Ctrl+w
Sleep 500ms
# Open the terminal, focus the editor, and grow the panel tall so btop has
# room (it needs 24 rows), then drop back into the terminal and run btop
Ctrl+t
Sleep 450ms
Ctrl+j
Sleep 150ms
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Ctrl+l
Up
Sleep 250ms
Ctrl+u
Sleep 200ms
Type@25ms "btop"
Enter
Sleep 3s
# Quit btop, focus the editor, shrink the panel back down, then close it
Type "q"
Sleep 400ms
Ctrl+j
Sleep 200ms
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Ctrl+l
Down
Sleep 250ms
Ctrl+t
Sleep 600ms
# Slide the sidebar left, step by step, then tuck it fully away
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Ctrl+l
Left
Sleep 400ms
Ctrl+b
Sleep 800ms

# Restore the default theme so the GIF loops cleanly back to the start
Ctrl+p
Type "Switch Theme"
Sleep 250ms
Enter
Sleep 400ms
Type "default-d"
Sleep 600ms
Enter
Sleep 1.6s
