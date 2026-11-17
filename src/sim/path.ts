// Deterministic A* on the tile grid. Pass grids hold a per-tile step cost (0 = blocked).
import { MAPN, TILE, HALF } from './core';

const N = MAPN;
const NN = N * N;
// neighbour order is fixed: E S W N SE SW NW NE
const DX = [1, 0, -1, 0, 1, -1, -1, 1];
const DY = [0, 1, 0, -1, 1, 1, -1, -1];

export class Pathfinder {
  g = new Int32Array(NN);
  came = new Int32Array(NN);
  stamp = new Uint32Array(NN);
  closed = new Uint32Array(NN);
  gen = 1;
  // heap of node indices, keyed by f then h then insertion counter
  hn = new Int32Array(NN * 8);
  hk = new Float64Array(NN * 8);   // f * 2^31 + h * 2^17 + counter  (f < 2^21, h < 2^14, counter < 2^17: exact)
  hs = 0;
  counter = 0;

  private push(n: number, f: number, h: number) {
    const hn = this.hn, hk = this.hk;
    const key = f * 2147483648 + h * 131072 + this.counter++;
    let i = this.hs++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key < hk[p]) { hn[i] = hn[p]; hk[i] = hk[p]; i = p; } else break;
    }
    hn[i] = n; hk[i] = key;
  }
  private pop(): number {
    const hn = this.hn, hk = this.hk;
    const top = hn[0];
    const n = --this.hs;
    if (n > 0) {
      const ln = hn[n], lk = hk[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && hk[r] < hk[l] ? r : l;
        if (hk[m] < lk) { hn[i] = hn[m]; hk[i] = hk[m]; i = m; } else break;
      }
      hn[i] = ln; hk[i] = lk;
    }
    return top;
  }

  /** Returns tile path (list of tile indices from start-exclusive to goal) and the number of expansions. */
  find(pass: Uint8Array, sx: number, sy: number, gx: number, gy: number, maxNodes: number): { tiles: number[]; work: number; reached: boolean } {
    const start = sy * N + sx, goal = gy * N + gx;
    if (start === goal) return { tiles: [], work: 1, reached: true };
    this.gen++;
    if (this.gen > 0xfffffff0) { this.stamp.fill(0); this.closed.fill(0); this.gen = 1; }
    const gen = this.gen;
    this.hs = 0; this.counter = 0;
    const H = (n: number) => {
      const dx = Math.abs((n % N) - gx), dy = Math.abs(((n / N) | 0) - gy);
      return dx > dy ? dx * 100 + dy * 41 : dy * 100 + dx * 41;
    };
    this.g[start] = 0; this.stamp[start] = gen; this.came[start] = -1;
    const h0 = H(start);
    this.push(start, h0, h0);
    let best = start, bestH = h0, work = 0, reached = false;
    while (this.hs > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      work++;
      if (cur === goal) { reached = true; best = cur; break; }
      const hc = H(cur);
      if (hc < bestH) { bestH = hc; best = cur; }
      if (work >= maxNodes) break;
      const cx = cur % N, cy = (cur / N) | 0;
      const gc = this.g[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        const c = pass[ni];
        if (c === 0) continue;
        if (this.closed[ni] === gen) continue;
        let step: number;
        if (k >= 4) {
          // no corner cutting
          if (pass[cy * N + nx] === 0 || pass[ny * N + cx] === 0) continue;
          step = (c * 141) / 100 | 0;
        } else step = c;
        const ng = gc + step;
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.stamp[ni] = gen; this.g[ni] = ng; this.came[ni] = cur;
          const h = H(ni);
          this.push(ni, ng + h, h);
        }
      }
    }
    const tiles: number[] = [];
    let n = best;
    while (n !== start && n !== -1) { tiles.push(n); n = this.came[n]; }
    tiles.reverse();
    return { tiles, work, reached };
  }
}

/** Is a straight line between two fixed-point positions walkable (with a little clearance)? */
export function lineWalkable(pass: Uint8Array, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, (len / 256) | 0);
  // perpendicular offset for clearance (~0.18 tile)
  let px = -dy, py = dx;
  const pl = Math.abs(px) + Math.abs(py);
  if (pl > 0) { px = Math.trunc(px * 180 / pl); py = Math.trunc(py * 180 / pl); }
  for (let s = 0; s <= steps; s++) {
    const x = ax + Math.trunc(dx * s / steps), y = ay + Math.trunc(dy * s / steps);
    for (let o = -1; o <= 1; o++) {
      const qx = (x + px * o) >> 10, qy = (y + py * o) >> 10;
      if (qx < 0 || qy < 0 || qx >= N || qy >= N) return false;
      if (pass[qy * N + qx] === 0) return false;
    }
  }
  return true;
}

/** Convert a tile path into smoothed waypoints (fixed coords). */
export function smooth(pass: Uint8Array, sx: number, sy: number, tiles: number[], gx: number, gy: number, reached: boolean): number[] {
  const pts: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    pts.push((t % N) * TILE + HALF, ((t / N) | 0) * TILE + HALF);
  }
  if (reached && pts.length >= 2) { pts[pts.length - 2] = gx; pts[pts.length - 1] = gy; }
  else if (reached && pts.length === 0) { pts.push(gx, gy); }
  // string pulling
  const out: number[] = [];
  let cx = sx, cy = sy, i = 0;
  const n = pts.length / 2;
  while (i < n) {
    let far = i;
    // look ahead up to 24 points for the farthest visible one
    for (let j = Math.min(n - 1, i + 24); j > i; j--) {
      if (lineWalkable(pass, cx, cy, pts[j * 2], pts[j * 2 + 1])) { far = j; break; }
    }
    out.push(pts[far * 2], pts[far * 2 + 1]);
    cx = pts[far * 2]; cy = pts[far * 2 + 1];
    i = far + 1;
  }
  return out;
}

/** Nearest passable tile to (tx,ty) by ring search. */
export function nearestPassable(pass: Uint8Array, tx: number, ty: number, maxR = 8): [number, number] | null {
  if (tx >= 0 && ty >= 0 && tx < N && ty < N && pass[ty * N + tx] !== 0) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null, bd = 1e9;
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (pass[y * N + x] === 0) continue;
      const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) return best;
  }
  return null;
}
