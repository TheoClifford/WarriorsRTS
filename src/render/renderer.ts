// Draws the latest simulation state, interpolating between ticks.
import { World, UNITS, BLDS, isFighter, baseType } from '../sim/world';
import { B, TILE, MAPN, T_TREES, T_ROCK, T_UNDER, T_MOOR, T_MARSH, T_FENCE, T_FLAT, T_RIVER, T_TUNNEL, octant } from '../sim/core';
import type { Ent } from '../sim/types';
import { SpriteCache, CSprite } from './sprites';
import { TerrainCache, iso, unIso, OX, MAP_W, MAP_H, CH, minimapColor } from './terrain';
import { hash3 } from './rt';

const N = MAPN;
export function hexToRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function clanColor(clan: string): string { return (B.clans[clan] && B.clans[clan].color) || '#cccccc'; }

interface Prop { x: number; y: number; key: number; kind: number; a: number; b: number; c: number; sx: number; sy: number; ti: number }
const PB = 256; // prop bucket size in world-screen pixels   // kind: 0 tree 1 rock 2 fern 3 reed 4 heather 5 gorse 6 fence 7 greatrock
export interface Bark { id: number; text: string; t: number }
export interface Ping { x: number; y: number; t: number; color: string }
export interface DrawState {
  sel: Set<number>; hover: number; box: [number, number, number, number] | null;
  ghost: { type: string; tx: number; ty: number; ok: boolean; tiles?: number[] } | null;
  barks: Bark[]; pings: Ping[]; clicks: { x: number; y: number; t: number; atk: boolean }[];
  showAll: boolean; flash: number; shake: number;
}

const D_FN = 0, D_SPR = 1, D_BIGSPR = 2;
interface DrawRec { k: number; kind: number; spr: CSprite | null; x: number; y: number; flag: number; fn: (() => void) | null }
export class Renderer {
  pool: DrawRec[] = [];
  nDraw = 0;
  pushDraw(k: number, kind: number, spr: CSprite | null, x: number, y: number, flag: number, fn: (() => void) | null = null) {
    let d = this.pool[this.nDraw];
    if (!d) { d = { k: 0, kind: 0, spr: null, x: 0, y: 0, flag: 0, fn: null }; this.pool[this.nDraw] = d; }
    d.k = k; d.kind = kind; d.spr = spr; d.x = x; d.y = y; d.flag = flag; d.fn = fn;
    this.nDraw++;
  }
  ctx: CanvasRenderingContext2D;
  sprites = new SpriteCache();
  terrain: TerrainCache;
  camX = 0; camY = 0; w = 0; h = 0; viewH = 0;
  props: Prop[] = [];
  propBuckets: Prop[][] = [];
  pbW = 0;
  fog: HTMLCanvasElement; fogCtx: CanvasRenderingContext2D; fogImg: ImageData;
  mini: HTMLCanvasElement | null = null; miniBase: HTMLCanvasElement | null = null; miniSeason = -1;
  fxList: { x: number; y: number; kind: string; t: number; o?: number }[] = [];
  lastFxTick = -1;
  particles: { x: number; y: number; vx: number; vy: number; s: number }[] = [];
  lastSeen = new Map<number, { t: string; o: number; tx: number; ty: number; sz: number; done: boolean }>();
  time = 0;

  constructor(public canvas: HTMLCanvasElement, public world: World, public me: number) {
    this.ctx = canvas.getContext('2d')!;
    this.terrain = new TerrainCache(world.map, () => world.frozen);
    this.fog = document.createElement('canvas'); this.fog.width = N; this.fog.height = N;
    this.fogCtx = this.fog.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(N, N);
    this.buildProps();
    for (let i = 0; i < 140; i++) this.particles.push({ x: Math.random() * 2000, y: Math.random() * 1200, vx: 0, vy: 0, s: Math.random() });
  }

