import json, sys, glob, collections
f = sorted(glob.glob('/tmp/prof/*.cpuprofile'))[-1]
p = json.load(open(f))
src = open('/tmp/prof.mjs').read().split('\n')
want = sys.argv[1:]
lines = collections.Counter()
for n in p['nodes']:
    cf = n['callFrame']
    if cf['functionName'] in want:
        for pt in n.get('positionTicks', []): lines[(cf['functionName'], pt['line'])] += pt['ticks']
tot = sum(lines.values()) or 1
for (fn, ln), t in lines.most_common(25): print(f"{t:6d} {fn}:{ln}  {src[ln-1].strip()[:110]}")
