#!/usr/bin/env bash
# Run every A/B variant as its own process, in parallel, then print a
# combined table. Usage: npm run sim:ab -- [--matches N] [--seed S]
set -euo pipefail
cd "$(dirname "$0")/.."
VARIANTS=$(node -e '
  const s=require("fs").readFileSync("src/sim/run.ts","utf8");
  const m=s.match(/const VARIANTS[^{]*\{([\s\S]*?)\n\};/);
  for (const l of m[1].split("\n")) { const k=l.match(/^\s*(\w+):/); if(k) console.log(k[1]); }')
OUT=$(mktemp -d)
for v in $VARIANTS; do
  npx tsx src/sim/run.ts --variant "$v" "$@" > "$OUT/$v.txt" 2>&1 &
done
wait
head -1 "$OUT/$(echo $VARIANTS | cut -d' ' -f1).txt"
for v in $VARIANTS; do sed -n 2p "$OUT/$v.txt"; done | sort -k2 -n -r
echo
tail -1 "$OUT/$(echo $VARIANTS | cut -d' ' -f1).txt"