  buildProps() {
    this.buildPropsRaw();
    this.pbW = Math.ceil(MAP_W / PB) + 1;
    const pbH = Math.ceil(MAP_H / PB) + 1;
    this.propBuckets = Array.from({ length: this.pbW * pbH }, () => []);
    for (const p of this.props) {
      const [sx, sy] = iso(p.x, p.y);
      p.sx = sx; p.sy = sy;
      p.ti = Math.min(N - 1, Math.floor(p.y)) * N + Math.min(N - 1, Math.floor(p.x));
      const bx = Math.max(0, Math.min(this.pbW - 1, Math.floor(sx / PB))), by = Math.max(0, Math.min(pbH - 1, Math.floor(sy / PB)));
      this.propBuckets[by * this.pbW + bx].push(p);
    }
  }
  buildPropsRaw() {
    const m = this.world.map;
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      const i = ty * N + tx;
      const t = m.terrain[i], d = m.deco[i];
      const h = hash3(tx, ty, 3), h2 = hash3(tx, ty, 9);
      const jx = (h - 0.5) * 0.3, jy = (h2 - 0.5) * 0.3;
      if (t === T_TREES) {
        const style = d & 7, v = (d >> 3) & 31;
        if (style === 4) { if (v === 0) this.props.push({ x: tx + 1, y: ty + 1, sx: 0, sy: 0, ti: 0, key: 0, kind: 0, a: 4, b: 0, c: 0 }); continue; }
        this.props.push({ x: tx + 0.5 + jx, y: ty + 0.5 + jy, sx: 0, sy: 0, ti: 0, key: 0, kind: 0, a: style, b: v % 4, c: 0 });
      } else if (t === T_ROCK) {
        this.props.push({ x: tx + 0.5 + jx * 0.5, y: ty + 0.5 + jy * 0.5, sx: 0, sy: 0, ti: 0, key: 0, kind: 1, a: (d & 7) === 6 ? 1 : 0, b: (tx * 7 + ty * 3) % 6, c: 0 });
      } else if (t === T_FLAT && (d & 7) === 5 && tx === 47 && ty === 47) {
        this.props.push({ x: 48, y: 48, sx: 0, sy: 0, ti: 0, key: 0, kind: 7, a: 0, b: 0, c: 0 });
      } else if (t === T_UNDER) {
        const reed = m.region[i] === 0 && hash3(tx, ty, 1) < 0.5;
        this.props.push({ x: tx + 0.5 + jx, y: ty + 0.5 + jy, sx: 0, sy: 0, ti: 0, key: 0, kind: reed ? 3 : 2, a: (tx * 3 + ty) % 4, b: 0, c: 0 });
        if (h > 0.55) this.props.push({ x: tx + 0.2 + jy, y: ty + 0.8 + jx, sx: 0, sy: 0, ti: 0, key: 0, kind: reed ? 3 : 2, a: (tx + ty * 5) % 4, b: 0, c: 0 });
      } else if (t === T_MOOR) {
        if (h < 0.1) this.props.push({ x: tx + 0.5 + jx, y: ty + 0.5 + jy, sx: 0, sy: 0, ti: 0, key: 0, kind: h < 0.04 ? 5 : 4, a: (tx + ty) % 4, b: 0, c: 0 });
      } else if (t === T_MARSH) {
        if (h < 0.35) this.props.push({ x: tx + 0.5 + jx, y: ty + 0.5 + jy, sx: 0, sy: 0, ti: 0, key: 0, kind: 3, a: (tx + ty) % 4, b: 0, c: 0 });
      } else if (t === T_FENCE) {
        const alongX = (tx > 0 && m.terrain[i - 1] === T_FENCE) || (tx < N - 1 && m.terrain[i + 1] === T_FENCE);
        this.props.push({ x: tx + 0.5, y: ty + 0.5, sx: 0, sy: 0, ti: 0, key: 0, kind: 6, a: alongX ? 0 : 1, b: 0, c: 0 });
      }
    }
  }

  resize(w: number, h: number, hudBottom: number) {
    this.w = w; this.h = h; this.viewH = h - hudBottom;
    this.canvas.width = w; this.canvas.height = h;
  }
  centerOn(x: number, y: number) {
    const [sx, sy] = iso(x / TILE, y / TILE);
    this.camX = sx - this.w / 2; this.camY = sy - this.viewH / 2;
    this.clampCam();
  }
  clampCam() {
    this.camX = Math.max(-200, Math.min(MAP_W - this.w + 200, this.camX));
    this.camY = Math.max(-200, Math.min(MAP_H - this.viewH + 160, this.camY));
  }
  /** screen px -> fixed-point world */
  toWorld(px: number, py: number): [number, number] {
    const [fx, fy] = unIso(px + this.camX, py + this.camY);
    return [Math.round(fx * TILE), Math.round(fy * TILE)];
  }
  toScreen(x: number, y: number): [number, number] {
    const [sx, sy] = iso(x / TILE, y / TILE);
    return [sx - this.camX, sy - this.camY];
  }

  seeTile(i: number): number { // 0 unexplored, 1 explored, 2 visible
    if (this.me < 0) return 2;
    const p = this.world.players[this.me];
    return p.vis[i] ? 2 : p.explored[i] ? 1 : 0;
  }

  // ------------------------------------------------------------------ main draw
  draw(alpha: number, st: DrawState, now: number) {
    this.time = now;
    const ctx = this.ctx, w = this.world;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10140e';
    ctx.fillRect(0, 0, this.w, this.h);
    let shx = 0, shy = 0;
    if (st.shake > 0) { shx = (Math.random() - 0.5) * st.shake * 4; shy = (Math.random() - 0.5) * st.shake * 4; }
    ctx.translate(Math.round(shx), Math.round(shy));
    const season = w.season;
    // ---- terrain chunks
    const cx0 = Math.floor(this.camX / CH), cx1 = Math.floor((this.camX + this.w) / CH);
    const cy0 = Math.floor(this.camY / CH), cy1 = Math.floor((this.camY + this.h) / CH);
    const T = this.terrain;
    const firstFrame = T.chunks.size === 0;
    for (let cy = Math.max(0, cy0); cy <= Math.min(Math.ceil(MAP_H / CH) - 1, cy1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(Math.ceil(MAP_W / CH) - 1, cx1); cx++) {
        // the very first frame paints synchronously (behind the start banner); after that chunks paint progressively
        let c = T.get(cx, cy, season, firstFrame);
        if (!c) {
          for (let s = 1; s < 4 && !c; s++) c = T.chunks.get(T.key(cx, cy, (season + 4 - s) % 4)) || null;
          if (!c) continue;
        }
        ctx.drawImage(c, cx * CH - Math.round(this.camX), cy * CH - Math.round(this.camY));
      }
    }
    // prefetch the ring of chunks around the view, then paint within a small budget
    for (let cy = Math.max(0, cy0 - 1); cy <= Math.min(Math.ceil(MAP_H / CH) - 1, cy1 + 1); cy++)
      for (let cx = Math.max(0, cx0 - 1); cx <= Math.min(Math.ceil(MAP_W / CH) - 1, cx1 + 1); cx++)
        if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1) { if (!T.chunks.has(T.key(cx, cy, season))) T.jobs.length < 6 && T.request(cx, cy, season); }
    T.pump(5);
    // tile range on screen
    const corners = [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]].map(([x, y]) => unIso(x + this.camX, y + this.camY));
    const minX = Math.max(0, Math.floor(Math.min(...corners.map(c => c[0]))) - 3), maxX = Math.min(N - 1, Math.ceil(Math.max(...corners.map(c => c[0]))) + 3);
    const minY = Math.max(0, Math.floor(Math.min(...corners.map(c => c[1]))) - 3), maxY = Math.min(N - 1, Math.ceil(Math.max(...corners.map(c => c[1]))) + 3);
    const onScreen = (sx: number, sy: number, m = 160) => sx > -m && sx < this.w + m && sy > -m && sy < this.h + m * 1.5;

    // ---- ground layer: tunnel mouths, resource beds, territory markers, selection rings, shadows
    for (const b of w.blds) if (b.t === 'marker' && b.done && !b.gone && (b.o === this.me || this.seeTile(w.ti(b.x, b.y)) > 0 || st.showAll)) this.markerRing(b);
    this.nDraw = 0;
    const draws = { push: (d: { k: number; f: () => void }) => this.pushDraw(d.k, D_FN, null, 0, 0, 0, d.f) };
    // tunnel mouths
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
      if (w.map.terrain[ty * N + tx] !== T_TUNNEL) continue;
      if (Math.abs(tx - ty) > 0) continue;
      const [sx, sy] = iso(tx + 0.5, ty + 0.5);
      ctx.fillStyle = 'rgba(20,16,14,0.8)';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx - this.camX + s * 70, sy - this.camY + s * 0, 10, 6, 0, 0, 7); ctx.fill(); }
    }
    // resources
    for (const r of w.ress) {
      const ti = w.ti(r.x, r.y);
      if (!st.showAll && this.seeTile(ti) === 0) continue;
      const [sx, sy] = this.toScreen(r.x, r.y);
      if (!onScreen(sx, sy)) continue;
      if (r.sub === 'moss' || r.sub === 'herb') {
        const kind = r.sub === 'moss' ? 'moss' : r.rname === 'Catmint' ? 'catmint' : r.rname === 'Snakerocks' ? 'snakeherb' : 'herb';
        const spr = this.sprites.structure(kind, [0, 0, 0], 1, season === 3);
        if (spr) {
          ctx.globalAlpha = (r.stock as number) <= 0 ? 0.25 : 0.6 + 0.4 * Math.min(1, (r.stock as number) / (r.cap as number));
          ctx.drawImage(spr.c, Math.round(sx - spr.ax), Math.round(sy - spr.ay));
          ctx.globalAlpha = 1;
        }
      } else if (r.sub === 'carrion') {
        ctx.fillStyle = 'rgba(80,70,60,0.55)';
        ctx.beginPath(); ctx.ellipse(sx, sy, 40, 18, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#d8d2c4';
        for (let i = 0; i < 6; i++) { const a = i * 1.1; ctx.fillRect(Math.round(sx + Math.cos(a) * 24), Math.round(sy + Math.sin(a) * 9), 6, 2); }
      }
      // critters
      if (r.critter && (r.stock as number) > 0 && !((r.fallow as number) > w.tick) && this.seeTile(ti) === 2 && !(r.sub === 'fish' && w.frozen)) {
        const n = r.sub === 'fish' ? 2 : Math.min(5, Math.ceil((r.stock as number) / 90));
        for (let i = 0; i < n; i++) {
          const ph = now / 1000 * (0.35 + i * 0.07) + i * 2.1 + r.id;
          const rad = (r.r as number) / TILE * (0.4 + 0.5 * ((i * 0.37) % 1));
          const fx = r.x / TILE + Math.cos(ph) * rad, fy = r.y / TILE + Math.sin(ph * 1.3) * rad;
          const [px, py] = this.toScreen(fx * TILE, fy * TILE);
          const frame = Math.floor(now / 180 + i) % 2;
          if (r.sub === 'fish' && Math.sin(ph * 3) < 0.6) continue;
          const sp = this.sprites.critter(r.critter, frame);
          if (sp) this.pushDraw(py, D_SPR, sp, px, py, 0);
        }
      }
    }
    // static props (bucketed by screen region)
    {
      const pbH = this.propBuckets.length / this.pbW;
      const bx0 = Math.max(0, Math.floor((this.camX - 300) / PB)), bx1 = Math.min(this.pbW - 1, Math.floor((this.camX + this.w + 300) / PB));
      const by0 = Math.max(0, Math.floor((this.camY - 120) / PB)), by1 = Math.min(pbH - 1, Math.floor((this.camY + this.h + 420) / PB));
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const bucket = this.propBuckets[by * this.pbW + bx];
        for (let k = 0; k < bucket.length; k++) {
          const p = bucket[k];
          if (!st.showAll && this.seeTile(p.ti) === 0) continue;
          const sx = p.sx - this.camX, sy = p.sy - this.camY;
          if (!onScreen(sx, sy, 260)) continue;
          let spr: CSprite | null = null;
          if (p.kind === 0) spr = this.sprites.tree(p.a, season, p.b);
          else if (p.kind === 1) spr = this.sprites.rock(p.b, p.a === 1, season);
          else if (p.kind === 2) spr = this.sprites.prop('fern', p.a, season);
          else if (p.kind === 3) spr = this.sprites.prop('reed', p.a, season);
          else if (p.kind === 4) spr = this.sprites.prop('heather', p.a, season);
          else if (p.kind === 5) spr = this.sprites.prop('gorse', p.a, season);
          else if (p.kind === 6) spr = this.sprites.structure(p.a ? 'fenceY' : 'fence', [0, 0, 0], 1, season === 3);
          else if (p.kind === 7) spr = this.sprites.rock(9, false, season);
          if (!spr) continue;
          this.pushDraw(sy - (p.kind >= 2 && p.kind <= 5 ? 6 : 0), p.kind === 7 ? D_BIGSPR : D_SPR, spr, sx, sy, 0);
        }
      }
    }
    // buildings
    for (const b of w.blds) {
      if (b.gone) continue;
      const vis = st.showAll || b.o === this.me || (((b.seen as number) >> this.me) & 1);
      if (!vis) continue;
      const [sx, sy] = this.toScreen(b.x, b.y);
      if (!onScreen(sx, sy, 300)) continue;
      const sz = b.sz as number;
      // soft coloured ground shadow
      if (b.o >= 0) this.footprint(b.tx as number, b.ty as number, sz, clanColor(w.clanOf(b.o)), 0.16, st.sel.has(b.id) ? 0.95 : 0.3);
      draws.push({ k: sy + sz * 4, f: () => this.drawBuilding(b, sx, sy) });
    }
    // units
    for (const u of w.units) {
      if (u.dead || u.hide) continue;
      const visible = st.showAll || this.me < 0 || w.visibleTo(u, this.me);
      if (!visible) continue;
      const x = (u.px as number) + ((u.x - (u.px as number)) * alpha), y = (u.py as number) + ((u.y - (u.py as number)) * alpha);
      const [sx, sy] = this.toScreen(x, y);
      if (!onScreen(sx, sy)) continue;
      // shadow + team colour
      const r = w.radius(u) / TILE * 32;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.25, r * 0.62, 0, 0, 7); ctx.fill();
      if (u.o >= 0) {
        ctx.fillStyle = clanColor(w.clanOf(u.o));
        ctx.globalAlpha = 0.32;
        ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.45, r * 0.75, 0, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (st.sel.has(u.id) || st.hover === u.id) {
        ctx.strokeStyle = u.o === this.me ? (st.sel.has(u.id) ? '#ffffff' : 'rgba(255,255,255,0.6)') : u.o < 0 ? '#e0c060' : clanColor(w.clanOf(u.o));
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.6, r * 0.82, 0, 0, 7); ctx.stroke();
      }
      draws.push({ k: sy, f: () => this.drawUnit(u, sx, sy, st) });
    }
    // corpses
    for (const c of w.corpses) {
      const age = w.tick - c.tick;
      if (age > 140) continue;
      if (!st.showAll && this.seeTile(w.ti(c.x, c.y)) !== 2) continue;
      const [sx, sy] = this.toScreen(c.x, c.y);
      if (!onScreen(sx, sy)) continue;
      const pose = age < 6 ? 0 : 1;
      const spr = this.sprites.unit(c.t, c.clan || 'thunder', c.pelt, c.face, 'fall', pose, true);
      if (!spr) continue;
      draws.push({ k: sy - 2, f: () => { this.ctx.globalAlpha = age > 80 ? Math.max(0, 1 - (age - 80) / 60) : 1; this.blit(spr.s, sx, sy, spr.flip); this.ctx.globalAlpha = 1; } });
    }
    // monsters
    for (const m of w.monsters) {
      const [mx, my] = w.roadPos(m.s);
      const [mx2, my2] = w.roadPos(m.s + m.dir * 400);
      if (!st.showAll && this.seeTile(w.ti(mx, my)) === 0) continue;
      const [sx, sy] = this.toScreen(mx, my);
      if (!onScreen(sx, sy, 200)) continue;
      const face = octant(mx2 - mx, my2 - my);
      const spr = this.sprites.monster(m.kind, face);
      if (!spr) continue;
      draws.push({ k: sy, f: () => {
        this.blit(spr.s, sx, sy, spr.flip);
        const [hx, hy] = this.toScreen(mx2 + (mx2 - mx) * 3, my2 + (my2 - my) * 3);
        const g = this.ctx.createRadialGradient(hx, hy, 2, hx, hy, 60);
        g.addColorStop(0, 'rgba(255,250,200,0.5)'); g.addColorStop(1, 'rgba(255,250,200,0)');
        this.ctx.fillStyle = g; this.ctx.beginPath(); this.ctx.ellipse(hx, hy, 60, 30, 0, 0, 7); this.ctx.fill();
      } });
    }
    const list = this.pool.slice(0, this.nDraw);
    list.sort((a, b) => a.k - b.k);
    for (const d of list) {
      if (d.kind === D_SPR) { const s = d.spr as CSprite; ctx.drawImage(s.c, Math.round(d.x - s.ax), Math.round(d.y - s.ay)); }
      else if (d.kind === D_BIGSPR) { const s = d.spr as CSprite; ctx.drawImage(s.c, Math.round(d.x - s.ax * 1.6), Math.round(d.y - s.ay * 1.6), s.w * 1.6, s.h * 1.6); }
      else if (d.fn) d.fn();
    }

    // ---- effects
    this.collectFx();
    this.drawFx(now, st);
    // ---- fog
    if (!st.showAll && this.me >= 0) this.drawFog();
    // ---- overlays on top of fog
    for (const u of w.units) {
      if (u.dead || u.hide) continue;
      if (!(st.sel.has(u.id) || st.hover === u.id || (w.tick - (u.lastHurt as number) < 60 && u.hp < u.mhp))) continue;
      if (!st.showAll && this.me >= 0 && !w.visibleTo(u, this.me)) continue;
      const x = (u.px as number) + ((u.x - (u.px as number)) * alpha), y = (u.py as number) + ((u.y - (u.py as number)) * alpha);
      const [sx, sy] = this.toScreen(x, y);
      this.hpBar(sx, sy - (u.leader ? 52 : 44), u.hp / u.mhp, 26);
    }
    for (const b of w.blds) {
      if (b.gone || !(st.sel.has(b.id) || st.hover === b.id)) continue;
      const [sx, sy] = this.toScreen(b.x, b.y);
      this.hpBar(sx, sy - (b.sz as number) * 16 - 40, b.hp / b.mhp, 40);
      if (b.rally && b.o === this.me) {
        const [rx, ry] = this.toScreen(b.rally.x, b.rally.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
        this.paw(rx, ry, '#fff');
      }
    }
    // barks
    ctx.font = 'bold 12px Alegreya, Georgia, serif';
    ctx.textAlign = 'center';
    for (const bk of st.barks) {
      const u = w.get(bk.id);
      if (!u || u.dead || u.hide) continue;
      const age = now - bk.t;
      if (age > 1800) continue;
      const [sx, sy] = this.toScreen(u.x, u.y);
      ctx.globalAlpha = Math.min(1, (1800 - age) / 400);
      ctx.fillStyle = 'rgba(20,18,12,0.7)';
      const tw = ctx.measureText(bk.text).width + 10;
      ctx.fillRect(Math.round(sx - tw / 2), Math.round(sy - 66 - age / 60), Math.round(tw), 17);
      ctx.fillStyle = '#f4ead0';
      ctx.fillText(bk.text, sx, sy - 54 - age / 60);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    // click markers
    for (const c of st.clicks) {
      const age = now - c.t;
      if (age > 600) continue;
      const [sx, sy] = this.toScreen(c.x, c.y);
      ctx.globalAlpha = 1 - age / 600;
      this.paw(sx, sy, c.atk ? '#ff6050' : '#c8f080', 1 + age / 900);
      ctx.globalAlpha = 1;
    }
    // placement ghost
    if (st.ghost) this.drawGhost(st.ghost);
    // selection box
    if (st.box) {
      const [x0, y0, x1, y1] = st.box;
      ctx.strokeStyle = '#f4ead0'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.fillStyle = 'rgba(244,234,208,0.08)';
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    // weather
    this.weather(season);
    if (st.flash > 0) { ctx.fillStyle = `rgba(255,250,220,${Math.min(0.35, st.flash * 0.35)})`; ctx.fillRect(0, 0, this.w, this.h); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.sprites.pump();
  }

  blit(s: CSprite, sx: number, sy: number, flip: boolean) {
    const ctx = this.ctx;
    if (flip) {
      ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); ctx.scale(-1, 1);
      ctx.drawImage(s.c, -s.ax, -s.ay); ctx.restore();
    } else ctx.drawImage(s.c, Math.round(sx - s.ax), Math.round(sy - s.ay));
  }

  unitPose(u: Ent): [string, number] {
    const t = this.time;
    const w = this.world;
    const isMed = u.t === 'medicine';
    if (u.pounce) return ['pounce', 0];
    switch (u.anim) {
      case 2: {
        const iv = Math.round(UNITS[u.t].interval * 20);
        const ph = (iv - (u.cd as number)) / iv;
        return ['attack', ph < 0.15 ? 1 : ph < 0.35 ? 2 : 0];
      }
      case 3: return isMed ? ['med_idle', 0] : ['gather', Math.floor(t / 420 + u.id) % 2];
      case 4: return ['gather', Math.floor(t / 300 + u.id) % 2];
      case 5: return ['pounce', 0];
      case 7: return ['idle', 0];
    }
    if (u.moving) {
      const fast = baseType(u.t) === 'runner' || u.t === 'fox';
      const fr = Math.floor(t / (fast ? 90 : 130) + u.id) % 4;
      if (u.t === 'apprentice' && (u.carry as number) > 0) {
        const r = w.get(u.gres);
        const ct = u.carryT === 'prey' ? (r && r.sub === 'fish' ? 'carry_fish' : 'carry_prey') : u.carryT === 'moss' ? 'carry_moss' : 'carry_herbs';
        return [ct, fr];
      }
      if (isMed) return ['med_walk', fr];
      return [fast ? 'run' : 'walk', fr];
    }
    if (u.o < 0) return ['stand', 0];
    return [isMed ? 'med_idle' : 'idle', Math.floor(t / 1600 + u.id * 0.37) % 2];
  }

  drawUnit(u: Ent, sx: number, sy: number, st: DrawState) {
    const w = this.world;
    const [pose, frame] = this.unitPose(u);
    const clan = w.clanOf(u.o) || 'thunder';
    const spr = this.sprites.unit(u.t, clan, u.pelt as number, u.face as number, pose, frame, false);
    const ctx = this.ctx;
    const conc = u.o === this.me && w.isConcealed(u);
    if (conc) ctx.globalAlpha = 0.5;
    if (spr) this.blit(spr.s, sx, sy - (pose === 'pounce' ? 8 : 0), spr.flip);
    else { ctx.fillStyle = clanColor(clan); ctx.beginPath(); ctx.ellipse(sx, sy - 10, 10, 8, 0, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (u.leader) {
      // StarClan's light around a leader
      for (let i = 0; i < 4; i++) {
        const a = this.time / 700 + i * 1.57;
        ctx.fillStyle = i % 2 ? '#d8f0ff' : '#ffffff';
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.time / 200 + i);
        ctx.fillRect(Math.round(sx + Math.cos(a) * 16), Math.round(sy - 18 + Math.sin(a) * 7), 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    if (u.dep && (st.sel.has(u.id) || u.o === this.me)) {
      ctx.fillStyle = '#9fe070';
      ctx.beginPath(); ctx.moveTo(sx, sy - 50); ctx.lineTo(sx + 4, sy - 45); ctx.lineTo(sx, sy - 40); ctx.lineTo(sx - 4, sy - 45); ctx.closePath(); ctx.fill();
    }
    if (u.anim === 7 && u.prog) {
      // channel bar (over-marking, ceremony)
      const need = u.ord && u.ord[0] && u.ord[0].o === 'deputy' ? 100 : 200;
      this.hpBar(sx, sy - 50, Math.min(1, (u.prog as number) / need), 24, '#e8d070');
    }
  }

  drawBuilding(b: Ent, sx: number, sy: number) {
    const ctx = this.ctx, w = this.world;
    const clan = w.clanOf(b.o);
    const sz = b.sz as number;
    const kind = b.t === 'gorse' ? 'gorse' : b.t;
    const spr = this.sprites.structure(kind, [0, 0, 0], sz, w.season === 3 && b.done as boolean, (b.id % 3) + 1);
    if (!spr) return;
    if (!b.done) {
      const f = Math.min(1, (b.bp as number) / (b.bneed as number));
      // foundation sticks
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 2;
      for (let i = 0; i < sz * 3; i++) {
        const a = hash3(b.id, i, 1), c = hash3(b.id, i, 2);
        const [x0, y0] = iso((b.tx as number) + a * sz, (b.ty as number) + c * sz);
        ctx.beginPath(); ctx.moveTo(x0 - this.camX, y0 - this.camY); ctx.lineTo(x0 - this.camX + 8, y0 - this.camY - 3); ctx.stroke();
      }
      const hh = Math.round(spr.h * (0.15 + 0.85 * f));
      ctx.globalAlpha = 0.85;
      ctx.drawImage(spr.c, 0, spr.h - hh, spr.w, hh, Math.round(sx - spr.ax), Math.round(sy - spr.ay + spr.h - hh), spr.w, hh);
      ctx.globalAlpha = 1;
      return;
    }
    const empty = (b.dis as number) > w.tick;
    if (empty) ctx.globalAlpha = 0.55;
    ctx.drawImage(spr.c, Math.round(sx - spr.ax), Math.round(sy - spr.ay));
    ctx.globalAlpha = 1;
    // kits tumbling at the nursery entrance while an apprentice is being raised
    if (b.t === 'nursery' && !empty && b.q && b.q.length && b.q[0].u) {
      for (let i = 0; i < 2; i++) {
        const ph = this.time / 400 + i * 2;
        const kx = sx + 34 + Math.cos(ph) * 10 + i * 10, ky = sy + 10 + Math.sin(ph * 1.3) * 4;
        const k = this.sprites.unit('kit', clan || 'thunder', (b.id + i) % 6, Math.floor(ph) % 8, i ? 'walk' : 'idle', Math.floor(this.time / 150) % 4, false);
        if (k) this.blit(k.s, kx, ky, k.flip);
      }
    }
    // damage: broken stems
    if (b.hp < b.mhp * 0.5 && b.t !== 'marker') {
      ctx.fillStyle = 'rgba(40,30,20,0.6)';
      for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(sx - 20 + hash3(b.id, i, 4) * 40), Math.round(sy - 20 - hash3(b.id, i, 5) * 30), 6, 2);
    }
  }

  markerRing(b: Ent) {
    const r = this.world.hasTech(b.o, 'borders') ? BLDS.marker.radiusBorderPatrols : BLDS.marker.radius;
    const [sx, sy] = this.toScreen(b.x, b.y);
    const ctx = this.ctx;
    ctx.strokeStyle = clanColor(this.world.clanOf(b.o));
    ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.ellipse(sx, sy, r * 45.25, r * 22.6, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.35; ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.ellipse(sx, sy, 16, 8, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  footprint(tx: number, ty: number, sz: number, color: string, fillA: number, lineA: number) {
    const ctx = this.ctx;
    const pts = [iso(tx, ty), iso(tx + sz, ty), iso(tx + sz, ty + sz), iso(tx, ty + sz)];
    ctx.beginPath();
    pts.forEach(([x, y], i) => { if (i) ctx.lineTo(x - this.camX, y - this.camY); else ctx.moveTo(x - this.camX, y - this.camY); });
    ctx.closePath();
    ctx.fillStyle = color; ctx.globalAlpha = fillA; ctx.fill();
    ctx.globalAlpha = lineA; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  hpBar(x: number, y: number, f: number, wd: number, col?: string) {
    const ctx = this.ctx;
    x = Math.round(x - wd / 2); y = Math.round(y);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, wd + 2, 5);
    ctx.fillStyle = col || (f > 0.6 ? '#6cd04a' : f > 0.3 ? '#e8c040' : '#e04838');
    ctx.fillRect(x, y, Math.max(1, Math.round(wd * Math.max(0, f))), 3);
  }
  paw(x: number, y: number, col: string, s = 1) {
    const ctx = this.ctx;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(x, y, 5 * s, 3 * s, 0, 0, 7); ctx.fill();
    for (const [dx, dy] of [[-6, -5], [-2, -7], [2, -7], [6, -5]]) { ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s * 0.7, 1.8 * s, 1.4 * s, 0, 0, 7); ctx.fill(); }
  }

  drawGhost(g: NonNullable<DrawState['ghost']>) {
    const ctx = this.ctx;
    const tiles = g.tiles && g.tiles.length ? g.tiles : [g.tx, g.ty];
    const sz = BLDS[g.type].size;
    for (let i = 0; i + 1 < tiles.length; i += 2) {
      this.footprint(tiles[i], tiles[i + 1], sz, g.ok ? '#80ff80' : '#ff5040', 0.25, 0.9);
      const spr = this.sprites.structure(g.type, [0, 0, 0], sz, false, 1);
      if (spr) {
        const [sx, sy] = iso(tiles[i] + sz / 2, tiles[i + 1] + sz / 2);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(spr.c, Math.round(sx - this.camX - spr.ax), Math.round(sy - this.camY - spr.ay));
        ctx.globalAlpha = 1;
      }
    }
    if (g.type === 'marker') {
      const r = this.world.hasTech(this.me, 'borders') ? BLDS.marker.radiusBorderPatrols : BLDS.marker.radius;
      const [sx, sy] = iso(g.tx + 0.5, g.ty + 0.5);
      ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.4; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(sx - this.camX, sy - this.camY, r * 45.25, r * 22.6, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  collectFx() {
    const w = this.world;
    for (const f of w.fx) {
      if (f.tick <= this.lastFxTick) continue;
      this.fxList.push({ x: f.x, y: f.y, kind: f.kind, t: this.time, o: f.o });
    }
    if (w.fx.length) this.lastFxTick = w.fx[w.fx.length - 1].tick;
    this.fxList = this.fxList.filter(f => this.time - f.t < 700);
  }
  drawFx(now: number, st: DrawState) {
    const ctx = this.ctx;
    for (const f of this.fxList) {
      if (!st.showAll && this.seeTile(this.world.ti(f.x, f.y)) !== 2) continue;
      const [sx, sy] = this.toScreen(f.x, f.y);
      const age = (now - f.t) / 700;
      ctx.globalAlpha = Math.max(0, 1 - age);
      if (f.kind === 'scratch' || f.kind === 'queen' || f.kind === 'thorn') {
        ctx.strokeStyle = f.kind === 'thorn' ? '#c09060' : f.kind === 'queen' ? '#fff0d0' : '#ffffff';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(sx - 8 + i * 5, sy - 26); ctx.lineTo(sx - 2 + i * 5, sy - 14); ctx.stroke(); }
      } else if (f.kind === 'pounce' || f.kind === 'ambush') {
        ctx.strokeStyle = f.kind === 'ambush' ? '#ffd040' : '#e8dcc0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(sx, sy, 8 + age * 30, 4 + age * 15, 0, 0, 7); ctx.stroke();
        if (f.kind === 'ambush') { ctx.fillStyle = '#ffd040'; ctx.font = 'bold 16px Georgia'; ctx.fillText('!', sx - 3, sy - 34 - age * 10); }
      } else if (f.kind === 'heal') {
        ctx.fillStyle = '#90f070';
        for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(sx - 8 + i * 8), Math.round(sy - 20 - age * 20 - i * 3), 2, 6), ctx.fillRect(Math.round(sx - 10 + i * 8), Math.round(sy - 18 - age * 20 - i * 3), 6, 2);
      } else if (f.kind === 'collapse') {
        ctx.fillStyle = '#9a8a74';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(sx + Math.cos(i) * (10 + age * 40), sy - 10 + Math.sin(i) * 8 - age * 10, 8 * (1 - age) + 3, 0, 7); ctx.fill(); }
      } else if (f.kind === 'adder' || f.kind === 'rat') {
        ctx.fillStyle = '#e04030'; ctx.fillRect(Math.round(sx - 2), Math.round(sy - 22 - age * 10), 4, 4);
      } else if (f.kind === 'monsterhit') {
        ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.arc(sx, sy - 10, 20 * (1 - age) + 4, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  fogGen = -1;
  drawFog() {
    const w = this.world;
    if (this.fogGen !== w.visGen) {
      // vision only changes every few ticks: rebuild the fog image then, not every frame
      this.fogGen = w.visGen;
      const p = w.players[this.me];
      const d = new Uint32Array(this.fogImg.data.buffer);
      const vis = p.vis, ex = p.explored;
      for (let i = 0; i < N * N; i++) d[i] = vis[i] ? 0x00080a08 : ex[i] ? 0x78080a08 : 0xff080a08;
      this.fogCtx.putImageData(this.fogImg, 0, 0);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(32, 16, -32, 16, OX - this.camX, -this.camY);
    ctx.drawImage(this.fog, 0, 0);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  weather(season: number) {
    if (season !== 3 && season !== 2) return;
    const ctx = this.ctx;
    const snow = season === 3;
    for (const p of this.particles) {
      p.y += snow ? 0.6 + p.s * 0.8 : 0.5 + p.s * 0.5;
      p.x += snow ? Math.sin(this.time / 900 + p.s * 9) * 0.4 : 0.6 + Math.sin(this.time / 500 + p.s * 9) * 0.8;
      if (p.y > this.h) { p.y = -5; p.x = Math.random() * this.w; }
      if (p.x > this.w) p.x = 0;
      if (!snow && p.s > 0.35) continue;
      ctx.fillStyle = snow ? 'rgba(255,255,255,0.85)' : (p.s > 0.17 ? '#c8782e' : '#d8a840');
      ctx.fillRect(Math.round(p.x), Math.round(p.y), snow ? (p.s > 0.6 ? 2 : 1) + 1 : 3, snow ? (p.s > 0.6 ? 2 : 1) + 1 : 2);
    }
  }

  // ------------------------------------------------------------------ minimap
  miniLayer: HTMLCanvasElement | null = null; miniLayerImg: ImageData | null = null; miniLayerKey = '';
  miniBaseData: Uint32Array | null = null; lastMini = 0;
  drawMinimap(c: HTMLCanvasElement, st: DrawState, alerts: Ping[], now: number) {
    if (now - this.lastMini < 100) return;
    this.lastMini = now;
    const w = this.world;
    const W = c.width, H = c.height;
    const ctx = c.getContext('2d')!;
    const season = w.season;
    if (!this.miniBase || this.miniSeason !== season) {
      this.miniSeason = season;
      const base = new Uint32Array(N * N);
      for (let i = 0; i < N * N; i++) { const col = minimapColor(w.map.terrain[i], season, w.frozen); base[i] = (0xff000000 | (col[2] << 16) | (col[1] << 8) | col[0]) >>> 0; }
      this.miniBaseData = base;
      this.miniBase = document.createElement('canvas');
      this.miniLayerKey = '';
    }
    // terrain + territory tint + fog, composed per vision update into one 96x96 image
    const key = w.visGen + ':' + season + ':' + (st.showAll ? 1 : 0);
    if (key !== this.miniLayerKey) {
      this.miniLayerKey = key;
      if (!this.miniLayer) { this.miniLayer = document.createElement('canvas'); this.miniLayer.width = N; this.miniLayer.height = N; this.miniLayerImg = this.miniLayer.getContext('2d')!.createImageData(N, N); }
      const out = new Uint32Array((this.miniLayerImg as ImageData).data.buffer);
      const base = this.miniBaseData as Uint32Array;
      const me = this.me >= 0 && !st.showAll ? w.players[this.me] : null;
      const tints = w.players.filter(p => !(this.me >= 0 && p.id !== this.me && !st.showAll)).map(p => ({ claim: p.claim, rgb: hexToRgb(clanColor(p.clan)) }));
      for (let i = 0; i < N * N; i++) {
        let v = base[i];
        let r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255;
        for (const t of tints) if (t.claim[i]) { r = r * 0.78 + t.rgb[0] * 0.22; g = g * 0.78 + t.rgb[1] * 0.22; b = b * 0.78 + t.rgb[2] * 0.22; }
        if (me && !me.vis[i]) { if (me.explored[i]) { r *= 0.58; g *= 0.58; b *= 0.58; } else { r = 10; g = 12; b = 8; } }
        out[i] = (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
      }
      this.miniLayer.getContext('2d')!.putImageData(this.miniLayerImg as ImageData, 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sx = W / 2 / N, sy = H / 2 / N;
    ctx.setTransform(sx, sy, -sx, sy, W / 2, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniLayer as HTMLCanvasElement, 0, 0);
    // resources
    for (const r of w.ress) {
      if ((r.stock as number) <= 0) continue;
      if (this.me >= 0 && !st.showAll && !w.players[this.me].explored[w.ti(r.x, r.y)]) continue;
      ctx.fillStyle = r.rt === 'prey' ? '#e07060' : r.rt === 'moss' ? '#80e060' : '#d080f0';
      ctx.fillRect((r.x >> 10) - 0.5, (r.y >> 10) - 0.5, 2, 2);
    }
    for (const b of w.blds) {
      if (b.gone) continue;
      if (this.me >= 0 && !st.showAll && b.o !== this.me && !(((b.seen as number) >> this.me) & 1)) continue;
      ctx.fillStyle = clanColor(w.clanOf(b.o));
      ctx.fillRect(b.tx as number, b.ty as number, Math.max(2, b.sz as number), Math.max(2, b.sz as number));
    }
    for (const u of w.units) {
      if (u.dead || u.hide) continue;
      if (this.me >= 0 && !st.showAll && !w.visibleTo(u, this.me)) continue;
      ctx.fillStyle = u.o < 0 ? '#e8c060' : st.sel.has(u.id) ? '#ffffff' : clanColor(w.clanOf(u.o));
      ctx.fillRect((u.x >> 10) - 0.5, (u.y >> 10) - 0.5, 1.6, 1.6);
    }
    // camera outline
    const corners = [[0, 0], [this.w, 0], [this.w, this.viewH], [0, this.viewH]].map(([x, y]) => unIso(x + this.camX, y + this.camY));
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.6;
    ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    // alerts
    for (const a of alerts) {
      const age = (now - a.t) / 3000;
      if (age > 1) continue;
      ctx.strokeStyle = a.color; ctx.lineWidth = 0.8; ctx.globalAlpha = 1 - age;
      ctx.beginPath(); ctx.arc(a.x / TILE, a.y / TILE, 2 + age * 8, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** minimap px -> fixed world */
  miniToWorld(c: HTMLCanvasElement, mx: number, my: number): [number, number] {
    const W = c.width, H = c.height;
    // inverse of x' = (x - y) * W/2/N + W/2, y' = (x + y) * H/2/N
    const a = (mx - W / 2) / (W / 2 / N), b = my / (H / 2 / N);
    const fx = (a + b) / 2, fy = (b - a) / 2;
    return [Math.round(fx * TILE), Math.round(fy * TILE)];
  }
}
