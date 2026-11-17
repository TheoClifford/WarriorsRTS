// A tiny ray tracer that pre-renders 3D primitive models into isometric pixel sprites (the way late-90s RTS art was made).
// Pure TypeScript, no DOM, so it also runs in Node for tests.

export type V3 = [number, number, number];
export type ColorFn = (p: V3, n: V3) => V3;   // model-space point, world normal -> rgb 0..255

export interface Prim {
  k: 0 | 1 | 2 | 3;     // 0 ellipsoid, 1 capsule, 2 box, 3 cone (apex up)
  c: V3;                // centre (ellipsoid, box) / capsule a / cone base centre
  b?: V3;               // capsule end
  r: V3;                // radii (ellipsoid), half sizes (box); r[0] = radius (capsule), [radius, height] (cone)
  m?: number[];         // 3x3 rotation, local->world, row-major (ellipsoid/box)
  col: V3 | ColorFn;
  mat?: number;         // 0 fur, 1 foliage, 2 stone, 3 wood, 4 glow, 5 flat, 6 water
  shade?: number;       // extra darkening 0..1
  noOutline?: boolean;
  // precomputed
  bc?: V3; br?: number; mi?: number[];
}

// Isometric camera, world in tile units, z up. 1 tile = 45.255 px horizontally projected.
export const S = 45.2548;
const R: V3 = [0.70711, -0.70711, 0];
const U: V3 = [-0.35355, -0.35355, 0.86603];
const F: V3 = [-0.61237, -0.61237, -0.5];
const L0: V3 = norm([-0.25, 0.55, 0.85]);

