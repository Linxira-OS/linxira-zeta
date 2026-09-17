#!/bin/bash
set -u
R="C:/Users/ETPau/Documents/GITHUB/zeta-sync-1821"
mapfile -t HOPS < "$R/hops.txt"
LAST=0; TOTAL=${#HOPS[@]}
STAGING=$(git -C "$R" ls-remote origin refs/heads/_sync-staging 2>/dev/null | cut -c1-40)
for i in "${!HOPS[@]}"; do [ "${HOPS[$i]}" = "$STAGING" ] && LAST=$((i+1)); done
echo "resume $LAST/$TOTAL"
FAILS=0
while [ $LAST -lt $TOTAL ]; do
  SHA="${HOPS[$LAST]}"
  OK=0
  for t in $(seq 1 10); do
    git -C "$R" push origin +$SHA:refs/heads/_sync-staging > /dev/null 2>&1 && OK=1 && break
    FAILS=$((FAILS+1)); sleep 2
  done
  if [ $OK -eq 1 ]; then LAST=$((LAST+1)); echo "up $LAST/$TOTAL"; FAILS=0; fi
  if [ $FAILS -ge 60 ]; then echo "STALLED at $LAST"; exit 2; fi
done
for t in $(seq 1 15); do
  git -C "$R" push origin sync/omp-release/v18.2.1 > /dev/null 2>&1 && break
  sleep 3
done
echo "FINAL: $(git -C "$R" ls-remote origin refs/heads/sync/omp-release/v18.2.1 | cut -c1-12)"
