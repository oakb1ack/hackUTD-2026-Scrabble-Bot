#!/usr/bin/env bash
# Print our place in one or more matches: scripts/rank.sh 42851 42855 ...
# With no args, prints the last 10 matches we played.
export PATH="$HOME/.local/bin:$PATH"
US=182
if [ $# -eq 0 ]; then
  set -- $(spacetime sql scrabblebot "SELECT match_id FROM match_participant WHERE bot_id = $US AND match_id > 42700" 2>/dev/null \
    | grep -E '^ *[0-9]+ *$' | tr -d ' ' | sort -n | tail -10)
fi
for m in "$@"; do
  spacetime sql scrabblebot "SELECT bot_id, score FROM match_participant WHERE match_id = $m" 2>/dev/null \
    | awk -F'|' 'NR>2 && NF>1 {gsub(/ /,"",$1); gsub(/ /,"",$2); print $2, $1}' \
    | sort -n -r \
    | awk -v m="$m" -v us="$US" '
        { n++; if ($2==us) { place=n; score=$1 } if (n==1) { top=$1; topbot=$2 } }
        END { if (place=="") print "match " m ": not in it";
              else printf "match %s: %d%s/%d  score %d  (1st: bot %s with %d)\n", m, place,
                (place==1?"st":place==2?"nd":place==3?"rd":"th"), n, score, topbot, top }'
done
