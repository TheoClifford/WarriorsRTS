// Core constants, deterministic math and RNG. Everything inside the simulation is integer arithmetic.
import BAL from '../data/balance.json';

export const B: any = BAL;
export const TILE = 1024;          // fixed-point sub-units per tile
export const HALF = 512;
export const TPS = 20;             // simulation ticks per second
export const MAPN = 96;            // map is MAPN x MAPN tiles
export const HP = 100;             // centi-HP

// Terrain codes
export const T_OPEN = 0, T_UNDER = 1, T_TREES = 2, T_MOOR = 3, T_MARSH = 4, T_RIVER = 5, T_FORD = 6,
  T_ROAD = 7, T_ROCK = 8, T_FLAT = 9, T_FENCE = 10, T_TUNNEL = 11;
export const TERRAIN_NAMES = ['Open ground', 'Undergrowth', 'Trees', 'Moor', 'Marsh', 'River', 'Stepping stones', 'Thunderpath', 'Rock', 'Flat rock', 'Twoleg fence', 'Thunderpath tunnel'];

export const CLANS = ['river', 'wind', 'shadow', 'thunder'] as const;
export type ClanId = typeof CLANS[number];

export function sec(s: number): number { return Math.round(s * TPS); }
export function tiles(t: number): number { return Math.round(t * TILE); }
/** speed in tiles/sec -> sub-units per tick */
export function speedPerTick(s: number): number { return Math.round(s * TILE / TPS); }

export function isqrt(n: number): number {
  if (n <= 0) return 0;
  return Math.floor(Math.sqrt(n));
}
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return isqrt(dx * dx + dy * dy);
}
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
export function idiv(a: number, b: number) { return Math.trunc(a / b); }

/** Octant facing 0..7 from a vector, 0 = +x (world), counter-clockwise toward +y. Integer only. */
export function octant(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  // tan(22.5) ~ 0.4142 -> 53/128
  let o: number;
  if (ay * 128 <= ax * 53) o = 0;          // mostly x
  else if (ax * 128 <= ay * 53) o = 2;     // mostly y
  else o = 1;                               // diagonal
  // map into quadrant
  if (dx >= 0 && dy >= 0) return o;                       // 0,1,2
  if (dx < 0 && dy >= 0) return o === 0 ? 4 : o === 1 ? 3 : 2;
  if (dx < 0 && dy < 0) return o === 0 ? 4 : o === 1 ? 5 : 6;
  return o === 0 ? 0 : o === 1 ? 7 : 6;
}

/** Mulberry32, integer state. */
export class Rng {
  s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }
  /** integer in [0, n) */
  int(n: number): number { return n <= 0 ? 0 : this.next() % n; }
  range(a: number, b: number): number { return a + this.int(b - a + 1); }
  pick<T>(arr: readonly T[]): T { return arr[this.int(arr.length)]; }
}

/** Integer hash for deterministic per-tile noise. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/** FNV-1a style running hash over integers. */
export class Hasher {
  h = 0x811c9dc5;
  add(n: number) {
    n = n | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= (n >>> (i * 8)) & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
    }
  }
  addStr(s: string) { for (let i = 0; i < s.length; i++) { this.h ^= s.charCodeAt(i); this.h = Math.imul(this.h, 0x01000193); } }
  get(): number { return this.h >>> 0; }
}

export function costOf(c: any): { prey: number; moss: number; herbs: number } {
  return { prey: (c && c.prey) | 0, moss: (c && c.moss) | 0, herbs: (c && c.herbs) | 0 };
}
