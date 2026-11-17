// 3D primitive models for every sprite: cats, wildlife, prey, dens, trees, rocks, monsters.
import { Prim, V3, ColorFn, rotX, rotY, rotZ, mul, mv, transform, noise3, hash3, add, scl } from './rt';

// ------------------------------------------------------------------ pelts
export interface Pelt { base: V3; dark: V3; light: V3; pat: 'solid' | 'tabby' | 'spotted' | 'tortie' | 'bicolor' | 'tuxedo' | 'mottled'; eye: V3; white?: number; patch?: V3 }
const EYES: Record<string, V3> = { green: [120, 200, 80], amber: [230, 160, 40], yellow: [230, 210, 60], blue: [110, 170, 230] };
export const PELTS: Record<string, Pelt[]> = {
  thunder: [
    { base: [222, 128, 48], dark: [168, 78, 26], light: [245, 210, 160], pat: 'tabby', eye: EYES.green },
    { base: [150, 108, 68], dark: [82, 56, 34], light: [220, 200, 170], pat: 'tabby', eye: EYES.amber },
    { base: [128, 128, 132], dark: [90, 90, 96], light: [220, 220, 220], pat: 'solid', eye: EYES.yellow },
    { base: [60, 44, 36], dark: [30, 22, 18], light: [210, 120, 50], pat: 'tortie', eye: EYES.amber, patch: [215, 140, 70] },
    { base: [232, 202, 150], dark: [200, 160, 110], light: [250, 240, 220], pat: 'solid', eye: EYES.blue },
    { base: [110, 72, 44], dark: [60, 38, 22], light: [240, 236, 228], pat: 'bicolor', eye: EYES.green, white: 0.5 },
  ],
  river: [
    { base: [176, 182, 190], dark: [96, 100, 110], light: [232, 234, 238], pat: 'tabby', eye: EYES.blue },
    { base: [104, 112, 126], dark: [70, 76, 88], light: [180, 186, 196], pat: 'solid', eye: EYES.amber },
    { base: [80, 82, 90], dark: [52, 54, 60], light: [150, 152, 160], pat: 'mottled', eye: EYES.yellow },
    { base: [138, 112, 82], dark: [80, 62, 44], light: [220, 205, 180], pat: 'tabby', eye: EYES.green },
    { base: [150, 156, 166], dark: [100, 106, 116], light: [236, 236, 236], pat: 'bicolor', eye: EYES.blue, white: 0.55 },
    { base: [190, 172, 140], dark: [140, 120, 90], light: [240, 230, 210], pat: 'spotted', eye: EYES.green },
  ],
  wind: [
    { base: [176, 140, 96], dark: [118, 88, 56], light: [232, 214, 184], pat: 'tabby', eye: EYES.amber },
    { base: [204, 176, 120], dark: [160, 130, 80], light: [240, 228, 200], pat: 'solid', eye: EYES.yellow },
    { base: [120, 92, 64], dark: [72, 54, 36], light: [210, 190, 160], pat: 'mottled', eye: EYES.green },
    { base: [146, 132, 112], dark: [96, 86, 72], light: [222, 214, 200], pat: 'spotted', eye: EYES.amber },
    { base: [196, 120, 64], dark: [140, 80, 40], light: [240, 220, 190], pat: 'tabby', eye: EYES.green },
    { base: [160, 148, 128], dark: [110, 100, 84], light: [236, 230, 220], pat: 'bicolor', eye: EYES.blue, white: 0.4 },
  ],
  shadow: [
    { base: [44, 42, 48], dark: [24, 22, 28], light: [90, 88, 96], pat: 'solid', eye: EYES.yellow },
    { base: [72, 74, 80], dark: [44, 46, 52], light: [130, 132, 140], pat: 'mottled', eye: EYES.amber },
    { base: [86, 60, 40], dark: [44, 30, 20], light: [160, 130, 100], pat: 'tabby', eye: EYES.green },
    { base: [36, 34, 38], dark: [20, 18, 22], light: [236, 236, 232], pat: 'tuxedo', eye: EYES.green, white: 0.45 },
    { base: [100, 96, 100], dark: [60, 58, 64], light: [170, 166, 170], pat: 'tabby', eye: EYES.yellow },
    { base: [40, 30, 26], dark: [20, 16, 14], light: [180, 96, 40], pat: 'tortie', eye: EYES.amber, patch: [170, 100, 50] },
  ],
};
export const FOX_PELT: Pelt = { base: [210, 104, 40], dark: [60, 40, 34], light: [240, 232, 220], pat: 'bicolor', eye: EYES.amber, white: 0.35 };
export const BADGER_PELT: Pelt = { base: [120, 120, 118], dark: [24, 24, 26], light: [236, 236, 232], pat: 'solid', eye: [30, 30, 30] };

