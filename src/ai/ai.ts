// Scripted AI. Plays only through commands, so it is deterministic and replayable, and doubles as the balance harness.
import { World, UNITS, BLDS, TECHS, isFighter, baseType } from '../sim/world';
import { B, TILE, HALF, MAPN, Rng, dist2, costOf, sec } from '../sim/core';
import type { Ent, Cmd } from '../sim/types';

export type Strategy = 'rush' | 'boom' | 'balanced';
export type Difficulty = 'easy' | 'normal' | 'hard';

const N = MAPN;

interface Plan { apps: number; hollowAt: number; age2Apps: number; age3Apps: number; attackSize: number; attackAfter: number; hollows: number; nurseries: number }
const PLANS: Record<Strategy, Plan> = {
  // rush: two hollows on few apprentices, raid before the Border Moons, then age up and boom behind the raids
  rush: { apps: 18, hollowAt: 6, age2Apps: 14, age3Apps: 24, attackSize: 8, attackAfter: sec(240), hollows: 2, nurseries: 2 },
  balanced: { apps: 30, hollowAt: 9, age2Apps: 17, age3Apps: 26, attackSize: 12, attackAfter: sec(420), hollows: 2, nurseries: 2 },
  boom: { apps: 32, hollowAt: 11, age2Apps: 18, age3Apps: 28, attackSize: 20, attackAfter: sec(660), hollows: 3, nurseries: 3 },
};

export class AI {
  rng: Rng;
  plan: Plan;
  attacking = false;
  attackStart = 0;
  attackPeak = 0;
  lastThink = 0;
  seenEnemy: Record<string, number> = {};
  pendingBuild: Record<string, number> = {};
  scouted = false;
  alarmOn = false;
  interval: number;
  rallyX = 0; rallyY = 0;
  raided = false; // rush: first raid launched
  hopeless = 0; // ticks spent with no army, no income and enemies at the camp
  leashed = new Map<number, number>(); // raider id -> tick it was pulled back from the enemy camp
  // attacks muster at a staging point short of the target so the patrol arrives together, not strung out by speed
  staging = false; stageX = 0; stageY = 0; stageStart = 0;

  constructor(public w: World, public p: number, public strat: Strategy = 'balanced', public diff: Difficulty = 'normal', seed = 1) {
    this.rng = new Rng(seed * 7919 + p * 31);
    this.plan = { ...PLANS[strat] };
    this.interval = diff === 'easy' ? 40 : diff === 'hard' ? 8 : 16;
    if (diff === 'easy') { this.plan.apps = Math.round(this.plan.apps * 0.7); this.plan.attackSize += 4; this.plan.attackAfter += sec(120); }
    const camp = w.get(w.players[p].campId)!;
    // rally toward the middle of the map
    const cx = N * TILE / 2;
    this.rallyX = camp.x + Math.trunc((cx - camp.x) * 22 / 100);
    this.rallyY = camp.y + Math.trunc((cx - camp.y) * 22 / 100);
  }

