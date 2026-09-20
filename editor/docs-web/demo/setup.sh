#!/usr/bin/env bash
# Generates a throwaway demo project for the ttt hero recording (demo.tape).
# Everything lives outside the ttt repo, in its own git repo, so recording
# mutates nothing tracked. Regenerate anytime; no cleanup needed.
#
#   bash docs-web/demo/setup.sh [target-dir]   # default: /tmp/ttt-demo
set -euo pipefail
DIR="${1:-/tmp/ttt-demo}"
CFG="${2:-/tmp/ttt-demo-cfg}"
rm -rf "$DIR"
mkdir -p "$DIR/src" "$DIR/scripts"

# Isolated config for the recording: keeps your real ~/.config/ttt untouched
# and makes the demo reproducible. VHS can't send the default alt+shift+arrow
# panel-resize keys, so remap them to ctrl+l chords (merged over defaults).
rm -rf "$CFG"; mkdir -p "$CFG"
cat > "$CFG/keybindings.json" <<'JSON'
[
  { "key": "ctrl+l up",    "command": "panel.taller" },
  { "key": "ctrl+l down",  "command": "panel.shorter" },
  { "key": "ctrl+l left",  "command": "sidebar.narrower" },
  { "key": "ctrl+l right", "command": "sidebar.wider" },
  { "key": "ctrl+j",       "command": "focus.nextGroup" },
  { "key": "ctrl+u",       "command": "focus.terminal" }
]
JSON
cat > "$CFG/settings.json" <<'JSON'
{ "version": 1, "theme": "default-dark", "editor": { "lineNumbers": true } }
JSON

cd "$DIR"

# Types are named Item/Tracker so the lowercase loop variable `task` is the
# ONLY case-insensitive match for a Find of "task" — the multi-cursor shot in
# demo.tape lands cleanly on it (9 whole-word occurrences, no collisions).
cat > src/tasks.ts <<'TS'
import { Store } from "./store";

export interface Item {
  id: number;
  title: string;
  done: boolean;
}

export class Tracker {
  constructor(private store: Store<Item>) {}

  add(title: string): Item {
    const task = { id: Date.now(), title, done: false };
    this.store.save(task);
    return task;
  }

  complete(id: number): void {
    const task = this.store.get(id);
    if (task) {
      task.done = true;
      this.store.save(task);
    }
  }

  pending(): Item[] {
    return this.store.all().filter((task) => !task.done);
  }
}
TS

cat > src/store.ts <<'TS'
export class Store<T extends { id: number }> {
  private items = new Map<number, T>();

  save(item: T): void {
    this.items.set(item.id, item);
  }

  get(id: number): T | undefined {
    return this.items.get(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
TS

cat > src/index.ts <<'TS'
import { Store } from "./store";
import { Item, Tracker } from "./tasks";

const tracker = new Tracker(new Store<Item>());

tracker.add("Ship v1.0.0");
tracker.add("Record the demo");
const t = tracker.add("Write the docs");
tracker.complete(t.id);

for (const task of tracker.pending()) {
  console.log(`- [ ] ${task.title}`);
}
TS

cat > scripts/test.sh <<'SH'
#!/usr/bin/env bash
g="\033[32m"; d="\033[2m"; r="\033[0m"
for t in "adds a task" "completes a task" "lists pending tasks" \
         "ignores done tasks" "persists through the store"; do
  printf "  ${g}✓${r} ${d}%s${r}\n" "$t"; sleep 0.12
done
printf "\n  ${g}5 passed${r} ${d}(0.38s)${r}\n"
SH
chmod +x scripts/test.sh

cat > Makefile <<'MK'
test:
	@bash ./scripts/test.sh
MK

cat > package.json <<'JSON'
{
  "name": "task-service",
  "version": "1.0.0",
  "scripts": { "test": "make test" }
}
JSON

cat > README.md <<'MD'
# task-service

A tiny task tracker — the demo project for **ttt**.

- `src/tasks.ts` — the service
- `src/store.ts` — in-memory store
- `make test` — run the suite
MD

git init -q
git add -A
git -c user.email=demo@ttt.dev -c user.name=ttt commit -qm "initial commit" >/dev/null
echo "demo project ready at $DIR"