// ------------------------------------------------------------------ cat shapes
export const CAT_SCALE = 1.9;
export interface CatShape {
  scale: number; bodyLen: number; bodyW: number; bodyH: number; legLen: number; legR: number; headR: number;
  neck: number; tailLen: number; tailR: number; tailUp: number; ear: number; low: number; muzzle?: number; snout?: number; bushy?: number;
}
const BASE: CatShape = { scale: 1, bodyLen: 0.18, bodyW: 0.088, bodyH: 0.088, legLen: 0.10, legR: 0.03, headR: 0.092, neck: 0.0, tailLen: 0.27, tailR: 0.026, tailUp: 0.7, ear: 1.15, low: 0 };
export const SHAPES: Record<string, CatShape> = {
  apprentice: { ...BASE, scale: 0.82, headR: 0.088, tailLen: 0.22 },
  warrior: { ...BASE },
  riverwarrior: { ...BASE, bodyW: 0.095, bodyH: 0.09, legR: 0.029, tailLen: 0.28, tailUp: 0.35 },
  shadowwarrior: { ...BASE, bodyW: 0.08, tailUp: 0.45 },
  guard: { ...BASE, bodyLen: 0.18, bodyW: 0.12, bodyH: 0.108, legLen: 0.085, legR: 0.038, headR: 0.1, tailLen: 0.20, tailR: 0.03, tailUp: 0.5 },
  runner: { ...BASE, bodyLen: 0.21, bodyW: 0.072, bodyH: 0.074, legLen: 0.15, legR: 0.025, headR: 0.084, tailLen: 0.32, tailR: 0.02, tailUp: 0.25 },
  moorrunner: { ...BASE, bodyLen: 0.22, bodyW: 0.068, bodyH: 0.07, legLen: 0.17, legR: 0.024, headR: 0.082, tailLen: 0.34, tailR: 0.019, tailUp: 0.2 },
  stalker: { ...BASE, bodyLen: 0.2, bodyW: 0.082, bodyH: 0.078, legLen: 0.11, legR: 0.027, headR: 0.086, tailLen: 0.28, tailUp: 0.05, low: 0.55, ear: 0.9 },
  ambusher: { ...BASE, bodyLen: 0.21, bodyW: 0.092, bodyH: 0.086, legLen: 0.11, legR: 0.03, headR: 0.09, tailLen: 0.28, tailUp: 0.05, low: 0.55, ear: 0.9 },
  medicine: { ...BASE, bodyW: 0.084, bodyH: 0.084, tailUp: 0.55 },
  leader: { ...BASE, scale: 1.18, bodyW: 0.096, bodyH: 0.094, legR: 0.032, headR: 0.094, tailLen: 0.3, tailUp: 0.85 },
  kit: { ...BASE, scale: 0.45, headR: 0.115, bodyLen: 0.15, legLen: 0.08, tailLen: 0.14, ear: 1.2 },
  fox: { ...BASE, scale: 1.2, bodyLen: 0.21, bodyW: 0.085, bodyH: 0.088, legLen: 0.14, legR: 0.024, headR: 0.078, tailLen: 0.3, tailR: 0.038, tailUp: 0.2, ear: 1.4, snout: 1, bushy: 1 },
  badger: { ...BASE, scale: 1.3, bodyLen: 0.23, bodyW: 0.14, bodyH: 0.11, legLen: 0.065, legR: 0.038, headR: 0.08, tailLen: 0.08, tailR: 0.03, tailUp: 0.1, ear: 0.5, snout: 1.3 },
};

export interface Pose {
  walk?: number;     // phase 0..1
  stride?: number;
  sit?: boolean;
  crouch?: number;   // 0..1
  lunge?: number;    // -1 coil .. 1 strike
  paw?: number;      // raised front paw 0..1
  headDown?: number;
  pounce?: boolean;
  fall?: number;     // 0..1
  tail?: number;     // sway -1..1
  carry?: 'prey' | 'moss' | 'herbs' | 'leaf' | 'fish' | null;
  closedEyes?: boolean;
}

