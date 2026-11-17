// Seasonal ground, painted per pixel into cached 512x512 chunks.
import { MAPN, T_OPEN, T_UNDER, T_TREES, T_MOOR, T_MARSH, T_RIVER, T_FORD, T_ROAD, T_ROCK, T_FLAT, T_FENCE, T_TUNNEL } from '../sim/core';
import type { MapDef } from '../sim/map';

export const TW = 64, TH = 32;           // tile diamond size
export const OX = MAPN * 32;             // world-screen x offset so the map starts at 0
export const MAP_W = MAPN * 64, MAP_H = MAPN * 32;
export const CH = 512;

/** tile coordinates (float) -> world-screen pixels */
export function iso(fx: number, fy: number): [number, number] { return [(fx - fy) * 32 + OX, (fx + fy) * 16]; }
export function unIso(sx: number, sy: number): [number, number] { const x = sx - OX; return [(sy / 16 + x / 32) / 2, (sy / 16 - x / 32) / 2]; }

// tileable value-noise texture
const NS = 256;
const NT = new Float32Array(NS * NS);
(function () {
  const h = (x: number, y: number) => { let v = Math.imul(x & 255, 374761393) + Math.imul(y & 255, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
    let v = 0, amp = 0.5, f = 1 / 32;
    for (let o = 0; o < 4; o++) {
      const fx = x * f, fy = y * f, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const p = Math.round(NS * f);
      const a = h(ix % p, iy % p), b = h((ix + 1) % p, iy % p), c = h(ix % p, (iy + 1) % p), d = h((ix + 1) % p, (iy + 1) % p);
      const u = tx * tx * (3 - 2 * tx), w = ty * ty * (3 - 2 * ty);
      v += amp * (a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w);
      amp *= 0.5; f *= 2;
    }
    NT[y * NS + x] = v;
  }
})();
export function nz(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy;
  const x0 = ix & 255, y0 = iy & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
  const a = NT[y0 * NS + x0], b = NT[y0 * NS + x1], c = NT[y1 * NS + x0], d = NT[y1 * NS + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
function hpx(x: number, y: number) { let v = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; }

type C3 = [number, number, number];
const PAL: Record<number, C3[]> = {
  // [newleaf, greenleaf, leaf-fall, leaf-bare]
  [T_OPEN]: [[108, 156, 64], [92, 140, 56], [138, 140, 66], [222, 228, 232]],
  [T_UNDER]: [[70, 122, 50], [56, 104, 42], [128, 98, 48], [196, 200, 196]],
  [T_TREES]: [[66, 98, 46], [56, 86, 40], [104, 84, 46], [206, 212, 214]],
  [T_MOOR]: [[146, 140, 86], [140, 126, 82], [150, 118, 76], [218, 220, 224]],
  [T_MARSH]: [[88, 110, 66], [80, 100, 62], [104, 100, 64], [202, 210, 214]],
  [T_FLAT]: [[176, 166, 146], [180, 168, 146], [172, 160, 140], [214, 216, 218]],
  [T_ROCK]: [[118, 114, 106], [118, 114, 106], [118, 114, 106], [196, 200, 204]],
  [T_ROAD]: [[72, 72, 74], [72, 72, 74], [72, 72, 74], [92, 94, 98]],
};
const SNOW: C3 = [234, 239, 244];

interface Job { key: string; cx: number; cy: number; season: number; cv: HTMLCanvasElement; img: ImageData; buf: Uint32Array; row: number }
export class TerrainCache {
  chunks = new Map<string, HTMLCanvasElement>();
  order: string[] = [];
  max = 36;
  jobs: Job[] = [];
  jobKeys = new Set<string>();
  constructor(public map: MapDef, public frozenFn: () => boolean) {}
  tAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= MAPN || y >= MAPN) return -1;
    return this.map.terrain[(y | 0) * MAPN + (x | 0)];
  }
  key(cx: number, cy: number, season: number) { return `${cx},${cy},${season}`; }
  /** a finished chunk, or null. With `sync`, paint it now; otherwise queue it for progressive painting. */
  get(cx: number, cy: number, season: number, sync: boolean): HTMLCanvasElement | null {
    const k = this.key(cx, cy, season);
    const c = this.chunks.get(k);
    if (c) { if (this.order[this.order.length - 1] !== k) { const i = this.order.indexOf(k); if (i >= 0) this.order.splice(i, 1); this.order.push(k); } return c; }
    if (sync) {
      const cv = this.paint(cx, cy, season);
      this.store(k, cv);
      const ji = this.jobs.findIndex(j => j.key === k);
      if (ji >= 0) { this.jobs.splice(ji, 1); this.jobKeys.delete(k); }
      return cv;
    }
    this.request(cx, cy, season);
    return null;
  }
  private store(k: string, cv: HTMLCanvasElement) {
    this.chunks.set(k, cv); this.order.push(k);
    while (this.order.length > this.max) { const o = this.order.shift() as string; this.chunks.delete(o); }
  }
  request(cx: number, cy: number, season: number) {
    const k = this.key(cx, cy, season);
    if (this.chunks.has(k) || this.jobKeys.has(k)) return;
    const cv = document.createElement('canvas');
    cv.width = CH; cv.height = CH;
    const img = cv.getContext('2d')!.createImageData(CH, CH);
    this.jobs.push({ key: k, cx, cy, season, cv, img, buf: new Uint32Array(img.data.buffer), row: 0 });
    this.jobKeys.add(k);
  }
  /** paint queued chunks for at most budgetMs; newest requests first (they are what the camera is looking at) */
  pump(budgetMs: number) {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budgetMs) {
      const j = this.jobs[this.jobs.length - 1];
      const end = Math.min(CH, j.row + 16);
      this.paintRows(j.buf, j.cx, j.cy, j.season, j.row, end);
      j.row = end;
      if (j.row >= CH) {
        j.cv.getContext('2d')!.putImageData(j.img, 0, 0);
        this.jobs.pop(); this.jobKeys.delete(j.key);
        this.store(j.key, j.cv);
      }
    }
    // drop stale requests (camera moved on, or the season changed)
    if (this.jobs.length > 24) { const old = this.jobs.splice(0, this.jobs.length - 24); for (const j of old) this.jobKeys.delete(j.key); }
  }
  paint(cx: number, cy: number, season: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = CH; cv.height = CH;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(CH, CH);
    this.paintInto(new Uint32Array(img.data.buffer), cx, cy, season);
    ctx.putImageData(img, 0, 0);
    return cv;
  }
  /** fills a CH x CH ABGR buffer; no allocation per pixel */
  paintInto(buf: Uint32Array, cx: number, cy: number, season: number) { this.paintRows(buf, cx, cy, season, 0, CH); }
  paintRows(buf: Uint32Array, cx: number, cy: number, season: number, row0: number, row1: number) {
    const frozen = season === 3;
    for (let py = row0; py < row1; py++) {
      const sy = cy * CH + py;
      const a = sy / 16;
      for (let px = 0; px < CH; px++) {
        const sx = cx * CH + px;
        const b = (sx - OX) / 32;
        const fx = (a + b) / 2, fy = (a - b) / 2;
        if (fx < 0 || fy < 0 || fx >= MAPN || fy >= MAPN) continue;
        this.shadeS(fx, fy, sx, sy, season, frozen);
        const r = this.r < 0 ? 0 : this.r > 255 ? 255 : this.r | 0;
        const g = this.g < 0 ? 0 : this.g > 255 ? 255 : this.g | 0;
        const bl = this.b < 0 ? 0 : this.b > 255 ? 255 : this.b | 0;
        buf[py * CH + px] = (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;
      }
    }
  }
  r = 0; g = 0; b = 0;
  private isWaterAt(x: number, y: number) { const q = this.tAt(x, y); return q === T_RIVER || q === T_FORD; }
  private isLandAt(x: number, y: number) { const q = this.tAt(x, y); return q >= 0 && q !== T_RIVER && q !== T_FORD; }
  private notRoadAt(x: number, y: number) { const q = this.tAt(x, y); return q !== T_ROAD && q !== T_TUNNEL; }
  /** scalar shader: writes this.r/g/b */
  shadeS(fx: number, fy: number, sx: number, sy: number, season: number, frozen: boolean) {
    const wx = (nz(fx * 22, fy * 22) - 0.5) * 0.9 + (nz(fx * 5, fy * 5) - 0.5) * 0.5, wy = (nz(fx * 22 + 77, fy * 22 + 31) - 0.5) * 0.9 + (nz(fx * 5 + 40, fy * 5 + 9) - 0.5) * 0.5;
    const t0 = this.tAt(fx, fy);
    let t = this.tAt(fx + wx, fy + wy);
    if (t0 === T_ROAD || t0 === T_TUNNEL || t0 === T_FENCE || t === T_ROAD || t === T_TUNNEL || t === T_FENCE || t < 0) t = t0;
    if (t === T_FENCE) t = T_OPEN;
    const n1 = nz(fx * 1.3, fy * 1.3), n2 = nz(fx * 6, fy * 6), n3 = hpx(sx, sy);
    let r: number, g: number, b: number;
    if (t === T_RIVER || t === T_FORD) {
      const qx = fx + wx, qy = fy + wy;
      const land = this.isLandAt(qx + 0.32, qy) || this.isLandAt(qx - 0.32, qy) || this.isLandAt(qx, qy + 0.32) || this.isLandAt(qx, qy - 0.32);
      if (frozen) {
        r = 190 + n2 * 30; g = 212 + n2 * 20; b = 230 + n2 * 14;
        if (Math.abs(nz(fx * 9, fy * 2.5) - 0.5) < 0.012) { r = 240; g = 246; b = 250; }
        if (land) { r = 214; g = 224; b = 232; }
      } else {
        const sh = t === T_FORD ? 0.45 : 0;
        r = 44 + 40 * sh + n1 * 18; g = 88 + 40 * sh + n1 * 22; b = 140 + 20 * sh + n1 * 22;
        const rip = Math.abs(nz(fx * 3 + fy * 0.5, fy * 12) - 0.5);
        if (rip < 0.03) { r += 34; g += 40; b += 40; }
        if (land) { r = r * 0.55 + 70; g = g * 0.55 + 74; b = b * 0.55 + 66; }
      }
      if (t === T_FORD) {
        const sxs = fx * 2.3, sys = fy * 2.3;
        const fxs = Math.floor(sxs), fys = Math.floor(sys);
        const dx = sxs - fxs - 0.5, dy = sys - fys - 0.5;
        if (dx * dx + dy * dy < 0.09 + hpx(fxs, fys) * 0.05) { if (frozen) { r = 220; g = 226; b = 230; } else { r = 150 + n2 * 20; g = 146 + n2 * 20; b = 136 + n2 * 20; } }
      }
      this.r = r; this.g = g; this.b = b;
      return;
    }
    if (t === T_ROAD || t === T_TUNNEL) {
      const base = PAL[T_ROAD][season];
      const v = n2 * 16 + n3 * 8;
      r = base[0] + v; g = base[1] + v; b = base[2] + v;
      if (this.notRoadAt(fx + 0.12, fy) || this.notRoadAt(fx - 0.12, fy) || this.notRoadAt(fx, fy + 0.12) || this.notRoadAt(fx, fy - 0.12)) { r = 196; g = 196; b = 186; }
      if (season === 3 && n2 > 0.55) { r = r * 0.4 + 140; g = g * 0.4 + 144; b = b * 0.4 + 150; }
      this.r = r; this.g = g; this.b = b;
      return;
    }
    const pal = (PAL[t] || PAL[T_OPEN])[season];
    const v = (n1 - 0.5) * 22 + (n2 - 0.5) * 18 + (n3 - 0.5) * 10;
    r = pal[0] + v; g = pal[1] + v; b = pal[2] + v * 0.6;
    if (season !== 3) {
      if (t === T_UNDER) {
        const f = nz(fx * 14 + fy * 7, fy * 14 - fx * 4);
        if (f > 0.6) { r += 26; g += 34; b += 14; } else if (f < 0.35) { r -= 16; g -= 14; b -= 10; }
      } else if (t === T_MOOR) {
        const f = nz(fx * 10, fy * 10);
        if (f > 0.62) { if (season === 2) { r = 150; g = 96; b = 70; } else { r = 126; g = 92; b = 124; } }
        else if (f < 0.32) { r -= 18; g -= 6; b -= 12; }
      } else if (t === T_MARSH) {
        if (nz(fx * 3.5 + 40, fy * 3.5) > 0.62) { r = 62; g = 92; b = 96; }
      } else if (t === T_OPEN) {
        if (season === 0 && n3 > 0.993) { if (n3 > 0.9965) { r = 240; g = 220; b = 90; } else { r = 240; g = 240; b = 240; } }
        if (season === 2 && n3 > 0.97) { r = 200; g = 120; b = 50; }
        if (nz(fx * 0.7 + 9, fy * 0.7) > 0.68) { r += 10; g += 12; b += 4; }
      } else if (t === T_TREES) {
        if (season === 2 && n3 > 0.85) { r = 190; g = 110; b = 40; }
      } else if (t === T_FLAT || t === T_ROCK) {
        if (Math.abs(nz(fx * 5, fy * 5) - 0.5) < 0.02) { r -= 30; g -= 30; b -= 30; }
      }
      if (!frozen) {
        const qx = fx + wx, qy = fy + wy;
        if (this.isWaterAt(qx + 0.3, qy) || this.isWaterAt(qx - 0.3, qy) || this.isWaterAt(qx, qy + 0.3) || this.isWaterAt(qx, qy - 0.3)) { r = r * 0.5 + 62; g = g * 0.5 + 54; b = b * 0.5 + 36; }
      }
    } else {
      const cover = nz(fx * 2.2 + 5, fy * 2.2) * 0.6 + nz(fx * 9, fy * 9) * 0.4 + (n3 - 0.5) * 0.12;
      if (t !== T_ROCK && cover < 0.33) {
        const d = (n2 - 0.5);
        if (t === T_UNDER) { r = 118 + d * 20; g = 92 + d * 20; b = 62 + d * 14; }
        else if (t === T_MOOR) { r = 120 + d * 20; g = 104 + d * 20; b = 86 + d * 14; }
        else { r = 128 + d * 20; g = 126 + d * 20; b = 92 + d * 14; }
      } else { r = SNOW[0] + (n2 - 0.5) * 14; g = SNOW[1] + (n2 - 0.5) * 12; b = SNOW[2] + (n2 - 0.5) * 8; }
      if (t === T_TREES) { r -= 18; g -= 14; b -= 10; }
    }
    this.r = r; this.g = g; this.b = b;
  }
  /** array version (tests, old callers) */
  shade(fx: number, fy: number, sx: number, sy: number, season: number, frozen: boolean): C3 {
    this.shadeS(fx, fy, sx, sy, season, frozen);
    return [this.r, this.g, this.b];
  }
}

/** colours for the minimap */
export function minimapColor(t: number, season: number, frozen: boolean): C3 {
  if (t === T_RIVER || t === T_FORD) return frozen ? [190, 210, 228] : t === T_FORD ? [90, 130, 160] : [52, 96, 150];
  if (t === T_ROAD || t === T_TUNNEL) return [64, 64, 66];
  if (t === T_TREES) return season === 3 ? [150, 160, 160] : [40, 70, 34];
  if (t === T_FENCE) return [150, 120, 84];
  const p = PAL[t] || PAL[T_OPEN];
  return p[season];
}
