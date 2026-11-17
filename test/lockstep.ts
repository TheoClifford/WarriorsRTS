import { World } from '../src/sim/world';
import { AI } from '../src/ai/ai';
import { Lockstep } from '../src/net/lockstep';
import { LoopbackHub } from '../src/net/transport';
import { Rng } from '../src/sim/core';
const mins = +(process.argv[2] || 6), corruptAt = +(process.argv[3] || -1);
const r = new Rng(42); const hub = new LoopbackHub(70, 120, 0.25, () => r.next() / 4294967296);
const settings = { seed: 7, players: [{ clan: 'thunder' as const, name: 'Host' }, { clan: 'shadow' as const, name: 'Guest' }] };
const ta = hub.make('A'), tb = hub.make('B');
const wa = new World(settings), wb = new World(settings);
const la = new Lockstep(ta, 0, wa, 0), lb = new Lockstep(tb, 1, wb, 0);
la.peer = 'B'; lb.peer = 'A'; la.clock = () => now; lb.clock = () => now;
const aia = new AI(wa, 0, 'balanced', 'normal', 1), aib = new AI(wb, 1, 'rush', 'normal', 2);
let now = 0; let stalls = 0, maxDelay = 0; let corrupted = false; let detected = -1, resynced = -1;
const sides = [{ w: wa, l: la, ai: aia, t: ta }, { w: wb, l: lb, ai: aib, t: tb }];
const endTick = mins * 1200;
while (wa.tick < endTick || wb.tick < endTick) {
  now += 10;
  for (const s of sides) s.t.tick(now);
  for (const s of sides) {
    const target = Math.floor(now / 50);
    let steps = 0;
    s.l.pump(s.w.tick, now);
    while (s.w.tick < target && s.w.tick < endTick && steps < 8) {
      if (!s.l.canStep(s.w.tick)) { stalls++; break; }
      if (s.w.tick % 2 === 0) s.l.recordHash(s.w.tick);
      const cmds = s.l.commandsFor(s.w.tick);
      s.w.step(cmds);
      for (const c of s.ai.think()) s.l.issue(c);
      s.l.pump(s.w.tick, now);
      steps++;
    }
    maxDelay = Math.max(maxDelay, s.l.delay);
  }
  if (corruptAt > 0 && !corrupted && wb.tick >= corruptAt) { wb.players[1].prey += 1; corrupted = true; console.log('corrupted guest at tick', wb.tick); }
  if (corrupted && detected < 0 && (la.desync >= 0 || lb.desync >= 0)) { detected = wb.tick; console.log('desync detected at turn', Math.max(la.desync, lb.desync), 'tick', wb.tick); lb.requestResync(); }
  if (detected >= 0 && resynced < 0 && !lb.needSnap && !la.snapOut && lb.epoch !== 0) { resynced = wb.tick; console.log('resynced at tick', wb.tick, 'snapshot chunks', lb.snapIn?.n); }
  if (now > endTick * 50 * 3) { console.log('TIMEOUT'); break; }
}
console.log('final ticks', wa.tick, wb.tick, 'hashes', wa.hash().toString(16), wb.hash().toString(16), 'equal:', wa.hash() === wb.hash());
console.log('stall-checks', stalls, 'max delay turns', maxDelay, 'rtt', la.rtt.toFixed(0), 'desync flags', la.desync, lb.desync, 'commands', la.log.length);
process.exit(wa.hash() === wb.hash() && (corruptAt < 0 ? la.desync < 0 && lb.desync < 0 : resynced > 0) ? 0 : 1);