function peltColor(pelt: Pelt, part: 'body' | 'head' | 'leg' | 'tail' | 'belly' | 'muzzle' | 'ear', seed: number, sh: CatShape, kind?: string): ColorFn {
  const inv = 1 / (sh.scale * CAT_SCALE);
  return (p: V3) => {
    const x = p[0] * inv, y = p[1] * inv, z = p[2] * inv;
    let c = pelt.base;
    const w = pelt.white || 0;
    // white areas for bicolour/tuxedo
    if (pelt.pat === 'bicolor' || pelt.pat === 'tuxedo') {
      const chest = part === 'body' && x > sh.bodyLen * 0.3 && z < sh.legLen + sh.bodyH * (0.9 * w + 0.4);
      const belly = part === 'belly' || (part === 'body' && z < sh.legLen + sh.bodyH * (w * 0.9));
      if (chest || belly || part === 'muzzle' || (part === 'leg' && z < sh.legLen * (0.3 + w))) return pelt.light;
      if (kind === 'fox' && part === 'tail') return x < -sh.bodyLen - sh.tailLen * 0.75 ? pelt.light : pelt.base;
      if (kind === 'fox' && part === 'leg') return pelt.dark;
    }
    if (part === 'muzzle') return mix(pelt.base, pelt.light, 0.6);
    if (part === 'belly') return mix(pelt.base, pelt.light, 0.5);
    if (pelt.pat === 'tabby') {
      const nn = noise3(x * 30 + seed, y * 30, z * 30);
      let s: number;
      if (part === 'leg') s = Math.abs(((z * 34 + nn * 0.8) % 1 + 1) % 1 - 0.5);
      else if (part === 'tail') s = Math.abs(((x * 26 + z * 10 + nn) % 1 + 1) % 1 - 0.5);
      else s = Math.abs(((x * 22 + Math.abs(y) * 8 + nn * 1.2) % 1 + 1) % 1 - 0.5);
      if (s < 0.17) c = pelt.dark;
    } else if (pelt.pat === 'spotted') {
      if (noise3(x * 40 + seed, y * 40, z * 40) > 0.68) c = pelt.dark;
    } else if (pelt.pat === 'mottled') {
      const nn = noise3(x * 18 + seed, y * 18, z * 18);
      c = mix(pelt.base, nn > 0.5 ? pelt.light : pelt.dark, Math.abs(nn - 0.5) * 1.2);
    } else if (pelt.pat === 'tortie') {
      const nn = noise3(x * 14 + seed, y * 14 + 3, z * 14);
      if (nn > 0.6) c = pelt.patch || pelt.light; else if (nn < 0.3) c = pelt.dark;
    }
    if (kind === 'badger' && part === 'head') {
      return Math.abs(y) < 0.018 || Math.abs(y) > 0.05 ? pelt.light : pelt.dark;
    }
    if (kind === 'badger' && part === 'leg') return pelt.dark;
    if (part === 'ear') return mix(c, pelt.dark, 0.3);
    return c;
  };
}
export function mix(a: V3, b: V3, t: number): V3 { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

const E = (c: V3, r: V3, col: V3 | ColorFn, m?: number[], mat = 0): Prim => ({ k: 0, c, r, col, m, mat });
const Cap = (a: V3, b: V3, r: number, col: V3 | ColorFn, mat = 0): Prim => ({ k: 1, c: a, b, r: [r, 0, 0], col, mat });

/** Build a cat (or fox/badger) in model space: x forward, y left, z up, origin on the ground under the body. */
export function catModel(type: string, pelt: Pelt, pose: Pose, seed = 0): Prim[] {
  const sh = SHAPES[type] || SHAPES.warrior;
  const kind = type === 'fox' || type === 'badger' ? type : 'cat';
  const out: Prim[] = [];
  const crouch = Math.max(pose.crouch || 0, sh.low);
  const legLen = sh.legLen * (1 - 0.45 * crouch);
  let bodyZ = legLen + sh.bodyH * 0.55;
  let pitch = 0;
  const lunge = pose.lunge || 0;
  let bodyX = lunge * 0.05;
  if (pose.sit) { pitch = -0.62; bodyZ = sh.legLen * 0.75 + sh.bodyH * 0.9; bodyX = -0.04; }
  if (pose.pounce) { pitch = 0.12; bodyZ += 0.1; }
  if (lunge > 0.3) pitch = -0.18 * lunge;
  if (lunge < -0.3) pitch = 0.1;
  const bl = sh.bodyLen * (pose.pounce ? 1.12 : 1);
  const P = rotY(pitch);
  const at = (v: V3): V3 => add(mv(P, v), [bodyX, 0, bodyZ]);
  const body = peltColor(pelt, 'body', seed, sh, kind), leg = peltColor(pelt, 'leg', seed, sh, kind), head = peltColor(pelt, 'head', seed, sh, kind);
  const tail = peltColor(pelt, 'tail', seed, sh, kind), belly = peltColor(pelt, 'belly', seed, sh, kind), muzzle = peltColor(pelt, 'muzzle', seed, sh, kind);
  out.push(E(at([0, 0, 0]), [bl, sh.bodyW, sh.bodyH], body, P));
  out.push(E(at([bl * 0.55, 0, sh.bodyH * 0.12]), [sh.bodyH * 1.05, sh.bodyW * 1.0, sh.bodyH * 1.05], body, P));
  out.push(E(at([-bl * 0.55, 0, 0.0]), [sh.bodyH * 1.15, sh.bodyW * 1.05, sh.bodyH * 1.0], body, P));
  out.push(E(at([0, 0, -sh.bodyH * 0.35]), [bl * 0.8, sh.bodyW * 0.8, sh.bodyH * 0.6], belly, P));
  // head
  const hd = pose.headDown || 0;
  let hx = bl * 0.98 + sh.headR * 0.35 + sh.neck, hz = sh.bodyH * 1.0 - hd * (sh.bodyH * 1.3 + legLen * 0.5);
  if (pose.sit) { hx = bl * 0.95; hz = sh.bodyH * 1.2; }
  if (kind === 'badger') hz = sh.bodyH * 0.2;
  const hc = add(at([hx, 0, hz]), [0, 0, 0]);
  out.push(E(at([bl * 0.82, 0, sh.bodyH * 0.5 + hz * 0.25]), [sh.headR * 0.85, sh.bodyW * 0.85, sh.headR * 0.85], body, P));
  const hR = sh.headR;
  const HP = pose.sit ? rotY(0) : rotY(hd * 0.5);
  out.push(E(hc, [hR * 1.05, hR, hR * 0.92], head, HP));
  const snout = sh.snout || 0;
  const mz = add(hc, mv(HP, [hR * (0.78 + snout * 0.45), 0, -hR * 0.28]));
  out.push(E(mz, [hR * (0.42 + snout * 0.45), hR * (0.5 - snout * 0.15), hR * (0.36 - snout * 0.06)], muzzle, HP));
  if (snout) out.push(E(add(mz, mv(HP, [hR * (0.4 + snout * 0.45), 0, hR * 0.02])), [hR * 0.12, hR * 0.12, hR * 0.1], [30, 26, 26]));
  else out.push(E(add(mz, mv(HP, [hR * 0.38, 0, hR * 0.12])), [hR * 0.09, hR * 0.11, hR * 0.07], [210, 130, 130]));
  // ears
  const ear = sh.ear * hR;
  for (const s of [-1, 1]) {
    const flat = sh.low > 0.3 || (pose.lunge || 0) > 0.3;
    const em = mul(HP, mul(rotX(s * (flat ? 0.9 : 0.35)), rotY(flat ? -0.6 : -0.15)));
    out.push(E(add(hc, mv(HP, [-hR * 0.05, s * hR * 0.58, hR * 0.72])), [ear * 0.26, ear * 0.18, ear * 0.5], peltColor(pelt, 'ear', seed, sh, kind), em));
  }
  // eyes
  if (!pose.closedEyes && pose.fall === undefined) {
    for (const s of [-1, 1]) {
      const ec = add(hc, mv(HP, [hR * 0.78, s * hR * 0.4, hR * 0.18]));
      out.push({ ...E(ec, [hR * 0.16, hR * 0.16, hR * 0.13], pelt.eye, undefined, 4), noOutline: true });
      out.push({ ...E(add(ec, [hR * 0.08, 0, 0]), [hR * 0.1, hR * 0.06, hR * 0.12], [10, 10, 10], undefined, 4), noOutline: true });
    }
  }
  // legs
  const ph = (pose.walk || 0) * Math.PI * 2;
  const stride = pose.stride ?? 0.06;
  const legs: [number, number, number][] = [[0.6, 1, 0], [0.6, -1, Math.PI], [-0.6, 1, Math.PI], [-0.6, -1, 0]];
  legs.forEach(([fx, s, off], li) => {
    const hip = at([bl * fx * 0.95, s * sh.bodyW * 0.55, -sh.bodyH * 0.2]);
    let foot: V3;
    if (pose.sit) {
      if (fx > 0) foot = [bodyX + bl * 0.75, s * sh.bodyW * 0.45, sh.legR];
      else foot = [bodyX - bl * 0.05, s * sh.bodyW * 0.9, sh.legR];
    } else if (pose.pounce) {
      foot = fx > 0 ? add(hip, [0.13, 0, -0.06]) : add(hip, [-0.14, 0, -0.04]);
    } else {
      const sw = pose.walk !== undefined ? Math.sin(ph + off) : 0;
      const lift = pose.walk !== undefined ? Math.max(0, Math.cos(ph + off)) * 0.035 : 0;
      foot = [hip[0] + sw * stride * (fx > 0 ? 1 : 0.9), hip[1], sh.legR + lift];
      if (fx > 0 && li === 0 && (pose.paw || 0) > 0) foot = add(hip, [0.08 + 0.06 * (pose.paw || 0), 0, 0.02 + 0.05 * (pose.paw || 0)]);
      if (crouch > 0.3) foot = [hip[0] + (fx > 0 ? 0.03 : -0.02), hip[1] * 1.15, sh.legR];
    }
    if (pose.sit && fx < 0) {
      // folded haunches
      out.push(E(add(hip, [0.02, 0, -0.01]), [sh.bodyH * 1.1, sh.bodyW * 0.5, sh.bodyH * 0.75], body));
    }
    out.push(Cap(hip, foot, sh.legR * (fx > 0 ? 1 : 1.12), leg));
    out.push(E(add(foot, [0.012, 0, -sh.legR * 0.35]), [sh.legR * 1.4, sh.legR * 1.1, sh.legR * 0.8], leg));
  });
  // tail: chain of capsules
  const sway = pose.tail || 0;
  let tp = at([-bl * 0.95, 0, sh.bodyH * 0.25]);
  let ang = pose.sit ? -1.4 : (pose.pounce ? 0.15 : sh.tailUp);
  let yaw = 0;
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const len = sh.tailLen / segs;
    if (pose.sit) { yaw += 0.55 + sway * 0.2; ang = -0.25; }
    else { ang -= 0.18 * (1 - sh.tailUp); yaw += sway * 0.25; }
    const dir: V3 = [-Math.cos(ang) * Math.cos(yaw), Math.sin(yaw) * Math.cos(ang), Math.sin(ang)];
    let np = add(tp, scl(dir, len));
    if (np[2] < sh.tailR) np = [np[0], np[1], sh.tailR];
    const r = sh.tailR * (sh.bushy ? (1 + i * 0.12) : (1 - i * 0.1));
    out.push(Cap(tp, np, r, tail));
    tp = np;
  }
  // carried item
  if (pose.carry) {
    const ip = add(mz, mv(HP, [hR * 0.5, 0, -hR * 0.35]));
    if (pose.carry === 'prey') out.push(E(add(ip, [0, 0.03, -0.01]), [0.05, 0.022, 0.022], [120, 100, 86], rotZ(1.2)));
    else if (pose.carry === 'fish') out.push(E(add(ip, [0, 0.03, -0.01]), [0.06, 0.02, 0.02], [170, 186, 196], rotZ(1.2)));
    else if (pose.carry === 'moss') out.push({ ...E(ip, [0.05, 0.05, 0.04], [90, 150, 60], undefined, 1) });
    else out.push({ ...E(ip, [0.05, 0.04, 0.03], pose.carry === 'leaf' ? [70, 140, 70] : [100, 160, 80], rotZ(0.5), 1) });
    if (pose.carry === 'herbs' || pose.carry === 'leaf') out.push(E(add(ip, [0.01, -0.03, 0.02]), [0.015, 0.015, 0.015], pose.carry === 'leaf' ? [230, 200, 60] : [200, 120, 200], undefined, 4));
  }
  let model = out;
  if (pose.fall !== undefined) {
    const f = pose.fall;
    model = transform(model, rotX(f * Math.PI / 2 * 0.95), [0, -f * sh.bodyH * 0.2, -f * legLen * 0.9]);
    // keep it above ground
  }
  const S = sh.scale * CAT_SCALE;
  model = transform(model, [S, 0, 0, 0, S, 0, 0, 0, S]).map(p => ({ ...p, r: p.k === 1 ? [p.r[0] * S, 0, 0] : scl(p.r, S) as V3 }));
  return model;
}