export function norm(v: V3): V3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function rotZ(a: number): number[] { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function rotY(a: number): number[] { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotX(a: number): number[] { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function mul(a: number[], b: number[]): number[] {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
export function mv(m: number[], v: V3): V3 { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
function tr(m: number[]): number[] { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** apply a model transform (rotation then translation) to a list of primitives, returning new ones */
export function transform(prims: Prim[], m: number[], t: V3 = [0, 0, 0]): Prim[] {
  return prims.map(p => {
    const q: Prim = { ...p };
    q.c = add(mv(m, p.c), t);
    if (p.b) q.b = add(mv(m, p.b), t);
    if (p.k === 0 || p.k === 2) q.m = mul(m, p.m || I3);
    return q;
  });
}
export function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scl(a: V3, s: number): V3 { return [a[0] * s, a[1] * s, a[2] * s]; }

function prep(p: Prim) {
  const P = p as any;
  if (p.k === 0 || p.k === 2) {
    const m = p.m || I3;
    p.mi = tr(m);
    if (p.k === 0) {
      // A = diag(1/r) * R^T maps world offsets to the unit sphere; Bn = R * diag(1/r) maps sphere points to normals
      const r = p.r, mi = p.mi;
      P.A = [mi[0] / r[0], mi[1] / r[0], mi[2] / r[0], mi[3] / r[1], mi[4] / r[1], mi[5] / r[1], mi[6] / r[2], mi[7] / r[2], mi[8] / r[2]];
      P.Bn = [m[0] / r[0], m[1] / r[1], m[2] / r[2], m[3] / r[0], m[4] / r[1], m[5] / r[2], m[6] / r[0], m[7] / r[1], m[8] / r[2]];
      p.bc = p.c; p.br = Math.max(p.r[0], p.r[1], p.r[2]);
    } else { p.bc = p.c; p.br = Math.hypot(p.r[0], p.r[1], p.r[2]); }
  } else if (p.k === 1) { const b = p.b as V3; p.bc = scl(add(p.c, b), 0.5); p.br = Math.hypot(b[0] - p.c[0], b[1] - p.c[1], b[2] - p.c[2]) / 2 + p.r[0]; }
  else { p.bc = [p.c[0], p.c[1], p.c[2] + p.r[1] / 2]; p.br = Math.hypot(p.r[0], p.r[1] / 2) + 0.01; }
}

const Fx = F[0], Fy = F[1], Fz = F[2];
function setN(out: V3, x: number, y: number, z: number) { const l = Math.sqrt(x * x + y * y + z * z) || 1; out[0] = x / l; out[1] = y / l; out[2] = z / l; }
// returns t and writes the normal into out. Ray direction is always F. Scalar maths only: no allocation.
function hit(p: Prim, ox: number, oy: number, oz: number, out: V3): number {
  const bc = p.bc as V3, br = p.br as number;
  const qx0 = ox - bc[0], qy0 = oy - bc[1], qz0 = oz - bc[2];
  const bb = qx0 * Fx + qy0 * Fy + qz0 * Fz;
  if (bb * bb - (qx0 * qx0 + qy0 * qy0 + qz0 * qz0 - br * br) < 0) return -1;
  if (p.k === 0) {
    const A = (p as any).A as number[];
    const wx = ox - p.c[0], wy = oy - p.c[1], wz = oz - p.c[2];
    const sx = A[0] * wx + A[1] * wy + A[2] * wz, sy = A[3] * wx + A[4] * wy + A[5] * wz, sz = A[6] * wx + A[7] * wy + A[8] * wz;
    const dx = A[0] * Fx + A[1] * Fy + A[2] * Fz, dy = A[3] * Fx + A[4] * Fy + A[5] * Fz, dz = A[6] * Fx + A[7] * Fy + A[8] * Fz;
    const a = dx * dx + dy * dy + dz * dz, b = sx * dx + sy * dy + sz * dz, c = sx * sx + sy * sy + sz * sz - 1;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    if (t < 0) return -1;
    const ux = sx + dx * t, uy = sy + dy * t, uz = sz + dz * t;
    const Bn = (p as any).Bn as number[];
    setN(out, Bn[0] * ux + Bn[1] * uy + Bn[2] * uz, Bn[3] * ux + Bn[4] * uy + Bn[5] * uz, Bn[6] * ux + Bn[7] * uy + Bn[8] * uz);
    return t;
  }
  if (p.k === 1) {
    const a = p.c, b2 = p.b as V3, ra = p.r[0];
    const bax = b2[0] - a[0], bay = b2[1] - a[1], baz = b2[2] - a[2];
    const oax = ox - a[0], oay = oy - a[1], oaz = oz - a[2];
    const baba = bax * bax + bay * bay + baz * baz, bard = bax * Fx + bay * Fy + baz * Fz, baoa = bax * oax + bay * oay + baz * oaz;
    const rdoa = Fx * oax + Fy * oay + Fz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
    const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - ra * ra * baba;
    let h = B * B - A * C;
    if (h < 0) return -1;
    let t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) {
      const k = y / baba;
      setN(out, ox + Fx * t - a[0] - bax * k, oy + Fy * t - a[1] - bay * k, oz + Fz * t - a[2] - baz * k);
      return t;
    }
    const cx = y <= 0 ? a[0] : b2[0], cy = y <= 0 ? a[1] : b2[1], cz = y <= 0 ? a[2] : b2[2];
    const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
    const bq = Fx * ocx + Fy * ocy + Fz * ocz, cq = ocx * ocx + ocy * ocy + ocz * ocz - ra * ra;
    h = bq * bq - cq;
    if (h > 0) {
      t = -bq - Math.sqrt(h);
      setN(out, ox + Fx * t - cx, oy + Fy * t - cy, oz + Fz * t - cz);
      return t;
    }
    return -1;
  }
  if (p.k === 2) {
    const mi = p.mi as number[];
    const wx = ox - p.c[0], wy = oy - p.c[1], wz = oz - p.c[2];
    const l0 = mi[0] * wx + mi[1] * wy + mi[2] * wz, l1 = mi[3] * wx + mi[4] * wy + mi[5] * wz, l2 = mi[6] * wx + mi[7] * wy + mi[8] * wz;
    const d0 = mi[0] * Fx + mi[1] * Fy + mi[2] * Fz, d1 = mi[3] * Fx + mi[4] * Fy + mi[5] * Fz, d2 = mi[6] * Fx + mi[7] * Fy + mi[8] * Fz;
    let tmin = -1e9, tmax = 1e9, ax = -1, sg = 1;
    for (let i = 0; i < 3; i++) {
      const lo = i === 0 ? l0 : i === 1 ? l1 : l2, ld = i === 0 ? d0 : i === 1 ? d1 : d2;
      const inv = 1 / (ld || 1e-9);
      let t1 = (-p.r[i] - lo) * inv, t2 = (p.r[i] - lo) * inv;
      let s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = i; sg = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (tmin < 0) return -1;
    const m = p.m || I3;
    out[0] = m[ax] * sg; out[1] = m[3 + ax] * sg; out[2] = m[6 + ax] * sg;
    return tmin;
  }
  // cone: base centre c, radius r[0], height r[1], axis +z
  {
    const rr = p.r[0], hh = p.r[1];
    const k = rr / hh, k2 = k * k;
    const cox = ox - p.c[0], coy = oy - p.c[1], coz = oz - (p.c[2] + hh);
    const A = Fx * Fx + Fy * Fy - k2 * Fz * Fz;
    const B = cox * Fx + coy * Fy - k2 * coz * Fz;
    const C = cox * cox + coy * coy - k2 * coz * coz;
    const h = B * B - A * C;
    let best = -1;
    if (h >= 0 && Math.abs(A) > 1e-9) {
      const sq = Math.sqrt(h);
      const ta = (-B - sq) / A, tb = (-B + sq) / A;
      for (let q = 0; q < 2; q++) {
        const t = q === 0 ? ta : tb;
        if (t < 0) continue;
        const z = coz + Fz * t;
        if (z <= 0 && z >= -hh && (best < 0 || t < best)) best = t;
      }
      if (best >= 0) setN(out, cox + Fx * best, coy + Fy * best, -k2 * (coz + Fz * best));
    }
    if (Math.abs(Fz) > 1e-9) {
      const t = (p.c[2] - oz) / Fz;
      if (t > 0 && (best < 0 || t < best)) {
        const px = ox + Fx * t - p.c[0], py = oy + Fy * t - p.c[1];
        if (px * px + py * py <= rr * rr) { best = t; out[0] = 0; out[1] = 0; out[2] = -1; }
      }
    }
    return best;
  }
}

export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(Math.floor(x) | 0, 374761393) + Math.imul(Math.floor(y) | 0, 668265263) + Math.imul(Math.floor(z) | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}

export interface Sprite { w: number; h: number; ax: number; ay: number; data: Uint8ClampedArray }

export interface RenderOpts {
  w: number; h: number; ax: number; ay: number;   // canvas size, anchor (ground origin) pixel
  scale?: number;                                 // world scaling of the model
  outline?: number;                               // 0 none, 1 dark outline
  levels?: number;                                // shading quantisation
  ambient?: number;
  edge?: boolean;                                 // inner edge darkening
  light?: V3;
  toModel?: number[];                             // inverse model rotation for colour functions (world->model)
}

export function render(prims: Prim[], o: RenderOpts): Sprite {
  const { w, h, ax, ay } = o;
  const data = new Uint8ClampedArray(w * h * 4);
  const depth = new Float32Array(w * h).fill(1e9);
  const pid = new Int16Array(w * h).fill(-1);
  for (const p of prims) prep(p);
  const L = o.light || L0;
  const levels = o.levels ?? 5;
  const amb = o.ambient ?? 0.42;
  const n: V3 = [0, 0, 0];
  const toModel = o.toModel || I3;
  // cull primitives per row via projected bounds
  const proj = prims.map(p => {
    const bc = p.bc as V3, br = (p.br as number);
    const sx = dot(bc, R) * S + ax, sy = -dot(bc, U) * S + ay;
    return [sx - br * S - 1, sx + br * S + 1, sy - br * S - 1, sy + br * S + 1];
  });
  const bn: V3 = [0, 0, 1];
  const hpm: V3 = [0, 0, 0];
  const rowPrims: number[] = [];
  for (let py = 0; py < h; py++) {
    rowPrims.length = 0;
    for (let i = 0; i < prims.length; i++) if (py + 0.5 >= proj[i][2] && py + 0.5 <= proj[i][3]) rowPrims.push(i);
    if (!rowPrims.length) continue;
    const sy = -(py + 0.5 - ay) / S;
    for (let px = 0; px < w; px++) {
      const sx = (px + 0.5 - ax) / S;
      const ox = R[0] * sx + U[0] * sy - F[0] * 20, oy = R[1] * sx + U[1] * sy - F[1] * 20, oz = R[2] * sx + U[2] * sy - F[2] * 20;
      let best = 1e9, bi = -1;
      for (let q = 0; q < rowPrims.length; q++) {
        const i = rowPrims[q];
        const pr = proj[i];
        if (px + 0.5 < pr[0] || px + 0.5 > pr[1]) continue;
        const t = hit(prims[i], ox, oy, oz, n);
        if (t > 0 && t < best) { best = t; bi = i; bn[0] = n[0]; bn[1] = n[1]; bn[2] = n[2]; }
      }
      if (bi < 0) continue;
      const p = prims[bi];
      const hx = ox + F[0] * best, hy = oy + F[1] * best, hz = oz + F[2] * best;
      let col: V3;
      if (typeof p.col === 'function') {
        hpm[0] = toModel[0] * hx + toModel[1] * hy + toModel[2] * hz; hpm[1] = toModel[3] * hx + toModel[4] * hy + toModel[5] * hz; hpm[2] = toModel[6] * hx + toModel[7] * hy + toModel[8] * hz;
        col = (p.col as ColorFn)(hpm, bn);
      } else col = p.col as V3;
      const mat = p.mat || 0;
      let diff = bn[0] * L[0] + bn[1] * L[1] + bn[2] * L[2];
      if (diff < 0) diff = 0;
      if (mat === 1) diff = diff * 0.75 + 0.25 * noise3(hx * 22, hy * 22, hz * 22);
      if (mat === 2) diff = diff * 0.85 + 0.15 * noise3(hx * 9, hy * 9, hz * 9);
      let I = mat === 4 ? 1.1 : mat === 5 ? 0.9 + 0.1 * diff : amb + (1 - amb) * diff;
      if (mat === 0) { const c = 1 - Math.abs(bn[0] * F[0] + bn[1] * F[1] + bn[2] * F[2]); I += 0.08 * c * c; }
      if (levels > 0 && mat !== 4) I = Math.round(I * levels) / levels;
      if (p.shade) I *= 1 - p.shade;
      if (mat === 1) { const nn = noise3(hx * 40, hy * 40, hz * 40); I *= 0.82 + 0.3 * nn; }
      if (mat === 3) { const nn = noise3(hx * 5, hy * 5, hz * 60); I *= 0.85 + 0.25 * nn; }
      const k = (py * w + px);
      data[k * 4] = col[0] * I; data[k * 4 + 1] = col[1] * I; data[k * 4 + 2] = col[2] * I; data[k * 4 + 3] = 255;
      depth[k] = best; pid[k] = bi;
    }
  }
  // inner edges where depth jumps
  if (o.edge !== false) {
    for (let py = 1; py < h - 1; py++) for (let px = 1; px < w - 1; px++) {
      const k = py * w + px;
      if (pid[k] < 0) continue;
      const d0 = depth[k];
      let jump = false;
      for (const kk of [k - 1, k - w]) {
        if (pid[kk] >= 0 && depth[kk] < d0 - 0.09 && pid[kk] !== pid[k]) jump = true;
      }
      if (jump) { data[k * 4] *= 0.68; data[k * 4 + 1] *= 0.68; data[k * 4 + 2] *= 0.68; }
    }
  }
  // outline
  if (o.outline) {
    const src = data.slice();
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const k = py * w + px;
      if (src[k * 4 + 3]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const kk = y * w + x;
        if (!src[kk * 4 + 3]) continue;
        if (prims[pid[kk]] && prims[pid[kk]].noOutline) continue;
        r += src[kk * 4]; g += src[kk * 4 + 1]; b += src[kk * 4 + 2]; c++;
      }
      if (c) { data[k * 4] = r / c * 0.3; data[k * 4 + 1] = g / c * 0.3; data[k * 4 + 2] = b / c * 0.32; data[k * 4 + 3] = o.outline === 2 ? 140 : 235; }
    }
  }
  return { w, h, ax, ay, data };
}

/** project a world point (tile units) to sprite pixel offsets from the anchor */
export function project(p: V3): [number, number] { return [dot(p, R) * S, -dot(p, U) * S]; }
