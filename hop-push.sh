#!/bin/bash
set -u
cd "C:/Users/ETPau/Documents/GITHUB/zeta-sync-1821"
mapfile -t HOPS < hops.txt
TOTAL=${#HOPS[@]}
LAST_UP=0
for i in "${!HOPS[@]}"; do
  if git ls-remote origin refs/heads/_sync-staging 2>/dev/null | grep -q "${HOPS[$i]}"; then LAST_UP=$((i+1)); fi
done
echo "origin has $LAST_UP / $TOTAL"
STEP=60
while [ $LAST_UP -lt $TOTAL ]; do
  NEXT=$((LAST_UP + STEP)); [ $NEXT -gt $TOTAL ] && NEXT=$TOTAL
  SHA="${HOPS[$((NEXT-1))]}"
  OK=0
  for try in 1 2 3 4; do
    if git push origin +$SHA:refs/heads/_sync-staging > pushlog.txt 2>&1; then OK=1; break; fi
    sleep 8
  done
  if [ $OK -eq 1 ]; then
    LAST_UP=$NEXT
    echo "up $NEXT/$TOTAL (${SHA:0:9})"
  else
    STEP=$((STEP/2)); [ $STEP -lt 5 ] && STEP=5
    echo "fail, step -> $STEP"
  fi
done
rm -f hops.txt hop-push.sh pushlog.txt
echo "ALL_HOPS_UP"
