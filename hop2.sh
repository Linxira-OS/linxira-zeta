#!/bin/bash
set -u
cd "C:/Users/ETPau/Documents/GITHUB/zeta-sync-1821"
mapfile -t HOPS < hops.txt
LAST=0; TOTAL=${#HOPS[@]}
for i in "${!HOPS[@]}"; do git ls-remote origin refs/heads/_sync-staging 2>/dev/null | grep -q "${HOPS[$i]}" && LAST=$((i+1)); done
echo "resume at $LAST/$TOTAL"
STEP=8
while [ $LAST -lt $TOTAL ]; do
  NEXT=$((LAST+STEP)); [ $NEXT -gt $TOTAL ] && NEXT=$TOTAL
  SHA="${HOPS[$((NEXT-1))]}"
  OK=0
  for t in $(seq 1 8); do
    git push origin +$SHA:refs/heads/_sync-staging > /dev/null 2>&1 && OK=1 && break
    sleep 2
  done
  if [ $OK -eq 1 ]; then LAST=$NEXT; echo "up $LAST/$TOTAL"; fi
done
# staging complete — now the real branch (only Zeta-side commits + merges remain to transfer)
for t in $(seq 1 10); do
  git push origin sync/omp-release/v18.2.1 > /dev/null 2>&1 && { echo "BRANCH_PUSHED"; break; }
  sleep 3
done
git ls-remote origin refs/heads/sync/omp-release/v18.2.1 | cut -c1-12
