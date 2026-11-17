// Balance harness (spec section 11): full-factorial AI round robin.
// Every ordered pair of Clans x every pair of build orders x N seeds. One JSON line per game, streamed.
import { World, isFighter } from '../src/sim/world';
import { AI, Strategy } from '../src/ai/ai';
import { CLANS, sec } from '../src/sim/core';
import { appendFileSync, existsSync, readFileSync } from 'fs';
const seeds = +(process.argv[2] || 10), part = +(process.argv[3] || 0), parts = +(process.argv[4] || 1), out = process.argv[5] || 'test/out/balance.jsonl', seedBase = +(process.argv[6] || 5000);
const strats: Strategy[] = ['balanced', 'rush', 'boom'];
const games: [number, number, Strategy, Strategy, number][] = [];
for (let s = 0; s < seeds; s++) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) for (const s0 of strats) for (const s1 of strats) games.push([i, j, s0, s1, seedBase + s]);
// resume: skip games already in the output file
const done = new Set<string>();
if (existsSync(out)) for (const l of readFileSync(out, 'utf8').split('\n')) { if (!l) continue; try { const g = JSON.parse(l); done.add(g.c.join() + g.s.join() + g.seed); } catch { /* partial line */ } }
let n = 0;
const t0 = Date.now();
for (let g = part; g < games.length; g += parts) {
  const [i, j, s0, s1, seed] = games[g];
  if (done.has(CLANS[i] + ',' + CLANS[j] + s0 + ',' + s1 + seed)) continue;
  const w = new World({ seed: seed * 131 + i * 17 + j * 5 + strats.indexOf(s0) * 3 + strats.indexOf(s1), players: [{ clan: CLANS[i], name: 'A', ai: true }, { clan: CLANS[j], name: 'B', ai: true }] });
  const ais = [new AI(w, 0, s0, 'normal', seed), new AI(w, 1, s1, 'normal', seed + 7)];
  let pend: any[] = [];
  let peak = [0, 0];
  while (!w.over && w.tick < sec(35 * 60)) {
    const c = pend; pend = []; w.step(c); for (const a of ais) pend.push(...a.think());
    if (w.tick % 600 === 0) for (const p of w.players) { let a = 0; for (const u of w.units) if (u.o === p.id && !u.dead && isFighter(u.t) && !u.leader) a++; peak[p.id] = Math.max(peak[p.id], a); }
  }
  const P = w.players;
  appendFileSync(out, JSON.stringify({
    c: [CLANS[i], CLANS[j]], s: [s0, s1], seed, winner: w.winner, len: +(w.tick / 1200).toFixed(2),
    ff: +((Math.max(P[0].stats.firstFight, -1)) / 1200).toFixed(2), a2: P.map(p => +((p.stats.ageTimes[1] || 0) / 1200).toFixed(2)), a3: P.map(p => +((p.stats.ageTimes[2] || 0) / 1200).toFixed(2)),
    lives: P.map(p => p.lives), prey: P.map(p => p.stats.gathered.prey), herbs: P.map(p => p.stats.gathered.herbs), killed: P.map(p => p.stats.killed), lost: P.map(p => p.stats.lost), peak,
  }) + '\n');
  n++;
}
console.log(`part ${part}/${parts}: ${n} games in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