  think(): Cmd[] {
    const w = this.w;
    if (w.tick - this.lastThink < this.interval) return [];
    this.lastThink = w.tick;
    const P = w.players[this.p];
    if (P.defeated || w.over) return [];
    const out: Cmd[] = [];
    const me = this.p;
    const units = w.units.filter(u => u.o === me && !u.dead && !u.hide);
    const apps = units.filter(u => u.t === 'apprentice');
    const army = units.filter(u => isFighter(u.t) && !u.leader);
    const blds = w.blds.filter(b => b.o === me && !b.gone);
    const camp = w.get(P.campId);
    if (!camp) return out;
    const have = (t: string, done = false) => blds.filter(b => b.t === t && (!done || b.done)).length;
    const res = { prey: P.prey, moss: P.moss, herbs: P.herbs };
    const can = (c: any) => { const k = costOf(c); return res.prey >= k.prey && res.moss >= k.moss && res.herbs >= k.herbs; };
    const spend = (c: any) => { const k = costOf(c); res.prey -= k.prey; res.moss -= k.moss; res.herbs -= k.herbs; };
    for (const k in this.pendingBuild) if (w.tick - this.pendingBuild[k] > sec(30)) delete this.pendingBuild[k];

    // ---------- scouting ----------
    if (!this.scouted) {
      const scout = army.find(u => u.t === 'warrior');
      if (scout) out.push({ c: 'exp', p: me, ids: [scout.id] });
      this.scouted = true;
    }
    // remember what we've seen of the enemy
    for (const u of w.units) {
      if (u.o < 0 || u.o === me || u.dead || !w.visibleTo(u, me)) continue;
      const bt = baseType(u.t);
      this.seenEnemy[bt] = Math.max(this.seenEnemy[bt] || 0, 0) + 1;
    }
    for (const k in this.seenEnemy) this.seenEnemy[k] = Math.floor(this.seenEnemy[k] * 0.97);

    // ---------- threats ----------
    const threats = w.units.filter(u => u.o >= 0 && u.o !== me && !u.dead && !u.hide && w.visibleTo(u, me) && dist2(u.x, u.y, camp.x, camp.y) < (TILE * 16) ** 2);
    const threatFighters = threats.filter(u => isFighter(u.t));
    if (threatFighters.length >= 2 && army.length < threatFighters.length && !this.alarmOn) { out.push({ c: 'alarm', p: me, on: true }); this.alarmOn = true; }
    if (this.alarmOn && threatFighters.length === 0) { out.push({ c: 'alarm', p: me, on: false }); this.alarmOn = false; }
    // withdraw from a lost game rather than make the winner grind down the camp: no warriors, no prey, enemies at the camp
    const broke = P.prey < UNITS.warrior.cost.prey + 40 && army.length === 0 && apps.length <= 8;
    if (broke && threatFighters.length >= 5 && w.tick > sec(10 * 60)) this.hopeless += this.interval;
    else this.hopeless = Math.max(0, this.hopeless - this.interval * 2);
    if (this.hopeless >= sec(60) && this.diff !== 'easy') { out.push({ c: 'resign', p: me }); return out; }

    // ---------- age ups ----------
    // a rush spends on warriors, not on the Border Moons, until its first raid is out (or it has run late)
    const rushHold = this.strat === 'rush' && P.age === 1 && !this.raided && w.tick < sec(330);
    if (this.strat === 'rush' && this.raided && this.plan.apps < 30) { this.plan.apps = 30; this.plan.attackSize = Math.max(this.plan.attackSize, 8); }
    if (!P.aging && P.age < 3 && !rushHold) {
      const a = B.ages[P.age];
      const want = P.age === 1 ? apps.length >= this.plan.age2Apps : apps.length >= this.plan.age3Apps;
      if (want && !w.ageBlock(me) && can(a.cost)) { out.push({ c: 'age', p: me }); spend(a.cost); }
      else if (want && w.ageBlock(me) && P.leaderId) {
        // bring the leader home for the Clan meeting
        const L = w.get(P.leaderId);
        if (L && !L.hide && !w.onHome(L) && !(L.ord && L.ord.length)) out.push({ c: 'mv', p: me, ids: [L.id], x: camp.x + TILE * 3, y: camp.y + TILE * 3 });
      }
    }
    const wantAge = !rushHold && !P.aging && P.age < 3 && (P.age === 1 ? apps.length >= this.plan.age2Apps : apps.length >= this.plan.age3Apps);
    const ageCost = P.age < 3 ? costOf(B.ages[P.age].cost) : { prey: 0, moss: 0, herbs: 0 };
    const saving = wantAge && res.prey < ageCost.prey + 80;
    const saveHerbs = wantAge && res.herbs < ageCost.herbs + 20;

    // ---------- buildings ----------
    const reserved = new Set<number>();
    const idleBuilders = () => apps.filter(u => !reserved.has(u.id) && (!u.ord || !u.ord.length || (u.ord[0].o === 'gather' && (u.carry as number) === 0)));
    const build = (type: string, near: [number, number], maxR = 12): boolean => {
      if (this.pendingBuild[type]) return false;
      const c = BLDS[type].cost;
      if (!can(c)) return false;
      const spot = this.findSpot(type, near[0], near[1], maxR);
      if (!spot) return false;
      const pool = idleBuilders().sort((a, b) => dist2(a.x, a.y, spot[0] * TILE, spot[1] * TILE) - dist2(b.x, b.y, spot[0] * TILE, spot[1] * TILE));
      const n = type === 'den' || type === 'marker' || type === 'cache' ? 1 : 2;
      const ids = pool.slice(0, n).map(u => u.id);
      if (!ids.length) return false;
      out.push({ c: 'bld', p: me, ids, b: type, tx: spot[0], ty: spot[1] });
      spend(c);
      this.pendingBuild[type] = w.tick;
      for (const id of ids) reserved.add(id);
      return true;
    };
    const ctile: [number, number] = [camp.x >> 10, camp.y >> 10];
    // housing
    const queuedPop = blds.reduce((s, b) => s + (b.q || []).filter(q => q.u).length, 0);
    const building = (t: string) => blds.some(b => b.t === t && !b.done);
    if (P.cap < B.popCap && P.pop + queuedPop + 3 >= P.cap && !building('den')) build('den', ctile, 10);
    // training hollow
    if (!have('hollow') && (apps.length >= this.plan.hollowAt || w.tick > sec(150))) build('hollow', [ctile[0] + Math.sign(this.rallyX - camp.x) * 6, ctile[1] + Math.sign(this.rallyY - camp.y) * 6], 10);
    if (this.strat === 'rush' && P.age === 1 && have('hollow', true) === 1 && have('hollow') === 1 && apps.length >= 8 && !this.raided) build('hollow', [ctile[0] + Math.sign(this.rallyX - camp.x) * 7, ctile[1] + Math.sign(this.rallyY - camp.y) * 4], 12);
    if (P.age >= 2) {
      if (!have('medden')) build('medden', ctile, 12);
      if (!have('elders')) build('elders', ctile, 12);
      if (have('nursery') < Math.min(this.plan.nurseries, BLDS.nursery.limitByAge[P.age - 1]) && apps.length < this.plan.apps - 4 && !saving) build('nursery', ctile, 12);
      const wantHollows = Math.min(4, Math.max(Math.min(this.plan.hollows, P.age), Math.floor(res.prey / 500) + 1));
      if (have('hollow') < wantHollows && res.prey > 250 && !saving) build('hollow', [ctile[0] + Math.sign(this.rallyX - camp.x) * 7, ctile[1] + Math.sign(this.rallyY - camp.y) * 7], 12);
    }
    // caches near busy, far resources
    if (w.tick % 5 === 0 || true) {
      const gathering = new Map<number, number>();
      for (const u of apps) if (u.ord && u.ord[0] && u.ord[0].o === 'gather') gathering.set(u.ord[0].t as number, (gathering.get(u.ord[0].t as number) || 0) + 1);
      for (const r of w.ress) {
        if (r.stock! <= 0) continue;
        const gath = gathering.get(r.id) || 0;
        if (gath < 2) continue;
        let near = 1e18;
        for (const b of blds) { const dd = BLDS[b.t].dropoff; if (!dd || dd.indexOf(r.rt) < 0) continue; near = Math.min(near, w.distToBld(r.x, r.y, b)); }
        if (near > TILE * (r.rt === 'prey' ? 4 : 6)) { if (build('cache', [r.x >> 10, r.y >> 10], 4)) break; }
      }
    }
    // scent markers on our resources and toward Fourtrees
    if (P.age >= 1 && have('marker') < (P.age === 1 ? 1 : P.age === 2 ? 3 : 5) && res.moss > 60 && w.tick > sec(120)) {
      const targets: [number, number][] = [];
      const mid = N >> 1;
      targets.push([ctile[0] + Math.trunc((mid - ctile[0]) * 0.45), ctile[1] + Math.trunc((mid - ctile[1]) * 0.45)]);
      targets.push([ctile[0] + Math.trunc((mid - ctile[0]) * 0.75), ctile[1] + Math.trunc((mid - ctile[1]) * 0.75)]);
      const sun = w.map.sites.find(s => s.id === 'sunningrocks')!;
      if (P.clan === 'river' || P.clan === 'thunder') targets.push([sun.tx, sun.ty]);
      targets.push([mid - 3, mid - 3]);
      for (const t of targets) {
        if (blds.some(b => b.t === 'marker' && Math.abs(b.tx! - t[0]) < 5 && Math.abs(b.ty! - t[1]) < 5)) continue;
        if (build('marker', t, 4)) break;
      }
    }

    // ---------- training ----------
    const nurseries = blds.filter(b => b.t === 'nursery' && b.done && !(b.dis! > w.tick));
    const appTarget = rushHold ? 12 : this.plan.apps;
    for (const n of nurseries) {
      if (apps.length + queuedPop >= appTarget + 2) break;
      if ((n.q || []).length < 2 && can(UNITS.apprentice.cost) && (!saving || res.prey > B.ages[P.age].cost.prey + 50)) {
        out.push({ c: 'trn', p: me, b: n.id, u: 'apprentice', n: 1 });
        spend(UNITS.apprentice.cost);
      }
    }
    const hollows = blds.filter(b => b.t === 'hollow' && b.done);
    const ecoReady = apps.length >= Math.min(this.plan.apps, this.strat === 'rush' ? 8 : this.strat === 'boom' ? 20 : 12) || w.tick > sec(this.strat === 'boom' ? 480 : 300);
    if (ecoReady || threatFighters.length) {
      for (const h of hollows) {
        if ((h.q || []).length >= 2) continue;
        let t = this.pickUnit(P.age);
        if (!t) continue;
        let c = UNITS[t].cost;
        if (saveHerbs && costOf(c).herbs > 0 && !threatFighters.length) c = UNITS[P.age >= 2 && this.rng.int(2) ? 'guard' : 'warrior'].cost, (t as any) = null;
        const tt = t || (P.age >= 2 && this.rng.int(2) ? 'guard' : 'warrior');
        c = UNITS[tt].cost;
        if (saving && !threatFighters.length && res.prey - costOf(c).prey < ageCost.prey) continue;
        if (can(c)) { out.push({ c: 'trn', p: me, b: h.id, u: tt, n: 1 }); spend(c); }
      }
    }
    const med = blds.find(b => b.t === 'medden' && b.done);
    if (med && w.countUnits(me, 'medicine') + w.queuedUnits(me, 'medicine') < (P.age >= 3 ? 2 : 1) && can(UNITS.medicine.cost) && army.length >= 6) {
      out.push({ c: 'trn', p: me, b: med.id, u: 'medicine', n: 1 }); spend(UNITS.medicine.cost);
    }
    // ---------- research ----------
    if (!saving || res.prey > 600) {
      const order = ['hunting', 'bundles', 'battle1', 'pelt1', 'herblore', 'tracking', B.clans[P.clan].tech, 'battle2', 'pelt2', 'senior', 'cobweb', 'borders', 'travelling'];
      for (const tk of order) {
        const T = TECHS[tk];
        if (!T || P.techs[tk] || w.techQueued(me, tk)) continue;
        if (T.age > P.age || (T.clan && T.clan !== P.clan) || (T.requires && !P.techs[T.requires])) continue;
        const b = blds.find(x => x.t === T.building && x.done && !(x.q || []).length);
        if (!b) continue;
        const c = costOf(T.cost);
        if (res.prey - c.prey < 150 || res.herbs - c.herbs < (saveHerbs ? ageCost.herbs : 0) || res.moss - c.moss < 0) continue;
        out.push({ c: 'res', p: me, b: b.id, tech: tk }); spend(T.cost);
        break;
      }
    }
    // ---------- gathering ----------
    this.assignWorkers(apps.filter(u => !reserved.has(u.id)), out);

    // ---------- deputy ----------
    if (!P.deputyId && w.tick >= P.depCd && army.length >= 3) {
      const cand = army.find(u => u.t === 'warrior' || u.t === 'guard') || army[0];
      if (cand && !(cand.ord && cand.ord[0] && cand.ord[0].o === 'deputy') && !this.attacking) out.push({ c: 'dep', p: me, id: cand.id });
    }

    // ---------- army ----------
    const fighters = army.filter(u => !(u.ord && u.ord[0] && (u.ord[0].o === 'deputy' || u.ord[0].o === 'explore')));
    // clear the fox or badger guarding the nearest herbs once we have a small patrol
    if (!threatFighters.length && !this.attacking && fighters.length >= 2) {
      let beast: Ent | null = null, bd = (TILE * 40) ** 2;
      for (const x of w.units) {
        if (x.o >= 0 || x.dead) continue;
        if (!P.explored[w.ti(x.x, x.y)]) continue;
        const d = dist2(x.x, x.y, camp.x, camp.y);
        if (d < bd) { bd = d; beast = x; }
      }
      if (beast) {
        const need = beast.t === 'badger' ? 5 : 3;
        const L0 = w.get(P.leaderId);
        const squad = fighters.slice(0, need + 1);
        const ids = squad.map(u => u.id);
        if (L0 && !L0.hide && P.lives > 6) ids.push(L0.id);
        if (ids.length >= need && squad.some(u => !u.ord || !u.ord.length || u.ord[0].o === 'move')) {
          if (w.visibleTo(beast, me)) out.push({ c: 'atk', p: me, ids, t: beast.id });
          else out.push({ c: 'mv', p: me, ids, x: beast.x, y: beast.y, am: 1 });
        }
      }
    }
    const medics = units.filter(u => u.t === 'medicine');
    const L = w.get(P.leaderId);
    if (threatFighters.length) {
      const t = threatFighters[0];
      const def = fighters.filter(u => !(u.ord && u.ord[0] && u.ord[0].o === 'amove' && this.attacking));
      const ids = (this.attacking && fighters.length > threatFighters.length * 2 ? def.filter((_, i) => i % 2 === 0) : fighters).map(u => u.id);
      if (L && !L.hide) ids.push(L.id);
      if (ids.length) out.push({ c: 'mv', p: me, ids, x: t.x, y: t.y, am: 1 });
      if (!this.attacking || fighters.length < threatFighters.length * 2) this.attacking = false;
    } else if (!this.attacking) {
      const size = fighters.length;
      if (size >= this.plan.attackSize && w.tick >= this.plan.attackAfter) {
        this.attacking = true; this.attackStart = w.tick; this.attackPeak = size; this.raided = true;
        const tg = this.attackTarget();
        if (tg) {
          // 60% of the way from the rally point toward the target
          this.staging = true; this.stageStart = w.tick;
          this.stageX = this.rallyX + Math.trunc((tg[0] - this.rallyX) * 6 / 10);
          this.stageY = this.rallyY + Math.trunc((tg[1] - this.rallyY) * 6 / 10);
        }
      } else {
        // muster at the rally point
        const idle = fighters.filter(u => (!u.ord || !u.ord.length) && dist2(u.x, u.y, this.rallyX, this.rallyY) > (TILE * 5) ** 2);
        if (idle.length) out.push({ c: 'mv', p: me, ids: idle.map(u => u.id), x: this.rallyX, y: this.rallyY });
        if (L && !L.hide && (!L.ord || !L.ord.length) && !w.onHome(L)) out.push({ c: 'mv', p: me, ids: [L.id], x: camp.x + TILE * 3, y: camp.y + TILE * 3 });
      }
    }
    if (this.attacking && !threatFighters.length) {
      const target = this.attackTarget();
      const size = fighters.length;
      this.attackPeak = Math.max(this.attackPeak, size);
      if (size < Math.max(3, Math.floor(this.attackPeak * 0.35))) {
        this.attacking = false;
        out.push({ c: 'mv', p: me, ids: fighters.map(u => u.id), x: this.rallyX, y: this.rallyY });
        this.plan.attackSize = Math.min(30, this.plan.attackSize + 3);
      } else if (this.staging) {
        let near = 0;
        const r2 = (TILE * 6) ** 2;
        for (const u of fighters) if (dist2(u.x, u.y, this.stageX, this.stageY) < r2) near++;
        if (near * 4 >= fighters.length * 3 || w.tick - this.stageStart > sec(45)) this.staging = false;
        const lazy = fighters.filter(u => !u.ord || !u.ord.length || (u.ord[0].o === 'move' && dist2(u.ord[0].x as number, u.ord[0].y as number, this.stageX, this.stageY) > TILE * TILE));
        if (lazy.length) out.push({ c: 'mv', p: me, ids: lazy.map(u => u.id), x: this.stageX, y: this.stageY, am: 1 });
        if (!this.staging) out.push({ c: 'mv', p: me, ids: fighters.map(u => u.id), x: target ? target[0] : this.stageX, y: target ? target[1] : this.stageY, am: 1 });
      } else if (target) {
        const lazy = fighters.filter(u => (!u.ord || !u.ord.length || (u.ord[0].o === 'move')) && !(w.tick - (this.leashed.get(u.id) ?? -1e9) < sec(4)));
        if (lazy.length) out.push({ c: 'mv', p: me, ids: lazy.map(u => u.id), x: target[0], y: target[1], am: 1 });
        // early raiders stay out of reach of the enemy camp's thorns
        if (this.raiding()) {
          for (const o of w.players) {
            if (o.id === me || o.defeated) continue;
            const ec = w.get(o.campId);
            if (!ec) continue;
            const back: number[] = [];
            for (const u of fighters) {
              if (w.distToBld(u.x, u.y, ec) >= TILE * 3) continue;
              // keep fighting cats that are fighting; pull back the ones chasing apprentices into the thorns or clawing at dens
              const tg = w.get(u.tgt);
              if (tg && !tg.dead && tg.k === 1 && isFighter(tg.t)) continue;
              back.push(u.id);
            }
            if (!back.length) continue;
            for (const id of back) this.leashed.set(id, w.tick);
            const dx = this.rallyX - ec.x, dy = this.rallyY - ec.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            out.push({ c: 'mv', p: me, ids: back, x: ec.x + Math.trunc(dx / d * TILE * 8), y: ec.y + Math.trunc(dy / d * TILE * 8) });
          }
        }
        // leader joins attacks in the Battle Moons
        if (L && !L.hide && P.age >= 3 && P.lives > 3 && (!L.ord || !L.ord.length)) out.push({ c: 'mv', p: me, ids: [L.id], x: target[0], y: target[1], am: 1 });
        if (medics.length && fighters.length) {
          const c = fighters[0];
          out.push({ c: 'mv', p: me, ids: medics.map(m => m.id), x: c.x - TILE, y: c.y - TILE });
        }
      }
    }
    return out;
  }