// ------------------------------------------------------------------ wildlife and prey critters
export function critterModel(kind: string, frame: number): Prim[] {
  const hop = frame ? 0.02 : 0;
  if (kind === 'mouse' || kind === 'rat') {
    const s = kind === 'rat' ? 1.5 : 1;
    const c: V3 = kind === 'rat' ? [96, 86, 80] : [130, 110, 92];
    return [E([0, 0, 0.025 * s + hop], [0.04 * s, 0.022 * s, 0.022 * s], c), E([0.04 * s, 0, 0.03 * s + hop], [0.018 * s, 0.016 * s, 0.015 * s], c), Cap([-0.04 * s, 0, 0.02 * s], [-0.09 * s, 0.01, 0.01], 0.005 * s, [180, 140, 130])];
  }
  if (kind === 'rabbit') return [E([0, 0, 0.05 + hop], [0.06, 0.04, 0.045], [150, 120, 90]), E([0.05, 0, 0.08 + hop], [0.03, 0.028, 0.028], [150, 120, 90]), E([0.04, 0.012, 0.13 + hop], [0.01, 0.008, 0.04], [140, 110, 82]), E([0.04, -0.012, 0.13 + hop], [0.01, 0.008, 0.04], [140, 110, 82]), E([-0.06, 0, 0.06 + hop], [0.018, 0.018, 0.018], [240, 240, 236])];
  if (kind === 'frog') return [E([0, 0, 0.02 + hop], [0.035, 0.03, 0.02], [96, 140, 60]), E([0.02, 0.012, 0.035 + hop], [0.008, 0.008, 0.008], [20, 20, 20]), E([0.02, -0.012, 0.035 + hop], [0.008, 0.008, 0.008], [20, 20, 20])];
  if (kind === 'fish') return [{ ...E([0, 0, 0.005], [0.06, 0.018, 0.012], [170, 190, 200], rotZ(frame ? 0.3 : -0.2)), mat: 4 }];
  return [];
}

