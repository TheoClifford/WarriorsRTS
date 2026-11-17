// Unit cost-efficiency arena: equal-cost groups fight on open ground at Fourtrees; prints value-weighted outcome.
import { World, UNITS } from '../src/sim/world';
import { sec, TILE, MAPN, costOf, B } from '../src/sim/core';
function merge(dst: any, src: any) { for (const k in src) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) merge(dst[k], src[k]); else dst[k] = src[k]; } }
merge(B, JSON.parse(process.argv[3] || '{}'));
const value = (t: string) => { const c = costOf(UNITS[t].cost); return c.prey + c.moss + 1.6 * c.herbs; };
const budget = 600;
const types = (process.argv[2] || 'warrior,guard,runner,stalker').split(',');
const clans = ['thunder', 'wind'];
function fight(a: string, b: string, seed: number): number {
  const w = new World({ seed, players: [{ clan: clans[0] as any, name: 'A', ai: true }, { clan: clans[1] as any, name: 'B', ai: true }] });
  // clear the board of everything but the arena
  for (const u of w.units) if (u.o >= 0 && !u.leader) { u.dead = 1; u.gone = true; }
  w.units = w.units.filter(u => !u.gone);
  const cx = (MAPN >> 1) * TILE, cy = (MAPN >> 1) * TILE + TILE * 6;
  const na = Math.round(budget / value(a)), nb = Math.round(budget / value(b));
  const A: any[] = [], Bs: any[] = [];
  for (let i = 0; i < na; i++) A.push(w.spawnUnit(0, a, cx - TILE * 4 + (i % 3) * 600, cy + Math.trunc(i / 3) * 700 - TILE));
  for (let i = 0; i < nb; i++) Bs.push(w.spawnUnit(1, b, cx + TILE * 4 - (i % 3) * 600, cy + Math.trunc(i / 3) * 700 - TILE));
  w.step([{ c: 'mv', p: 0, ids: A.map(u => u.id), x: cx + TILE * 6, y: cy, am: 1 }, { c: 'mv', p: 1, ids: Bs.map(u => u.id), x: cx - TILE * 6, y: cy, am: 1 }] as any);
  for (let t = 0; t < sec(90); t++) { w.step([]); if (A.every(u => u.dead) || Bs.every(u => u.dead)) break; }
  const va = A.filter(u => !u.dead).reduce((s, u) => s + value(a) * u.hp / u.mhp, 0), vb = Bs.filter(u => !u.dead).reduce((s, u) => s + value(b) * u.hp / u.mhp, 0);
  return (va - vb) / budget; // +1: A wiped B at no loss
}
console.log('row vs column, equal cost (' + budget + '), herbs valued 1.6x; +100 = row wins untouched');
console.log('            ' + types.map(t => t.padStart(9)).join(''));
for (const a of types) {
  const row = types.map(b => { let s = 0; for (let k = 0; k < 4; k++) s += fight(a, b, 100 + k) - fight(b, a, 200 + k); return Math.round(s / 8 * 100); });
  console.log(a.padEnd(12) + row.map(v => String(v).padStart(9)).join(''));
}
