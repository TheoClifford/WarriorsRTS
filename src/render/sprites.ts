// Sprite cache: renders models into canvases lazily, within a per-frame time budget.
import { render, rotZ, transform, Prim, Sprite, V3, scl } from './rt';
import { catModel, PELTS, FOX_PELT, BADGER_PELT, Pose, treeModel, rockModel, fernModel, structureModel, monsterModel, critterModel, snowify } from './models';

export interface CSprite { c: HTMLCanvasElement; ax: number; ay: number; w: number; h: number }

export function toCanvas(s: Sprite): CSprite {
  // crop to the visible pixels: most sprites are mostly padding
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.data[(y * s.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const id = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) id.data.set(s.data.subarray(((y + y0) * s.w + x0) * 4, ((y + y0) * s.w + x0 + w) * 4), y * w * 4);
  ctx.putImageData(id, 0, 0);
  return { c, ax: s.ax - x0, ay: s.ay - y0, w, h };
}
export function scaled(prims: Prim[], s: number): Prim[] {
  return transform(prims, [s, 0, 0, 0, s, 0, 0, 0, s]).map(p => ({ ...p, r: p.k === 1 ? [p.r[0] * s, 0, 0] : p.k === 3 ? [p.r[0] * s, p.r[1] * s, 0] : scl(p.r, s) as V3 }));
}

// facing 0..7 -> unique rendered facing and mirror flag
const FACE_MAP: [number, boolean][] = [[0, false], [1, false], [0, true], [3, false], [4, false], [5, false], [4, true], [3, true]];
export function faceInfo(f: number): [number, boolean] { return FACE_MAP[((f % 8) + 8) % 8]; }

export const POSES: Record<string, Pose[]> = {
  idle: [{ sit: true, tail: -0.6 }, { sit: true, tail: 0.6 }],
  stand: [{ walk: 0, stride: 0 }],
  walk: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w })),
  run: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w, stride: 0.095 })),
  carry_prey: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w, carry: 'prey' as const })),
  carry_fish: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w, carry: 'fish' as const })),
  carry_moss: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w, carry: 'moss' as const })),
  carry_herbs: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w, carry: 'herbs' as const })),
  med_walk: [0, 0.25, 0.5, 0.75].map(w => ({ walk: w, carry: 'leaf' as const })),
  med_idle: [{ sit: true, tail: -0.6, carry: 'leaf' as const }, { sit: true, tail: 0.6, carry: 'leaf' as const }],
  attack: [{ lunge: -0.7, crouch: 0.35 }, { lunge: 1, paw: 1 }, { lunge: 0.35, paw: 0.4 }],
  gather: [{ crouch: 0.65, headDown: 1 }, { crouch: 0.35, headDown: 0.6, tail: 0.5 }],
  pounce: [{ pounce: true }],
  fall: [{ fall: 0.55, closedEyes: true }, { fall: 1, closedEyes: true }],
};

export class SpriteCache {
  map = new Map<string, CSprite>();
  queue: string[] = [];
  queued = new Set<string>();
  budgetMs = 7;