// ------------------------------------------------------------------ vegetation, rocks, terrain props
const LEAF = {
  newleaf: [[120, 176, 70], [96, 160, 60], [140, 190, 80]],
  greenleaf: [[60, 120, 44], [48, 106, 40], [76, 136, 50]],
  leaffall: [[200, 120, 40], [180, 140, 50], [160, 80, 30]],
  leafbare: [[110, 96, 80]],
} as Record<string, V3[]>;
export function seasonKey(s: number) { return ['newleaf', 'greenleaf', 'leaffall', 'leafbare'][s]; }

export function treeModel(style: number, season: number, v: number): Prim[] {
  const out: Prim[] = [];
  const rnd = (i: number) => hash3(v, i, style);
  const sk = seasonKey(season);
  const bare = season === 3;
  const snow: V3 = [236, 242, 248];
  if (style === 1) { // pine: evergreen
    const h = 1.5 + rnd(1) * 0.5;
    out.push({ ...Cap([0, 0, 0], [0, 0, h * 0.4], 0.07, [92, 64, 44]), mat: 3 });
    const g: V3 = season === 3 ? [40, 74, 56] : [44, 84, 52];
    for (let i = 0; i < 4; i++) {
      const z = 0.25 + i * h * 0.21, r = 0.5 - i * 0.1;
      out.push({ k: 3, c: [0, 0, z], r: [r, h * 0.38, 0], col: bare ? ((p: V3) => (noise3(p[0] * 20, p[1] * 20, p[2] * 6) > 0.45 ? snow : g)) as ColorFn : g, mat: 1 });
    }
    return out;
  }
  if (style === 2) { // willow
    out.push({ ...Cap([0, 0, 0], [0.05, 0.02, 0.8], 0.09, [104, 88, 66]), mat: 3 });
    const pal = bare ? [[150, 140, 110] as V3, [200, 200, 196] as V3] : season === 2 ? [[190, 170, 70] as V3, [160, 150, 60] as V3] : [[120, 160, 80] as V3, [100, 146, 70] as V3];
    for (let i = 0; i < (bare ? 6 : 8); i++) {
      const a = i * 0.785 + rnd(i) * 0.5;
      out.push(E([Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0.65 + rnd(i + 9) * 0.25], [bare ? 0.12 : 0.2, bare ? 0.12 : 0.2, bare ? 0.3 : 0.42], pal[i % pal.length], rotZ(a), 1));
    }
    return out;
  }
  if (style === 3) { // birch
    out.push({ ...Cap([0, 0, 0], [0, 0, 1.0], 0.06, (p: V3) => (noise3(p[0] * 9, p[1] * 9, p[2] * 30) > 0.72 ? [50, 50, 50] : [222, 220, 210]) as V3), mat: 0 });
    if (!bare) {
      const pal = season === 2 ? [[230, 190, 60] as V3, [210, 170, 50] as V3] : [[130, 180, 80] as V3, [110, 166, 70] as V3];
      for (let i = 0; i < 5; i++) out.push(E([(rnd(i) - 0.5) * 0.4, (rnd(i + 3) - 0.5) * 0.4, 1.0 + rnd(i + 6) * 0.35], [0.24, 0.24, 0.3], pal[i % 2], undefined, 1));
    } else {
      for (let i = 0; i < 5; i++) { const a = i * 1.3; out.push({ ...Cap([0, 0, 0.6], [Math.cos(a) * 0.32, Math.sin(a) * 0.32, 1.25], 0.035, [200, 196, 186]), mat: 3 }); }
    }
    return out;
  }
  // oak (style 0) and great oak (style 4)
  const big = style === 4 ? 1.75 : 0.9 + rnd(2) * 0.25;
  out.push({ ...Cap([0, 0, 0], [0, 0, 0.9 * big], 0.11 * big, [100, 78, 56]), mat: 3 });
  out.push({ ...E([0, 0, 0.04], [0.2 * big, 0.2 * big, 0.08], [96, 74, 52]), mat: 3 });
  if (bare) {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + rnd(i) * 0.4;
      const tip: V3 = [Math.cos(a) * 0.5 * big, Math.sin(a) * 0.5 * big, (1.25 + rnd(i + 4) * 0.3) * big];
      out.push({ ...Cap([0, 0, 0.75 * big], tip, 0.06 * big, [96, 80, 64]), mat: 3 });
      const mid = scl(add(tip, [0, 0, 0.75 * big]), 0.5);
      out.push({ ...Cap(mid, add(tip, [Math.cos(a + 1) * 0.2 * big, Math.sin(a + 1) * 0.2 * big, 0.1 * big]), 0.035 * big, [100, 84, 68]), mat: 3 });
      out.push(E(add(tip, [0, 0, 0.03]), [0.08 * big, 0.08 * big, 0.035], snow, undefined, 5));
    }
    return out;
  }
  const pal = LEAF[sk];
  const n = style === 4 ? 9 : 6;
  for (let i = 0; i < n; i++) {
    const a = i * (6.283 / n) + rnd(i) * 0.6;
    const rr = (i === 0 ? 0 : 0.3 + rnd(i + 20) * 0.12) * big;
    out.push(E([Math.cos(a) * rr, Math.sin(a) * rr, (1.15 + rnd(i + 30) * 0.3) * big], [0.38 * big, 0.38 * big, 0.3 * big], pal[i % pal.length], undefined, 1));
  }
  out.push(E([0, 0, 1.5 * big], [0.36 * big, 0.36 * big, 0.28 * big], pal[0], undefined, 1));
  return out;
}

