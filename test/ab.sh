#!/bin/sh
# usage: test/ab.sh <clan> <seeds> <seedBase> '<json patch>'  — win rate of <clan> under the patch
cd "$(dirname "$0")/.."
npx esbuild test/abtest.ts --bundle --platform=node --format=esm --outfile=/tmp/abtest.mjs --log-level=warning
o=/tmp/ab_$$.jsonl; rm -f $o
node /tmp/abtest.mjs "$1" "$2" "$3" "$4" 0 2 $o & node /tmp/abtest.mjs "$1" "$2" "$3" "$4" 1 2 $o; wait
python3 - "$1" $o "$4" <<'PY'
import json,sys
clan,f,patch=sys.argv[1],sys.argv[2],sys.argv[3]
G=[json.loads(l) for l in open(f)]
w=d=0; by={}
for g in G:
    if g['winner'] is None or g['winner']<0: continue
    i=g['c'].index(clan); d+=1; win=g['winner']==i; w+=win
    k=g['s'][i]; by.setdefault(k,[0,0]); by[k][0]+=win; by[k][1]+=1
print(f"{clan} {patch}: {w/d*100:.1f}% of {d} decided  ", {k:f"{v[0]/v[1]*100:.0f}%" for k,v in by.items()})
PY
