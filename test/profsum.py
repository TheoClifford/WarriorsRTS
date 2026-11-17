import json, sys, glob, collections
f = sorted(glob.glob('/tmp/prof/*.cpuprofile'))[-1]
p = json.load(open(f))
nodes = {n['id']: n for n in p['nodes']}
self_t = collections.Counter()
dt = p['timeDeltas']; samples = p['samples']
for s, d in zip(samples, dt): self_t[s] += d
agg = collections.Counter()
for nid, t in self_t.items():
    cf = nodes[nid]['callFrame']
    key = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']+1}"
    agg[key] += t
tot = sum(agg.values())
for k, v in agg.most_common(int(sys.argv[1]) if len(sys.argv)>1 else 30): print(f"{v/tot*100:5.1f}%  {k}")
