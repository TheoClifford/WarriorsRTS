// Headless AI vs AI match.
import { World, isFighter } from '../src/sim/world';
import { AI, Strategy } from '../src/ai/ai';
import { CLANS, sec } from '../src/sim/core';
const [c0='thunder', c1='wind', s0='balanced', s1='balanced', seedS='1', minsS='25'] = process.argv.slice(2);
const seed = +seedS;
const w = new World({ seed, players: [{ clan: c0 as any, name: 'A', ai: true }, { clan: c1 as any, name: 'B', ai: true }] });
const ais = [new AI(w, 0, s0 as Strategy, 'normal', seed), new AI(w, 1, s1 as Strategy, 'normal', seed + 1)];
const t0 = Date.now();
let maxTick = 0;
const fmt = (t: number) => `${Math.floor(t / 1200)}:${String(Math.floor(t / 20) % 60).padStart(2, '0')}`;
let lastLog = 0;
while (!w.over && w.tick < sec(+minsS * 60)) {
  const cmds = ais.flatMap(a => a.think());
  const s = Date.now();
  w.step(cmds);
  maxTick = Math.max(maxTick, Date.now() - s);
  if (w.tick - lastLog >= sec(60)) {
    lastLog = w.tick;
    const line = w.players.map(p => {
      const us = w.units.filter(u => u.o === p.id && !u.dead);
      const apps = us.filter(u => u.t === 'apprentice').length, army = us.filter(u => isFighter(u.t) && !u.leader).length;
      return `${p.clan[0].toUpperCase()} age${p.age} apps ${String(apps).padStart(2)} army ${String(army).padStart(2)} pop ${p.pop}/${p.cap} P${p.prey} M${p.moss} H${p.herbs} lives ${p.lives}`;
    }).join(' | ');
    console.log(fmt(w.tick), line);
  }
}
const evs = w.events.filter(e => ['agedone','defeat','victory','leader'].includes(e.kind) && e.p !== 1);
console.log('--- result:', w.over ? `winner ${w.winner} (${w.winner>=0?w.players[w.winner].clan:'-'})` : 'no result', 'at', fmt(w.tick));
console.log('ages:', w.players.map(p => p.clan + ' ' + p.stats.ageTimes.map(fmt).join(',')).join(' ; '));
console.log('first fight:', fmt(Math.max(0, w.players[0].stats.firstFight)), ' stats:', JSON.stringify(w.players.map(p => ({ k: p.stats.killed, l: p.stats.lost, g: p.stats.gathered, t: p.stats.trained }))));
console.log(`sim time ${(Date.now() - t0)}ms for ${w.tick} ticks, avg ${((Date.now() - t0) / w.tick).toFixed(3)}ms/tick, worst ${maxTick}ms`);
