// Trace one AI game: a line every 30 s per player, for balance diagnosis.
import { World, isFighter } from '../src/sim/world';
import { AI, Strategy } from '../src/ai/ai';
import { CLANS, sec } from '../src/sim/core';
const [c0, c1, s0, s1, seedS, every] = process.argv.slice(2);
const w = new World({ seed: +(seedS || 1), players: [{ clan: c0 as any, name: 'A', ai: true }, { clan: c1 as any, name: 'B', ai: true }] });
const ais = [new AI(w, 0, s0 as Strategy, 'normal', +seedS), new AI(w, 1, s1 as Strategy, 'normal', +seedS + 7)];
let pend: any[] = [];
const step = sec(+(every || 30));
while (!w.over && w.tick < sec(35 * 60)) {
  const c = pend; pend = []; w.step(c); for (const a of ais) pend.push(...a.think());
  if (w.tick % step === 0) {
    const rows = w.players.map(p => {
      let apps = 0, army = 0, outside = 0; const kinds: Record<string, number> = {};
      for (const u of w.units) if (u.o === p.id && !u.dead) { if (u.t === 'apprentice') { apps++; if (u.hide) outside++; } else if (isFighter(u.t) && !u.leader) { army++; kinds[u.t] = (kinds[u.t] || 0) + 1; } }
      const L = w.get(p.leaderId);
      const ai = ais[p.id];
      const hol = w.blds.filter(b => b.o === p.id && b.t === 'hollow' && !b.gone).map(b => b.done ? 'H' : 'h').join('');
      return `${p.clan[0]}${ai.strat[0]} ${hol} moss ${p.moss | 0} age${p.age}${p.aging ? '+' : ''} apps ${apps}(${outside} hid) army ${army} ${JSON.stringify(kinds).replace(/"/g, '')} prey ${p.prey | 0}/${p.stats.gathered.prey} herbs ${p.herbs | 0} k${p.stats.killed} l${p.stats.lost} lives ${p.lives}${L && !L.dead ? '' : ' (leader down)'}${p.alarm ? ' ALARM' : ''}${ai.attacking ? ' ATK' + ai.plan.attackSize : ''}`;
    });
    console.log(`${(w.tick / 1200).toFixed(1).padStart(5)}m | ${rows.join(' | ')}`);
  }
}
console.log('winner', w.winner, 'at', (w.tick / 1200).toFixed(1));
