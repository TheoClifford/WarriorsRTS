// Economy benchmark (spec section 11): one AI, no opponent interference.
import { World, isFighter } from '../src/sim/world';
import { AI } from '../src/ai/ai';
import { sec } from '../src/sim/core';
const clan = (process.argv[2] || 'thunder') as any, strat = (process.argv[3] || 'balanced') as any;
const w = new World({ seed: 5, players: [{ clan, name: 'A', ai: true }, { clan: clan === 'wind' ? 'river' : 'wind', name: 'B', ai: true }] });
const ai = new AI(w, 0, strat, 'normal', 5);
const marks = [2, 5, 8, 12, 16].map(m => sec(m * 60));
const target: Record<number, string> = { 2: '12 / 1 / Hollow going up', 5: '18-20 / 2-4 / Age II', 8: '26-28 / 10-14 / 2 nurseries', 12: '28-32 / 18-24 / Age III', 16: '28-32 / 28-32 / cap' };
while (w.tick <= marks[marks.length - 1]) {
  w.step(ai.think());
  if (marks.includes(w.tick)) {
    const us = w.units.filter(u => u.o === 0 && !u.dead);
    const P = w.players[0];
    const apps = us.filter(u => u.t === 'apprentice').length, army = us.filter(u => isFighter(u.t) && !u.leader).length;
    const m = w.tick / 1200;
    console.log(`${String(m).padStart(2)}:00  apps ${String(apps).padStart(2)}  fighters ${String(army).padStart(2)}  age ${P.age}${P.aging ? '(aging)' : ''}  hollows ${w.countBlds(0, 'hollow', true)} nurseries ${w.countBlds(0, 'nursery', true)} caches ${w.countBlds(0,'cache',true)} pop ${P.pop}/${P.cap}  bank P${P.prey} M${P.moss} H${P.herbs}   target: ${target[m]}`);
  }
}
console.log('gathered', JSON.stringify(w.players[0].stats.gathered), 'age times', w.players[0].stats.ageTimes.map(t => (t / 1200).toFixed(1)).join(','));
