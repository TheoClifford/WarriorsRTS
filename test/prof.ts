import { World } from '../src/sim/world';
import { AI } from '../src/ai/ai';
const cases: any[] = [['thunder', 'wind', 'balanced', 'rush', 11], ['river', 'shadow', 'boom', 'balanced', 22]];
const t0 = Date.now(); let ticks = 0;
for (const [c0, c1, s0, s1, seed] of cases) {
  const w = new World({ seed, players: [{ clan: c0, name: 'A', ai: true }, { clan: c1, name: 'B', ai: true }] });
  const ais = [new AI(w, 0, s0, 'normal', seed), new AI(w, 1, s1, 'normal', seed + 7)];
  let pend: any[] = [];
  while (!w.over && w.tick < 36000) { const c = pend; pend = []; w.step(c); for (const a of ais) pend.push(...a.think()); }
  ticks += w.tick;
}
console.log('ticks', ticks, 'ms', Date.now() - t0, 'ms/tick', ((Date.now() - t0) / ticks).toFixed(4));
