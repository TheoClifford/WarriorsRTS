// The deterministic simulation. Only commands change it; both peers apply the same commands on the same tick.
import {
  B, TILE, HALF, TPS, MAPN, HP, Rng, Hasher, sec, tiles, speedPerTick, isqrt, dist, dist2, octant, costOf, hash2, clamp,
  T_OPEN, T_UNDER, T_TREES, T_MOOR, T_MARSH, T_RIVER, T_FORD, T_ROAD, T_ROCK, T_FLAT, T_FENCE, T_TUNNEL, ClanId,
} from './core';
import { buildMap, MapDef } from './map';
import { Pathfinder, lineWalkable, smooth, nearestPassable } from './path';
import { makeName, prefixOf, CANON_LEADERS, DEATH_LINES } from './names';
import type { Ent, Order, Player, GameEvent, Cmd, MatchSettings, Monster, Corpse, Fx, QItem } from './types';

const N = MAPN;
const NN = N * N;
export const UNITS: Record<string, any> = B.units;
export const BLDS: Record<string, any> = B.buildings;
export const TECHS: Record<string, any> = B.techs;
export const CB: any = B.combat;

const SPEED: Record<string, number> = {};
const RADIUS: Record<string, number> = {};
for (const k in UNITS) {
  SPEED[k] = speedPerTick(UNITS[k].speed);
  const bt = (UNITS[k].base as string) || k;
  RADIUS[k] = bt === 'apprentice' ? 210 : bt === 'guard' ? 270 : k === 'leader' ? 280 : k === 'badger' ? 320 : k === 'fox' ? 260 : 240;
}

// Field-of-view cache. Terrain never changes, so the set of tiles the ray caster reaches from a tile with a
// given radius is fixed: compute it once with the exact same rays, then reuse the flat list.
const FOV_CACHE = new Map<string, Map<number, Int32Array>>();
const fovScratch = new Uint32Array(MAPN * MAPN);
let fovStamp = 0;
function fovList(cache: Map<number, Int32Array>, T: Uint8Array, cx: number, cy: number, R: number): Int32Array {
  R = Math.min(14, R);
  const key = (cy * N + cx) * 16 + R;
  const hit = cache.get(key);
  if (hit) return hit;
  fovStamp++;
  const out: number[] = [];
  const mark = (i: number) => { if (fovScratch[i] !== fovStamp) { fovScratch[i] = fovStamp; out.push(i); } };
  if (cx >= 0 && cy >= 0 && cx < N && cy < N) mark(cy * N + cx);
  const rays = RAYS[R];
  for (let k = 0; k < rays.length; k++) {
    const ray = rays[k];
    for (let j = 0; j < ray.length; j += 2) {
      const x = cx + ray[j], y = cy + ray[j + 1];
      if (x < 0 || y < 0 || x >= N || y >= N) break;
      const i = y * N + x;
      mark(i);
      const t = T[i];
      if (t === T_TREES || t === T_ROCK) break;
    }
  }
  const arr = Int32Array.from(out);
  cache.set(key, arr);
  return arr;
}
const DISC_CACHE = new Map<number, Int32Array>();
function discList(cx: number, cy: number, r: number): Int32Array {
  const key = (cy * N + cx) * 16 + r;
  const hit = DISC_CACHE.get(key);
  if (hit) return hit;
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r) out.push(y * N + x);
  }
  const arr = Int32Array.from(out);
  DISC_CACHE.set(key, arr);
  return arr;
}

const GOX = [1, 1, 0, -1, -1, -1, 0, 1], GOY = [0, 1, 1, 1, 0, -1, -1, -1];
function passAt(pass: Uint8Array, x: number, y: number): boolean {
  const tx = x >> 10, ty = y >> 10;
  return tx >= 0 && ty >= 0 && tx < N && ty < N && pass[ty * N + tx] !== 0;
}
export function baseType(t: string): string { const u = UNITS[t]; return (u && u.base) || t; }
export function isFighter(t: string) { const u = UNITS[t]; return !!u && u.role === 'fighter'; }

// ray tables for line of sight, radius 1..14
const RAYS: number[][][] = [];
(function buildRays() {
  for (let R = 0; R <= 14; R++) {
    const rays: number[][] = [];
    const ends: [number, number][] = [];
    for (let i = -R; i <= R; i++) { ends.push([i, -R], [i, R]); if (i !== -R && i !== R) ends.push([-R, i], [R, i]); }
    for (const [ex, ey] of ends) {
      const ray: number[] = [];
      // Bresenham from 0,0 to ex,ey
      let x = 0, y = 0;
      const dx = Math.abs(ex), dy = -Math.abs(ey), sx = ex > 0 ? 1 : -1, sy = ey > 0 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        if (x === ex && y === ey) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
        if (x * x + y * y > R * R + R) break;
        ray.push(x, y);
      }
      rays.push(ray);
    }
    RAYS.push(rays);
  }
})();

export class World {
  map: MapDef;
  settings: MatchSettings;
  tick = 0;
  rng: Rng;
  nextId = 1;
  ents: Ent[] = [];
  byId = new Map<number, Ent>();
  units: Ent[] = [];
  blds: Ent[] = [];
  ress: Ent[] = [];
  players: Player[] = [];
  events: GameEvent[] = [];
  fx: Fx[] = [];
  corpses: Corpse[] = [];
  pass: Uint8Array[] = [];   // per player
  passWild!: Uint8Array;
  bldGrid = new Int32Array(NN);
  resGrid = new Int32Array(NN);
  frozen = false;
  season = 0;
  monsters: Monster[] = [];
  nextMonster = 0; monsterWarned = false;
  roadPts: number[] = []; roadLen: number[] = []; roadTotal = 0;
  pathQueue: number[] = [];
  pf = new Pathfinder();
  over = false; winner = -1;
  claimDirty = true;
  names = new Set<string>();
  // spatial hash
  cellHead = new Int32Array(NN);
  cellNext = new Int32Array(1024);
  cellUnits: Ent[] = [];
  cellCount = 0;
  fov!: Map<number, Int32Array>;
  anyGone = false;
  dropCache: (Ent[] | null)[] = [];

  constructor(settings: MatchSettings) {
    this.settings = settings;
    this.rng = new Rng(settings.seed);
    this.map = buildMap();
    {
      const h = new Hasher();
      for (let i = 0; i < NN; i++) h.add(this.map.terrain[i]);
      const k = String(h.get());
      if (!FOV_CACHE.has(k)) FOV_CACHE.set(k, new Map());
      this.fov = FOV_CACHE.get(k)!;
    }
    for (let i = 0; i < this.map.road.length; i++) {
      this.roadPts.push(Math.round(this.map.road[i][0] * TILE / 10), Math.round(this.map.road[i][1] * TILE / 10));
    }
    this.roadLen.push(0);
    for (let i = 1; i < this.map.road.length; i++) {
      const d = dist(this.roadPts[i * 2 - 2], this.roadPts[i * 2 - 1], this.roadPts[i * 2], this.roadPts[i * 2 + 1]);
      this.roadTotal += d; this.roadLen.push(this.roadTotal);
    }
    this.nextMonster = sec(25) + this.rng.int(sec(15));
    // players
    settings.players.forEach((ps, i) => {
      this.players.push({
        id: i, clan: ps.clan, name: ps.name, ai: !!ps.ai,
        prey: B.start.prey, moss: B.start.moss, herbs: B.start.herbs,
        age: 1, aging: false, techs: {}, pop: 0, cap: 0,
        campId: 0, leaderId: 0, lives: 9, deputyId: 0, depCd: 0, successionId: 0, needSuccession: false,
        auraOff: 0, alarm: false, defeated: false, resigned: false,
        claim: new Uint8Array(NN), vis: new Uint8Array(NN), explored: new Uint8Array(NN),
        sunAcc: 0, lastTrespass: -9999, warnedSnow: -1,
        stats: { gathered: { prey: 0, moss: 0, herbs: 0 }, trained: 0, lost: 0, killed: 0, built: 0, ageTimes: [0], firstFight: -1, timeline: [], livesLost: 0 },
      });
    });
    // resources
    for (const r of this.map.resources) {
      const e = this.add({
        id: 0, k: 3, t: r.sub, o: -1, x: r.tx * TILE + HALF, y: r.ty * TILE + HALF, hp: 0, mhp: 0, dead: 0, gone: false,
        rt: r.rt, sub: r.sub, stock: r.stock, cap: r.cap, racc: 0, fallow: 0, r: Math.round(r.r * TILE / 10),
        hazard: r.hazard || 0, immune: r.immune, moor: !!r.moor, rname: r.name, critter: r.critter, home: r.home,
      } as Ent);
      const rt = Math.ceil(r.r / 10);
      for (let y = r.ty - rt; y <= r.ty + rt; y++) for (let x = r.tx - rt; x <= r.tx + rt; x++) {
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if ((x - r.tx) * (x - r.tx) + (y - r.ty) * (y - r.ty) <= (r.r / 10) * (r.r / 10)) this.resGrid[y * N + x] = e.id;
      }
    }
    for (const w of this.map.wild) {
      const u = this.spawnUnit(-1, w.type, w.tx * TILE + HALF, w.ty * TILE + HALF);
      u.den = [u.x, u.y];
    }
    // camps
    for (const p of this.players) {
      const cc = this.map.camps[p.clan], nc = this.map.nursery[p.clan], st = this.map.start[p.clan];
      const camp = this.placeBuilding(p.id, 'camp', cc.tx - 2, cc.ty - 2, true);
      p.campId = camp.id;
      this.placeBuilding(p.id, 'nursery', nc.tx - 1, nc.ty - 1, true);
      const leaderName = this.settings.canonLeaders !== false ? CANON_LEADERS[p.clan] : makeName(this.rng, 'star', this.names);
      this.names.add(leaderName.toLowerCase());
      const L = this.spawnUnit(p.id, 'leader', st.leader[0] * TILE + HALF, st.leader[1] * TILE + HALF, leaderName);
      L.leader = true; p.leaderId = L.id;
      this.spawnUnit(p.id, 'warrior', st.scout[0] * TILE + HALF, st.scout[1] * TILE + HALF);
      for (let i = 0; i < B.start.apprentices; i++) {
        const a = st.apps[i % st.apps.length];
        this.spawnUnit(p.id, 'apprentice', a[0] * TILE + HALF, a[1] * TILE + HALF);
      }
    }
    // every Clan knows its own territory
    for (const p of this.players) {
      const q = ['river', 'wind', 'shadow', 'thunder'].indexOf(p.clan);
      for (let i = 0; i < NN; i++) if (this.map.region[i] === q) p.explored[i] = 1;
    }
    this.recomputePass();
    this.updateClaims();
    this.updatePop();
    this.updateVision();
  }