  raidIdx = 0;
  wild: Ent[] = [];
  raiding(): boolean { return this.strat === 'rush' && this.w.players[this.p].age <= 2 && this.w.tick < sec(15 * 60); }
  attackTarget(): [number, number] | null {
    const w = this.w;
    // early raids go for the apprentices at the hunting grounds, not into the camp's thorns
    if (this.raiding()) {
      let best: Ent | null = null, bd = 1e18;
      const me = w.get(w.players[this.p].campId)!;
      for (const u of w.units) {
        if (u.o < 0 || u.o === this.p || u.dead || u.hide || u.t !== 'apprentice' || !w.visibleTo(u, this.p)) continue;
        const ec = w.get(w.players[u.o].campId);
        if (ec && w.distToBld(u.x, u.y, ec) < TILE * 3) continue;
        const d = dist2(u.x, u.y, me.x, me.y);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) return [best.x, best.y];
      for (const o of w.players) {
        if (o.id === this.p || o.defeated) continue;
        const grounds = w.ress.filter(r => r.sub === 'ground' && r.home === ['river', 'wind', 'shadow', 'thunder'].indexOf(o.clan));
        if (grounds.length) {
          const g = grounds[Math.floor(w.tick / sec(40) + this.raidIdx) % grounds.length];
          return [g.x, g.y];
        }
      }
    }
    // nearest known enemy building, preferring the camp
    let best: Ent | null = null, bd = 1e18;
    const P = w.players[this.p];
    const camp = w.get(P.campId)!;
    for (const b of w.blds) {
      if (b.gone || b.o < 0 || b.o === this.p || b.t === 'marker') continue;
      if (!((b.seen as number) & (1 << this.p))) continue;
      const d = dist2(b.x, b.y, camp.x, camp.y) - (b.t === 'camp' ? (TILE * 10) ** 2 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) return [best.x, best.y];
    // head for the enemy home territory
    for (const o of w.players) {
      if (o.id === this.p || o.defeated) continue;
      const c = w.map.camps[o.clan];
      return [c.tx * TILE + HALF, c.ty * TILE + HALF];
    }
    return null;
  }

  pickUnit(age: number): string | null {
    const P = this.w.players[this.p];
    if (age < 2) return 'warrior';
    const se = this.seenEnemy;
    const runners = (se.runner || 0), guards = (se.guard || 0), stalkers = (se.stalker || 0), warriors = (se.warrior || 0);
    const r = this.rng.int(100);
    const uniq = B.clans[P.clan].unique;
    const herbsOk = P.herbs >= 60;
    // counter what we've seen, with variety
    if (runners > guards + stalkers && r < 60) return 'guard';
    if (guards > runners + stalkers && r < 60 && herbsOk) return age >= 3 && UNITS[uniq].base === 'stalker' ? uniq : 'stalker';
    if (stalkers > guards + runners && r < 60 && herbsOk) return age >= 3 && UNITS[uniq].base === 'runner' ? uniq : 'runner';
    if (age >= 3 && r < 35 && (UNITS[uniq].cost.herbs || 0) <= P.herbs) return uniq;
    if (r < 40) return 'warrior';
    if (r < 60) return 'guard';
    if (r < 80 && herbsOk) return 'runner';
    if (herbsOk) return 'stalker';
    return warriors > 4 ? 'guard' : 'warrior';
  }

  assignWorkers(apps: Ent[], out: Cmd[]) {
    const w = this.w, me = this.p, P = w.players[me];
    const want = P.age === 1 ? { prey: 66, moss: 34, herbs: 0 } : P.age === 2 ? { prey: 52, moss: 20, herbs: 28 } : { prey: 55, moss: 12, herbs: 33 };
    if (P.age === 1 && this.w.countBlds(me, 'hollow') > 0 && apps.length > 12) { want.prey = 60; want.moss = 25; want.herbs = 15; }
    // a rush needs moss for its hollows before anything else
    if (this.strat === 'rush' && P.age === 1 && !this.raided) {
      if (this.w.countBlds(me, 'hollow') < 2) { want.prey = 50; want.moss = 50; want.herbs = 0; } else { want.prey = 85; want.moss = 15; want.herbs = 0; }
    }
    if (P.moss > 500) { want.prey += want.moss - 8; want.moss = 8; }
    if (P.herbs > 400) { want.prey += want.herbs - 10; want.herbs = 10; }
    const count = { prey: 0, moss: 0, herbs: 0 };
    const idle: Ent[] = [];
    const perRes: Record<number, number> = {};
    for (const u of apps) {
      const o = u.ord && u.ord[0];
      if (o && o.o === 'gather') {
        const r = w.get(o.t);
        // leave adders and rats before they kill the apprentice
        const risky = r && r.hazard && r.immune !== P.clan && u.hp <= (r.hazard as number) * 100 * 2;
        if (r && !risky && w.resUsable(r, u)) { count[r.rt as 'prey']++; perRes[r.id] = (perRes[r.id] || 0) + 1; continue; }
      }
      if (!o || (o.o === 'gather')) idle.push(u);
      else if (o.o === 'build' || o.o === 'repair' || o.o === 'shelter') continue;
    }
    const total = apps.length || 1;
    this.wild = w.units.filter(x => x.o < 0 && !x.dead);
    for (const u of idle) {
      let best: 'prey' | 'moss' | 'herbs' = 'prey', bd = -1e9;
      for (const k of ['prey', 'moss', 'herbs'] as const) {
        const deficit = want[k] * total / 100 - count[k];
        if (deficit > bd) { bd = deficit; best = k; }
      }
      const r = this.pickRes(u, best, perRes) || this.pickRes(u, 'prey', perRes) || this.pickRes(u, 'moss', perRes);
      if (!r) continue;
      perRes[r.id] = (perRes[r.id] || 0) + 1;
      count[r.rt as 'prey']++;
      out.push({ c: 'gat', p: me, ids: [u.id], t: r.id });
      // optimistic local hint so the next idle cat picks differently
    }
  }
  pickRes(u: Ent, rt: string, perRes: Record<number, number>): Ent | null {
    const w = this.w;
    const P = w.players[this.p];
    const camp = w.get(P.campId)!;
    let best: Ent | null = null, bs = 1e18;
    for (const r of w.ress) {
      if (r.rt !== rt || !w.resUsable(r, u)) continue;
      if (!P.explored[w.ti(r.x, r.y)]) continue;
      const n = perRes[r.id] || 0;
      const lim = r.sub === 'ground' ? 5 : r.sub === 'fish' ? 3 : 6;
      if (n >= lim) continue;
      if (r.hazard && r.immune !== P.clan && u.hp <= r.hazard * 100 * 2) continue;
      // avoid guarded patches unless the guard is dead
      if (r.sub === 'herb' && this.wild.some(x => dist2(x.x, x.y, r.x, r.y) < (TILE * 5) ** 2)) continue;
      // avoid resources deep in enemy land
      const dCamp = dist2(r.x, r.y, camp.x, camp.y);
      let enemyNear = false;
      for (const o of w.players) if (o.id !== this.p && !o.defeated) { const c = w.get(o.campId); if (c && dist2(r.x, r.y, c.x, c.y) < dCamp) enemyNear = true; }
      if (enemyNear) continue;
      const s = dist2(u.x, u.y, r.x, r.y) + dCamp / 3 + n * (TILE * 3) ** 2;
      if (s < bs) { bs = s; best = r; }
    }
    return best;
  }

  findSpot(type: string, cx: number, cy: number, maxR: number): [number, number] | null {
    const w = this.w;
    const sz = BLDS[type].size;
    const P = w.players[this.p];
    for (let r = 2; r <= maxR; r++) {
      const cands: [number, number][] = [];
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        cands.push([x, y]);
      }
      // deterministic shuffle
      for (let i = cands.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
      for (const [x, y] of cands) {
        const tx = x - (sz >> 1), ty = y - (sz >> 1);
        if (w.canPlace(this.p, type, tx, ty)) continue;
        // keep a one-tile walkway around everything except markers
        if (type !== 'marker' && !this.margin(tx, ty, sz)) continue;
        if (!P.claim[y * N + x] && type !== 'marker' && type !== 'cache') continue;
        return [tx, ty];
      }
    }
    return null;
  }
  margin(tx: number, ty: number, sz: number): boolean {
    const w = this.w;
    const pass = w.pass[this.p];
    for (let y = ty - 1; y <= ty + sz; y++) for (let x = tx - 1; x <= tx + sz; x++) {
      if (x >= tx && x < tx + sz && y >= ty && y < ty + sz) continue;
      if (x < 0 || y < 0 || x >= N || y >= N) return false;
      if (w.bldGrid[y * N + x]) return false;
      if (!pass[y * N + x]) return false;
      if (w.resGrid[y * N + x]) return false;
    }
    return true;
  }
}
