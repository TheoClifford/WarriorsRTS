// The Forest: a 96x96 hand-shaped map. Deterministic: integer hashing and plain arithmetic only (no trig).
import { Pathfinder } from './path';
import {
  MAPN, CLANS, ClanId, hash2, T_OPEN, T_UNDER, T_TREES, T_MOOR, T_MARSH, T_RIVER, T_FORD, T_ROAD, T_ROCK, T_FLAT, T_FENCE, T_TUNNEL, B,
} from './core';

export interface ResSpec {
  sub: 'ground' | 'fish' | 'carrion' | 'moss' | 'herb';
  rt: 'prey' | 'moss' | 'herbs';
  tx: number; ty: number;      // centre tile
  r: number;                   // radius in tenths of a tile
  stock: number; cap: number;
  name?: string; hazard?: number; immune?: string; moor?: boolean; critter?: string; home?: number;
}
export interface SiteSpec { id: string; name: string; tx: number; ty: number; r: number; desc: string; }
export interface MapDef {
  n: number;
  terrain: Uint8Array;
  region: Uint8Array;  // 0..3 clan quadrant, 4 = Fourtrees hollow / neutral
  deco: Uint8Array;    // tree style (low 3 bits: 0 oak,1 pine,2 willow,3 birch,4 great oak) | variant << 3
  camps: Record<string, { tx: number; ty: number }>;   // centre tile of 5x5
  nursery: Record<string, { tx: number; ty: number }>; // centre tile of 3x3
  start: Record<string, { leader: [number, number]; scout: [number, number]; apps: [number, number][] }>;
  resources: ResSpec[];
  wild: { type: string; tx: number; ty: number }[];
  sites: SiteSpec[];
  road: [number, number][];   // polyline in tile-centre coords (x10 integers)
  roadEnds: [number, number][];
}

const N = MAPN;

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => (hash2(a, b, seed) & 0xffff) / 65535;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return a + (b - a) * v;
}
function fbm(x: number, y: number, s: number, seed: number): number {
  return (vnoise(x / s, y / s, seed) * 0.65 + vnoise(x / (s / 2.2), y / (s / 2.2), seed + 7) * 0.35);
}

/** local quadrant coords -> global tile for clan quadrant q */
export function toGlobal(q: number, lx: number, ly: number): [number, number] {
  switch (q) {
    case 0: return [lx, ly];                 // RiverClan: top of screen
    case 1: return [N - 1 - lx, ly];         // WindClan: right
    case 2: return [N - 1 - lx, N - 1 - ly]; // ShadowClan: bottom
    default: return [lx, N - 1 - ly];        // ThunderClan: left
  }
}
export function toLocal(q: number, x: number, y: number): [number, number] {
  switch (q) {
    case 0: return [x, y];
    case 1: return [N - 1 - x, y];
    case 2: return [N - 1 - x, N - 1 - y];
    default: return [x, N - 1 - y];
  }
}
export function quadrantOf(x: number, y: number): number {
  if (x < 48 && y < 48) return 0;
  if (x >= 48 && y < 48) return 1;
  if (x >= 48 && y >= 48) return 2;
  return 3;
}

// Home layout in local coordinates (corner of the map at 0,0, Fourtrees toward +x,+y)
export const HOME = {
  camp: [14, 14] as [number, number],
  nursery: [7, 16] as [number, number],
  starter: [[20, 9], [9, 20], [19, 19]] as [number, number][],
  outer: [[36, 8], [8, 36], [34, 24], [24, 34]] as [number, number][],
  moss: [[25, 4], [4, 25], [40, 3], [3, 40]] as [number, number][],
  safeHerb: [5, 5] as [number, number],
  exposedHerb: [40, 28] as [number, number],
  fox: [42, 30] as [number, number],
  ringInner: 29, ringOuter: 31.5,
};

