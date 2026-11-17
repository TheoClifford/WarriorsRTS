// A/B a rules change on one Clan's games: node abtest.mjs <clan> <seeds> <seedBase> '<json patch on B>' part parts out
import { World } from '../src/sim/world';
import { AI, Strategy } from '../src/ai/ai';
import { CLANS, sec, B } from '../src/sim/core';
import { appendFileSync } from 'fs';
const [clan, seedsS, baseS, patchS, partS, partsS, out] = process.argv.slice(2);
const patch = JSON.parse(patchS || '{}');
function merge(dst: any, src: any) { for (const k in src) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) merge(dst[k], src[k]); else dst[k] = src[k]; } }
merge(B, patch);
const strats: Strategy[] = ['balanced', 'rush', 'boom'];
const ci = CLANS.indexOf(clan as any);
const games: [number, number, Strategy, Strategy, number][] = [];
for (let s = 0; s < +seedsS; s++) for (let j = 0; j < 4; j++) if (j !== ci) for (const s0 of strats) for (const s1 of strats) { games.push([ci, j, s0, s1, +baseS + s]); games.push([j, ci, s0, s1, +baseS + s]); }
for (let g = +partS; g < games.length; g += +partsS) {
  const [i, j, s0, s1, seed] = games[g];
  const w = new World({ seed: seed * 131 + i * 17 + j * 5 + strats.indexOf(s0) * 3 + strats.indexOf(s1), players: [{ clan: CLANS[i], name: 'A', ai: true }, { clan: CLANS[j], name: 'B', ai: true }] });
  const ais = [new AI(w, 0, s0, 'normal', seed), new AI(w, 1, s1, 'normal', seed + 7)];
  let pend: any[] = [];
  while (!w.over && w.tick < sec(35 * 60)) { const c = pend; pend = []; w.step(c); for (const a of ais) pend.push(...a.think()); }
  appendFileSync(out, JSON.stringify({ c: [CLANS[i], CLANS[j]], s: [s0, s1], winner: w.winner, len: +(w.tick / 1200).toFixed(2) }) + '\n');
}
