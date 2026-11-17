// Who kills whom, where: a kill log for one AI game (balance diagnosis).
import { World } from '../src/sim/world';
import { AI, Strategy } from '../src/ai/ai';
import { sec, TILE } from '../src/sim/core';
const [c0, c1, s0, s1, seedS, from, to] = process.argv.slice(2);
const w = new World({ seed: +(seedS || 1), players: [{ clan: c0 as any, name: 'A', ai: true }, { clan: c1 as any, name: 'B', ai: true }] });
const ais = [new AI(w, 0, s0 as Strategy, 'normal', +seedS), new AI(w, 1, s1 as Strategy, 'normal', +seedS + 7)];
const orig = w.kill.bind(w);
const lo = sec(+(from || 0) * 60), hi = sec(+(to || 40) * 60);
const tally: Record<string, number> = {};
(w as any).kill = (u: any, k: any) => {
  if (!u.dead && u.o >= 0 && w.tick >= lo && w.tick <= hi) {
    const camp = w.get(w.players[u.o].campId)!;
    const d = Math.round(w.distToBld(u.x, u.y, camp) / TILE);
    const who = k ? (k.o < 0 ? k.t : `p${k.o}:${k.t}`) : 'camp/hazard';
    const key = `p${u.o}:${u.t} <- ${who} ${d <= 2 ? 'AT CAMP' : d <= 10 ? 'near camp' : 'away'}`;
    tally[key] = (tally[key] || 0) + 1;
  }
  return orig(u, k);
};
let pend: any[] = [];
while (!w.over && w.tick < Math.min(hi, sec(35 * 60))) { const c = pend; pend = []; w.step(c); for (const a of ais) pend.push(...a.think()); }
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