export function rockModel(v: number, cliff: boolean, season: number): Prim[] {
  const out: Prim[] = [];
  const rnd = (i: number) => hash3(v, i, 77);
  const grey: V3 = [128 + rnd(1) * 20, 124 + rnd(2) * 18, 116 + rnd(3) * 14];
  if (cliff) {
    out.push({ k: 2, c: [0, 0, 0.12], r: [0.48, 0.48, 0.12], col: grey, mat: 2 });
    for (let i = 0; i < 3; i++) {
      const h = 0.5 + rnd(i + 5) * 0.5;
      out.push({ k: 2, c: [(rnd(i) - 0.5) * 0.35, (rnd(i + 9) - 0.5) * 0.35, h / 2], r: [0.28 + rnd(i + 3) * 0.12, 0.3, h / 2], m: mul(rotZ(rnd(i + 2) * 3), rotX((rnd(i + 7) - 0.5) * 0.15)), col: grey, mat: 2 });
    }
  } else {
    for (let i = 0; i < 3; i++) out.push({ ...E([(rnd(i) - 0.5) * 0.35, (rnd(i + 4) - 0.5) * 0.35, 0.12], [0.34 + rnd(i + 6) * 0.15, 0.3 + rnd(i + 7) * 0.1, 0.2 + rnd(i + 8) * 0.14], grey, rotZ(rnd(i + 3) * 3)), mat: 2 });
  }
  if (season === 3) out.push(E([0, 0, cliff ? 0.8 : 0.28], [0.25, 0.25, 0.04], [236, 242, 248], undefined, 5));
  return out;
}

export function fernModel(v: number, season: number, kind: 'fern' | 'reed' | 'heather' | 'gorse'): Prim[] {
  const out: Prim[] = [];
  const rnd = (i: number) => hash3(v, i, 13);
  if (kind === 'reed') {
    const c: V3 = season === 3 ? [170, 160, 120] : season === 2 ? [170, 150, 80] : [110, 140, 70];
    for (let i = 0; i < 5; i++) { const x = (rnd(i) - 0.5) * 0.3, y = (rnd(i + 5) - 0.5) * 0.3; out.push(Cap([x, y, 0], [x + 0.02, y, 0.3 + rnd(i + 2) * 0.15], 0.012, c)); if (i < 2) out.push(E([x + 0.02, y, 0.38 + rnd(i + 2) * 0.12], [0.015, 0.015, 0.05], [110, 80, 50])); }
    return out;
  }
  const pal: V3[] = kind === 'heather' ? (season === 3 ? [[150, 140, 140], [200, 200, 205]] : [[120, 80, 120], [100, 110, 70]]) :
    kind === 'gorse' ? (season === 3 ? [[70, 90, 60], [220, 225, 230]] : [[70, 110, 50], [230, 200, 50]]) :
      season === 3 ? [[130, 110, 80], [220, 226, 232]] : season === 2 ? [[170, 110, 50], [140, 100, 50]] : season === 0 ? [[100, 160, 70], [80, 140, 60]] : [[60, 120, 50], [50, 104, 44]];
  for (let i = 0; i < 4; i++) {
    const a = rnd(i) * 6.28;
    out.push(E([Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.09], [0.16, 0.08, 0.06 + rnd(i + 4) * 0.04], pal[i === 3 && kind !== 'fern' ? 1 : 0], mul(rotZ(a), rotY(-0.4)), 1));
  }
  if (kind === 'gorse' || kind === 'heather') for (let i = 0; i < 6; i++) out.push(E([(rnd(i + 20) - 0.5) * 0.3, (rnd(i + 30) - 0.5) * 0.3, 0.12 + rnd(i) * 0.06], [0.025, 0.025, 0.025], pal[1], undefined, 4));
  return out;
}

// ------------------------------------------------------------------ structures
const BRAMBLE: ColorFn = (p) => { const n = noise3(p[0] * 30, p[1] * 30, p[2] * 30); return (n > 0.72 ? [130, 70, 50] : n > 0.4 ? [64, 92, 44] : [50, 74, 36]) as V3; };
const FERN: ColorFn = (p) => { const n = noise3(p[0] * 26, p[1] * 26, p[2] * 26); return (n > 0.6 ? [96, 140, 60] : [66, 112, 48]) as V3; };
const EARTH: V3 = [120, 92, 62];
const SAND: V3 = [196, 176, 132];
const dark: V3 = [26, 22, 20];
export function snowify(prims: Prim[]): Prim[] {
  return prims.map(p => {
    if (p.mat === 4 || p.mat === 6) return p;
    const base = p.col;
    return { ...p, col: (pt: V3, n: V3) => (n[2] > 0.55 && pt[2] > 0.08 ? [234, 240, 246] : (typeof base === 'function' ? (base as ColorFn)(pt, n) : base as V3)) as V3 };
  });
}