export function buildMap(): MapDef {
  const terrain = new Uint8Array(N * N);
  const region = new Uint8Array(N * N);
  const deco = new Uint8Array(N * N);
  const idx = (x: number, y: number) => y * N + x;
  const C = 48; // centre in tile-centre coordinates (tile x has centre x+0.5)

  // ---------- 1. regional themes ----------
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = quadrantOf(x, y);
    const i = idx(x, y);
    region[i] = q;
    const nT = fbm(x, y, 6, 11 + q * 3), nU = fbm(x, y, 5, 31 + q * 3), nM = fbm(x, y, 9, 53 + q);
    let t = T_OPEN;
    if (q === 0) { // RiverClan: meadows, reed beds, willows
      if (nU > 0.64) t = T_UNDER;
      if (nT > 0.72) t = T_TREES;
    } else if (q === 1) { // WindClan: open moor, rock outcrops, nowhere to hide
      t = T_MOOR;
      if (nM > 0.66) t = T_OPEN;
      if (nT > 0.80) t = T_ROCK;
    } else if (q === 2) { // ShadowClan: pine forest and marsh
      if (nM > 0.60) t = T_MARSH;
      if (nT > 0.60) t = T_TREES;
      if (nU > 0.78 && t === T_OPEN) t = T_UNDER;
    } else { // ThunderClan: oak woodland, dense undergrowth
      if (nU > 0.50) t = T_UNDER;
      if (nT > 0.67) t = T_TREES;
    }
    terrain[i] = t;
    const v = hash2(x, y, 99) & 31;
    const style = q === 0 ? (v % 3 === 0 ? 0 : 2) : q === 1 ? 3 : q === 2 ? 1 : (v % 5 === 0 ? 3 : 0);
    deco[i] = style | (v << 3);
  }
  const base = (q: number) => (q === 1 ? T_MOOR : T_OPEN);

  const prot = new Uint8Array(N * N); // tiles that trail carving must never touch
  // ---------- 2. camp clearings and rings with exactly two army-wide gaps ----------
  for (let q = 0; q < 4; q++) {
    for (let ly = 0; ly < 48; ly++) for (let lx = 0; lx < 48; lx++) {
      const [x, y] = toGlobal(q, lx, ly);
      const i = idx(x, y);
      const fx = lx + 0.5, fy = ly + 0.5;
      const rc = Math.sqrt(fx * fx + fy * fy);
      if (rc < HOME.ringInner) {
        terrain[i] = base(q);
        if (q !== 1 && fbm(x, y, 3, 400 + q) > 0.70 && rc > 9) terrain[i] = T_UNDER;
      } else if (rc < HOME.ringOuter + (fbm(x, y, 3, 500 + q) - 0.5) * 1.2) {
        const s = fy / fx;
        const gap = (s > 0.466 && s < 0.700) || (s > 1.428 && s < 2.145);
        if (!gap) { terrain[i] = q === 1 ? T_ROCK : T_TREES; prot[i] = 1; }
        else terrain[i] = base(q);
      }
    }
  }
  const setT = (x: number, y: number, t: number, d = -1, p = 1) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    terrain[idx(x, y)] = t; if (d >= 0) deco[idx(x, y)] = d; if (p) prot[idx(x, y)] = 1;
  };

  // ---------- 3. The gorge (RiverClan | WindClan) ----------
  for (let y = 0; y <= 40; y++) {
    const w = fbm(48, y, 4, 700) > 0.55 ? 1 : 0;
    for (let x = 44 - w; x <= 51 + w; x++) {
      if (x === 47 || x === 48) setT(x, y, T_RIVER); else setT(x, y, T_ROCK, 6);
    }
  }
  // ---------- 4. The river (RiverClan | ThunderClan) ----------
  const riverMid = (x: number) => {
    const fade = Math.min(1, Math.max(0, (37 - x) / 8));
    return 48 + (vnoise(x / 8, 0.5, 77) - 0.5) * 4 * fade;
  };
  for (let x = 0; x <= 40; x++) {
    const m = riverMid(x + 0.5);
    for (let y = 40; y < 56; y++) if (Math.abs(y + 0.5 - m) <= 1.6) setT(x, y, T_RIVER);
  }
  // Sunningrocks: warm flat rocks on ThunderClan's bank
  for (let x = 23; x <= 31; x++) {
    const m = riverMid(x + 0.5);
    const top = Math.floor(m + 1.6);
    for (let y = top - (x >= 25 && x <= 29 ? 1 : 0); y <= top + 3; y++) {
      if (y - top >= 2 && (x === 23 || x === 31)) continue;
      setT(x, y, T_FLAT, 7, 0);
    }
  }
  // reed beds along RiverClan's bank
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    if (terrain[idx(x, y)] !== T_OPEN || prot[idx(x, y)]) continue;
    let near = false;
    for (let d = 1; d <= 2 && !near; d++) if (y + d < N && terrain[idx(x, y + d)] === T_RIVER) near = true;
    if (near && (hash2(x, y, 5) & 3) !== 0) terrain[idx(x, y)] = T_UNDER;
  }
  // ---------- 5. The Thunderpath arms, fenced on both sides ----------
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x + 0.5, fy = y + 0.5;
    const dx = fx - C, dy = fy - C;
    if (fx >= C + 11) {               // east arm: WindClan | ShadowClan
      if (Math.abs(dy) <= 2) setT(x, y, T_ROAD);
      else if (dy < -2 && dy >= -5.6) setT(x, y, T_ROCK, 6);            // WindClan side: gorse and rock
      else if (dy > 2 && dy <= 5.6) setT(x, y, T_TREES, 1 | ((hash2(x, y, 3) & 31) << 3)); // ShadowClan pines
    }
    if (fy >= C + 11) {               // south arm: ShadowClan | ThunderClan
      if (Math.abs(dx) <= 2) setT(x, y, T_ROAD);
      else if (dx > 2 && dx <= 5.6) setT(x, y, T_TREES, 1 | ((hash2(x, y, 3) & 31) << 3));
      else if (dx < -2 && dx >= -5.6) setT(x, y, T_TREES, 0 | ((hash2(x, y, 4) & 31) << 3)); // ThunderClan oaks
    }
  }
  // ---------- 6. Fourtrees: four alcoves meeting around the Great Rock ----------
  for (let y = 30; y < 66; y++) for (let x = 30; x < 66; x++) {
    const dx = x + 0.5 - C, dy = y + 0.5 - C;
    const r = Math.sqrt(dx * dx + dy * dy);
    const i = idx(x, y);
    if (r < 14.6 && r >= 11.5 && dx > 0 && dy > 0) {
      // ShadowClan's pine belt around the bend, open only at the diagonal
      if (Math.abs(dx - dy) >= 3.2) setT(x, y, T_TREES, 1 | ((hash2(x, y, 3) & 31) << 3));
      else { terrain[i] = T_OPEN; prot[i] = 1; }
      continue;
    }
    if (r >= 11.5) continue;
    region[i] = 4;
    const axis = Math.abs(dx) < 1 || Math.abs(dy) < 1;
    if (r < 1.5) setT(x, y, T_FLAT, 5);
    else if (r < 4) setT(x, y, T_OPEN);
    else if (r < 8) {
      if (axis) {
        if (r >= 4.4 && r < 6.6) setT(x, y, T_TREES, 4 | (((x & 1) + (y & 1) * 2) << 3));
        else setT(x, y, T_ROCK, 6);
      } else setT(x, y, (hash2(x, y, 9) & 7) === 0 ? T_UNDER : T_OPEN);
    } else {
      if (dx < 0 && dy < 0) setT(x, y, Math.abs(dx - dy) < 2.2 ? T_FORD : T_RIVER);
      else if (dx > 0 && dy > 0) setT(x, y, Math.abs(dx - dy) < 1.6 ? T_TUNNEL : T_ROAD);
      else if (Math.abs(dx + dy) < 2.6) setT(x, y, T_OPEN);
      else setT(x, y, dx > 0 ? T_ROCK : T_TREES, dx > 0 ? 6 : 0);
    }
  }
  const road: [number, number][] = [];
  road.push([960, 480]);
  const RR = 9.75;
  for (let a = 0; a <= 8; a++) {
    const tt = (a / 8) * 0.41421356;
    const c = (1 - tt * tt) / (1 + tt * tt), s = (2 * tt) / (1 + tt * tt);
    road.push([Math.round((48 + RR * c) * 10), Math.round((48 + RR * s) * 10)]);
  }
  const half = road.slice(1);
  for (let i = half.length - 2; i >= 0; i--) road.push([half[i][1], half[i][0]]);
  road.push([480, 960]);

  // ---------- 7. Twolegplace edge (beyond the pines, ThunderClan side of the road) ----------
  for (let y = 85; y < N; y++) for (let x = 35; x <= 44; x++) {
    const edge = (x === 35) || (y === 85);
    const gate = y === 85 && (x === 39 || x === 40);
    if (edge && !gate) setT(x, y, T_FENCE); else { terrain[idx(x, y)] = T_OPEN; prot[idx(x, y)] = 0; }
    region[idx(x, y)] = 4;
  }

  // ---------- 8. resources ----------
  const resources: ResSpec[] = [];
  const wild: MapDef['wild'] = [];
  const clear = (cx: number, cy: number, r: number, q: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const t = terrain[idx(x, y)];
      if (t === T_RIVER || t === T_ROAD || t === T_TUNNEL || t === T_FORD || t === T_FENCE) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + r) terrain[idx(x, y)] = t === T_FLAT ? T_FLAT : base(q);
    }
  };
  const critterOf = (q: number) => (q === 1 ? 'rabbit' : q === 2 ? 'frog' : 'mouse');
  const camps: MapDef['camps'] = {}, nursery: MapDef['nursery'] = {}, start: MapDef['start'] = {};
  for (let q = 0; q < 4; q++) {
    const clan = CLANS[q];
    const g = (l: [number, number]) => toGlobal(q, l[0], l[1]);
    const [cx, cy] = g(HOME.camp);
    camps[clan] = { tx: cx, ty: cy };
    clear(cx, cy, 4, q);
    const [nx, ny] = g(HOME.nursery);
    nursery[clan] = { tx: nx, ty: ny };
    clear(nx, ny, 2, q);
    // start positions (local coords mirrored per quadrant)
    start[clan] = {
      leader: g([18, 17]),
      scout: g([21, 21]),
      apps: [g([18, 12]), g([18, 14]), g([18, 16]), g([12, 18]), g([14, 18]), g([16, 18])],
    };
    const preyGround = (l: [number, number], starter: boolean) => {
      const [x, y] = g(l);
      clear(x, y, 2, q);
      resources.push({ sub: 'ground', rt: 'prey', tx: x, ty: y, r: 16, stock: B.preyGround.stock, cap: B.preyGround.cap, moor: q === 1, critter: critterOf(q), home: q, name: starter ? undefined : undefined });
    };
    HOME.starter.forEach(l => preyGround(l, true));
    HOME.outer.forEach((l, k) => {
      if (q === 2 && k === 2) { // Carrionplace replaces one outer ground in ShadowClan territory
        const [x, y] = g(l);
        clear(x, y, 2, q);
        resources.push({ sub: 'carrion', rt: 'prey', tx: x, ty: y, r: 18, stock: 99999, cap: 99999, name: 'Carrionplace', hazard: B.combat.ratDamage, immune: 'shadow', critter: 'rat', home: q });
      } else preyGround(l, false);
    });
    HOME.moss.forEach(l => { const [x, y] = g(l); clear(x, y, 1, q); resources.push({ sub: 'moss', rt: 'moss', tx: x, ty: y, r: 12, stock: B.mossBed, cap: B.mossBed, home: q }); });
    { const [x, y] = g(HOME.safeHerb); clear(x, y, 1, q); resources.push({ sub: 'herb', rt: 'herbs', tx: x, ty: y, r: 10, stock: 300, cap: 300, home: q }); }
    {
      const [x, y] = g(HOME.exposedHerb);
      clear(x, y, 2, q);
      if (clan === 'thunder') {
        // Snakerocks: rich herbs among warm stones, with adders
        resources.push({ sub: 'herb', rt: 'herbs', tx: x, ty: y, r: 12, stock: 600, cap: 600, name: 'Snakerocks', hazard: B.combat.adderDamage, home: q });
        for (const [ax, ay] of [[-2, -2], [2, -2], [-2, 2], [3, 1]]) { setT(x + ax, y + ay, T_ROCK, 6); }
      } else {
        resources.push({ sub: 'herb', rt: 'herbs', tx: x, ty: y, r: 12, stock: 500, cap: 500, home: q });
        const [fx, fy] = g(HOME.fox);
        clear(fx, fy, 1, q);
        wild.push({ type: 'fox', tx: fx, ty: fy });
      }
    }
  }
  // RiverClan fishing spots, in the river itself (only swimmers reach them)
  for (const fxCol of [7, 16, 33]) {
    for (let y = 44; y < 54; y++) {
      if (terrain[idx(fxCol, y)] === T_RIVER && terrain[idx(fxCol, y + 1)] === T_RIVER) {
        resources.push({ sub: 'fish', rt: 'prey', tx: fxCol, ty: y, r: 8, stock: 99999, cap: 99999, critter: 'fish', home: 0 });
        break;
      }
    }
  }
  // catmint at Twolegplace, guarded by a badger
  resources.push({ sub: 'herb', rt: 'herbs', tx: 40, ty: 91, r: 14, stock: 800, cap: 800, name: 'Catmint', home: 4 });
  wild.push({ type: 'badger', tx: 42, ty: 88 });
  // a few neutral bracken stands at the hollow's edges
  for (const [x, y] of [[57, 38], [38, 57]]) { clear(x, y, 1, quadrantOf(x, y)); resources.push({ sub: 'moss', rt: 'moss', tx: x, ty: y, r: 12, stock: 600, cap: 600, home: 4 }); }

  const sites: SiteSpec[] = [
    { id: 'fourtrees', name: 'Fourtrees', tx: 47, ty: 47, r: 7, desc: 'Sight of all four approaches.' },
    { id: 'sunningrocks', name: 'Sunningrocks', tx: 27, ty: 51, r: 4, desc: '+0.5 prey per second to the Clan holding a marker here.' },
    { id: 'snakerocks', name: 'Snakerocks', tx: toGlobal(3, HOME.exposedHerb[0], HOME.exposedHerb[1])[0], ty: toGlobal(3, HOME.exposedHerb[0], HOME.exposedHerb[1])[1], r: 3, desc: 'Rich herbs. Adders bite gatherers.' },
    { id: 'carrionplace', name: 'Carrionplace', tx: toGlobal(2, HOME.outer[2][0], HOME.outer[2][1])[0], ty: toGlobal(2, HOME.outer[2][0], HOME.outer[2][1])[1], r: 3, desc: 'Prey that never runs out. Rats bite.' },
    { id: 'twolegplace', name: 'Twolegplace edge', tx: 40, ty: 90, r: 4, desc: 'Catmint: the largest herb patch, fully exposed.' },
    { id: 'gorge', name: 'The gorge', tx: 47, ty: 18, r: 3, desc: 'Impassable. The river runs deep between the cliffs.' },
    { id: 'tunnel', name: 'Thunderpath tunnel', tx: 54, ty: 54, r: 2, desc: 'The one safe way under the Thunderpath.' },
  ];

  // ---------- 9. trails: guarantee every resource and the hollow can be reached from home ----------
  const pf = new Pathfinder();
  const soft = new Uint8Array(N * N);
  const fillSoft = () => {
    for (let i = 0; i < N * N; i++) {
      const t = terrain[i];
      const passable = t === T_OPEN || t === T_UNDER || t === T_MOOR || t === T_MARSH || t === T_FLAT || t === T_ROAD || t === T_TUNNEL || t === T_FORD;
      soft[i] = passable ? 100 : (!prot[i] && (t === T_TREES || t === T_ROCK)) ? 250 : 0;
    }
    for (const k in camps) { const c = camps[k]; for (let y = c.ty - 2; y <= c.ty + 2; y++) for (let x = c.tx - 2; x <= c.tx + 2; x++) soft[idx(x, y)] = 0; }
  };
  const carve = (q: number, from: [number, number], to: [number, number]) => {
    fillSoft();
    const r = pf.find(soft, from[0], from[1], to[0], to[1], 20000);
    const open = (t: number) => {
      if ((terrain[t] === T_TREES || terrain[t] === T_ROCK || terrain[t] === T_UNDER) && !prot[t]) terrain[t] = base(quadrantOf(t % N, (t / N) | 0));
    };
    let px = from[0], py = from[1];
    for (const t of r.tiles) {
      const x = t % N, y = (t / N) | 0;
      open(t);
      if (x !== px && y !== py) { open(py * N + x); open(y * N + px); }
      px = x; py = y;
    }
  };
  for (let q = 0; q < 4; q++) {
    const ex = toGlobal(q, 18, 18) as [number, number];
    for (const r of resources) {
      if (r.home !== q || r.sub === 'fish') continue;
      carve(q, ex, [r.tx, r.ty]);
    }
    carve(q, ex, ([[45, 45], [50, 45], [50, 50], [45, 50]] as [number, number][])[q]);
    for (const w of wild) if (quadrantOf(w.tx, w.ty) === q) carve(q, ex, [w.tx, w.ty]);
  }
  carve(3, toGlobal(3, 18, 18) as [number, number], [40, 91]);
  return { n: N, terrain, region, deco, camps, nursery, start, resources, wild, sites, road, roadEnds: [road[0], road[road.length - 1]] };
}