  urgentLeft = 6;   // per frame: sprites we may render synchronously when nothing else fits
  get(key: string, make: () => CSprite, urgent = false): CSprite | null {
    const s = this.map.get(key);
    if (s) return s;
    if (!urgent && this.urgentLeft > 0 && this.firstOf(key)) { this.urgentLeft--; urgent = true; }
    if (urgent) { const v = make(); this.map.set(key, v); return v; }
    if (!this.queued.has(key)) { this.queued.add(key); this.queue.push(key); this.makers.set(key, make); }
    return null;
  }
  makers = new Map<string, () => CSprite>();
  kinds = new Set<string>();
  /** is this the first sprite of its unit/clan/pelt? then there is nothing to fall back on */
  firstOf(key: string): boolean {
    if (!key.startsWith('u|')) return false;
    const k = key.split('|').slice(0, 4).join('|');
    if (this.kinds.has(k)) return false;
    this.kinds.add(k);
    return true;
  }
  /** call once per frame */
  pump() {
    this.urgentLeft = 6;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < this.budgetMs) {
      const k = this.queue.shift() as string;
      const mk = this.makers.get(k);
      this.queued.delete(k); this.makers.delete(k);
      if (mk && !this.map.has(k)) this.map.set(k, mk());
    }
  }

  // ---------------------------------------------------------------- cats
  unitKey(type: string, clan: string, pelt: number, face: number, pose: string, frame: number) { return `u|${type}|${clan}|${pelt}|${face}|${pose}|${frame}`; }
  unit(type: string, clan: string, pelt: number, f: number, pose: string, frame: number, urgent = false): { s: CSprite; flip: boolean } | null {
    const [uf, flip] = faceInfo(f);
    const poses = POSES[pose] || POSES.idle;
    frame = frame % poses.length;
    const key = this.unitKey(type, clan, pelt, uf, pose, frame);
    const make = () => {
      const pl = type === 'fox' ? FOX_PELT : type === 'badger' ? BADGER_PELT : (PELTS[clan] || PELTS.thunder)[pelt % 6];
      const shapeType = type === 'kit' ? 'kit' : type;
      const prims = transform(catModel(shapeType, pl, poses[frame], pelt * 13), rotZ(uf * Math.PI / 4));
      const big = type === 'leader' || type === 'badger' || type === 'fox';
      const w = big ? 104 : 88, h = big ? 88 : 76;
      return toCanvas(render(prims, { w, h, ax: w >> 1, ay: h - 18, outline: 1, toModel: rotZ(-uf * Math.PI / 4) }));
    };
    let s = this.get(key, make, urgent);
    if (!s) {
      // fallback: any frame of the same pose already rendered, else idle/walk, else another facing or pelt
      for (let k = 0; k < poses.length && !s; k++) s = this.map.get(this.unitKey(type, clan, pelt, uf, pose, k)) || null;
      for (const p2 of [pose, 'walk', 'idle', 'stand']) for (const f2 of [uf, 0, 1, 3, 4, 5]) for (const pe of [pelt, 0, 1, 2, 3, 4, 5]) {
        if (s) break;
        s = this.map.get(this.unitKey(type, clan, pe, f2, p2, 0)) || null;
      }
      if (!s) return null;
    }
    return { s, flip };
  }

  /** queue the common frames for a Clan so they are ready before they are needed */
  warm(clan: string, types: string[]) {
    for (const t of types) for (let pe = 0; pe < 6; pe++) for (const f of [0, 1, 3, 4, 5]) {
      for (const [pose, n] of [['idle', 1], ['walk', 4]] as [string, number][]) for (let fr = 0; fr < n; fr++) this.unit(t, clan, pe, f, pose, fr, false);
    }
  }
  // ---------------------------------------------------------------- nature
  tree(style: number, season: number, v: number): CSprite | null {
    const key = `t|${style}|${season}|${v}`;
    return this.get(key, () => {
      const big = style === 4;
      const w = big ? 240 : 150, h = big ? 270 : 170;
      return toCanvas(render(treeModel(style, season, v), { w, h, ax: w >> 1, ay: h - 22, outline: 1, edge: false }));
    }, true);
  }
  rock(v: number, cliff: boolean, season: number): CSprite | null {
    const key = `r|${v}|${cliff ? 1 : 0}|${season === 3 ? 1 : 0}`;
    return this.get(key, () => toCanvas(render(rockModel(v, cliff, season), { w: 110, h: 110, ax: 55, ay: 82, outline: 1, edge: false })), true);
  }
  prop(kind: 'fern' | 'reed' | 'heather' | 'gorse', v: number, season: number): CSprite | null {
    const key = `p|${kind}|${v}|${season}`;
    return this.get(key, () => toCanvas(render(scaled(fernModel(v, season, kind), 2.0), { w: 80, h: 70, ax: 40, ay: 52, outline: 2, edge: false })), true);
  }
  critter(kind: string, frame: number): CSprite | null {
    const key = `c|${kind}|${frame}`;
    return this.get(key, () => toCanvas(render(scaled(critterModel(kind, frame), 1.7), { w: 40, h: 36, ax: 20, ay: 26, outline: 1, edge: false })), true);
  }
  // ---------------------------------------------------------------- structures
  structure(t: string, clanCol: V3, size: number, snow: boolean, v = 1): CSprite | null {
    const key = `s|${t}|${clanCol.join(',')}|${snow ? 1 : 0}|${v}`;
    return this.get(key, () => {
      let prims = structureModel(t, clanCol, v);
      if (t === 'marker') prims = scaled(prims, 1.7);
      if (t === 'herb' || t === 'catmint' || t === 'snakeherb' || t === 'moss') prims = scaled(prims, 1.15);
      if (snow) prims = snowify(prims);
      const w = Math.max(90, size * 64 + 60), h = Math.max(100, size * 32 + 130);
      return toCanvas(render(prims, { w, h, ax: w >> 1, ay: h - size * 16 - 26, outline: 1, edge: false }));
    }, true);
  }
  monster(kind: number, face: number): { s: CSprite; flip: boolean } | null {
    const [uf, flip] = faceInfo(face);
    const key = `m|${kind}|${uf}`;
    const s = this.get(key, () => toCanvas(render(transform(monsterModel(kind), rotZ(uf * Math.PI / 4)), { w: 150, h: 110, ax: 75, ay: 78, outline: 1 })), true);
    return s ? { s, flip } : null;
  }
}
