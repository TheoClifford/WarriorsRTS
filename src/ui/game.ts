// The running match: main loop, input, commands, feedback.
import { World, UNITS, BLDS, isFighter } from '../sim/world';
import { B, TILE, HALF, MAPN, TPS, costOf, dist2 } from '../sim/core';
import type { Cmd, Ent, MatchSettings, GameEvent } from '../sim/types';
import { AI, Strategy, Difficulty } from '../ai/ai';
import { Renderer, DrawState, Bark, Ping, clanColor } from '../render/renderer';
import { unIso } from '../render/terrain';
import { HUD } from './hud';
import { KEYS, Btn } from './grid';
import { BARKS, TAUNTS, clanBark } from './flavor';
import { sfx, unlockAudio } from '../audio/sound';
import type { Lockstep } from '../net/lockstep';
import type { Transport } from '../net/transport';
import type { Menus } from './menus';
import { applyUiScale } from './menus';

const N = MAPN;
export type Mode = 'sp' | 'mp' | 'practice' | 'watch' | 'replay' | 'attract';
export interface GameOptions {
  mode: Mode;
  settings: MatchSettings;
  me: number;
  ais: { seat: number; strat: Strategy; diff: Difficulty }[];
  net?: { ls: Lockstep; t: Transport; peerName: string };
  replay?: [number, Cmd][];
  menus: Menus;
}

