// 1) Same seed + same commands => identical hashes every 10 s of game time.
// 2) Snapshot mid-game, restore into a fresh world, continue: identical to the uninterrupted run.
// 3) Replaying the recorded command log reproduces the match exactly.
import { World } from '../src/sim/world';
import { AI } from '../src/ai/ai';
import type { Cmd } from '../src/sim/types';
const settings = { seed: 1234, players: [{ clan: 'river' as const, name: 'A', ai: true }, { clan: 'wind' as const, name: 'B', ai: true }] };
const TICKS = 12 * 1200;
function run(record: [number, Cmd][] | null, replay: Map<number, Cmd[]> | null, snapAt = -1) {
  let w = new World(settings);
  const ais = replay ? [] : [new AI(w, 0, 'balanced', 'normal', 1), new AI(w, 1, 'rush', 'normal', 2)];
  const hashes: number[] = [];
  let pending: Cmd[] = [];
  while (w.tick < TICKS) {
    let cmds = replay ? (replay.get(w.tick) || []) : pending; pending = [];
    if (record) for (const c of cmds) record.push([w.tick, c]);
    w.step(cmds);
    if (!replay) for (const a of ais) pending.push(...a.think());
    if (w.tick % 200 === 0) hashes.push(w.hash());
    if (w.tick === snapAt) {
      const snap = w.snapshot();
      const w2 = new World(settings); w2.restore(snap);
      if (w2.hash() !== w.hash()) { console.log('restore hash mismatch at', w.tick); process.exit(1); }
      // AI keeps its own memory; point it at the restored world
      for (const a of ais) (a as any).w = w2;
      w = w2;
    }
  }
  return hashes;
}
const log: [number, Cmd][] = [];
const a = run(log, null);
const b = run(null, null);
const m = new Map<number, Cmd[]>(); for (const [t, c] of log) { if (!m.has(t)) m.set(t, []); m.get(t)!.push(c); }
const c = run(null, m);
const d = run(null, null, 6000);
const eq = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);
console.log('checkpoints', a.length, '| rerun identical:', eq(a, b), '| replay identical:', eq(a, c), '| snapshot/restore identical:', eq(a, d), '| commands', log.length);
process.exit(eq(a, b) && eq(a, c) && eq(a, d) ? 0 : 1);
