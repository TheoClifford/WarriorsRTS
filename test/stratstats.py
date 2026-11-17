# Per build-order pairing: median prey, kills, losses, peak army for each side.
import json, sys, statistics as st
G = [json.loads(l) for l in open(sys.argv[1])]
for key in [('rush', 'boom'), ('rush', 'balanced'), ('balanced', 'boom'), ('rush', 'rush'), ('boom', 'boom')]:
    rows = []
    for g in G:
        for i in (0, 1):
            if (g['s'][i], g['s'][1 - i]) == key: rows.append((g, i))
    if not rows: continue
    def m(k, me):
        return st.median(g[k][i if me else 1 - i] for g, i in rows)
    win = sum(1 for g, i in rows if g['winner'] == i) / len(rows)
    print(f"{key[0]:>8} vs {key[1]:<8} n={len(rows):3d} win {win*100:3.0f}%  len {st.median(g['len'] for g,i in rows):4.1f}  prey {m('prey',1):6.0f}/{m('prey',0):6.0f}  killed {m('killed',1):4.0f}/{m('killed',0):4.0f}  peak {m('peak',1):3.0f}/{m('peak',0):3.0f}  a2 {m('a2',1):4.1f}/{m('a2',0):4.1f}")
