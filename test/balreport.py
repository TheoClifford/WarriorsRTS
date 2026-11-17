import json, sys, statistics as st, math, collections
rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else 'test/out/balance.jsonl')]
clans = ['thunder', 'river', 'wind', 'shadow']; strats = ['balanced', 'rush', 'boom']
def wilson(k, n, z=1.96):
    if n == 0: return (0, 0, 0)
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return (p, c - h, c + h)
def score(r, side):  # win 1, draw 0.5, loss 0
    return 1.0 if r['winner'] == side else 0.5 if r['winner'] < 0 else 0.0
N = len(rows); dec = [r for r in rows if r['winner'] >= 0]
print(f"{N} games, {len(dec)} decided ({len(dec)/N*100:.0f}%), median length {st.median(r['len'] for r in rows):.1f} min (IQR {st.quantiles([r['len'] for r in rows], n=4)[0]:.1f}-{st.quantiles([r['len'] for r in rows], n=4)[2]:.1f})")
print("\nClan win rate (decided games; target 45-55%):")
for c in clans:
    k = sum(1 for r in dec for i in (0, 1) if r['c'][i] == c and r['winner'] == i); n = sum(1 for r in dec for i in (0, 1) if r['c'][i] == c)
    p, lo, hi = wilson(k, n); flag = '' if 0.45 <= p <= 0.55 else '  <-- outside target'
    print(f"  {c:8s} {p*100:5.1f}%  (95% CI {lo*100:.0f}-{hi*100:.0f}%, n={n}){flag}")
print("\nBuild order win rate (decided; target: none above 60%):")
for s in strats:
    k = sum(1 for r in dec for i in (0, 1) if r['s'][i] == s and r['winner'] == i); n = sum(1 for r in dec for i in (0, 1) if r['s'][i] == s and r['s'][1-i] != s)
    k = sum(1 for r in dec for i in (0, 1) if r['s'][i] == s and r['s'][1-i] != s and r['winner'] == i)
    p, lo, hi = wilson(k, n)
    print(f"  {s:9s} {p*100:5.1f}%  (vs other orders, CI {lo*100:.0f}-{hi*100:.0f}%, n={n})")
print("\nBuild order head to head (row's win rate vs column, decided):")
print('            ' + ''.join(f"{s:>10s}" for s in strats))
for a in strats:
    line = f"  {a:9s} "
    for b in strats:
        if a == b: line += f"{'-':>10s}"; continue
        k = sum(1 for r in dec for i in (0, 1) if r['s'][i] == a and r['s'][1-i] == b and r['winner'] == i); n = sum(1 for r in dec for i in (0, 1) if r['s'][i] == a and r['s'][1-i] == b)
        line += f"{(k/n*100 if n else 0):9.0f}%"
    print(line)
print("\nClan matchups (row's win rate vs column, decided):")
print('            ' + ''.join(f"{c:>9s}" for c in clans))
for a in clans:
    line = f"  {a:9s} "
    for b in clans:
        if a == b: line += f"{'-':>9s}"; continue
        k = sum(1 for r in dec for i in (0, 1) if r['c'][i] == a and r['c'][1-i] == b and r['winner'] == i); n = sum(1 for r in dec for i in (0, 1) if r['c'][i] == a and r['c'][1-i] == b)
        line += f"{(k/n*100 if n else 0):8.0f}%"
    print(line)
print("\nClan x build order win rate (decided):")
for c in clans:
    parts = []
    for s in strats:
        k = sum(1 for r in dec for i in (0, 1) if r['c'][i] == c and r['s'][i] == s and r['winner'] == i); n = sum(1 for r in dec for i in (0, 1) if r['c'][i] == c and r['s'][i] == s)
        parts.append(f"{s} {k/n*100 if n else 0:.0f}%")
    print(f"  {c:8s} " + ', '.join(parts))
a2 = [x for r in rows for x in r['a2'] if x > 0]; a3 = [x for r in rows for x in r['a3'] if x > 0]
print(f"\nBorder Moons median {st.median(a2):.1f} min (target 4.5-5.5); Battle Moons median {st.median(a3):.1f} min (target 11-13), reached in {len(a3)}/{2*N}")
ff = [r['ff'] for r in rows if r['ff'] > 0]
print(f"First fight median {st.median(ff):.1f} min (rush games {st.median([r['ff'] for r in rows if r['ff']>0 and 'rush' in r['s']]):.1f})")
print("Prey gathered per Clan (median):", ', '.join(f"{c} {st.median([r['prey'][i] for r in rows for i in (0,1) if r['c'][i]==c]):.0f}" for c in clans))
print("Peak army per Clan (median):", ', '.join(f"{c} {st.median([r['peak'][i] for r in rows for i in (0,1) if r['c'][i]==c]):.0f}" for c in clans))
