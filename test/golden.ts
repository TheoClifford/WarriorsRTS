// Records (or checks) the exact hash trajectory of several full AI matches.
// Optimisations must leave every hash unchanged.
import { World } from '../src/sim/world';
import { AI, Strategy } from '../src/ai/ai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const FILE = 'test/golden.json';
const cases: [string, string, Strategy, Strategy, number][] = [
  ['thunder', 'wind', 'balanced', 'rush', 11], ['river', 'shadow', 'boom', 'balanced', 22], ['wind', 'river', 'rush', 'boom', 33], ['shadow', 'thunder', 'rush', 'rush', 44],
];
const out: any[] = [];
const t0 = Date.now();
for (const [c0, c1, s0, s1, seed] of cases) {
  const w = new World({ seed, players: [{ clan: c0 as any, name: 'A', ai: true }, { clan: c1 as any, name: 'B', ai: true }] });
  const ais = [new AI(w, 0, s0, 'normal', seed), new AI(w, 1, s1, 'normal', seed + 7)];
  const hashes: number[] = [];
  let pend: any[] = [];
  while (!w.over && w.tick < 36000) { const c = pend; pend = []; w.step(c); for (const a of ais) pend.push(...a.think()); if (w.tick % 200 === 0) hashes.push(w.hash()); }
  out.push({ case: [c0, c1, s0, s1, seed], ticks: w.tick, winner: w.winner, hashes });
}
const ms = Date.now() - t0;
if (process.argv[2] === 'record' || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(out));
  console.log('recorded', out.map(o => `${o.case.join('/')}: ${o.ticks} ticks winner ${o.winner}`).join(' | '), `${ms} ms`);
} else {
  const g = JSON.parse(readFileSync(FILE, 'utf8'));
  let ok = true;
  g.forEach((x: any, i: number) => {
    const y = out[i];
    const n = Math.min(x.hashes.length, y.hashes.length);
    let first = -1;
    for (let k = 0; k < n; k++) if (x.hashes[k] !== y.hashes[k]) { first = k; break; }
    const same = first < 0 && x.hashes.length === y.hashes.length && x.ticks === y.ticks && x.winner === y.winner;
    if (!same) ok = false;
    console.log(`${x.case.join('/')}: ${same ? 'identical' : 'DIFFERS at checkpoint ' + first} (${y.ticks} ticks)`);
  });
  console.log(ok ? 'GOLDEN MATCH' : 'GOLDEN MISMATCH', `${ms} ms`);
  process.exit(ok ? 0 : 1);
}