export function structureModel(t: string, clanCol: V3, v = 0): Prim[] {
  const out: Prim[] = [];
  const rnd = (i: number) => hash3(v, i, 5);
  switch (t) {
    case 'camp': {
      out.push({ ...E([0, 0, 0.0], [2.3, 2.3, 0.04], SAND), mat: 5 });
      // bramble wall ring with entrance facing the viewer (+x+y)
      for (let i = 0; i < 30; i++) {
        const a = i / 30 * 6.2832;
        const ent = Math.abs(((a - 0.785 + 9.42) % 6.2832) - 3.1416);
        if (ent < 0.42) continue;
        const r = 2.1 + (rnd(i) - 0.5) * 0.15;
        const front = Math.cos(a - 0.785) > 0.3;
        out.push(E([Math.cos(a) * r, Math.sin(a) * r, 0.28], [0.42, 0.42, front ? 0.34 : 0.5 + rnd(i + 40) * 0.12], BRAMBLE, undefined, 1));
      }
      // Highrock at the back
      out.push({ ...E([-0.9, -0.9, 0.45], [0.75, 0.55, 0.6], [140, 136, 126], rotZ(0.6)), mat: 2 });
      out.push({ ...E([-1.0, -1.1, 0.95], [0.4, 0.32, 0.25], [150, 146, 136], rotZ(0.6)), mat: 2 });
      // leader's den hollow under the rock
      out.push({ ...E([-0.45, -0.55, 0.15], [0.18, 0.18, 0.14], dark), mat: 5, noOutline: true });
      // small dens
      out.push(E([0.9, -1.1, 0.25], [0.45, 0.4, 0.3], FERN, undefined, 1));
      out.push(E([-1.15, 0.85, 0.25], [0.45, 0.4, 0.3], FERN, undefined, 1));
      // fresh-kill pile
      for (let i = 0; i < 7; i++) out.push(E([0.25 + (rnd(i) - 0.5) * 0.35, 0.25 + (rnd(i + 7) - 0.5) * 0.35, 0.05 + rnd(i + 3) * 0.05], [0.07, 0.035, 0.03], i % 3 ? [126, 104, 88] : [150, 130, 110], rotZ(rnd(i) * 3)));
      break;
    }
    case 'nursery': {
      out.push(E([0, 0, 0.05], [1.25, 1.25, 0.9], BRAMBLE, undefined, 1));
      out.push({ ...E([0.85, 0.85, 0.22], [0.25, 0.25, 0.22], dark), mat: 5 });
      out.push(E([0.2, -0.9, 0.4], [0.35, 0.3, 0.3], FERN, undefined, 1));
      break;
    }
    case 'den': {
      out.push(E([0, 0, 0.02], [0.8, 0.8, 0.52], FERN, undefined, 1));
      out.push({ ...E([0.55, 0.55, 0.16], [0.17, 0.17, 0.15], dark), mat: 5 });
      break;
    }
    case 'cache': {
      out.push({ ...E([0, 0, 0], [0.62, 0.55, 0.2], EARTH), mat: 2 });
      out.push({ ...E([0.2, -0.15, 0.12], [0.18, 0.16, 0.12], [150, 146, 136]), mat: 2 });
      for (let i = 0; i < 4; i++) out.push(E([(rnd(i) - 0.5) * 0.6, (rnd(i + 4) - 0.5) * 0.6, 0.16], [0.09, 0.05, 0.015], [80, 130, 50], rotZ(rnd(i) * 3)));
      out.push(E([0.15, 0.3, 0.12], [0.06, 0.03, 0.025], [120, 100, 86], rotZ(0.4)));
      break;
    }
    case 'hollow': {
      out.push({ ...E([0, 0, -0.02], [1.35, 1.35, 0.05], SAND), mat: 5 });
      out.push({ ...Cap([-0.8, 0.3, 0.14], [0.2, -0.85, 0.16], 0.15, [110, 86, 60]), mat: 3 });
      out.push({ ...Cap([0.7, -0.4, 0], [0.7, -0.4, 0.3], 0.18, [120, 92, 64]), mat: 3 });
      out.push(E([-0.85, -0.85, 0.15], [0.35, 0.3, 0.22], FERN, undefined, 1));
      out.push(E([0.95, 0.65, 0.12], [0.3, 0.25, 0.18], FERN, undefined, 1));
      break;
    }
    case 'marker': {
      out.push({ ...Cap([0, 0, 0], [0, 0, 0.32], 0.1, [104, 82, 60]), mat: 3 });
      out.push({ ...E([0, 0, 0.33], [0.1, 0.1, 0.03], [170, 140, 100]), mat: 5 });
      out.push(E([0.12, 0.08, 0.05], [0.1, 0.08, 0.06], FERN, undefined, 1));
      break;
    }
    case 'medden': {
      out.push({ ...E([-0.35, -0.2, 0.5], [0.75, 0.45, 0.7], [134, 130, 122], rotZ(0.4)), mat: 2 });
      out.push({ ...E([0.35, -0.55, 0.4], [0.55, 0.4, 0.55], [124, 120, 112], rotZ(-0.3)), mat: 2 });
      out.push({ ...E([0.15, 0.1, 0.25], [0.22, 0.22, 0.25], dark), mat: 5 });
      out.push(E([0.0, 0.5, 0.35], [0.25, 0.3, 0.4], FERN, undefined, 1));
      for (let i = 0; i < 6; i++) out.push(E([0.6 + (rnd(i) - 0.5) * 0.5, 0.45 + (rnd(i + 2) - 0.5) * 0.5, 0.06], [0.07, 0.05, 0.04], [[220, 190, 60], [200, 120, 200], [240, 240, 230], [90, 150, 70]][i % 4] as V3, undefined, 1));
      break;
    }
    case 'elders': {
      out.push({ ...Cap([-1.1, 0.4, 0.3], [1.0, -0.6, 0.35], 0.32, [104, 84, 62]), mat: 3 });
      out.push({ ...E([-1.05, 0.38, 0.3], [0.05, 0.3, 0.3], [150, 120, 80], rotZ(-0.45)), mat: 3 });
      out.push(E([0.0, 0.55, 0.3], [0.55, 0.4, 0.38], FERN, undefined, 1));
      for (let i = 0; i < 8; i++) out.push(E([(rnd(i) - 0.3) * 0.8, 0.4 + (rnd(i + 8) - 0.5) * 0.4, 0.45 + rnd(i + 3) * 0.2], [0.04, 0.04, 0.04], [240, 220, 120], undefined, 4));
      out.push({ ...E([0.35, 0.1, 0.12], [0.18, 0.18, 0.13], dark), mat: 5 });
      break;
    }
    case 'barrier': {
      for (let i = 0; i < 5; i++) out.push(E([(rnd(i) - 0.5) * 0.45, (rnd(i + 5) - 0.5) * 0.45, 0.2 + rnd(i + 2) * 0.15], [0.26, 0.26, 0.26], BRAMBLE, undefined, 1));
      break;
    }
    case 'gorse': {
      out.push(E([-0.3, 0.3, 0.25], [0.25, 0.25, 0.3], (p: V3) => (noise3(p[0] * 40, p[1] * 40, p[2] * 40) > 0.7 ? [230, 200, 50] : [70, 110, 50]) as V3, undefined, 1));
      out.push(E([0.3, -0.3, 0.25], [0.25, 0.25, 0.3], (p: V3) => (noise3(p[0] * 40, p[1] * 40, p[2] * 40) > 0.7 ? [230, 200, 50] : [70, 110, 50]) as V3, undefined, 1));
      out.push({ ...Cap([-0.3, 0.3, 0.5], [0.3, -0.3, 0.5], 0.12, (p: V3) => (noise3(p[0] * 40, p[1] * 40, p[2] * 40) > 0.7 ? [230, 200, 50] : [70, 110, 50]) as V3), mat: 1 });
      break;
    }
    case 'tunnel': {
      out.push({ ...E([0, 0, 0], [0.48, 0.48, 0.22], EARTH), mat: 2 });
      out.push({ ...E([0.25, 0.25, 0.1], [0.16, 0.16, 0.12], dark), mat: 5 });
      break;
    }
    case 'fence': {
      for (let i = -1; i <= 1; i++) out.push({ k: 2, c: [i * 0.4, 0, 0.3], r: [0.04, 0.04, 0.3], col: [150, 120, 84], mat: 3 });
      out.push({ k: 2, c: [0, 0, 0.45], r: [0.5, 0.025, 0.04], col: [160, 128, 90], mat: 3 });
      out.push({ k: 2, c: [0, 0, 0.2], r: [0.5, 0.025, 0.04], col: [160, 128, 90], mat: 3 });
      break;
    }
    case 'fenceY': return transform(structureModel('fence', clanCol, v), rotZ(Math.PI / 2));
    case 'moss': {
      for (let i = 0; i < 6; i++) out.push(E([(rnd(i) - 0.5) * 1.0, (rnd(i + 6) - 0.5) * 1.0, 0.04], [0.18 + rnd(i) * 0.1, 0.16, 0.07], i % 2 ? [96, 160, 64] : [120, 176, 70], rotZ(rnd(i) * 3), 1));
      for (let i = 0; i < 3; i++) out.push({ ...E([(rnd(i + 20) - 0.5) * 0.9, (rnd(i + 26) - 0.5) * 0.9, 0.05], [0.12, 0.1, 0.08], [130, 126, 118]), mat: 2 });
      break;
    }
    case 'herb': case 'catmint': case 'snakeherb': {
      const fl: V3 = t === 'catmint' ? [170, 130, 220] : t === 'snakeherb' ? [240, 240, 220] : [240, 190, 50];
      for (let i = 0; i < 9; i++) {
        const x = (rnd(i) - 0.5) * 1.0, y = (rnd(i + 9) - 0.5) * 1.0;
        out.push(E([x, y, 0.06], [0.1, 0.08, 0.07], [80, 140, 66], rotZ(rnd(i) * 3), 1));
        out.push(E([x, y, 0.14], [0.03, 0.03, 0.03], fl, undefined, 4));
      }
      break;
    }
  }
  return out;
}

export function monsterModel(kind: number): Prim[] {
  const cols: V3[] = [[180, 40, 40], [50, 90, 170], [220, 220, 210], [60, 130, 70]];
  const c = cols[kind % 4];
  const out: Prim[] = [];
  out.push({ k: 2, c: [0, 0, 0.32], r: [0.75, 0.36, 0.18], col: c, mat: 2 });
  out.push({ k: 2, c: [-0.1, 0, 0.6], r: [0.42, 0.32, 0.14], col: (p: V3, n: V3) => (Math.abs(n[2]) < 0.5 ? [60, 80, 100] : c) as V3, mat: 2 });
  for (const [x, y] of [[0.5, 0.36], [0.5, -0.36], [-0.5, 0.36], [-0.5, -0.36]]) out.push({ ...Cap([x, y - 0.04, 0.14], [x, y + 0.04, 0.14], 0.14, [30, 30, 30]), mat: 2 });
  out.push({ ...E([0.76, 0.22, 0.34], [0.03, 0.07, 0.05], [255, 250, 200], undefined, 4), noOutline: true });
  out.push({ ...E([0.76, -0.22, 0.34], [0.03, 0.07, 0.05], [255, 250, 200], undefined, 4), noOutline: true });
  return out;
}