export class Game {
  world: World;
  renderer: Renderer;
  hud: HUD;
  me: number;
  mode: Mode;
  ais: AI[] = [];
  aiCmds: Cmd[] = [];
  pending: Cmd[] = [];
  log: [number, Cmd][] = [];
  sel = new Set<number>();
  groups: number[][] = [];
  lastGroupKey = { k: -1, t: 0 };
  barks: Bark[] = [];
  pings: Ping[] = [];
  clicks: { x: number; y: number; t: number; atk: boolean }[] = [];
  lastAlert: { x: number; y: number } | null = null;
  speed = 1; paused = false;
  acc = 0; last = 0;
  running = true;
  mx = 0; my = 0; mdown = -1; dragStart: [number, number] | null = null; boxing = false; midDrag: [number, number, number, number] | null = null;
  keys = new Set<string>();
  placing: { type: string; start: [number, number] | null } | null = null;
  attackMode = false;
  hover = 0;
  lastSeq = 0;
  lastClick = { t: 0, id: 0 };
  idleIdx = 0;
  flash = 0; shake = 0;
  ended = false; endAt = 0;
  showAll = false;
  replayMap = new Map<number, Cmd[]>();
  attractTarget: [number, number] | null = null; attractT = 0;
  menus: Menus;
  net?: GameOptions['net'];
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement;
  disposers: (() => void)[] = [];
  onEnd: ((g: Game) => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor(public opts: GameOptions) {
    this.mode = opts.mode;
    this.me = opts.me;
    this.menus = opts.menus;
    this.net = opts.net;
    this.world = opts.net ? opts.net.ls.world : new World(opts.settings);
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new Renderer(this.canvas, this.world, this.me);
    this.hud = new HUD(this);
    this.minimap = document.getElementById('minimap') as HTMLCanvasElement;
    for (const a of opts.ais) this.ais.push(new AI(this.world, a.seat, a.strat, a.diff, opts.settings.seed + a.seat * 101));
    if (opts.replay) for (const [t, c] of opts.replay) { if (!this.replayMap.has(t)) this.replayMap.set(t, []); this.replayMap.get(t)!.push(c); }
    this.showAll = this.me < 0;
    if (this.mode === 'attract') this.hud.show(false);
    this.resize();
    const camp = this.me >= 0 ? this.world.get(this.world.players[this.me].campId) : null;
    if (camp) this.renderer.centerOn(camp.x + TILE * 3, camp.y + TILE * 3);
    else this.renderer.centerOn(48 * TILE, 48 * TILE);
    this.bindInput();
    // queue the common sprites for every Clan in play
    const types = ['apprentice', 'warrior', 'leader'];
    for (const p of this.world.players) this.renderer.sprites.warm(p.clan, types);
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
    // browsers stop animation frames in background tabs: keep the match moving (and our turns flowing) anyway
    this.bgTimer = setInterval(() => {
      const now = performance.now();
      if (this.running && now - this.lastFrameAt > 300 && (this.mode === 'mp' || this.mode === 'attract' ? true : false)) this.advance(now, 60);
    }, 200);
  }

  // ------------------------------------------------------------------ loop
  lastFrameAt = 0;
  bgTimer: any = 0;
  /** advance the simulation by real time; used by frames and, while the tab is hidden, by a timer */
  advance(now: number, maxSteps: number) {
    const dt = Math.min(maxSteps * 50, now - this.last);
    this.last = now;
    const canAdvance = !this.paused;
    if (canAdvance) this.acc += dt * (this.mode === 'mp' ? 1 : this.speed);
    let steps = 0;
    while (this.acc >= 50 && steps < maxSteps) {
      if (!this.stepOnce(now)) { this.acc = Math.min(this.acc, 50); break; }
      this.acc -= 50; steps++;
    }
    if (this.acc > maxSteps * 50) this.acc = maxSteps * 50;
    if (this.mode === 'mp' && this.net) this.net.ls.pump(this.world.tick, now);
  }
  frame(now: number) {
    if (!this.running) return;
    const dt = Math.min(250, now - (this.lastFrameAt || now));
    this.lastFrameAt = now;
    this.advance(now, this.mode === 'mp' ? 10 : 8);
    if (this.acc > 400) this.acc = 400;
    if (this.mode === 'mp' && this.net) this.netStatus(now);
    this.camera(dt);
    if (this.mode === 'attract') this.attractCam(now, dt);
    const st: DrawState = {
      sel: this.sel, hover: this.hover, box: this.boxing && this.dragStart ? [this.dragStart[0], this.dragStart[1], this.mx, this.my] : null,
      ghost: this.ghost(), barks: this.barks, pings: this.pings, clicks: this.clicks, showAll: this.showAll, flash: this.flash, shake: this.shake,
    };
    this.flash = Math.max(0, this.flash - dt / 600); this.shake = Math.max(0, this.shake - dt / 1000);
    this.renderer.draw(Math.min(1, this.acc / 50), st, now);
    if (this.mode !== 'attract') { this.renderer.drawMinimap(this.minimap, st, this.pings, now); this.hud.update(now); }
    this.combatSounds();
    this.barks = this.barks.filter(b => now - b.t < 1800);
    this.clicks = this.clicks.filter(c => now - c.t < 700);
    this.pings = this.pings.filter(p => now - p.t < 3000);
    if (this.world.over && !this.ended) { this.ended = true; this.endAt = now; }
    if (this.ended && this.endAt && now - this.endAt > 2500 && this.mode !== 'attract') { this.endAt = 0; if (this.onEnd) this.onEnd(this); }
    if (this.mode === 'attract' && this.world.over && now - this.endAt > 4000) { this.endAt = now; /* keep watching */ }
    requestAnimationFrame(t => this.frame(t));
  }
  menusBlocking() { return false; }

  stepOnce(now: number): boolean {
    const w = this.world;
    if (this.mode === 'mp' && this.net) {
      const ls = this.net.ls;
      ls.pump(w.tick, now);
      if (!ls.canStep(w.tick)) return false;
      if (w.tick % 2 === 0) ls.recordHash(w.tick);
      const cmds = ls.commandsFor(w.tick);
      for (const c of cmds) this.log.push([w.tick, c]);
      w.step(cmds);
      ls.pump(w.tick, now);
    } else if (this.mode === 'replay') {
      w.step(this.replayMap.get(w.tick) || []);
    } else {
      const cmds = [...this.pending.splice(0), ...this.aiCmds.splice(0)];
      for (const c of cmds) this.log.push([w.tick, c]);
      w.step(cmds);
      for (const ai of this.ais) for (const c of ai.think()) this.aiCmds.push(c);
    }
    this.processEvents();
    return true;
  }

  netStatus(now: number) {
    const ls = this.net!.ls;
    const s = ls.status(this.world.tick, now);
    this.hud.net(`${this.net!.t.kind === 'room' ? '' : 'local · '}${Math.round(s.rtt)} ms`);
    if (s.desync >= 0 && !s.resyncing) {
      this.hud.log('The Clans\' memories differ. Resynchronising…', 'bad');
      if (ls.seat === 1) ls.requestResync(); else ls.startSnapshot();
    }
    if (s.resyncing) this.hud.waiting(`Resynchronising with ${this.net!.peerName}… ${Math.round(s.resyncProgress * 100)}%`);
    else if (s.waiting && s.waitMs > 700) {
      const lost = s.peerSilentMs > 6000;
      this.hud.waiting(lost ? `Lost contact with ${this.net!.peerName}. Waiting… ${Math.round((60000 - s.peerSilentMs) / 1000)} s ` + (s.peerSilentMs > 20000 ? '<button class="tbtn" id="claimwin">Claim victory</button>' : '')
        : `Waiting for ${this.net!.peerName}…`);
      const b = document.getElementById('claimwin');
      if (b) b.onclick = () => { this.world.over = true; this.world.winner = this.me; this.world.ev(-1, 'victory', this.net!.peerName + ' has left. You are victorious.'); };
    } else this.hud.waiting(null);
  }

  // ------------------------------------------------------------------ commands
  cmd(c: any) {
    if (this.me < 0 || this.world.over) return;
    const full: Cmd = { ...c, p: this.me };
    if (this.mode === 'mp' && this.net) this.net.ls.issue(full);
    else this.pending.push(full);
  }
  selected(): Ent[] {
    const out: Ent[] = [];
    for (const id of this.sel) { const e = this.world.get(id); if (e && !e.gone && !e.dead && !(e.k === 1 && e.hide)) out.push(e); }
    return out;
  }
  ownUnits(): Ent[] { return this.selected().filter(e => e.k === 1 && e.o === this.me); }
  selSignature() { return Array.from(this.sel).join(','); }
  selChanged() { this.hud.selSig = ''; this.hud.gridSig = ''; }
  pressButton(b: Btn, shift: boolean) {
    unlockAudio();
    if (b.req) { sfx.error(); this.hud.log(b.req, 'bad'); return; }
    if (b.cost && this.me >= 0) {
      const k = costOf(b.cost), P = this.world.players[this.me];
      if (P.prey < k.prey || P.moss < k.moss || P.herbs < k.herbs) { sfx.error(); this.hud.log(P.prey < k.prey ? 'Not enough prey.' : P.moss < k.moss ? 'Not enough moss.' : 'Not enough herbs.', 'bad'); return; }
    }
    sfx.click();
    b.act(shift);
    this.selChanged();
  }
  beginPlace(t: string) { this.placing = { type: t, start: null }; this.attackMode = false; this.canvas.className = 'place'; }
  beginAttackMove() { if (!this.ownUnits().length) return; this.attackMode = true; this.placing = null; this.canvas.className = 'attack'; }
  cancelModes() { this.placing = null; this.attackMode = false; this.canvas.className = ''; }

  bark(units: Ent[], kind: string) {
    if (!units.length) return;
    const u = units[0];
    const clan = this.world.clanOf(u.o);
    let pool = BARKS[kind] || BARKS.move;
    if (kind === 'select') pool = u.leader ? BARKS.selectLeader : u.t === 'apprentice' ? BARKS.selectApp : u.t === 'medicine' ? BARKS.selectMed : BARKS.select;
    let text = pool[Math.floor(Math.random() * pool.length)];
    if (kind === 'attack' && Math.random() < 0.35) text = clanBark(clan);
    this.barks = this.barks.filter(b => b.id !== u.id);
    this.barks.push({ id: u.id, text, t: performance.now() });
  }

  // ------------------------------------------------------------------ events from the simulation
  processEvents() {
    const w = this.world;
    for (const e of w.events) {
      if ((e.seq as number) <= this.lastSeq) continue;
      this.lastSeq = e.seq as number;
      if (this.mode === 'attract') continue;
      if (e.p !== -1 && e.p !== this.me && !(this.me < 0)) continue;
      this.onEvent(e);
    }
  }
  onEvent(e: GameEvent) {
    const hud = this.hud;
    const ping = (col: string) => { if (e.x !== undefined) { this.pings.push({ x: e.x, y: e.y as number, t: performance.now(), color: col }); this.lastAlert = { x: e.x, y: e.y as number }; } };
    switch (e.kind) {
      case 'error': if (this.me >= 0) { sfx.error(); hud.log(e.text, 'bad'); } break;
      case 'built': sfx.done(); hud.log(e.text, 'good', e.x, e.y); break;
      case 'trained': if (!e.text.startsWith('A new apprentice')) hud.log(e.text, '', e.x, e.y); break;
      case 'research': sfx.done(); hud.log(e.text, 'good'); break;
      case 'age': hud.log(e.text, 'star'); break;
      case 'agedone': sfx.age(); hud.banner(e.text.split('.')[0] + '.', 'New cats and dens are ready.'); hud.log(e.text, 'star'); break;
      case 'enemyage': hud.log(e.text, ''); break;
      case 'season': sfx.season(); hud.banner(e.text); hud.log(e.text, ''); this.renderer.miniSeason = -1; break;
      case 'snow': hud.banner(e.text); hud.log(e.text, 'star'); break;
      case 'rumble': sfx.rumble(); this.shake = 1.2; hud.log(e.text, 'bad'); setTimeout(() => sfx.monster(), 2600); break;
      case 'monster': hud.log(e.text, 'bad', e.x, e.y); ping('#ffffff'); break;
      case 'attacked': sfx.hiss(); hud.log(e.text, 'bad', e.x, e.y); ping('#ff5040'); break;
      case 'trespass': sfx.trespass(); hud.log(e.text, 'bad', e.x, e.y); ping('#ffb040'); break;
      case 'ambush': hud.log('Ambush!', 'bad', e.x, e.y); ping('#ff5040'); break;
      case 'leader': case 'leaderfell': sfx.yowl(); hud.log(e.text, 'star', e.x, e.y); if (e.text.includes('lost a life') || e.text.includes('last life')) { hud.banner(e.text.split('.')[0] + '.'); this.flash = 0.6; } break;
      case 'deputy': hud.log(e.text, 'star', e.x, e.y); if (e.text.startsWith('By StarClan')) hud.banner(e.text); break;
      case 'death': hud.log(e.text, 'bad', e.x, e.y); break;
      case 'kill': hud.log(e.text, 'good', e.x, e.y); break;
      case 'lost': hud.log(e.text, 'bad', e.x, e.y); ping('#ff5040'); break;
      case 'nursery': hud.banner(e.text); hud.log(e.text, 'bad', e.x, e.y); break;
      case 'starclan': hud.banner('StarClan is displeased', e.text); hud.log(e.text, 'star'); break;
      case 'alarm': sfx.alarm(); hud.log(e.text, e.text.startsWith('All') ? 'good' : 'bad'); break;
      case 'defeat': hud.log(e.text, 'bad'); break;
      case 'victory': hud.banner(e.text); break;
      case 'taunt': {
        const n = Number(e.text);
        const who = e.id !== undefined ? this.world.players[e.id] : null;
        hud.log((who ? who.name + ': ' : '') + (TAUNTS[n] || e.text), 'taunt');
        if (n === 11) sfx.purr(); else sfx.mew();
        break;
      }
      case 'chat': { const who = e.id !== undefined ? this.world.players[e.id] : null; hud.log((who ? who.name + ': ' : '') + e.text, 'taunt'); sfx.chirp(); break; }
      default: hud.log(e.text, '');
    }
  }
  combatSounds() {
    const w = this.world;
    if (this.mode === 'attract') return;
    for (const u of w.units) {
      if (u.lastHit !== w.tick - 1 || u.dead) continue;
      const [sx, sy] = this.renderer.toScreen(u.x, u.y);
      if (sx < 0 || sy < 0 || sx > this.renderer.w || sy > this.renderer.viewH) continue;
      if (!this.showAll && !w.visibleTo(u, this.me)) continue;
      if (Math.random() < 0.5) sfx.scratch(); else sfx.hiss();
      break;
    }
    for (const c of w.corpses) {
      if (c.tick !== w.tick - 1) continue;
      const [sx, sy] = this.renderer.toScreen(c.x, c.y);
      if (sx > 0 && sy > 0 && sx < this.renderer.w && sy < this.renderer.viewH && (this.showAll || this.renderer.seeTile(w.ti(c.x, c.y)) === 2)) { sfx.yowl(); break; }
    }
  }

  // ------------------------------------------------------------------ camera
  camera(dt: number) {
    if (this.mode === 'attract') return;
    const sp = 1.1 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= sp;
    if (this.keys.has('ArrowRight')) dx += sp;
    if (this.keys.has('ArrowUp')) dy -= sp;
    if (this.keys.has('ArrowDown')) dy += sp;
    if (document.hasFocus() && this.mouseIn && !this.midDrag && this.mdown < 0) {
      const m = 6;
      if (this.mx < m) dx -= sp; if (this.mx > this.renderer.w - m) dx += sp;
      if (this.my < m) dy -= sp; if (this.my > this.renderer.h - m) dy += sp;
    }
    if (dx || dy) { this.renderer.camX += dx; this.renderer.camY += dy; this.renderer.clampCam(); }
  }
  mouseIn = false;
  attractCam(now: number, dt: number) {
    const w = this.world;
    if (!this.attractTarget || now - this.attractT > 9000) {
      this.attractT = now;
      const fighters = w.units.filter(u => !u.dead && !u.hide && u.o >= 0 && (isFighter(u.t) || u.t === 'apprentice'));
      const busy = fighters.filter(u => w.tick - (u.lastFight as number) < 100);
      const pool = busy.length ? busy : fighters;
      const u = pool[Math.floor(Math.random() * pool.length)];
      this.attractTarget = u ? [u.x, u.y] : [48 * TILE, 48 * TILE];
    }
    const r = this.renderer;
    const [tx, ty] = r.toScreen(this.attractTarget[0], this.attractTarget[1]);
    const k = Math.min(1, dt / 1800);
    r.camX += (tx - r.w / 2) * k; r.camY += (ty - r.h / 2) * k;
    r.clampCam();
  }
  resize() {
    const bottom = this.mode === 'attract' ? 0 : Math.round(172 * applyUiScale());
    this.renderer.resize(window.innerWidth, window.innerHeight, bottom);
  }

  // ------------------------------------------------------------------ picking
  pick(px: number, py: number): Ent | null {
    const w = this.world, r = this.renderer;
    let best: Ent | null = null, bd = 1e9;
    for (const u of w.units) {
      if (u.dead || u.hide) continue;
      if (!this.showAll && !w.visibleTo(u, this.me)) continue;
      const [sx, sy] = r.toScreen(u.x, u.y);
      const dx = px - sx, dy = py - (sy - 16);
      if (Math.abs(dx) > 20 || dy < -26 || dy > 20) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    const [fx, fy] = unIso(px + r.camX, py + r.camY);
    const [fx2, fy2] = unIso(px + r.camX, py + r.camY + 26);
    for (const b of w.blds) {
      if (b.gone) continue;
      if (!this.showAll && b.o !== this.me && !(((b.seen as number) >> this.me) & 1)) continue;
      const inside = (x: number, y: number) => x >= (b.tx as number) && x < (b.tx as number) + (b.sz as number) && y >= (b.ty as number) && y < (b.ty as number) + (b.sz as number);
      if (inside(fx, fy) || (b.sz as number) >= 2 && inside(fx2, fy2)) return b;
    }
    for (const res of w.ress) {
      if (!this.showAll && !w.players[this.me].explored[w.ti(res.x, res.y)]) continue;
      const rr = (res.r as number) / TILE + 0.4;
      if ((fx - res.x / TILE) ** 2 + (fy - res.y / TILE) ** 2 <= rr * rr) return res;
    }
    return null;
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const c = this.canvas;
    const on = (t: EventTarget, ev: string, fn: any, opt?: any) => { t.addEventListener(ev, fn, opt); this.disposers.push(() => t.removeEventListener(ev, fn, opt)); };
    on(window, 'resize', () => this.resize());
    if (this.mode === 'attract') return;
    on(c, 'contextmenu', (e: Event) => e.preventDefault());
    on(c, 'mouseenter', (e: MouseEvent) => { this.mx = e.clientX; this.my = e.clientY; });
    on(c, 'mouseleave', () => { this.mouseIn = false; });
    on(c, 'mousemove', (e: MouseEvent) => {
      this.mx = e.clientX; this.my = e.clientY; this.mouseIn = true;
      if (this.midDrag) { this.renderer.camX = this.midDrag[2] - (e.clientX - this.midDrag[0]); this.renderer.camY = this.midDrag[3] - (e.clientY - this.midDrag[1]); this.renderer.clampCam(); return; }
      if (this.mdown === 0 && this.dragStart && !this.placing && Math.hypot(e.clientX - this.dragStart[0], e.clientY - this.dragStart[1]) > 5) this.boxing = true;
      const p = this.pick(e.clientX, e.clientY);
      this.hover = p && p.k !== 3 ? p.id : 0;
    });
    on(c, 'mousedown', (e: MouseEvent) => {
      unlockAudio();
      this.mx = e.clientX; this.my = e.clientY;
      if (e.button === 1) { e.preventDefault(); this.midDrag = [e.clientX, e.clientY, this.renderer.camX, this.renderer.camY]; return; }
      this.mdown = e.button;
      if (e.button === 0) {
        if (this.placing && (this.placing.type === 'barrier' || this.placing.type === 'gorse')) { this.placing.start = this.tileAt(e.clientX, e.clientY); return; }
        this.dragStart = [e.clientX, e.clientY];
      }
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 1) { this.midDrag = null; return; }
      if (this.mdown !== e.button) return;
      this.mdown = -1;
      if (e.button === 0) this.leftUp(e);
      else if (e.button === 2) this.rightClick(e);
    });
    // minimap
    const mm = this.minimap;
    let mmDown = -1;
    const mmAct = (e: MouseEvent, btn: number) => {
      const r = mm.getBoundingClientRect();
      const [x, y] = this.renderer.miniToWorld(mm, (e.clientX - r.left) * mm.width / r.width, (e.clientY - r.top) * mm.height / r.height);
      if (btn === 0) this.renderer.centerOn(x, y);
      else if (btn === 2) this.orderGround(x, y, e.shiftKey);
    };
    on(mm, 'contextmenu', (e: Event) => e.preventDefault());
    on(mm, 'mousedown', (e: MouseEvent) => { e.preventDefault(); mmDown = e.button; mmAct(e, e.button); });
    on(mm, 'mousemove', (e: MouseEvent) => { if (mmDown === 0) mmAct(e, 0); });
    on(window, 'mouseup', () => { mmDown = -1; });
    on(window, 'keydown', (e: KeyboardEvent) => this.keyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key));
    on(window, 'blur', () => this.keys.clear());
    const chat = document.getElementById('chat') as HTMLInputElement;
    on(chat, 'keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = chat.value.trim();
        if (v) { const n = Number(v); if (Number.isInteger(n) && TAUNTS[n]) this.cmd({ c: 'taunt', n }); else this.cmd({ c: 'chat', text: v }); }
        chat.value = ''; chat.classList.add('hidden'); chat.blur();
      } else if (e.key === 'Escape') { chat.value = ''; chat.classList.add('hidden'); chat.blur(); }
    });
  }
  dispose() {
    this.running = false;
    clearInterval(this.bgTimer);
    for (const d of this.disposers) d();
    this.hud.destroy();
    if (this.net) { try { this.net.t.close(); } catch { /* */ } }
  }

  tileAt(px: number, py: number): [number, number] {
    const [fx, fy] = unIso(px + this.renderer.camX, py + this.renderer.camY);
    return [Math.floor(fx), Math.floor(fy)];
  }
  ghost(): DrawState['ghost'] {
    if (!this.placing || this.me < 0) return null;
    const t = this.placing.type;
    const sz = BLDS[t].size;
    const [tx, ty] = this.tileAt(this.mx, this.my);
    const ox = tx - (sz >> 1), oy = ty - (sz >> 1);
    let tiles: number[] | undefined;
    if ((t === 'barrier' || t === 'gorse') && this.placing.start) tiles = this.lineTiles(this.placing.start, [tx, ty]);
    const list = tiles || [ox, oy];
    let ok = true;
    const P = this.world.players[this.me];
    const k = costOf(BLDS[t].cost);
    const n = list.length / 2;
    if (P.prey < k.prey * n || P.moss < k.moss * n || P.herbs < k.herbs * n) ok = false;
    for (let i = 0; i < list.length && ok; i += 2) if (this.world.canPlace(this.me, i === 0 || t !== 'gorse' ? t : 'barrier', list[i], list[i + 1])) ok = false;
    return { type: t, tx: ox, ty: oy, ok, tiles };
  }
  lineTiles(a: [number, number], b: [number, number]): number[] {
    const out: number[] = [];
    let [x0, y0] = a; const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 40; i++) {
      out.push(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }

  leftUp(e: MouseEvent) {
    const w = this.world;
    if (this.placing) {
      const g = this.ghost();
      if (g) {
        const apps = this.ownUnits().filter(u => u.t === 'apprentice').map(u => u.id);
        const t = this.placing.type;
        if (g.tiles) {
          if (g.ok || true) this.cmd({ c: 'wall', ids: apps, b: t, tiles: g.tiles, q: e.shiftKey });
        } else {
          const err = w.canPlace(this.me, t, g.tx, g.ty);
          if (err) { sfx.error(); this.hud.log(err, 'bad'); this.dragStart = null; return; }
          this.cmd({ c: 'bld', ids: apps, b: t, tx: g.tx, ty: g.ty, q: e.shiftKey });
        }
        sfx.rustle();
        this.bark(this.ownUnits(), 'build');
        if (!e.shiftKey) this.cancelModes(); else this.placing.start = null;
      }
      this.dragStart = null;
      return;
    }
    if (this.attackMode) {
      const [x, y] = this.renderer.toWorld(e.clientX, e.clientY);
      const t = this.pick(e.clientX, e.clientY);
      const us = this.ownUnits();
      if (t && t.k !== 3 && t.o !== this.me) this.cmd({ c: 'atk', ids: us.map(u => u.id), t: t.id, q: e.shiftKey });
      else this.cmd({ c: 'mv', ids: us.map(u => u.id), x, y, am: 1, q: e.shiftKey });
      this.clicks.push({ x, y, t: performance.now(), atk: true });
      this.bark(us, 'attack'); sfx.chirp();
      if (!e.shiftKey) this.cancelModes();
      this.dragStart = null;
      return;
    }
    if (this.boxing && this.dragStart) {
      const [x0, y0] = this.dragStart, x1 = e.clientX, y1 = e.clientY;
      const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
      const inBox: Ent[] = [];
      for (const u of w.units) {
        if (u.o !== this.me || u.dead || u.hide) continue;
        const [sx, sy] = this.renderer.toScreen(u.x, u.y);
        if (sx >= lx && sx <= hx && sy - 12 >= ly && sy - 12 <= hy) inBox.push(u);
      }
      if (!e.shiftKey) this.sel.clear();
      for (const u of inBox) this.sel.add(u.id);
      if (inBox.length) { this.bark(inBox, 'select'); sfx.mew(); }
      this.selChanged();
    } else {
      const p = this.pick(e.clientX, e.clientY);
      const now = performance.now();
      if (p && p.k === 1 && p.o === this.me && now - this.lastClick.t < 320 && this.lastClick.id === p.id) {
        // double click: all of that type on screen
        this.sel.clear();
        for (const u of w.units) {
          if (u.o !== this.me || u.dead || u.hide || u.t !== p.t) continue;
          const [sx, sy] = this.renderer.toScreen(u.x, u.y);
          if (sx > 0 && sy > 0 && sx < this.renderer.w && sy < this.renderer.viewH) this.sel.add(u.id);
        }
      } else if (p) {
        if (e.shiftKey && p.k === 1 && p.o === this.me) { if (this.sel.has(p.id)) this.sel.delete(p.id); else this.sel.add(p.id); }
        else { this.sel.clear(); this.sel.add(p.id); }
        if (p.k === 1 && p.o === this.me) { this.bark([p], 'select'); sfx.mew(); }
        else sfx.click();
      } else if (!e.shiftKey) this.sel.clear();
      this.lastClick = { t: now, id: p ? p.id : 0 };
      this.selChanged();
    }
    this.boxing = false; this.dragStart = null;
  }

  rightClick(e: MouseEvent) {
    if (this.placing || this.attackMode) { this.cancelModes(); return; }
    const w = this.world;
    const t = this.pick(e.clientX, e.clientY);
    const [x, y] = this.renderer.toWorld(e.clientX, e.clientY);
    const us = this.ownUnits();
    const q = e.shiftKey;
    if (!us.length) {
      // rally point for a selected building
      const b = this.selected().find(s => s.k === 2 && s.o === this.me);
      if (b) { this.cmd({ c: 'ral', b: b.id, x, y, t: t && (t.k === 3 || (t.k === 2 && t.o === this.me)) ? t.id : 0 }); this.clicks.push({ x, y, t: performance.now(), atk: false }); sfx.click(); }
      return;
    }
    const ids = us.map(u => u.id);
    const apps = us.filter(u => u.t === 'apprentice');
    const fighters = us.filter(u => u.t !== 'apprentice');
    if (t) {
      if (t.k === 3) {
        if (apps.length) { this.cmd({ c: 'gat', ids: apps.map(u => u.id), t: t.id, q }); this.bark(apps, t.rt === 'moss' ? 'moss' : t.rt === 'herbs' ? 'herbs' : 'gather'); }
        if (fighters.length) this.cmd({ c: 'mv', ids: fighters.map(u => u.id), x, y, q });
        sfx.chirp();
        this.clicks.push({ x: t.x, y: t.y, t: performance.now(), atk: false });
        return;
      }
      if (t.o !== this.me && (t.k === 1 || t.k === 2)) {
        if (t.k === 1 && t.t === 'medicine' && t.o >= 0) this.hud.log('Attacking a medicine cat will displease StarClan.', 'star');
        this.cmd({ c: 'atk', ids, t: t.id, q });
        this.bark(us, 'attack'); sfx.chirp();
        this.clicks.push({ x: t.x, y: t.y, t: performance.now(), atk: true });
        return;
      }
      if (t.k === 2 && t.o === this.me) {
        if (t.t === 'tunnel' && t.pair && w.clanOf(this.me) === 'wind') { this.cmd({ c: 'tun', ids, t: t.id, q }); sfx.chirp(); return; }
        if (apps.length && (!t.done || t.hp < t.mhp)) { this.cmd({ c: 'rep', ids: apps.map(u => u.id), t: t.id, q }); this.bark(apps, 'build'); sfx.chirp(); if (fighters.length) this.cmd({ c: 'mv', ids: fighters.map(u => u.id), x, y, q }); return; }
        if (apps.length && t.t === 'camp' && this.world.players[this.me].alarm) { this.cmd({ c: 'shl', ids: apps.map(u => u.id), q }); sfx.chirp(); return; }
      }
    }
    this.orderGround(x, y, q);
  }
  orderGround(x: number, y: number, q: boolean) {
    const us = this.ownUnits();
    if (!us.length) return;
    this.cmd({ c: 'mv', ids: us.map(u => u.id), x, y, q });
    this.bark(us, 'move'); sfx.chirp();
    this.clicks.push({ x, y, t: performance.now(), atk: false });
  }

  keyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (this.menus.isOpen()) { if (e.key === 'Escape') this.menus.closeOverlay(); return; }
    const k = e.key;
    if (k.startsWith('Arrow')) { this.keys.add(k); e.preventDefault(); return; }
    if (k === 'Escape') { if (this.placing || this.attackMode) this.cancelModes(); else if (this.sel.size) { this.sel.clear(); this.selChanged(); } else this.openMenu(); return; }
    if (k === 'F1') { e.preventDefault(); this.menus.help(); return; }
    if (k === 'F2') { e.preventDefault(); this.menus.techTree(this.me >= 0 ? this.world.players[this.me].clan : 'thunder'); return; }
    if (k === 'F3' || k === 'p' && this.mode !== 'mp' && !e.ctrlKey) { if (this.mode !== 'mp') { e.preventDefault(); this.paused = !this.paused; this.hud.banner(this.paused ? 'Paused' : ''); } if (k === 'F3') return; if (k === 'p') return; }
    if (k === 'F10') { e.preventDefault(); this.openMenu(); return; }
    if (k === 'Enter') { const c = document.getElementById('chat') as HTMLInputElement; c.classList.remove('hidden'); c.focus(); e.preventDefault(); return; }
    if ((k === '+' || k === '=') && this.mode !== 'mp') { this.speed = Math.min(4, this.speed * 2); return; }
    if ((k === '-' || k === '_') && this.mode !== 'mp') { this.speed = Math.max(0.5, this.speed / 2); return; }
    if (k === 'F4' && this.mode !== 'mp') { e.preventDefault(); this.showAll = !this.showAll; return; }
    const w = this.world;
    if (/^[0-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups[n] = this.ownUnits().map(u => u.id).concat(this.selected().filter(s => s.k === 2 && s.o === this.me).map(s => s.id)); this.hud.log('Group ' + n + ' set.', ''); return; }
      const grp = (this.groups[n] || []).filter(id => { const x = w.get(id); return x && !x.dead && !x.gone; });
      if (!grp.length) return;
      this.sel = new Set(grp); this.selChanged();
      const now = performance.now();
      if (this.lastGroupKey.k === n && now - this.lastGroupKey.t < 400) { const f = w.get(grp[0])!; this.renderer.centerOn(f.x, f.y); }
      this.lastGroupKey = { k: n, t: now };
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') {
      e.preventDefault();
      this.sel = new Set(w.units.filter(u => u.o === this.me && !u.dead && !u.hide && isFighter(u.t)).map(u => u.id)); this.selChanged();
      return;
    }
    if (k === '.' || k === ',') {
      const idle = w.units.filter(u => u.o === this.me && !u.dead && !u.hide && (k === '.' ? u.t === 'apprentice' : isFighter(u.t) && !u.leader) && !(u.ord as any[]).length && !u.tgt);
      if (!idle.length) { this.hud.log(k === '.' ? 'No idle apprentices.' : 'No idle fighting cats.', ''); return; }
      const u = idle[this.idleIdx++ % idle.length];
      this.sel = new Set([u.id]); this.selChanged(); this.renderer.centerOn(u.x, u.y); this.bark([u], 'select');
      return;
    }
    if (k === ' ') { e.preventDefault(); if (this.lastAlert) this.renderer.centerOn(this.lastAlert.x, this.lastAlert.y); return; }
    if (k === 'Delete') { const s = this.selected().filter(x => x.o === this.me); if (s.length === 1) this.cmd({ c: 'del', id: s[0].id }); return; }
    const lk = k.toLowerCase();
    if (lk === 'h' && !e.ctrlKey) {
      if (this.me < 0) return;
      const camp = w.get(w.players[this.me].campId);
      if (camp) { this.sel = new Set([camp.id]); this.selChanged(); this.renderer.centerOn(camp.x, camp.y); }
      return;
    }
    const slot = KEYS.indexOf(lk);
    if (slot >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const btn = this.hud.gridBtns[slot];
      if (btn) { this.pressButton(btn, e.shiftKey); return; }
      if (lk === 'b' && this.me >= 0) { this.cmd({ c: 'alarm', on: !w.players[this.me].alarm }); return; }
    }
  }
  openMenu() { this.menus.ingame(this); }
}