  // ---------------------------------------------------------------- utilities
  add(e: Ent): Ent {
    e.id = this.nextId++;
    this.ents.push(e); this.byId.set(e.id, e);
    if (e.k === 1) this.units.push(e); else if (e.k === 2) this.blds.push(e); else this.ress.push(e);
    return e;
  }
  get(id: number | undefined): Ent | undefined { return id ? this.byId.get(id) : undefined; }
  alive(e: Ent | undefined): e is Ent { return !!e && !e.gone && !e.dead; }
  evSeq = 0;
  ev(p: number, kind: string, text: string, x?: number, y?: number, id?: number) {
    this.events.push({ tick: this.tick, p, kind, text, x, y, id, seq: ++this.evSeq });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 300);
  }
  addFx(x: number, y: number, kind: string, o?: number) {
    this.fx.push({ x, y, kind, tick: this.tick, o });
    if (this.fx.length > 300) this.fx.splice(0, 100);
  }
  clanOf(p: number): ClanId | '' { return p >= 0 && this.players[p] ? this.players[p].clan : ''; }
  ti(x: number, y: number) { return (y >> 10) * N + (x >> 10); }
  terrAt(x: number, y: number): number {
    const tx = x >> 10, ty = y >> 10;
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return T_ROCK;
    return this.map.terrain[ty * N + tx];
  }
  passFor(u: Ent): Uint8Array { return u.o >= 0 ? this.pass[u.o] : this.passWild; }
  isWater(t: number) { return (t === T_RIVER || t === T_FORD) && !this.frozen; }
  hasTech(p: number, t: string) { return p >= 0 && !!this.players[p] && !!this.players[p].techs[t]; }
  enemies(a: number, b: number) { return a !== b && (a >= 0 || b >= 0); }
  seasonPct(): number { return B.seasons.regrowPct[this.season]; }

  radius(u: Ent): number { return RADIUS[u.t]; }
  sight(u: Ent): number {
    let s = UNITS[u.t].sight | 0;
    if (this.hasTech(u.o, 'tracking')) s += 2;
    if (this.terrAt(u.x, u.y) === T_MOOR) s += 1;
    return s;
  }
  isConcealed(u: Ent): boolean {
    if (u.k !== 1 || u.o < 0) return false;
    if ((u.reveal | 0) > this.tick) return false;
    if (u.pounce) return false;
    const still = this.tick - (u.lastMove | 0) >= sec(CB.stillSec);
    const ter = this.terrAt(u.x, u.y);
    const clan = this.clanOf(u.o);
    // ThunderClan know their own forest: concealed even while moving through undergrowth on their home ground
    if (ter === T_UNDER && (still || (clan === 'thunder' && this.onHome(u)))) return true;
    if (u.t === 'shadowwarrior' && still) return true;
    if (clan === 'river' && this.hasTech(u.o, 'watercombat') && this.isWater(ter)) return true;
    return false;
  }
  visibleTo(e: Ent | undefined, p: number): boolean {
    if (!e) return false;
    if (p < 0) return true;
    if (e.o === p) return true;
    if (e.k === 1) return ((e.vis | 0) & (1 << p)) !== 0;
    if (e.k === 2) return this.players[p].vis[this.ti(e.x, e.y)] !== 0;
    return this.players[p].explored[this.ti(e.x, e.y)] !== 0;
  }
  maxHp(u: Ent): number {
    const ut = UNITS[u.t];
    let hp = ut.hp * HP;
    const p = u.o >= 0 ? this.players[u.o] : null;
    if (p) {
      if (ut.role === 'fighter' && p.clan === 'wind' && u.t !== 'leader') hp = Math.floor(hp * B.clans.wind.leanPct / 100);
      if (baseType(u.t) === 'warrior' && p.techs.senior) hp += 20 * HP;
      if (u.t === 'leader') hp = Math.floor(hp * (100 + CB.leaderAgePct * (p.age - 1)) / 100);
      if (u.dep) hp = Math.floor(hp * (100 + CB.deputyHpPct) / 100);
    }
    return hp;
  }
  refreshHp(p: number) {
    for (const u of this.units) if (u.o === p && !u.dead) {
      const m = this.maxHp(u);
      if (m !== u.mhp) { if (m > u.mhp) u.hp += m - u.mhp; u.mhp = m; if (u.hp > m) u.hp = m; }
    }
  }
  spawnUnit(o: number, t: string, x: number, y: number, name?: string): Ent {
    // every unit gets every field up front, in one order, so V8 gives all units a single hidden class
    const priorMedicine = o >= 0 && t === 'medicine' ? this.countUnits(o, 'medicine') : 0;
    const face = this.rng.int(8);
    const pelt = this.rng.int(6);
    const u = this.add({
      id: 0, k: 1, t, o, x, y, hp: 0, mhp: 0, dead: 0, gone: false,
      px: x, py: y, face, anim: 0, ord: [], gx: -1, gy: -1, gR: 0, path: null, pi: 0, pgx: 0, pgy: 0, preq: false,
      stuck: 0, repaths: 0, lastD: 0, moving: false, tgt: 0, cd: 0, pcd: 0, pounce: null,
      carry: 0, carryT: '', gacc: 0, gs: 0, gres: 0, name: '', kills: 0, pelt,
      lastMove: 0, lastFight: -9999, lastHurt: -9999, lastHit: -9999, reveal: 0, lightning: 0, lastAttacker: 0,
      dep: false, leader: false, hide: 0, hideUntil: 0, stance: 0, hx: x, hy: y, prog: 0, den: null as any, saved: null,
      vis: o >= 0 ? (1 << o) : 0, inClaim: 0, explore: false, healT: 0,
    } as Ent);
    if (o >= 0) {
      // the second medicine cat (Battle Moons) is the medicine cat's apprentice
      if (!name) name = makeName(this.rng, t === 'apprentice' ? 'paw' : (t === 'medicine' && priorMedicine >= 1) ? 'paw' : 'warrior', this.names);
      u.name = name;
    } else u.name = UNITS[t].name;
    u.mhp = this.maxHp(u); u.hp = u.mhp;
    return u;
  }
  countUnits(p: number, t: string): number { let n = 0; for (const u of this.units) if (u.o === p && u.t === t && !u.dead) n++; return n; }
  countBlds(p: number, t: string, doneOnly = false): number { let n = 0; for (const b of this.blds) if (b.o === p && b.t === t && !b.gone && (!doneOnly || b.done)) n++; return n; }
  queuedUnits(p: number, t: string): number { let n = 0; for (const b of this.blds) if (b.o === p && !b.gone && b.q) for (const q of b.q) if (q.u === t) n++; return n; }

  // ---------------------------------------------------------------- passability & territory
  passVer = 0;
  pathCache = new Map<string, { tiles: number[]; work: number; reached: boolean }>();
  recomputePass() {
    this.passVer++;
    this.pathCache.clear();
    for (let p = 0; p < this.players.length; p++) {
      if (!this.pass[p]) this.pass[p] = new Uint8Array(NN);
      this.fillPass(this.pass[p], p);
    }
    if (!this.passWild) this.passWild = new Uint8Array(NN);
    this.fillPass(this.passWild, -1);
  }
  private fillPass(arr: Uint8Array, p: number) {
    const clan = this.clanOf(p);
    const swim = clan === 'river';
    const T = this.map.terrain;
    for (let i = 0; i < NN; i++) {
      const t = T[i];
      let c = 0;
      switch (t) {
        case T_OPEN: case T_MOOR: case T_ROAD: case T_FLAT: case T_TUNNEL: c = 100; break;
        case T_UNDER: c = 111; break;
        case T_MARSH: c = clan === 'shadow' ? 100 : 118; break;
        case T_FORD: c = this.frozen ? 105 : 143; break;
        case T_RIVER: c = this.frozen ? 105 : (swim ? 143 : 0); break;
        default: c = 0;
      }
      const b = this.bldGrid[i];
      if (b) {
        const be = this.byId.get(b);
        if (be && !(be.t === 'gorse' && be.o === p && be.done)) c = 0;
      }
      arr[i] = c;
    }
  }
  updateClaims() {
    for (const p of this.players) p.claim.fill(0);
    for (const b of this.blds) {
      if (b.gone || !b.done || b.o < 0) continue;
      let r = 0;
      if (b.t === 'camp') r = 12;
      else if (b.t === 'marker') r = this.hasTech(b.o, 'borders') ? BLDS.marker.radiusBorderPatrols : BLDS.marker.radius;
      if (!r) continue;
      const cx = b.x >> 10, cy = b.y >> 10;
      const claim = this.players[b.o].claim;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r) claim[y * N + x] = 1;
      }
    }
    this.claimDirty = false;
  }
  onHome(u: Ent): boolean { return u.o >= 0 && this.players[u.o].claim[this.ti(u.x, u.y)] === 1; }

  // ---------------------------------------------------------------- buildings
  canPlace(p: number, type: string, tx: number, ty: number): string | null {
    const bd = BLDS[type];
    if (!bd || type === 'camp') return 'Cannot build that';
    const pl = this.players[p];
    if (bd.age && pl.age < bd.age) return 'Requires a later age';
    if (bd.clan && bd.clan !== pl.clan) return 'Not your Clan';
    if (bd.tech && !pl.techs[bd.tech]) return 'Requires ' + TECHS[bd.tech].name;
    if (type === 'nursery' && this.countBlds(p, 'nursery') >= bd.limitByAge[pl.age - 1]) return 'Nursery limit for this age';
    if (type === 'marker' && this.countBlds(p, 'marker') >= bd.max) return 'At most ' + bd.max + ' scent markers';
    if (type === 'tunnel' && this.countBlds(p, 'tunnel') >= bd.maxPairs * 2) return 'At most two tunnel pairs';
    const sz = bd.size;
    for (let y = ty; y < ty + sz; y++) for (let x = tx; x < tx + sz; x++) {
      if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) return 'Out of bounds';
      const i = y * N + x;
      const t = this.map.terrain[i];
      if (!(t === T_OPEN || t === T_UNDER || t === T_MOOR || t === T_MARSH || t === T_FLAT)) return 'Cannot build on this ground';
      if (this.bldGrid[i]) return 'Something is in the way';
      if (this.resGrid[i] && type !== 'marker' && type !== 'barrier' && type !== 'gorse') return 'Too close to a resource';
      if (!pl.explored[i]) return 'Unexplored';
    }
    if (type === 'marker') {
      for (const b of this.blds) if (!b.gone && b.t === 'marker' && b.o === p && Math.abs((b.tx as number) - tx) <= 3 && Math.abs((b.ty as number) - ty) <= 3) return 'Too close to another marker';
    }
    if (type === 'tunnel') {
      const un = this.blds.find(b => !b.gone && b.t === 'tunnel' && b.o === p && !b.pair);
      if (un && (Math.abs((un.tx as number) - tx) > bd.maxDist || Math.abs((un.ty as number) - ty) > bd.maxDist)) return 'Must be within ' + bd.maxDist + ' tiles of its pair';
    }
    return null;
  }
  placeBuilding(p: number, type: string, tx: number, ty: number, done: boolean): Ent {
    const bd = BLDS[type];
    const sz = bd.size;
    const b = this.add({
      id: 0, k: 2, t: type, o: p, x: tx * TILE + (sz * TILE) / 2, y: ty * TILE + (sz * TILE) / 2, hp: done ? bd.hp * HP : HP, mhp: bd.hp * HP, dead: 0, gone: false,
      tx, ty, sz, done, bp: 0, bneed: Math.max(1, sec(bd.sec)) * 100, bcount: 0, q: [], rally: null, dis: 0, shel: [], pair: 0, fcd: 0, seen: p >= 0 ? (1 << p) : 0,
    } as Ent);
    for (let y = ty; y < ty + sz; y++) for (let x = tx; x < tx + sz; x++) this.bldGrid[y * N + x] = b.id;
    this.dropCache.length = 0; this.bldVisVer++;
    // push units off the footprint
    for (const u of this.units) {
      if (u.dead || u.hide) continue;
      const ux = u.x >> 10, uy = u.y >> 10;
      if (ux >= tx && ux < tx + sz && uy >= ty && uy < ty + sz) {
        // nearest tile outside footprint
        const cands: [number, number][] = [];
        for (let y = ty - 1; y <= ty + sz; y++) for (let x = tx - 1; x <= tx + sz; x++) {
          if (x >= tx && x < tx + sz && y >= ty && y < ty + sz) continue;
          cands.push([x, y]);
        }
        let best: [number, number] | null = null, bd2 = 1e15;
        for (const [x, y] of cands) {
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const t = this.map.terrain[y * N + x];
          if (t === T_TREES || t === T_ROCK || t === T_FENCE || (t === T_RIVER && !this.frozen)) continue;
          if (this.bldGrid[y * N + x]) continue;
          const d = dist2(u.x, u.y, x * TILE + HALF, y * TILE + HALF);
          if (d < bd2) { bd2 = d; best = [x, y]; }
        }
        if (best) { u.x = best[0] * TILE + HALF; u.y = best[1] * TILE + HALF; u.px = u.x; u.py = u.y; u.path = null; }
      }
    }
    this.recomputePass();
    if (done) this.onBuilt(b, true);
    return b;
  }
  onBuilt(b: Ent, initial = false) {
    b.done = true;
    this.dropCache.length = 0; this.bldVisVer++;
    b.hp = Math.max(b.hp, 1);
    if (b.t === 'marker' || b.t === 'camp') this.claimDirty = true;
    if (b.t === 'gorse') this.recomputePass();
    if (b.t === 'tunnel' && b.o >= 0) {
      let best: Ent | null = null, bd = 1e18;
      for (const o of this.blds) {
        if (o === b || o.gone || o.t !== 'tunnel' || o.o !== b.o || !o.done || o.pair) continue;
        const d = dist2(o.x, o.y, b.x, b.y);
        if (d < bd && Math.abs((o.tx as number) - (b.tx as number)) <= BLDS.tunnel.maxDist && Math.abs((o.ty as number) - (b.ty as number)) <= BLDS.tunnel.maxDist) { bd = d; best = o; }
      }
      if (best) { best.pair = b.id; b.pair = best.id; this.ev(b.o, 'build', 'A tunnel pair is open.', b.x, b.y); }
    }
    if (!initial && b.o >= 0) {
      this.players[b.o].stats.built++;
      this.ev(b.o, 'built', BLDS[b.t].name + ' finished.', b.x, b.y, b.id);
    }
    this.updatePop();
  }
  removeBuilding(b: Ent) {
    if (b.gone) return;
    b.gone = true; b.dead = this.tick; this.anyGone = true;
    this.dropCache.length = 0; this.bldVisVer++;
    for (let y = b.ty as number; y < (b.ty as number) + (b.sz as number); y++) for (let x = b.tx as number; x < (b.tx as number) + (b.sz as number); x++) {
      if (this.bldGrid[y * N + x] === b.id) this.bldGrid[y * N + x] = 0;
    }
    if (b.pair) { const o = this.get(b.pair); if (o) o.pair = 0; }
    // release sheltered cats
    if (b.shel && b.shel.length) for (const id of b.shel.slice()) this.unshelter(this.get(id), b);
    if (b.t === 'marker' || b.t === 'camp') this.claimDirty = true;
    this.recomputePass();
    this.updatePop();
  }
  distToBld(x: number, y: number, b: Ent): number {
    const x0 = (b.tx as number) * TILE, y0 = (b.ty as number) * TILE, x1 = x0 + (b.sz as number) * TILE, y1 = y0 + (b.sz as number) * TILE;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return isqrt(dx * dx + dy * dy);
  }
  /** move toward the nearest point of a building's footprint (no allocation) */
  goalBld(u: Ent, b: Ent, r: number) {
    const x0 = (b.tx as number) * TILE, y0 = (b.ty as number) * TILE, s = (b.sz as number) * TILE;
    const x = u.x < x0 ? x0 : u.x > x0 + s ? x0 + s : u.x, y = u.y < y0 ? y0 : u.y > y0 + s ? y0 + s : u.y;
    u.gx = x; u.gy = y; u.gR = r;
  }
  nearPointOnBld(x: number, y: number, b: Ent): [number, number] {
    const x0 = (b.tx as number) * TILE, y0 = (b.ty as number) * TILE, x1 = x0 + (b.sz as number) * TILE, y1 = y0 + (b.sz as number) * TILE;
    return [clamp(x, x0, x1), clamp(y, y0, y1)];
  }
  /** a free tile next to a building, preferring the side toward (px,py) */
  spawnSpot(b: Ent, px: number, py: number, p: number): [number, number] {
    const pass = p >= 0 ? this.pass[p] : this.passWild;
    let best: [number, number] | null = null, bd = 1e18;
    const tx = b.tx as number, ty = b.ty as number, sz = b.sz as number;
    for (let r = 1; r <= 4 && !best; r++) {
      for (let y = ty - r; y < ty + sz + r; y++) for (let x = tx - r; x < tx + sz + r; x++) {
        if (x >= tx - r + 1 && x < tx + sz + r - 1 && y >= ty - r + 1 && y < ty + sz + r - 1) continue;
        if (x < 0 || y < 0 || x >= N || y >= N || pass[y * N + x] === 0) continue;
        const d = dist2(px, py, x * TILE + HALF, y * TILE + HALF);
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    if (!best) return [b.x, b.y + (sz * TILE) / 2 + HALF];
    return [best[0] * TILE + HALF, best[1] * TILE + HALF];
  }
  updatePop() {
    for (const p of this.players) { p.pop = 0; p.cap = 0; }
    for (const u of this.units) if (u.o >= 0 && !u.dead && !u.gone) this.players[u.o].pop++;
    for (const b of this.blds) if (b.o >= 0 && !b.gone && b.done) {
      const pp = BLDS[b.t].pop;
      if (pp) this.players[b.o].cap += pp;
    }
    for (const p of this.players) p.cap = Math.min(p.cap, B.popCap);
  }

  // ---------------------------------------------------------------- commands
  exec(cmd: Cmd) {
    const p = this.players[cmd.p];
    if (!p || p.defeated || this.over) return;
    const own = (id: number) => { const e = this.get(id); return e && e.o === cmd.p && e.k === 1 && !e.dead && !e.gone ? e : null; };
    const ownUnits = (ids: number[]): Ent[] => (Array.isArray(ids) ? ids : []).map(own).filter((u): u is Ent => !!u && !u.hide);
    const setOrder = (u: Ent, o: Order, q: boolean) => {
      if (!q) { u.ord = [o]; u.tgt = 0; u.path = null; u.gs = 0; u.prog = 0; u.explore = false; }
      else (u.ord as Order[]).push(o);
    };
    switch (cmd.c) {
      case 'mv': {
        const us = ownUnits(cmd.ids);
        const n = us.length;
        const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
        const sp = 760;
        us.forEach((u, i) => {
          let ox = 0, oy = 0;
          if (n > 1) {
            const cx = i % cols, cy = Math.floor(i / cols);
            const rows = Math.ceil(n / cols);
            ox = Math.round((cx - (cols - 1) / 2) * sp);
            oy = Math.round((cy - (rows - 1) / 2) * sp);
          }
          const gx = clamp((cmd.x | 0) + ox, HALF, N * TILE - HALF), gy = clamp((cmd.y | 0) + oy, HALF, N * TILE - HALF);
          setOrder(u, { o: cmd.am ? 'amove' : 'move', x: gx, y: gy }, !!cmd.q);
          u.hx = gx; u.hy = gy;
        });
        break;
      }
      case 'atk': {
        const t = this.get(cmd.t);
        if (!t || t.gone || t.dead) break;
        for (const u of ownUnits(cmd.ids)) {
          if (UNITS[u.t].role === 'medicine') continue;
          setOrder(u, { o: 'attack', t: t.id }, !!cmd.q);
        }
        break;
      }
      case 'gat': {
        const r = this.get(cmd.t);
        if (!r || r.k !== 3) break;
        for (const u of ownUnits(cmd.ids)) {
          if (u.t !== 'apprentice') { setOrder(u, { o: 'move', x: r.x, y: r.y }, !!cmd.q); continue; }
          setOrder(u, { o: 'gather', t: r.id }, !!cmd.q);
          if (!cmd.q) u.gs = 0;
        }
        break;
      }
      case 'bld': {
        const err = this.canPlace(cmd.p, cmd.b, cmd.tx | 0, cmd.ty | 0);
        if (err) { this.ev(cmd.p, 'error', err); break; }
        const c = costOf(BLDS[cmd.b].cost);
        if (!this.afford(p, c)) { this.ev(cmd.p, 'error', this.lackText(p, c)); break; }
        this.pay(p, c);
        const b = this.placeBuilding(cmd.p, cmd.b, cmd.tx | 0, cmd.ty | 0, false);
        for (const u of ownUnits(cmd.ids)) if (u.t === 'apprentice') setOrder(u, { o: 'build', t: b.id }, !!cmd.q);
        break;
      }
      case 'wall': {
        const ts: number[] = Array.isArray(cmd.tiles) ? cmd.tiles : [];
        const placed: Ent[] = [];
        for (let i = 0; i + 1 < ts.length && placed.length < 40; i += 2) {
          const type = cmd.b === 'gorse' && i === 0 ? 'gorse' : cmd.b === 'gorse' ? 'barrier' : cmd.b;
          if (this.canPlace(cmd.p, type, ts[i] | 0, ts[i + 1] | 0)) continue;
          const c = costOf(BLDS[type].cost);
          if (!this.afford(p, c)) { this.ev(cmd.p, 'error', this.lackText(p, c)); break; }
          this.pay(p, c);
          placed.push(this.placeBuilding(cmd.p, type, ts[i] | 0, ts[i + 1] | 0, false));
        }
        const us = ownUnits(cmd.ids).filter(u => u.t === 'apprentice');
        us.forEach((u, k) => {
          if (!cmd.q) { u.ord = []; u.tgt = 0; u.path = null; }
          for (let j = 0; j < placed.length; j++) (u.ord as Order[]).push({ o: 'build', t: placed[(j + k) % placed.length].id });
        });
        break;
      }
      case 'rep': {
        const b = this.get(cmd.t);
        if (!b || b.k !== 2 || b.o !== cmd.p) break;
        for (const u of ownUnits(cmd.ids)) if (u.t === 'apprentice') setOrder(u, { o: b.done ? 'repair' : 'build', t: b.id }, !!cmd.q);
        break;
      }
      case 'trn': {
        const b = this.get(cmd.b);
        if (!b || b.o !== cmd.p || b.k !== 2 || !b.done || b.gone) break;
        const ut = UNITS[cmd.u];
        if (!ut || ut.building !== b.t) break;
        if (ut.age && p.age < ut.age) { this.ev(cmd.p, 'error', 'Requires a later age'); break; }
        if (ut.clan && ut.clan !== p.clan) break;
        const n = clamp(cmd.n | 0 || 1, 1, 5);
        for (let i = 0; i < n; i++) {
          if ((b.q as QItem[]).length >= 10) break;
          if (cmd.u === 'medicine') {
            const lim = p.age >= 3 ? 2 : 1;
            if (this.countUnits(cmd.p, 'medicine') + this.queuedUnits(cmd.p, 'medicine') >= lim) { this.ev(cmd.p, 'error', 'Your Clan can keep only ' + lim + ' medicine cat' + (lim > 1 ? 's' : '')); break; }
          }
          const c = costOf(ut.cost);
          if (!this.afford(p, c)) { this.ev(cmd.p, 'error', this.lackText(p, c)); break; }
          this.pay(p, c);
          let t = sec(ut.sec);
          if (p.clan === 'thunder' && ut.role === 'fighter') t = Math.round(t * 100 / (100 + B.clans.thunder.trainPct));
          (b.q as QItem[]).push({ u: cmd.u, left: t, total: t, paid: c });
        }
        break;
      }
      case 'cq': {
        const b = this.get(cmd.b);
        if (!b || b.o !== cmd.p || !b.q) break;
        const i = cmd.i | 0;
        const it = b.q[i];
        if (!it) break;
        b.q.splice(i, 1);
        p.prey += it.paid.prey; p.moss += it.paid.moss; p.herbs += it.paid.herbs;
        if (it.tech === 'age2' || it.tech === 'age3') p.aging = false;
        break;
      }
      case 'res': {
        const b = this.get(cmd.b);
        if (!b || b.o !== cmd.p || !b.done || b.gone) break;
        const tech = TECHS[cmd.tech];
        if (!tech || tech.building !== b.t) break;
        if (p.techs[cmd.tech] || this.techQueued(cmd.p, cmd.tech)) break;
        if (tech.age && p.age < tech.age) { this.ev(cmd.p, 'error', 'Requires a later age'); break; }
        if (tech.clan && tech.clan !== p.clan) break;
        if (tech.requires && !p.techs[tech.requires]) { this.ev(cmd.p, 'error', 'Requires ' + TECHS[tech.requires].name); break; }
        const c = costOf(tech.cost);
        if (!this.afford(p, c)) { this.ev(cmd.p, 'error', this.lackText(p, c)); break; }
        this.pay(p, c);
        (b.q as QItem[]).push({ tech: cmd.tech, left: sec(tech.sec), total: sec(tech.sec), paid: c });
        break;
      }
      case 'age': {
        const camp = this.get(p.campId);
        if (!camp || camp.gone || p.age >= 3 || p.aging) break;
        const err = this.ageBlock(cmd.p);
        if (err) { this.ev(cmd.p, 'error', err); break; }
        const a = B.ages[p.age];
        const c = costOf(a.cost);
        if (!this.afford(p, c)) { this.ev(cmd.p, 'error', this.lackText(p, c)); break; }
        this.pay(p, c);
        p.aging = true;
        (camp.q as QItem[]).push({ tech: 'age' + (p.age + 1), left: sec(a.sec), total: sec(a.sec), paid: c });
        this.ev(cmd.p, 'age', 'The Clan gathers beneath the Highrock. ' + a.name + ' are coming.', camp.x, camp.y);
        break;
      }
      case 'ral': {
        const b = this.get(cmd.b);
        if (!b || b.o !== cmd.p || b.k !== 2) break;
        b.rally = { x: cmd.x | 0, y: cmd.y | 0, t: cmd.t | 0 };
        break;
      }
      case 'stop': {
        for (const u of ownUnits(cmd.ids)) { u.ord = []; u.tgt = 0; u.path = null; u.gx = -1; u.explore = false; u.hx = u.x; u.hy = u.y; }
        break;
      }
      case 'stn': {
        for (const u of ownUnits(cmd.ids)) { u.stance = clamp(cmd.s | 0, 0, 2); u.hx = u.x; u.hy = u.y; }
        break;
      }
      case 'alarm': {
        this.setAlarm(cmd.p, !!cmd.on);
        break;
      }
      case 'shl': {
        const camp = this.get(p.campId);
        if (!camp) break;
        for (const u of ownUnits(cmd.ids)) if (u.t === 'apprentice') setOrder(u, { o: 'shelter', t: camp.id }, !!cmd.q);
        break;
      }
      case 'unshl': {
        const camp = this.get(p.campId);
        if (camp && camp.shel) for (const id of camp.shel.slice()) this.unshelter(this.get(id), camp);
        break;
      }
      case 'dep': {
        const u = own(cmd.id);
        if (!u || u.hide || !isFighter(u.t) || u.leader || u.dep) break;
        if (p.deputyId && this.alive(this.get(p.deputyId))) { this.ev(cmd.p, 'error', 'Your Clan already has a deputy.'); break; }
        if (this.tick < p.depCd) { this.ev(cmd.p, 'error', 'Name a new deputy before moonhigh — not yet.'); break; }
        setOrder(u, { o: 'deputy', t: p.campId }, false);
        break;
      }
      case 'tun': {
        const t = this.get(cmd.t);
        if (!t || t.t !== 'tunnel' || t.o !== cmd.p || !t.pair || !t.done) break;
        for (const u of ownUnits(cmd.ids)) setOrder(u, { o: 'tunnel', t: t.id }, !!cmd.q);
        break;
      }
      case 'exp': {
        for (const u of ownUnits(cmd.ids)) { u.ord = [{ o: 'explore' }]; u.explore = true; u.tgt = 0; u.path = null; }
        break;
      }
      case 'del': {
        const e = this.get(cmd.id);
        if (!e || e.o !== cmd.p || e.gone || e.dead) break;
        if (e.k === 1 && !e.leader) this.kill(e, null);
        else if (e.k === 2 && e.t !== 'camp' && e.t !== 'nursery') {
          if (!e.done && (e.bp | 0) === 0) { const c = costOf(BLDS[e.t].cost); p.prey += c.prey; p.moss += c.moss; p.herbs += c.herbs; }
          this.removeBuilding(e);
        }
        break;
      }
      case 'resign': {
        p.resigned = true;
        this.defeat(cmd.p, B.clans[p.clan].name + ' has withdrawn from the forest.');
        break;
      }
      case 'taunt': {
        this.ev(-1, 'taunt', String(cmd.n | 0), undefined, undefined, cmd.p);
        break;
      }
      case 'chat': {
        this.ev(-1, 'chat', String(cmd.text || '').slice(0, 120), undefined, undefined, cmd.p);
        break;
      }
    }
  }
  techQueued(p: number, tech: string): boolean {
    for (const b of this.blds) if (b.o === p && !b.gone && b.q) for (const q of b.q) if (q.tech === tech) return true;
    return false;
  }
  ageBlock(p: number): string | null {
    const pl = this.players[p];
    if (pl.age >= 3) return 'Your Clan has reached the Battle Moons.';
    const req: string[] = B.ages[pl.age].requires;
    for (const r of req) if (!this.countBlds(p, r, true)) return 'Requires a finished ' + BLDS[r].name;
    const L = this.get(pl.leaderId);
    if (!L || L.dead || L.hide) return 'Your leader must be present to call a Clan meeting.';
    if (!this.onHome(L)) return 'Your leader must be on home ground to call a Clan meeting.';
    return null;
  }
  afford(p: Player, c: { prey: number; moss: number; herbs: number }) { return p.prey >= c.prey && p.moss >= c.moss && p.herbs >= c.herbs; }
  pay(p: Player, c: { prey: number; moss: number; herbs: number }) { p.prey -= c.prey; p.moss -= c.moss; p.herbs -= c.herbs; }
  lackText(p: Player, c: { prey: number; moss: number; herbs: number }) {
    if (p.prey < c.prey) return 'Not enough prey.';
    if (p.moss < c.moss) return 'Not enough moss.';
    return 'Not enough herbs.';
  }
  setAlarm(pi: number, on: boolean) {
    const p = this.players[pi];
    const camp = this.get(p.campId);
    if (!camp) return;
    p.alarm = on;
    if (on) {
      this.ev(pi, 'alarm', 'The alarm call! Apprentices, to the camp!', camp.x, camp.y);
      for (const u of this.units) if (u.o === pi && u.t === 'apprentice' && !u.dead && !u.hide) {
        u.saved = (u.ord as Order[]).slice();
        u.ord = [{ o: 'shelter', t: camp.id }]; u.path = null; u.tgt = 0;
      }
    } else {
      this.ev(pi, 'alarm', 'All clear. Back to work.', camp.x, camp.y);
      if (camp.shel) for (const id of camp.shel.slice()) this.unshelter(this.get(id), camp);
      for (const u of this.units) if (u.o === pi && u.t === 'apprentice' && !u.dead && u.ord && u.ord[0] && u.ord[0].o === 'shelter') {
        u.ord = u.saved || []; u.saved = null; u.path = null;
      }
    }
  }
  unshelter(u: Ent | undefined, camp: Ent) {
    if (!u || u.hide !== 1) return;
    camp.shel = (camp.shel as number[]).filter(i => i !== u.id);
    const [x, y] = this.spawnSpot(camp, camp.x + TILE * 3, camp.y + TILE * 3, u.o);
    u.x = x; u.y = y; u.px = x; u.py = y; u.hide = 0; u.path = null;
    u.ord = u.saved || []; u.saved = null;
  }

  // ---------------------------------------------------------------- main tick
  step(cmds: Cmd[]) {
    if (this.over) { this.tick++; return; }
    for (const c of cmds) this.exec(c);
    this.updateSeasons();
    this.updateMonsters();
    this.updatePlayers();
    this.buildGrid();
    for (const u of this.units) this.updateUnit(u);
    this.processPaths();
    for (const u of this.units) this.moveUnit(u);
    this.separate();
    for (const b of this.blds) this.updateBuilding(b);
    if (this.tick % 20 === 0) for (const r of this.ress) this.updateResource(r, 20);
    if (this.claimDirty) this.updateClaims();
    if (this.tick % 4 === 0) this.updateVision();
    if (this.tick % 10 === 5) this.checkTrespass();
    if (this.tick % 200 === 0) this.sampleStats();
    this.cleanup();
    this.tick++;
  }

  updateSeasons() {
    const len = sec(B.seasons.lengthSec);
    const s = Math.floor(this.tick / len) % 4;
    if (s !== this.season) {
      this.season = s;
      this.ev(-1, 'season', B.seasons.names[s] + ' has come.');
      if (s === 3 && !this.frozen) {
        this.frozen = true; this.recomputePass();
        this.ev(-1, 'season', 'The river has frozen. Any cat can cross it now, and the fish are gone.');
      } else if (s === 0 && this.frozen) {
        this.frozen = false; this.recomputePass();
        // cats standing on thawing water scramble to the nearest bank
        for (const u of this.units) {
          if (u.dead || u.hide) continue;
          const pass = this.passFor(u);
          const tx = u.x >> 10, ty = u.y >> 10;
          if (pass[ty * N + tx] === 0) {
            const np = nearestPassable(pass, tx, ty, 6);
            if (np) { u.x = np[0] * TILE + HALF; u.y = np[1] * TILE + HALF; u.px = u.x; u.py = u.y; u.path = null; }
          }
        }
        this.ev(-1, 'season', 'The ice breaks. The river runs again.');
      }
    }
    // leaf-bare warning
    const cycle = this.tick % (len * 4);
    const bareStart = len * 3;
    if (cycle === bareStart - sec(B.seasons.warnSecMedicine) || cycle === bareStart - sec(B.seasons.warnSec)) for (const p of this.players) {
      const med = this.countUnits(p.id, 'medicine') > 0;
      const warn = sec(med ? B.seasons.warnSecMedicine : B.seasons.warnSec);
      if (cycle === bareStart - warn) {
        this.ev(p.id, 'snow', med ? 'Your medicine cat reads the clouds: the air smells of snow.' : 'The air smells of snow.');
      }
    }
  }

  updateMonsters() {
    if (!this.monsterWarned && this.tick >= this.nextMonster - sec(CB.monsterWarnSec)) {
      this.monsterWarned = true;
      this.ev(-1, 'rumble', 'The ground trembles. A monster is coming down the Thunderpath!');
    }
    if (this.tick >= this.nextMonster) {
      const dir = this.rng.int(2) === 0 ? 1 : -1;
      this.monsters.push({ s: dir > 0 ? 0 : this.roadTotal, dir, hit: [], kind: this.rng.int(4) });
      this.nextMonster = this.tick + sec(CB.monsterMinSec) + this.rng.int(sec(CB.monsterMaxSec - CB.monsterMinSec) + 1);
      this.monsterWarned = false;
    }
    const sp = speedPerTick(CB.monsterSpeed);
    for (const m of this.monsters) {
      m.s += m.dir * sp;
      const [mx, my] = this.roadPos(m.s);
      for (const u of this.units) {
        if (u.dead || u.hide || u.o < 0 && u.t === 'badger') continue;
        if (this.terrAt(u.x, u.y) !== T_ROAD) continue;
        if (m.hit.indexOf(u.id) >= 0) continue;
        if (dist2(u.x, u.y, mx, my) < (TILE * 13 / 10) * (TILE * 13 / 10)) {
          m.hit.push(u.id);
          this.addFx(u.x, u.y, 'monsterhit');
          this.damage(u, CB.monsterDamage * HP, null);
          if (u.o >= 0) this.ev(u.o, 'monster', (u.name || 'A cat') + ' was struck by a monster!', u.x, u.y);
        }
      }
    }
    this.monsters = this.monsters.filter(m => m.s >= -TILE * 4 && m.s <= this.roadTotal + TILE * 4);
  }
  roadPos(s: number): [number, number] {
    const L = this.roadLen;
    if (s <= 0) return [this.roadPts[0], this.roadPts[1]];
    for (let i = 1; i < L.length; i++) {
      if (s <= L[i]) {
        const seg = L[i] - L[i - 1] || 1, f = s - L[i - 1];
        const ax = this.roadPts[i * 2 - 2], ay = this.roadPts[i * 2 - 1], bx = this.roadPts[i * 2], by = this.roadPts[i * 2 + 1];
        return [ax + Math.trunc((bx - ax) * f / seg), ay + Math.trunc((by - ay) * f / seg)];
      }
    }
    const n = this.roadPts.length;
    return [this.roadPts[n - 2], this.roadPts[n - 1]];
  }

  updatePlayers() {
    for (const p of this.players) {
      if (p.defeated) continue;
      // leader respawn / succession
      const L = this.get(p.leaderId);
      if (L && L.hide === 2 && this.tick >= (L.hideUntil as number)) {
        const camp = this.get(p.campId);
        if (camp) {
          const [x, y] = this.spawnSpot(camp, camp.x + TILE * 4, camp.y + TILE * 4, p.id);
          L.x = x; L.y = y; L.px = x; L.py = y; L.hide = 0; L.hp = L.mhp; L.ord = []; L.tgt = 0; L.path = null;
          this.ev(p.id, 'leader', L.name + ' returns to the Clan with ' + p.lives + ' li' + (p.lives === 1 ? 'fe' : 'ves') + ' remaining.', x, y, L.id);
        }
      }
      if (p.successionId) {
        const d = this.get(p.successionId);
        if (!d || d.gone) { p.successionId = 0; p.needSuccession = true; }
        else if (this.tick >= (d.hideUntil as number)) {
          const camp = this.get(p.campId);
          if (camp) {
            const [x, y] = this.spawnSpot(camp, camp.x + TILE * 4, camp.y + TILE * 4, p.id);
            const old = d.name as string;
            d.t = 'leader'; d.leader = true; d.dep = false; d.hide = 0; d.x = x; d.y = y; d.px = x; d.py = y;
            d.name = prefixOf(old) + 'star'; d.ord = []; d.tgt = 0; d.path = null;
            p.lives = 9; p.leaderId = d.id; p.deputyId = 0; p.successionId = 0;
            d.mhp = this.maxHp(d); d.hp = d.mhp;
            this.ev(p.id, 'leader', old + ' returns from the Moonstone as ' + d.name + ', with nine lives.', x, y, d.id);
            for (const o of this.players) if (o.id !== p.id) this.ev(o.id, 'leader', B.clans[p.clan].name + ' has a new leader: ' + d.name + '.');
          }
        }
      }
      if (p.needSuccession) {
        const d = this.get(p.deputyId);
        if (d && !d.dead && !d.gone && !d.hide) this.startSuccession(p, d);
      }
      // Sunningrocks
      if (this.tick % 20 === 0) {
        const site = this.map.sites.find(s => s.id === 'sunningrocks');
        if (site) {
          let holder = -1, count = 0;
          for (const q of this.players) {
            for (const b of this.blds) if (!b.gone && b.done && b.t === 'marker' && b.o === q.id && Math.abs((b.tx as number) - site.tx) <= site.r && Math.abs((b.ty as number) - site.ty) <= site.r) { if (holder !== q.id) { count++; holder = q.id; } break; }
          }
          if (count === 1 && holder === p.id) {
            p.sunAcc += Math.round(B.sunningrocksPreyPerSec * 100);
            while (p.sunAcc >= 100) { p.sunAcc -= 100; p.prey++; p.stats.gathered.prey++; }
          }
        }
      }
    }
  }
  startSuccession(p: Player, d: Ent) {
    p.needSuccession = false;
    p.successionId = d.id;
    d.hide = 3; d.hideUntil = this.tick + sec(CB.successionSec); d.ord = []; d.tgt = 0;
    this.ev(p.id, 'leader', d.name + ' sets out for the Moonstone at Highstones to receive nine lives.', d.x, d.y, d.id);
  }

  // ---------------------------------------------------------------- spatial grid
  buildGrid() {
    this.cellHead.fill(-1);
    if (this.cellNext.length < this.units.length) this.cellNext = new Int32Array(this.units.length * 2);
    const cu = this.cellUnits, cn = this.cellNext, ch = this.cellHead;
    let k = 0;
    for (const u of this.units) {
      if (u.dead || u.hide || u.gone) continue;
      const i = (u.y >> 10) * N + (u.x >> 10);
      if (i < 0 || i >= NN) continue;
      cu[k] = u; cn[k] = ch[i]; ch[i] = k; k++;
    }
    cu.length = k;
    this.cellCount = k;
  }
  /** iterate units within r tiles (square) */
  forNear(x: number, y: number, r: number, fn: (u: Ent) => void) {
    const cx = x >> 10, cy = y >> 10;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      if (ty < 0 || ty >= N) continue;
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (tx < 0 || tx >= N) continue;
        for (let k = this.cellHead[ty * N + tx]; k !== -1; k = this.cellNext[k]) fn(this.cellUnits[k]);
      }
    }
  }

  // ---------------------------------------------------------------- units
  updateUnit(u: Ent) {
    if (u.dead || u.gone) return;
    if (u.hide) {
      if (u.hide === 4 && this.tick >= (u.hideUntil as number)) {
        // emerge from tunnel
        const t = this.get(u.prog);
        if (t && !t.gone) { const [x, y] = this.spawnSpot(t, t.x + TILE, t.y + TILE, u.o); u.x = x; u.y = y; u.px = x; u.py = y; }
        u.hide = 0; u.path = null; u.prog = 0;
      }
      return;
    }
    if ((u.cd as number) > 0) u.cd!--;
    if ((u.pcd as number) > 0) u.pcd!--;
    u.gx = -1;
    if (u.pounce) return; // handled in movement
    const ut = UNITS[u.t];
    if (u.o < 0) { this.wildBehaviour(u); return; }
    if (ut.role === 'medicine') this.medicineHeal(u);
    const ord = (u.ord as Order[])[0];
    if (!ord) { this.idle(u); return; }
    let done = false;
    switch (ord.o) {
      case 'move': {
        if (this.arrived(u, ord.x as number, ord.y as number, 300)) done = true;
        else this.goal(u, ord.x as number, ord.y as number, 280);
        u.anim = 1;
        break;
      }
      case 'amove': {
        // cats clawing at a den drop it for an enemy cat that comes within reach
        if (u.tgt && this.tick % 5 === u.id % 5) { const cur = this.get(u.tgt); if (cur && cur.k === 2) { const t = this.acquire(u, this.sight(u) + 1, false); if (t) u.tgt = t.id; } }
        if (u.tgt && this.fightTarget(u, true)) break;
        if (this.tick % 5 === u.id % 5) { const t = this.acquire(u, this.sight(u) + 1, true); if (t) { u.tgt = t.id; this.fightTarget(u, true); break; } }
        if (this.arrived(u, ord.x as number, ord.y as number, 400)) done = true;
        else this.goal(u, ord.x as number, ord.y as number, 380);
        break;
      }
      case 'attack': {
        const t = this.get(ord.t);
        if (!t || t.gone || t.dead || (t.k === 2 && t.dis && t.dis > this.tick)) { done = true; break; }
        if (t.k === 1 && !this.visibleTo(t, u.o) && !(t.o === u.o)) { done = true; break; }
        if (t.k === 1 && t.hide) { done = true; break; }
        if (t.k === 2 && t.t === 'marker' && this.enemies(t.o, u.o)) { done = this.overmark(u, t); break; }
        u.tgt = t.id;
        if (!this.fightTarget(u, false)) done = true;
        break;
      }
      case 'gather': done = this.gather(u, ord); break;
      case 'build': case 'repair': done = this.build(u, ord); break;
      case 'shelter': {
        const camp = this.get(ord.t);
        if (!camp || camp.gone) { done = true; break; }
        if (this.distToBld(u.x, u.y, camp) <= 700) {
          if ((camp.shel as number[]).length < BLDS.camp.shelter) {
            (camp.shel as number[]).push(u.id); u.hide = 1; u.path = null;
            if (!u.saved) u.saved = (u.ord as Order[]).slice(1);
            u.ord = [];
          } else { u.anim = 0; }
        } else { this.goalBld(u, camp, 600); }
        break;
      }
      case 'deputy': {
        const camp = this.get(ord.t);
        const p = this.players[u.o];
        if (!camp || camp.gone) { done = true; break; }
        if (this.distToBld(u.x, u.y, camp) <= 900) {
          u.anim = 7;
          u.prog = (u.prog as number) + 1;
          if ((u.prog as number) >= sec(CB.deputyCeremonySec)) {
            u.prog = 0; done = true;
            if (!p.deputyId || !this.alive(this.get(p.deputyId))) {
              u.dep = true; p.deputyId = u.id;
              const old = u.mhp; u.mhp = this.maxHp(u); u.hp += u.mhp - old;
              this.ev(u.o, 'deputy', 'By StarClan, ' + u.name + ' is your new deputy.', u.x, u.y, u.id);
            }
          }
        } else { this.goalBld(u, camp, 800); }
        break;
      }
      case 'tunnel': {
        const t = this.get(ord.t);
        if (!t || t.gone || !t.pair || this.clanOf(u.o) !== 'wind') { done = true; break; }
        if (this.distToBld(u.x, u.y, t) <= 700) {
          u.hide = 4; u.hideUntil = this.tick + sec(BLDS.tunnel.travelSec); u.prog = t.pair; done = true;
          const pair = this.get(t.pair);
          if (pair) { u.x = pair.x; u.y = pair.y; u.px = u.x; u.py = u.y; }
        } else { this.goalBld(u, t, 600); }
        break;
      }
      case 'explore': {
        u.explore = true;
        // fight back if attacked
        if (u.tgt && this.fightTarget(u, true)) break;
        if (!ord.x || this.arrived(u, ord.x, ord.y as number, 900) || this.tick % 100 === u.id % 100) {
          const pt = this.unexplored(u);
          if (!pt) { done = true; u.explore = false; break; }
          ord.x = pt[0]; ord.y = pt[1];
        }
        this.goal(u, ord.x as number, ord.y as number, 800);
        break;
      }
    }
    if (done) {
      (u.ord as Order[]).shift();
      u.gs = 0; u.prog = 0;
      if (!(u.ord as Order[]).length) { u.hx = u.x; u.hy = u.y; u.tgt = 0; }
    }
  }

  arrived(u: Ent, x: number, y: number, r: number) {
    if (dist2(u.x, u.y, x, y) <= r * r) return true;
    // give up when stuck far from goal for long
    if ((u.repaths as number) > 4) { u.repaths = 0; return true; }
    return false;
  }
  goal(u: Ent, x: number, y: number, r: number) { u.gx = x; u.gy = y; u.gR = r; }

  idle(u: Ent) {
    u.anim = (u.carry as number) > 0 ? 0 : 0;
    const ut = UNITS[u.t];
    if (ut.role === 'fighter') {
      if (u.tgt) { if (this.fightTarget(u, true)) return; u.tgt = 0; }
      if (u.stance !== 2 && this.tick % 5 === u.id % 5) {
        const t = this.acquire(u, this.sight(u), false);
        if (t) { u.tgt = t.id; this.fightTarget(u, true); return; }
      } else if (u.stance === 2 && this.tick % 5 === u.id % 5) {
        const t = this.acquire(u, 1, false);
        if (t) { u.tgt = t.id; this.fightTarget(u, true); return; }
      }
      // defensive: drift back home
      if (u.stance === 1 && dist2(u.x, u.y, u.hx as number, u.hy as number) > TILE * TILE * 4) this.goal(u, u.hx as number, u.hy as number, 500);
    } else if (u.t === 'apprentice') {
      // fight back only if hit recently and attacker adjacent
      if (u.tgt) { if (this.tick - (u.lastHurt as number) < 60 && this.fightTarget(u, true)) return; u.tgt = 0; }
    } else if (ut.role === 'medicine') {
      // walk toward hurt friends within sight
      if (this.tick % 10 === u.id % 10) {
        let best: Ent | null = null, bd = 1e18;
        this.forNear(u.x, u.y, 5, o => {
          if (o.o !== u.o || o === u || o.hp >= o.mhp) return;
          const d = dist2(u.x, u.y, o.x, o.y);
          if (d < bd) { bd = d; best = o; }
        });
        u.healT = best ? (best as Ent).id : 0;
      }
      const h = this.get(u.healT);
      if (h && !h.dead && !h.hide && h.hp < h.mhp && dist2(u.x, u.y, h.x, h.y) > (TILE * 3 / 2) ** 2) this.goal(u, h.x, h.y, TILE);
    }
  }

  /** returns false if the target is no longer valid */
  fightTarget(u: Ent, auto: boolean): boolean {
    const t = this.get(u.tgt);
    if (!t || t.gone || t.dead || (t.k === 1 && t.hide) || (t.k === 2 && (t.dis as number) > this.tick)) { u.tgt = 0; return false; }
    if (t.k === 1 && t.o !== u.o && !this.visibleTo(t, u.o)) { u.tgt = 0; return false; }
    if (t.k === 2 && t.t === 'marker') { u.tgt = 0; return false; }
    const ut = UNITS[u.t];
    if (auto && ut.role === 'fighter') {
      // leash for automatic fights
      const lim = u.stance === 1 ? 8 : 14;
      if (dist2(u.x, u.y, u.hx as number, u.hy as number) > (TILE * lim) ** 2 && !(u.ord && u.ord[0] && u.ord[0].o === 'amove')) { u.tgt = 0; return false; }
    }
    let inRange: boolean, d: number;
    const melee = tiles(CB.meleeRange);
    if (t.k === 1) {
      d = dist(u.x, u.y, t.x, t.y);
      inRange = d <= this.radius(u) + this.radius(t) + melee;
    } else {
      d = this.distToBld(u.x, u.y, t);
      inRange = d <= 560;
    }
    if (inRange) {
      u.face = octant(t.x - u.x, t.y - u.y);
      u.anim = 2;
      if ((u.cd as number) <= 0) {
        this.hit(u, t);
        u.cd = sec(ut.interval);
      }
      return true;
    }
    if (u.stance === 2 && auto) { u.tgt = 0; return false; }
    // pounce
    const pc = ut.pounce;
    if (pc && t.k === 1 && (u.pcd as number) <= 0 && d <= tiles(pc.range) + this.radius(t) && d > melee * 2 &&
      lineWalkable(this.passFor(u), u.x, u.y, t.x, t.y)) {
      u.pounce = { conc: this.isConcealed(u), t: t.id, start: this.tick };
      u.anim = 5;
      return true;
    }
    if (t.k === 1) this.goal(u, t.x, t.y, this.radius(u) + this.radius(t) + melee - 60);
    else { this.goalBld(u, t, 520); }
    u.anim = 1;
    return true;
  }

  /** find the best enemy to fight within r tiles */
  acquire(u: Ent, r: number, buildingsToo: boolean): Ent | null {
    let best: Ent | null = null, bs = 1e18;
    const cu = this.cellUnits, cn = this.cellNext, ch = this.cellHead;
    const cx = u.x >> 10, cy = u.y >> 10, rr2 = (TILE * r) ** 2, bit = u.o >= 0 ? 1 << u.o : 0;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      if (ty < 0 || ty >= N) continue;
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (tx < 0 || tx >= N) continue;
        for (let q = ch[ty * N + tx]; q !== -1; q = cn[q]) {
          const o = cu[q];
          if (o.o === u.o || o.dead || o.hide) continue;
          if (o.o < 0) { // wildlife only if it is after us
            const tt = this.get(o.tgt);
            if (!tt || tt.o !== u.o) continue;
          } else if (!this.enemies(o.o, u.o)) continue;
          if (UNITS[o.t].role === 'medicine') continue;
          if (u.o >= 0 && ((o.vis as number) & bit) === 0) continue;
          let d = dist2(u.x, u.y, o.x, o.y);
          if (d > rr2) continue;
          if (o.t === 'apprentice') d += TILE * TILE * 6; // prefer fighters
          if (d < bs) { bs = d; best = o; }
        }
      }
    }
    if (best || !buildingsToo) return best;
    let bb: Ent | null = null; bs = 1e18;
    for (const b of this.blds) {
      if (b.gone || b.o < 0 || b.o === u.o || b.t === 'marker' || (b.dis as number) > this.tick) continue;
      if (!this.visibleTo(b, u.o)) continue;
      const d = this.distToBld(u.x, u.y, b);
      if (d > TILE * r) continue;
      if (d < bs) { bs = d; bb = b; }
    }
    return bb;
  }

  hit(a: Ent, t: Ent) {
    const ut = UNITS[a.t];
    const p = a.o >= 0 ? this.players[a.o] : null;
    let base = ut.dmg as number;
    if (p) {
      if (ut.role === 'fighter') base += (p.techs.battle1 ? 1 : 0) + (p.techs.battle2 ? 1 : 0);
      if (baseType(a.t) === 'warrior' && p.techs.senior) base += 2;
    }
    let bonus = 0;
    if (t.k === 1 && ut.bonus) bonus = ut.bonus[baseType(t.t)] | 0;
    if (ut.shallowsBonus && this.isWater(this.terrAt(a.x, a.y))) bonus += ut.shallowsBonus;
    let pct = 100;
    if (p) {
      if (a.t === 'leader') pct += CB.leaderAgePct * (p.age - 1);
      if (this.onHome(a)) pct += p.techs.borders ? CB.homePctBorderPatrols : CB.homePct;
      pct += this.auraAt(a);
    }
    let raw = (base + bonus) * HP * pct / 100;
    let armor = 0;
    if (t.k === 2) { raw = raw * (ut.structMult == null ? 100 : ut.structMult) / 100; armor = (BLDS[t.t].armor | 0) * HP; }
    else armor = this.armorOf(t) * HP;
    const concealed = this.isConcealed(a);
    if (concealed && p && p.clan === 'shadow' && p.techs.nightambush) raw *= 2;
    let dmg = Math.max(HP, Math.floor(raw) - armor);
    // Lightning Strike
    if (p && p.clan === 'thunder' && p.techs.lightning && this.tick - (a.lastFight as number) > sec(CB.outOfCombatSec)) a.lightning = this.tick + sec(CB.lightningSec);
    a.reveal = this.tick + sec(CB.revealSec);
    a.lastFight = this.tick; a.lastHit = this.tick;
    this.addFx(t.k === 1 ? t.x : (a.x + t.x) >> 1, t.k === 1 ? t.y : (a.y + t.y) >> 1, 'scratch', a.o);
    if (t.k === 1 && UNITS[t.t].role === 'medicine' && p && t.o >= 0 && t.o !== a.o) {
      if (p.auraOff < this.tick) this.ev(a.o, 'starclan', 'StarClan is displeased. Your leader\'s strength fades for a time.', t.x, t.y);
      for (const o of this.players) if (o.id !== a.o) this.ev(o.id, 'starclan', B.clans[p.clan].name + ' has attacked a medicine cat. StarClan is displeased.', t.x, t.y);
      p.auraOff = this.tick + sec(CB.medicinePenaltySec);
    }
    if (p && p.stats.firstFight < 0 && t.o >= 0 && t.o !== a.o) {
      p.stats.firstFight = this.tick;
      const op = this.players[t.o]; if (op && op.stats.firstFight < 0) op.stats.firstFight = this.tick;
    }
    this.damage(t, dmg, a);
  }
  armorOf(t: Ent): number {
    const ut = UNITS[t.t];
    let ar = ut.armor | 0;
    const p = t.o >= 0 ? this.players[t.o] : null;
    if (p && ut.role === 'fighter') ar += (p.techs.pelt1 ? 1 : 0) + (p.techs.pelt2 ? 1 : 0);
    return ar;
  }
  auraAt(a: Ent): number {
    const p = this.players[a.o];
    if (!p || p.auraOff > this.tick) return 0;
    let best = 0;
    const rr = (TILE * CB.auraRange) ** 2;
    const L = this.get(p.leaderId);
    if (L && !L.dead && !L.hide && L !== a && dist2(L.x, L.y, a.x, a.y) <= rr) best = CB.auraPct;
    if (!best) {
      const D = this.get(p.deputyId);
      if (D && D.dep && !D.dead && !D.hide && D !== a && dist2(D.x, D.y, a.x, a.y) <= rr) best = CB.deputyAuraPct;
    }
    return best;
  }

  damage(t: Ent, dmg: number, a: Ent | null) {
    if (t.dead || t.gone) return;
    if (t.k === 2) {
      if (t.t === 'marker') return;
      if ((t.dis as number) > this.tick) return;
      t.hp -= dmg;
      if (t.o >= 0 && a && this.tick % 40 < 2) this.ev(t.o, 'attacked', BLDS[t.t].name + ' is under attack!', t.x, t.y, t.id);
      if (t.hp <= 0) {
        if (t.t === 'nursery' && t.done) {
          t.hp = 0; t.dis = this.tick + sec(BLDS.nursery.drivenOutSec);
          this.ev(t.o, 'nursery', 'The queens carry the kits to safety! The nursery is empty for a time.', t.x, t.y, t.id);
          for (const o of this.players) if (o.id !== t.o) this.ev(o.id, 'nursery', 'You drove the queens from ' + B.clans[this.clanOf(t.o) as string].name + '\'s nursery.', t.x, t.y);
        } else if (t.t === 'camp') {
          t.hp = 0;
          this.removeBuilding(t);
          this.defeat(t.o, B.clans[this.clanOf(t.o) as string].name + '\'s camp has fallen. The Clan is driven out.');
        } else {
          this.addFx(t.x, t.y, 'collapse');
          if (t.o >= 0) this.ev(t.o, 'lost', BLDS[t.t].name + ' destroyed.', t.x, t.y);
          this.removeBuilding(t);
        }
      }
      return;
    }
    t.hp -= dmg;
    t.lastHurt = this.tick; t.lastFight = this.tick;
    if (a) {
      t.lastAttacker = a.id;
      // retaliate if not busy with an explicit attack
      const busy = t.ord && t.ord[0] && (t.ord[0].o === 'attack' || t.ord[0].o === 'move');
      const cur = t.tgt ? this.get(t.tgt) : undefined;
      if (!busy && (!cur || !this.alive(cur) || (cur.k === 2 && a.k === 1)) && UNITS[t.t].role !== 'medicine') {
        if (UNITS[t.t].role === 'fighter' || t.o < 0) t.tgt = a.id;
        else if (t.t === 'apprentice' && (!t.ord || !t.ord.length)) t.tgt = a.id;
      }
      // Over-marking is interrupted by damage
      t.prog = (t.ord && t.ord[0] && t.ord[0].o === 'attack') ? 0 : t.prog;
    }
    if (t.hp <= 0) this.kill(t, a);
  }

  kill(u: Ent, killer: Ent | null) {
    if (u.dead) return;
    const p = u.o >= 0 ? this.players[u.o] : null;
    this.corpses.push({ x: u.x, y: u.y, t: u.t, o: u.o, pelt: u.pelt as number, face: u.face as number, tick: this.tick, clan: this.clanOf(u.o) });
    if (this.corpses.length > 120) this.corpses.splice(0, 40);
    if (killer && killer.o >= 0) { killer.kills = (killer.kills as number) + 1; if (u.o >= 0) this.players[killer.o].stats.killed++; }
    if (u.leader && p) {
      p.lives--; p.stats.livesLost++;
      // witnesses
      for (const o of this.players) {
        if (o.id === u.o) continue;
        if (o.vis[this.ti(u.x, u.y)] & 1) this.ev(o.id, 'leaderfell', 'Your warriors saw ' + u.name + ' lose a life!', u.x, u.y);
      }
      if (p.lives > 0) {
        u.hide = 2; u.hideUntil = this.tick + sec(CB.leaderRespawnSec); u.hp = 0; u.ord = []; u.tgt = 0; u.pounce = null; u.path = null;
        this.ev(u.o, 'leader', u.name + ' has lost a life. ' + p.lives + ' remain. StarClan will return them to the camp.', u.x, u.y, u.id);
        return;
      }
      // last life
      u.dead = this.tick; u.gone = true; this.anyGone = true; p.leaderId = 0;
      this.ev(u.o, 'leader', u.name + ' has lost their last life and hunts with StarClan.', u.x, u.y);
      for (const o of this.players) if (o.id !== u.o) this.ev(o.id, 'leader', B.clans[p.clan].name + '\'s leader ' + u.name + ' has lost their ninth life.');
      if (this.settings.lastLife) { this.defeat(u.o, B.clans[p.clan].name + ' has lost its leader for good.'); return; }
      const d = this.get(p.deputyId);
      if (d && !d.dead && !d.gone && !d.hide) this.startSuccession(p, d);
      else { p.needSuccession = true; this.ev(u.o, 'leader', 'Your Clan is leaderless. Name a deputy so they can travel to the Moonstone.'); }
      p.stats.lost++;
      return;
    }
    u.dead = this.tick; u.gone = true; this.anyGone = true; u.hp = 0;
    if (p) {
      p.stats.lost++;
      if (u.dep) { p.deputyId = 0; p.depCd = this.tick + sec(CB.deputyCooldownSec); this.ev(u.o, 'deputy', 'Your deputy ' + u.name + ' has died. Name a new deputy before moonhigh.', u.x, u.y); }
      if (u.name && u.t !== 'apprentice') this.ev(u.o, 'death', u.name + ' ' + DEATH_LINES[u.id % DEATH_LINES.length] + '.', u.x, u.y);
      else if (u.name) this.ev(u.o, 'death', u.name + ' was killed.', u.x, u.y);
      if (killer && killer.o >= 0 && killer.o !== u.o) this.ev(killer.o, 'kill', 'Your cats drove off ' + B.clans[p.clan].name + '\'s ' + u.name + '.', u.x, u.y);
    } else if (killer && killer.o >= 0) this.ev(killer.o, 'kill', 'The ' + (UNITS[u.t].name as string).toLowerCase() + ' is dead.', u.x, u.y);
    this.updatePop();
  }

  defeat(pi: number, text: string) {
    const p = this.players[pi];
    if (p.defeated) return;
    p.defeated = true;
    this.ev(-1, 'defeat', text);
    const left = this.players.filter(q => !q.defeated);
    if (this.players.length > 1 && left.length <= 1) {
      this.over = true; this.winner = left.length ? left[0].id : -1;
      if (left.length) this.ev(-1, 'victory', B.clans[left[0].clan].name + ' is victorious!');
    } else if (this.players.length === 1) { this.over = true; this.winner = -1; }
  }

  medicineHeal(u: Ent) {
    if (u.moving) return;
    const p = this.players[u.o];
    const amt = Math.floor(UNITS.medicine.heal * HP / TPS * (p.techs.herblore ? 150 : 100) / 100);
    let best: Ent | null = null, bm = 0;
    this.forNear(u.x, u.y, 2, o => {
      if (o.o !== u.o || o.dead || o.hide) return;
      if (dist2(u.x, u.y, o.x, o.y) > (TILE * UNITS.medicine.healRange) ** 2) return;
      const miss = o.mhp - o.hp;
      if (miss > bm) { bm = miss; best = o; }
    });
    if (best) { (best as Ent).hp = Math.min((best as Ent).mhp, (best as Ent).hp + amt); if (this.tick % 20 === 0) this.addFx((best as Ent).x, (best as Ent).y, 'heal'); u.anim = 3; }
  }

  wildBehaviour(u: Ent) {
    const den = u.den as number[];
    if (u.tgt) {
      const t = this.get(u.tgt);
      if (!t || t.dead || t.hide || dist2(t.x, t.y, den[0], den[1]) > (TILE * 7) ** 2) u.tgt = 0;
      else { this.fightTarget(u, false); return; }
    }
    if (this.tick % 10 === u.id % 10) {
      let best: Ent | null = null, bd = 1e18;
      this.forNear(den[0], den[1], 3, o => {
        if (o.o < 0 || o.dead || o.hide) return;
        const d = dist2(o.x, o.y, den[0], den[1]);
        if (d < (TILE * 3) ** 2 && d < bd) { bd = d; best = o; }
      });
      if (best) { u.tgt = (best as Ent).id; return; }
    }
    if (dist2(u.x, u.y, den[0], den[1]) > TILE * TILE) this.goal(u, den[0], den[1], 400);
    else if (u.hp < u.mhp && this.tick % 20 === 0) u.hp = Math.min(u.mhp, u.hp + HP);
  }

  overmark(u: Ent, m: Ent): boolean {
    if (!isFighter(u.t)) return true;
    if (this.distToBld(u.x, u.y, m) <= 600) {
      u.anim = 7;
      if (u.lastHurt === this.tick) u.prog = 0;
      u.prog = (u.prog as number) + 1;
      if ((u.prog as number) >= sec(BLDS.marker.overmarkSec)) {
        u.prog = 0;
        if (m.o >= 0) this.ev(m.o, 'lost', 'Your scent marker was over-marked.', m.x, m.y);
        this.ev(u.o, 'built', 'You over-marked the enemy border.', m.x, m.y);
        this.removeBuilding(m);
        return true;
      }
    } else { this.goalBld(u, m, 500); u.prog = 0; }
    return false;
  }

  // ---------------------------------------------------------------- economy
  capacity(p: number) { return this.hasTech(p, 'bundles') ? B.carryMossBundles : B.carry; }
  gatherRate(u: Ent, r: Ent): number {
    const clan = this.clanOf(u.o);
    let rate: number;
    if (r.sub === 'fish') rate = B.gatherRates.fish;
    else if (r.sub === 'carrion') rate = B.gatherRates.carrion;
    else rate = B.gatherRates[r.rt as string];
    let m = Math.round(rate * 1000);
    if (r.rt === 'prey' && this.hasTech(u.o, 'hunting')) m = Math.floor(m * 115 / 100);
    if (r.rt === 'prey' && clan === 'shadow') m = Math.floor(m * B.clans.shadow.preyPct / 100);
    if (r.moor) m = Math.floor(m * (clan === 'wind' ? B.clans.wind.moorHuntPct : B.clans.wind.otherMoorHuntPct) / 100);
    return m;
  }
  gatherSpot(u: Ent, r: Ent): [number, number] {
    const k = (u.id * 5) % 8;
    const ox = [1, 1, 0, -1, -1, -1, 0, 1][k], oy = [0, 1, 1, 1, 0, -1, -1, -1][k];
    const rr = Math.floor((r.r as number) * 6 / 10);
    const f = (ox !== 0 && oy !== 0) ? 71 : 100;
    return [r.x + Math.trunc(ox * rr * f / 100), r.y + Math.trunc(oy * rr * f / 100)];
  }
  resUsable(r: Ent | undefined, u: Ent): boolean {
    if (!r || r.gone || r.k !== 3) return false;
    if ((r.stock as number) <= 0) return false;
    if ((r.fallow as number) > this.tick) return false;
    if (r.sub === 'fish' && (this.frozen || this.clanOf(u.o) !== 'river')) return false;
    return true;
  }
  nearestRes(u: Ent, rt: string, x: number, y: number, maxTiles: number, sub?: string): Ent | null {
    let best: Ent | null = null, bd = (TILE * maxTiles) ** 2;
    for (const r of this.ress) {
      if (r.rt !== rt || !this.resUsable(r, u)) continue;
      if (sub && r.sub !== sub && !(sub === 'ground' && r.sub === 'carrion')) continue;
      if (!this.players[u.o].explored[this.ti(r.x, r.y)]) continue;
      const d = dist2(x, y, r.x, r.y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  dropoff(u: Ent, rt: string): Ent | null {
    const key = u.o * 4 + (rt === 'prey' ? 0 : rt === 'moss' ? 1 : 2);
    let list = this.dropCache[key];
    if (!list) {
      list = [];
      for (const b of this.blds) {
        if (b.gone || !b.done || b.o !== u.o) continue;
        const dd = BLDS[b.t].dropoff;
        if (dd && dd.indexOf(rt) >= 0) list.push(b);
      }
      this.dropCache[key] = list;
    }
    let best: Ent | null = null, bd = 1e18;
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      if (b.gone || (b.dis as number) > this.tick) continue;
      const d = this.distToBld(u.x, u.y, b);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  gather(u: Ent, ord: Order): boolean {
    let r = this.get(ord.t);
    if (u.t !== 'apprentice') return true;
    // carrying something else: drop it first
    if ((u.carry as number) > 0 && r && u.carryT !== r.rt) u.gs = 2;
    if (u.gs !== 2 && !this.resUsable(r, u)) {
      const alt = r ? this.nearestRes(u, r.rt as string, r.x, r.y, 12, r.sub) : null;
      if (alt) { ord.t = alt.id; r = alt; u.gs = 0; }
      else if ((u.carry as number) > 0) u.gs = 2;
      else { u.anim = 0; return true; }
    }
    const cap = this.capacity(u.o);
    if (u.gs === 0 || u.gs === 1) {
      r = r as Ent;
      const gk = (u.id * 5) % 8;
      const gox = GOX[gk], goy = GOY[gk];
      const grr = Math.floor((r.r as number) * 6 / 10);
      const gf = (gox !== 0 && goy !== 0) ? 71 : 100;
      const sx = r.x + Math.trunc(gox * grr * gf / 100), sy = r.y + Math.trunc(goy * grr * gf / 100);
      const near = dist2(u.x, u.y, sx, sy) <= 420 * 420 || (r.sub === 'fish' && dist2(u.x, u.y, r.x, r.y) <= (TILE * 3 / 2) ** 2);
      if (!near && u.gs === 0) { this.goal(u, sx, sy, 380); u.anim = (u.carry as number) > 0 ? 1 : 1; return false; }
      u.gs = 1;
      u.anim = 3;
      if (u.carryT !== r.rt) { u.carry = 0; u.gacc = 0; u.carryT = r.rt; }
      u.face = octant(r.x - u.x, r.y - u.y);
      u.gacc = (u.gacc as number) + this.gatherRate(u, r);
      while ((u.gacc as number) >= 20000 && (u.carry as number) < cap && (r.stock as number) > 0) {
        u.gacc = (u.gacc as number) - 20000;
        u.carry = (u.carry as number) + 1;
        if ((r.cap as number) < 99999) r.stock = (r.stock as number) - 1;
        if ((r.stock as number) <= 0 && r.sub === 'ground') { r.stock = 0; r.fallow = this.tick + sec(B.preyGround.fallowSec); }
      }
      if ((u.carry as number) >= cap || ((r.stock as number) <= 0 && (u.carry as number) > 0)) {
        if (r.hazard && r.immune !== this.clanOf(u.o)) {
          this.damage(u, r.hazard * HP, null);
          this.addFx(u.x, u.y, r.sub === 'carrion' ? 'rat' : 'adder');
          if (u.dead) return true;
        }
        u.gs = 2; u.gres = r.id;
      }
      return false;
    }
    // returning
    const d = this.dropoff(u, u.carryT as string);
    if (!d) { u.anim = 0; if (this.tick % 200 === 0) this.ev(u.o, 'error', 'Your apprentices have nowhere to take their catch. Build a cache!'); return false; }
    if (this.distToBld(u.x, u.y, d) <= 600) {
      const p = this.players[u.o];
      const amt = u.carry as number;
      if (u.carryT === 'prey') { p.prey += amt; p.stats.gathered.prey += amt; }
      else if (u.carryT === 'moss') { p.moss += amt; p.stats.gathered.moss += amt; }
      else if (u.carryT === 'herbs') { p.herbs += amt; p.stats.gathered.herbs += amt; }
      u.carry = 0; u.gs = 0; u.gacc = 0;
      return false;
    }
    this.goalBld(u, d, 560);
    u.anim = 1;
    return false;
  }
  build(u: Ent, ord: Order): boolean {
    const b = this.get(ord.t);
    if (!b || b.gone || u.t !== 'apprentice') return true;
    if (ord.o === 'build' && b.done) {
      // finished: apprentices drift to the nearest resource for drop-off buildings
      if (b.t === 'cache' && (u.ord as Order[]).length <= 1) {
        let best: Ent | null = null, bd = (TILE * 8) ** 2;
        for (const r of this.ress) { if (!this.resUsable(r, u)) continue; const dd = dist2(r.x, r.y, b.x, b.y); if (dd < bd) { bd = dd; best = r; } }
        if (best) { (u.ord as Order[]).push({ o: 'gather', t: best.id }); }
      }
      return true;
    }
    if (ord.o === 'repair' && b.hp >= b.mhp) return true;
    if (this.distToBld(u.x, u.y, b) <= 560) {
      b.bcount = (b.bcount as number) + 1;
      u.anim = 4;
      u.face = octant(b.x - u.x, b.y - u.y);
      return false;
    }
    this.goalBld(u, b, 520);
    u.anim = 1;
    return false;
  }

  unexplored(u: Ent): [number, number] | null {
    const ex = this.players[u.o].explored, pass = this.passFor(u);
    const cx = u.x >> 10, cy = u.y >> 10;
    for (let r = 4; r < N; r += 2) {
      let best: [number, number] | null = null, bd = 1e9;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) < r - 1) continue;
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        const i = y * N + x;
        if (ex[i] || !pass[i]) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy) + ((hash2(x, y, u.id) & 7));
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (best) return [best[0] * TILE + HALF, best[1] * TILE + HALF];
    }
    return null;
  }

  // ---------------------------------------------------------------- movement
  speedOf(u: Ent): number {
    const ut = UNITS[u.t];
    let s = SPEED[u.t];
    const ter = this.terrAt(u.x, u.y);
    const clan = this.clanOf(u.o);
    let pct = 100;
    const water = this.isWater(ter);
    if (ter === T_UNDER) pct = B.terrainSpeed.under;
    else if (ter === T_MARSH) pct = clan === 'shadow' ? 100 : B.terrainSpeed.marsh;
    else if (ter === T_FORD) pct = this.frozen ? B.terrainSpeed.ice : (u.t === 'riverwarrior' ? 100 : B.terrainSpeed.ford);
    else if (ter === T_RIVER) pct = this.frozen ? B.terrainSpeed.ice : (u.t === 'riverwarrior' ? 100 : B.clans.river.swimPct);
    s = s * pct / 100;
    if (clan === 'wind' && ut.role === 'fighter' && (ter === T_OPEN || ter === T_MOOR || ter === T_FLAT || ter === T_ROAD)) s = s * B.clans.wind.openPct / 100;
    if (clan === 'river' && !water) s = s * B.clans.river.landPct / 100;
    if (u.o >= 0 && this.hasTech(u.o, 'travelling') && !this.onHome(u)) s = s * 110 / 100;
    if ((u.lightning as number) > this.tick) s = s * (100 + CB.lightningPct) / 100;
    if (water && clan !== 'river') {
      for (const p of this.players) if (p.clan === 'river' && p.techs.watercombat) { s = s * (100 - CB.waterSlowPct) / 100; break; }
    }
    return Math.max(1, Math.floor(s));
  }
  requestPath(u: Ent) {
    if (u.preq) return;
    u.preq = true;
    this.pathQueue.push(u.id);
  }
  processPaths() {
    let budget = 14000;
    while (this.pathQueue.length && budget > 0) {
      const id = this.pathQueue.shift() as number;
      const u = this.get(id);
      if (!u || u.dead || u.gone || !u.preq) continue;
      u.preq = false;
      if ((u.gx as number) < 0) continue;
      const pass = this.passFor(u);
      const gx = u.gx as number, gy = u.gy as number;
      u.pgx = gx; u.pgy = gy; u.pi = 0;
      if (lineWalkable(pass, u.x, u.y, gx, gy)) { u.path = [gx, gy]; budget -= 2; continue; }
      let sx = u.x >> 10, sy = u.y >> 10;
      if (pass[sy * N + sx] === 0) { const s = nearestPassable(pass, sx, sy, 3); if (s) { sx = s[0]; sy = s[1]; } }
      const gt = nearestPassable(pass, gx >> 10, gy >> 10, 10);
      if (!gt) { u.path = []; continue; }
      // the raw search depends only on the pass grid and the two tiles: cache it, charging the same work
      const ck = (u.o + 1) + ',' + sx + ',' + sy + ',' + gt[0] + ',' + gt[1];
      let r = this.pathCache.get(ck);
      if (!r) {
        r = this.pf.find(pass, sx, sy, gt[0], gt[1], 7000);
        if (this.pathCache.size > 4000) this.pathCache.clear();
        this.pathCache.set(ck, r);
      }
      budget -= r.work;
      const reachedExact = r.reached && gt[0] === (gx >> 10) && gt[1] === (gy >> 10);
      u.path = smooth(pass, u.x, u.y, r.tiles, gx, gy, reachedExact);
      if (r.reached && !reachedExact) u.path.push(gx, gy); // final approach into the goal area
    }
  }
  moveUnit(u: Ent) {
    if (u.dead || u.gone || u.hide) return;
    u.px = u.x; u.py = u.y;
    u.moving = false;
    if (u.pounce) { this.movePounce(u); return; }
    const gx = u.gx as number, gy = u.gy as number;
    if (gx < 0) { u.stuck = 0; return; }
    const gr = u.gR as number;
    if (dist2(u.x, u.y, gx, gy) <= gr * gr) { u.repaths = 0; return; }
    if (!u.path || Math.abs((u.pgx as number) - gx) > 700 || Math.abs((u.pgy as number) - gy) > 700) {
      if (lineWalkable(this.passFor(u), u.x, u.y, gx, gy)) { u.path = [gx, gy]; u.pi = 0; u.pgx = gx; u.pgy = gy; u.preq = false; }
      else { u.path = null; this.requestPath(u); }
    }
    let wx: number, wy: number;
    const path = u.path;
    if (path && (u.pi as number) * 2 < path.length) { wx = path[(u.pi as number) * 2]; wy = path[(u.pi as number) * 2 + 1]; }
    else if (path) { wx = gx; wy = gy; }
    else return;
    const sp = this.speedOf(u);
    let dx = wx - u.x, dy = wy - u.y;
    let d = isqrt(dx * dx + dy * dy);
    if (d <= sp && path && (u.pi as number) * 2 < path.length) {
      u.pi = (u.pi as number) + 1;
      if ((u.pi as number) * 2 < path.length) { wx = path[(u.pi as number) * 2]; wy = path[(u.pi as number) * 2 + 1]; dx = wx - u.x; dy = wy - u.y; d = isqrt(dx * dx + dy * dy); }
    }
    if (d === 0) return;
    const step = Math.min(sp, d);
    const nx = u.x + Math.trunc(dx * step / d), ny = u.y + Math.trunc(dy * step / d);
    const pass = this.passFor(u);
    if (passAt(pass, nx, ny)) { u.x = nx; u.y = ny; }
    else if (passAt(pass, nx, u.y)) u.x = nx;
    else if (passAt(pass, u.x, ny)) u.y = ny;
    if (u.x !== u.px || u.y !== u.py) {
      u.moving = true; u.lastMove = this.tick;
      u.face = octant(u.x - (u.px as number), u.y - (u.py as number));
      if (u.anim !== 2 && u.anim !== 5) u.anim = 1;
    }
    // stuck detection
    const dg = dist(u.x, u.y, gx, gy);
    if (dg >= (u.lastD as number) - 4) u.stuck = (u.stuck as number) + 1; else u.stuck = 0;
    u.lastD = dg;
    if ((u.stuck as number) > 30) {
      u.stuck = 0; u.path = null; u.repaths = (u.repaths as number) + 1;
    }
  }
  movePounce(u: Ent) {
    const pc = u.pounce!;
    const t = this.get(pc.t);
    const ut = UNITS[u.t];
    if (!t || t.dead || t.hide || this.tick - pc.start > 20) { u.pounce = null; u.pcd = sec(ut.pounce.cooldownSec) >> 1; return; }
    const sp = speedPerTick(9);
    const dx = t.x - u.x, dy = t.y - u.y;
    const d = isqrt(dx * dx + dy * dy);
    const reach = this.radius(u) + this.radius(t) + tiles(CB.meleeRange);
    u.face = octant(dx, dy);
    u.moving = true; u.lastMove = this.tick;
    if (d - sp <= reach) {
      if (d > reach) { u.x += Math.trunc(dx * (d - reach) / d); u.y += Math.trunc(dy * (d - reach) / d); }
      // land the pounce
      const p = this.players[u.o];
      let dmg = (pc.conc ? ut.pounce.concealedDmg : ut.pounce.dmg) as number;
      dmg += (ut.bonus && ut.bonus[baseType(t.t)]) | 0;
      if (p) dmg += (p.techs.battle1 ? 1 : 0) + (p.techs.battle2 ? 1 : 0);
      let pct = 100 + (p && this.onHome(u) ? (p.techs.borders ? CB.homePctBorderPatrols : CB.homePct) : 0) + (p ? this.auraAt(u) : 0);
      const dd = Math.max(HP, Math.floor(dmg * HP * pct / 100) - this.armorOf(t) * HP);
      u.pounce = null; u.pcd = sec(ut.pounce.cooldownSec); u.cd = sec(ut.interval);
      u.reveal = this.tick + sec(CB.revealSec); u.lastFight = this.tick; u.lastHit = this.tick;
      this.addFx(t.x, t.y, pc.conc ? 'ambush' : 'pounce', u.o);
      if (pc.conc && t.o >= 0) this.ev(t.o, 'ambush', 'Ambush!', t.x, t.y);
      this.damage(t, dd, u);
      u.anim = 2;
      return;
    }
    const nx = u.x + Math.trunc(dx * sp / d), ny = u.y + Math.trunc(dy * sp / d);
    const pass = this.passFor(u);
    if (pass[(ny >> 10) * N + (nx >> 10)]) { u.x = nx; u.y = ny; } else { u.pounce = null; }
  }
  separate() {
    this.buildGrid();
    const cu = this.cellUnits, cn = this.cellNext, ch = this.cellHead;
    const n = this.cellCount;
    for (let k = 0; k < n; k++) {
      const a = cu[k];
      const ra = this.radius(a);
      const aWork = !a.moving && (a.anim === 3 || a.anim === 4);
      // a's cell is taken once, before any nudges move it (as before)
      const cx = a.x >> 10, cy = a.y >> 10;
      for (let ty = cy - 1; ty <= cy + 1; ty++) {
        if (ty < 0 || ty >= N) continue;
        for (let tx = cx - 1; tx <= cx + 1; tx++) {
          if (tx < 0 || tx >= N) continue;
          for (let q = ch[ty * N + tx]; q !== -1; q = cn[q]) {
            const b = cu[q];
            if (b.id <= a.id) continue;
            const rb = this.radius(b);
            const rr = ra + rb - 40;
            const dx = b.x - a.x, dy = b.y - a.y;
            const d2v = dx * dx + dy * dy;
            if (d2v >= rr * rr) continue;
            const bWork = !b.moving && (b.anim === 3 || b.anim === 4);
            if (aWork && bWork) continue;
            let d = isqrt(d2v);
            let ux: number, uy: number;
            if (d === 0) { ux = (a.id & 1) ? 707 : -707; uy = (b.id & 1) ? 707 : -707; d = 1; }
            else { ux = Math.trunc(dx * 1000 / d); uy = Math.trunc(dy * 1000 / d); }
            const ov = Math.min(rr - d, 120);
            // the one standing still yields more
            const wa = a.moving ? 1 : 2, wb = b.moving ? 1 : 2;
            const pa = Math.trunc(ov * wa / (wa + wb)), pb = ov - pa;
            this.nudge(a, -Math.trunc(ux * pa / 1000), -Math.trunc(uy * pa / 1000));
            this.nudge(b, Math.trunc(ux * pb / 1000), Math.trunc(uy * pb / 1000));
          }
        }
      }
    }
  }
  nudge(u: Ent, dx: number, dy: number) {
    if (u.pounce) return;
    const nx = u.x + dx, ny = u.y + dy;
    const pass = this.passFor(u);
    const tx = nx >> 10, ty = ny >> 10;
    if (tx < 0 || ty < 0 || tx >= N || ty >= N || pass[ty * N + tx] === 0) return;
    u.x = nx; u.y = ny;
  }

  // ---------------------------------------------------------------- buildings tick
  updateBuilding(b: Ent) {
    if (b.gone) return;
    const p = b.o >= 0 ? this.players[b.o] : null;
    if (!b.done) {
      const n = b.bcount as number;
      if (n > 0) {
        const add = Math.floor(300 * n / (n + 2));
        b.bp = (b.bp as number) + add;
        b.hp = Math.min(b.mhp, b.hp + Math.ceil(b.mhp * add / (b.bneed as number)));
        if ((b.bp as number) >= (b.bneed as number)) this.onBuilt(b);
      }
      b.bcount = 0;
      return;
    }
    if (b.bcount && b.hp < b.mhp) {
      const n = b.bcount as number;
      const add = Math.floor(300 * n / (n + 2));
      b.hp = Math.min(b.mhp, b.hp + Math.ceil(b.mhp * add / (b.bneed as number) / 2));
    }
    b.bcount = 0;
    // nursery driven out
    if (b.t === 'nursery' && (b.dis as number) > 0) {
      if (this.tick >= (b.dis as number)) { b.dis = 0; b.hp = b.mhp >> 1; if (p) this.ev(b.o, 'nursery', 'The queens bring the kits home. The nursery is open again.', b.x, b.y); }
      else return;
    }
    // production
    const q = b.q as QItem[];
    if (q.length && p) {
      const it = q[0];
      let paused = false;
      if (it.u) {
        if (p.pop >= p.cap) paused = true;
        if (b.t === 'nursery' && p.aging) paused = true;
      }
      if (!paused) {
        it.left--;
        if (it.left <= 0) {
          q.shift();
          if (it.u) this.produce(b, it.u);
          else if (it.tech) this.research(b, it.tech);
        }
      }
    }
    // camp and queens fight back
    if (b.t === 'camp' || b.t === 'nursery') {
      b.fcd = (b.fcd as number) - 1;
      if ((b.fcd as number) <= 0) {
        b.fcd = TPS;
        const f = b.t === 'camp' ? BLDS.camp.fight : BLDS.nursery.queens;
        const dmg = Math.round((f.dps + (b.t === 'camp' ? (b.shel as number[]).length * f.perSheltered : 0)) * HP);
        const range = tiles(f.range);
        const cands: Ent[] = [];
        this.forNear(b.x, b.y, ((b.sz as number) >> 1) + 2, u => {
          if (u.o === b.o || u.dead || u.hide) return;
          if (u.o >= 0 && !this.enemies(u.o, b.o)) return;
          if (UNITS[u.t].role === 'medicine') return;
          if (this.distToBld(u.x, u.y, b) <= range) cands.push(u);
        });
        cands.sort((a, c) => this.distToBld(a.x, a.y, b) - this.distToBld(c.x, c.y, b) || a.id - c.id);
        for (let i = 0; i < Math.min(f.maxTargets, cands.length); i++) {
          this.addFx(cands[i].x, cands[i].y, b.t === 'camp' ? 'thorn' : 'queen', b.o);
          this.damage(cands[i], dmg, null);
        }
      }
    }
    // medicine den: cats resting beside it heal
    if (b.t === 'medden' && this.tick % 20 === 0) {
      this.forNear(b.x, b.y, 3, u => {
        if (u.o !== b.o || u.dead || u.moving || u.hp >= u.mhp) return;
        if (this.distToBld(u.x, u.y, b) <= TILE * 2) u.hp = Math.min(u.mhp, u.hp + BLDS.medden.restHeal * HP);
      });
    }
  }
  produce(b: Ent, t: string) {
    const p = this.players[b.o];
    const rx = b.rally ? b.rally.x : b.x + TILE * 3, ry = b.rally ? b.rally.y : b.y + TILE * 3;
    const [x, y] = this.spawnSpot(b, rx, ry, b.o);
    const u = this.spawnUnit(b.o, t, x, y);
    p.stats.trained++;
    this.updatePop();
    if (b.rally) {
      const tg = this.get(b.rally.t);
      if (tg && tg.k === 3 && t === 'apprentice') u.ord = [{ o: 'gather', t: tg.id }];
      else if (tg && tg.k === 2 && tg.o === b.o && !tg.done && t === 'apprentice') u.ord = [{ o: 'build', t: tg.id }];
      else u.ord = [{ o: 'move', x: b.rally.x, y: b.rally.y }];
      u.hx = b.rally.x; u.hy = b.rally.y;
    }
    this.ev(b.o, 'trained', (t === 'apprentice' ? 'A new apprentice, ' : UNITS[t].name + ' ') + u.name + (t === 'apprentice' ? ', leaves the nursery.' : ' is ready.'), u.x, u.y, u.id);
  }
  research(b: Ent, tech: string) {
    const p = this.players[b.o];
    if (tech === 'age2' || tech === 'age3') {
      p.age = tech === 'age2' ? 2 : 3;
      p.aging = false;
      p.stats.ageTimes[p.age - 1] = this.tick;
      this.refreshHp(b.o);
      this.ev(b.o, 'agedone', 'The ' + B.ages[p.age - 1].name + ' have begun. New cats and dens are ready.', b.x, b.y);
      for (const o of this.players) if (o.id !== b.o) this.ev(o.id, 'enemyage', B.clans[p.clan].name + ' has reached the ' + B.ages[p.age - 1].name + '.');
      return;
    }
    p.techs[tech] = true;
    if (tech === 'borders') { this.claimDirty = true; this.bldVisVer++; }
    if (tech === 'senior') this.refreshHp(b.o);
    this.ev(b.o, 'research', TECHS[tech].name + ' learned.', b.x, b.y);
  }

  updateResource(r: Ent, dt: number) {
    if (r.sub === 'ground') {
      if ((r.fallow as number) > this.tick) return;
      if ((r.stock as number) < (r.cap as number)) {
        r.racc = (r.racc as number) + Math.round(B.preyGround.regrowPerSec * this.seasonPct()) * dt;
        while ((r.racc as number) >= 2000) { r.racc = (r.racc as number) - 2000; r.stock = Math.min(r.cap as number, (r.stock as number) + 1); }
      }
    } else if (r.sub === 'herb') {
      if ((r.stock as number) < (r.cap as number)) {
        r.racc = (r.racc as number) + Math.round(B.herbRegrowPerSec * 100) * dt;
        while ((r.racc as number) >= 2000) { r.racc = (r.racc as number) - 2000; r.stock = Math.min(r.cap as number, (r.stock as number) + 1); }
      }
    }
  }

  // ---------------------------------------------------------------- vision
  visStamp = new Uint32Array(NN * 16 * 4);
  visGen = 0;
  bldVisVer = 1;
  bldVis: { ver: number; layer: Uint8Array }[] = [];
  /** vision from dens, camps and markers changes only when buildings do: keep it as a layer */
  buildingVisionLayer(p: number): Uint8Array {
    let c = this.bldVis[p];
    if (c && c.ver === this.bldVisVer) return c.layer;
    if (!c) { c = { ver: 0, layer: new Uint8Array(NN) }; this.bldVis[p] = c; }
    const layer = c.layer, ex = this.players[p].explored, T = this.map.terrain;
    layer.fill(0);
    for (const b of this.blds) {
      if (b.gone || b.o !== p) continue;
      if (b.t === 'marker' && b.done) {
        const r = this.hasTech(b.o, 'borders') ? BLDS.marker.radiusBorderPatrols : BLDS.marker.radius;
        const list = discList(b.x >> 10, b.y >> 10, r);
        for (let k = 0; k < list.length; k++) layer[list[k]] |= 2;
      } else {
        const s = BLDS[b.t].sight | 0;
        if (s > 0) {
          const list = fovList(this.fov, T, b.x >> 10, b.y >> 10, s + ((b.sz as number) >> 1));
          for (let k = 0; k < list.length; k++) layer[list[k]] |= 4;
        } else layer[this.ti(b.x, b.y)] |= 4;
      }
    }
    for (let i = 0; i < NN; i++) if (layer[i]) ex[i] = 1;
    c.ver = this.bldVisVer;
    return layer;
  }
  updateVision() {
    const T = this.map.terrain;
    const fov = this.fov;
    for (const p of this.players) p.vis.set(this.buildingVisionLayer(p.id));
    const gen = ++this.visGen, stamp = this.visStamp;
    for (const u of this.units) {
      if (u.o < 0 || u.dead || u.hide) continue;
      const pl = this.players[u.o];
      const vis = pl.vis, ex = pl.explored;
      const R = Math.min(14, this.sight(u));
      const sk = ((((u.y >> 10) * N + (u.x >> 10)) * 16 + R) << 2) | (u.o & 3);
      if (stamp[sk] === gen) continue;   // another cat of the same Clan already saw exactly this
      stamp[sk] = gen;
      const list = fovList(fov, T, u.x >> 10, u.y >> 10, R);
      for (let k = 0; k < list.length; k++) { const i = list[k]; vis[i] |= 1; ex[i] = 1; }
    }
    // who can see each unit
    const np = this.players.length;
    const cu = this.cellUnits, cn = this.cellNext, ch = this.cellHead;
    const cr = tiles(CB.concealRange), cr2 = cr * cr, R = CB.concealRange + 1;
    for (const u of this.units) {
      if (u.dead || u.hide) { u.vis = u.o >= 0 ? (1 << u.o) : 0; continue; }
      let m = u.o >= 0 ? (1 << u.o) : 0;
      const i = this.ti(u.x, u.y);
      const masked = this.clanOf(u.o) === 'shadow';
      const conc = this.isConcealed(u);
      for (let p = 0; p < np; p++) {
        if (p === u.o) continue;
        const f = this.players[p].vis[i];
        let ok = masked ? (f & 5) !== 0 : f !== 0;
        if (ok && conc) {
          ok = false;
          const cx = u.x >> 10, cy = u.y >> 10;
          for (let ty = cy - R; ty <= cy + R && !ok; ty++) {
            if (ty < 0 || ty >= N) continue;
            for (let tx = cx - R; tx <= cx + R && !ok; tx++) {
              if (tx < 0 || tx >= N) continue;
              for (let q = ch[ty * N + tx]; q !== -1; q = cn[q]) {
                const o = cu[q];
                if (o.o === p && !o.dead && dist2(o.x, o.y, u.x, u.y) <= cr2) { ok = true; break; }
              }
            }
          }
        }
        if (ok) m |= 1 << p;
      }
      u.vis = m;
    }
    for (const b of this.blds) {
      if (b.gone) continue;
      const i = this.ti(b.x, b.y);
      for (let p = 0; p < np; p++) if (this.players[p].vis[i]) b.seen = (b.seen as number) | (1 << p);
    }
  }
  checkTrespass() {
    for (const u of this.units) {
      if (u.dead || u.hide || u.o < 0) continue;
      const i = this.ti(u.x, u.y);
      let m = 0;
      for (const p of this.players) if (p.id !== u.o && p.claim[i]) m |= 1 << p.id;
      const entered = m & ~(u.inClaim as number);
      u.inClaim = m;
      if (!entered || this.clanOf(u.o) === 'shadow') continue;
      for (const p of this.players) {
        if (!(entered & (1 << p.id))) continue;
        if (this.tick - p.lastTrespass < sec(12)) continue;
        p.lastTrespass = this.tick;
        this.ev(p.id, 'trespass', B.clans[this.clanOf(u.o) as string].name + ' scent on the border!', u.x, u.y);
      }
    }
  }
  sampleStats() {
    for (const p of this.players) {
      let apps = 0, army = 0;
      for (const u of this.units) if (u.o === p.id && !u.dead) { if (u.t === 'apprentice') apps++; else if (isFighter(u.t)) army++; }
      p.stats.timeline.push({ t: this.tick, apps, army, prey: p.prey, moss: p.moss, herbs: p.herbs });
    }
  }
  cleanup() {
    if (!this.anyGone) return;
    this.anyGone = false;
    this.ents = this.ents.filter(e => !e.gone);
    this.units = this.units.filter(e => !e.gone);
    this.blds = this.blds.filter(e => !e.gone);
    this.ress = this.ress.filter(e => !e.gone);
    for (const id of Array.from(this.byId.keys())) { const e = this.byId.get(id); if (e && e.gone) this.byId.delete(id); }
    for (const p of this.players) { if (p.deputyId && !this.byId.get(p.deputyId)) p.deputyId = 0; }
  }

  // ---------------------------------------------------------------- hashing & snapshots
  hash(): number {
    const h = new Hasher();
    h.add(this.tick); h.add(this.rng.s); h.add(this.nextId);
    for (const p of this.players) { h.add(p.prey); h.add(p.moss); h.add(p.herbs); h.add(p.age); h.add(p.lives); h.add(p.pop); h.add(p.leaderId); h.add(p.deputyId); }
    for (const e of this.ents) {
      h.add(e.id); h.add(e.x); h.add(e.y); h.add(e.hp); h.add(e.o);
      if (e.k === 1) { h.add(e.tgt as number); h.add(e.cd as number); h.add(e.carry as number); h.add(e.hide as number); h.add((e.ord as Order[]).length); }
      else if (e.k === 3) h.add(e.stock as number);
      else { h.add(e.bp as number); h.add((e.q as QItem[]).length); }
    }
    h.add(this.monsters.length);
    return h.get();
  }
  snapshot(): string {
    const enc = (a: Uint8Array) => { let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(65 + a[i]); return s; };
    return JSON.stringify({
      tick: this.tick, rng: this.rng.s, nextId: this.nextId, frozen: this.frozen, season: this.season,
      monsters: this.monsters, nextMonster: this.nextMonster, monsterWarned: this.monsterWarned,
      over: this.over, winner: this.winner, names: Array.from(this.names), pathQueue: this.pathQueue,
      players: this.players.map(p => ({ ...p, claim: undefined, vis: undefined, explored: enc(p.explored) })),
      ents: this.ents,
    });
  }
  restore(json: string) {
    const s = JSON.parse(json);
    this.tick = s.tick; this.rng.s = s.rng; this.nextId = s.nextId; this.frozen = s.frozen; this.season = s.season;
    this.monsters = s.monsters; this.nextMonster = s.nextMonster; this.monsterWarned = s.monsterWarned;
    this.over = s.over; this.winner = s.winner; this.names = new Set(s.names); this.pathQueue = s.pathQueue;
    this.players = s.players.map((p: any, i: number) => {
      const ex = new Uint8Array(NN);
      for (let k = 0; k < NN; k++) ex[k] = p.explored.charCodeAt(k) - 65;
      return { ...p, claim: new Uint8Array(NN), vis: new Uint8Array(NN), explored: ex };
    });
    this.ents = s.ents; this.byId = new Map(); this.units = []; this.blds = []; this.ress = [];
    this.dropCache.length = 0; this.anyGone = false; this.bldVisVer++;
    this.bldGrid.fill(0);
    for (const e of this.ents) {
      this.byId.set(e.id, e);
      if (e.k === 1) this.units.push(e); else if (e.k === 2) this.blds.push(e); else this.ress.push(e);
      if (e.k === 2) for (let y = e.ty as number; y < (e.ty as number) + (e.sz as number); y++) for (let x = e.tx as number; x < (e.tx as number) + (e.sz as number); x++) this.bldGrid[y * N + x] = e.id;
    }
    this.recomputePass();
    this.updateClaims();
    this.updateVision();
  }
}
