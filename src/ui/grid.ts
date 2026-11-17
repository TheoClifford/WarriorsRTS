// The 5x3 command grid (AoE DE layout: Q W E R T / A S D F G / Z X C V B).
import { B, costOf } from '../sim/core';
import { UNITS, BLDS, TECHS, isFighter } from '../sim/world';
import type { Ent } from '../sim/types';
import { ICON } from './icons';
import type { Game } from './game';

export const KEYS = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b'];
export interface Btn {
  icon: string; title: string; desc?: string; cost?: any; sec?: number; strong?: string; weak?: string;
  req?: string | null; on?: boolean; count?: number; prog?: number; act: (shift: boolean) => void;
}

export function buildGrid(g: Game): (Btn | null)[] {
  const w = g.world, me = g.me;
  const slots: (Btn | null)[] = new Array(15).fill(null);
  if (me < 0) return slots;
  const P = w.players[me];
  const sel = g.selected();
  const own = sel.filter(e => e.o === me);
  if (!own.length) return slots;
  const units = own.filter(e => e.k === 1) as Ent[];
  const set = (k: string, b: Btn) => { slots[KEYS.indexOf(k)] = b; };
  const ids = () => units.map(u => u.id);
  const ageReq = (a?: number) => (a && P.age < a ? 'Requires the ' + B.ages[a - 1].name : null);
  const afford = (c: any) => { const k = costOf(c); return P.prey >= k.prey && P.moss >= k.moss && P.herbs >= k.herbs; };
  if (units.length) {
    const apps = units.filter(u => u.t === 'apprentice');
    const fighters = units.filter(u => isFighter(u.t));
    set('a', { icon: ICON.amove, title: 'Attack-move', desc: 'Move, fighting any enemy met on the way. (A, then click)', act: () => g.beginAttackMove() });
    set('s', { icon: ICON.stop, title: 'Stop', act: () => g.cmd({ c: 'stop', ids: ids() }) });
    set('b', { icon: ICON.alarm, title: P.alarm ? 'All clear' : 'Alarm call', desc: P.alarm ? 'Send sheltering apprentices back to work.' : 'Every apprentice runs to the camp to shelter. Each sheltered apprentice adds to the camp\'s defence.', on: P.alarm, act: () => g.cmd({ c: 'alarm', on: !P.alarm }) });
    if (units.length === 1 && !units[0].leader) set('v', { icon: ICON.delete, title: 'Send away', desc: 'Remove this cat from your Clan.', act: () => g.cmd({ c: 'del', id: units[0].id }) });
    if (apps.length && !fighters.length) {
      const bld = (k: string, t: string) => {
        const bd = BLDS[t];
        let req = ageReq(bd.age);
        if (!req && bd.clan && bd.clan !== P.clan) return;
        if (!req && bd.tech && !P.techs[bd.tech]) req = 'Requires ' + TECHS[bd.tech].name;
        if (!req && t === 'nursery' && w.countBlds(me, 'nursery') >= bd.limitByAge[P.age - 1]) req = 'Nursery limit reached for this age';
        if (!req && t === 'marker' && w.countBlds(me, 'marker') >= bd.max) req = 'At most ' + bd.max + ' scent markers';
        set(k, { icon: g.hud.bldIcon(t), title: bd.name, desc: bd.desc + (bd.pop ? ' ' : ''), cost: bd.cost, sec: bd.sec, req, act: () => g.beginPlace(t) });
      };
      bld('q', 'den'); bld('w', 'cache'); bld('e', 'hollow'); bld('r', 'marker'); bld('t', 'nursery');
      bld('d', 'medden'); bld('f', 'elders'); bld('g', 'barrier'); bld('z', 'gorse'); bld('x', 'tunnel');
      set('c', { icon: ICON.shelter, title: 'Shelter in camp', desc: 'Hide inside the camp. Up to 10 apprentices can shelter.', act: (sh) => g.cmd({ c: 'shl', ids: ids(), q: sh }) });
    }
    if (fighters.length) {
      const st = fighters[0].stance | 0;
      set('q', { icon: ICON.aggressive, title: 'Aggressive', desc: 'Chase and fight any enemy in sight.', on: st === 0, act: () => g.cmd({ c: 'stn', ids: ids(), s: 0 }) });
      set('w', { icon: ICON.defensive, title: 'Defensive', desc: 'Fight nearby enemies, then return.', on: st === 1, act: () => g.cmd({ c: 'stn', ids: ids(), s: 1 }) });
      set('e', { icon: ICON.stand, title: 'Stand ground', desc: 'Hold still and strike only what comes close. Still cats in cover stay hidden: the ambusher\'s stance.', on: st === 2, act: () => g.cmd({ c: 'stn', ids: ids(), s: 2 }) });
      set('d', { icon: ICON.explore, title: 'Scout', desc: 'Roam into unexplored land on its own.', act: () => g.cmd({ c: 'exp', ids: ids() }) });
      if (units.length === 1 && !units[0].leader && !units[0].dep) {
        const dep = w.get(P.deputyId);
        let req: string | null = null;
        if (dep && !dep.dead) req = 'Your Clan already has a deputy';
        else if (w.tick < P.depCd) req = 'A new deputy can be named after a short while';
        set('r', { icon: ICON.deputy, title: 'Appoint deputy', desc: 'Walk to the camp and be named deputy. The deputy has 30% more HP, a half-strength leader aura, and becomes leader if the leader loses their last life.', req, act: () => g.cmd({ c: 'dep', id: units[0].id }) });
      }
      if (P.clan === 'wind') set('t', { icon: ICON.tunnelgo, title: 'Use tunnel', desc: 'Right-click your own tunnel entrance to travel through it in 5 s.', req: P.techs.tunnels ? null : 'Requires Tunnels', act: () => g.hud.log('Right-click one of your tunnel entrances.', '') });
    }
    return slots;
  }
  // a building
  const b = own[0] as Ent;
  if (!b.done) { set('v', { icon: ICON.delete, title: 'Cancel', desc: 'Cancel construction (refunded if not yet started).', act: () => g.cmd({ c: 'del', id: b.id }) }); return slots; }
  const train = (k: string, t: string) => {
    const ut = UNITS[t];
    if (ut.clan && ut.clan !== P.clan) return;
    let req = ageReq(ut.age);
    if (!req && t === 'medicine') { const lim = P.age >= 3 ? 2 : 1; if (w.countUnits(me, 'medicine') + w.queuedUnits(me, 'medicine') >= lim) req = 'Your Clan keeps ' + (lim === 1 ? 'one medicine cat (two in the Battle Moons)' : 'two medicine cats'); }
    const n = (b.q || []).filter(q => q.u === t).length;
    set(k, { icon: g.hud.unitIcon(t), title: ut.name, desc: ut.desc, cost: ut.cost, sec: ut.sec, strong: ut.strong, weak: ut.weak, req, count: n || undefined, act: (sh) => g.cmd({ c: 'trn', b: b.id, u: t, n: sh ? 5 : 1 }) });
  };
  const tech = (k: string, t: string) => {
    const T = TECHS[t];
    if (T.clan && T.clan !== P.clan) return;
    if (P.techs[t]) return;
    let req = ageReq(T.age);
    if (!req && T.requires && !P.techs[T.requires]) req = 'Requires ' + TECHS[T.requires].name;
    const queued = w.techQueued(me, t);
    set(k, { icon: ICON[t] || ICON.more, title: T.name, desc: T.desc, cost: T.cost, sec: T.sec, req: queued ? 'Being learned' : req, on: queued, act: () => g.cmd({ c: 'res', b: b.id, tech: t }) });
  };
  switch (b.t) {
    case 'camp': {
      if (P.age < 3) {
        const a = B.ages[P.age];
        const block = P.aging ? 'The Clan meeting is under way' : w.ageBlock(me);
        set('q', { icon: P.age === 1 ? ICON.age2 : ICON.age3, title: 'Call a Clan meeting: ' + a.name, desc: P.age === 1 ? 'Unlocks Guards, Runners, Stalkers, the medicine den, elders\' den, upgrades, a second nursery and barriers. Pauses apprentice training while it runs.' : 'Unlocks your Clan\'s unique cat and technology, the second medicine cat, a third nursery and the last upgrades.', cost: a.cost, sec: a.sec, req: block, on: P.aging, act: () => g.cmd({ c: 'age' }) });
      }
      set('w', { icon: ICON.unshelter, title: 'Release sheltering apprentices', desc: (b.shel || []).length + ' apprentices sheltering.', req: (b.shel || []).length ? null : 'No one is sheltering', act: () => g.cmd({ c: 'unshl' }) });
      set('b', { icon: ICON.alarm, title: P.alarm ? 'All clear' : 'Alarm call', desc: 'Every apprentice runs to the camp to shelter.', on: P.alarm, act: () => g.cmd({ c: 'alarm', on: !P.alarm }) });
      break;
    }
    case 'nursery': train('q', 'apprentice'); break;
    case 'hollow': {
      train('q', 'warrior'); train('w', 'guard'); train('e', 'runner'); train('r', 'stalker'); train('t', B.clans[P.clan].unique);
      tech('a', P.techs.battle1 ? 'battle2' : 'battle1'); tech('s', P.techs.pelt1 ? 'pelt2' : 'pelt1'); tech('d', 'senior'); tech('f', B.clans[P.clan].tech);
      break;
    }
    case 'medden': train('q', 'medicine'); tech('a', 'herblore'); tech('s', 'cobweb'); tech('d', 'travelling'); break;
    case 'elders': tech('a', 'hunting'); tech('s', 'bundles'); tech('d', 'tracking'); tech('f', 'borders'); break;
  }
  if (b.t !== 'camp' && b.t !== 'nursery') set('v', { icon: ICON.delete, title: 'Abandon', desc: 'Tear down this den.', act: () => g.cmd({ c: 'del', id: b.id }) });
  void afford;
  return slots;
}
