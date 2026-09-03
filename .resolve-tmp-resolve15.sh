#!/bin/bash
cd /mnt/c/Users/ETPau/Documents/GITHUB/zeta-sync-omp-18-1-2 || exit 1
export GIT_DIR=$(sed 's|gitdir: C:/|/mnt/c/|' < .git)
export GIT_WORK_TREE="$PWD"
MAP='
@oh-my-pi/pi-agent-core|@linxiraos/pi-agent-core
@oh-my-pi/pi-ai|@linxiraos/pi-ai
@oh-my-pi/pi-catalog|@linxiraos/pi-catalog
@oh-my-pi/pi-coding-agent|@linxiraos/zeta
@oh-my-pi/hashline|@linxiraos/pi-hashline
@oh-my-pi/pi-mnemopi|@linxiraos/pi-mnemopi
@oh-my-pi/pi-natives|@linxiraos/pi-natives
@oh-my-pi/omptype|@linxiraos/pi-omptype
@oh-my-pi/snapcompact|@linxiraos/pi-snapcompact
@oh-my-pi/omp-stats|@linxiraos/pi-stats
@oh-my-pi/pi-tui|@linxiraos/pi-tui
@oh-my-pi/pi-utils|@linxiraos/pi-utils
@oh-my-pi/pi-wire|@linxiraos/pi-wire
@oh-my-pi/|@linxiraos/pi-
@oh-my-pi|@linxiraos
'
count=0
while IFS= read -r f; do
  case "$f" in bun.lock|README.md|docs/*|packages/ai/README.md) continue;; esac
  git show ":3:$f" > .resolve-tmp-theirs.tmp 2>/dev/null || { echo "SKIP: $f"; continue; }
  echo "$MAP" | while IFS='|' read -r from to; do
      [ -z "$from" ] && continue
      sed -i "s|${from//\//\\/}|${to//\//\\/}|g" .resolve-tmp-theirs.tmp
    done
  cp .resolve-tmp-theirs.tmp "$f"
  git add "$f" || echo "ADD-FAILED: $f"
  count=$((count+1))
done < .resolve-tmp-scope15.txt
echo "RESOLVED: $count"
