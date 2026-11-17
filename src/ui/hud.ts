// DOM heads-up display.
import { B, costOf, TPS } from '../sim/core';
import { UNITS, BLDS, TECHS, isFighter } from '../sim/world';
import type { Ent } from '../sim/types';
import { RES_ICON, ICON, CLAN_SYMBOL, starsHtml, seasonDial } from './icons';
import { buildGrid, KEYS, Btn } from './grid';
import { clanColor } from '../render/renderer';
import type { Game } from './game';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
export function el(tag: string, cls?: string, html?: string): HTMLElement { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
export function fmtTime(tick: number) { const s = Math.floor(tick / TPS); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
export function costHtml(c: any) {
  const k = costOf(c); let h = '';
  for (const r of ['prey', 'moss', 'herbs'] as const) if (k[r]) h += `<span>${RES_ICON[r]}${k[r]}</span>`;
  return h;
}

export class HUD {
  root: HTMLElement;
  iconCache = new Map<string, string>();
  gridSig = ''; gridBtns: (Btn | null)[] = [];
  selSig = '';
  lastUpdate = 0;
  logEls: { el: HTMLElement; t: number }[] = [];
  tipFor: HTMLElement | null = null;
  constructor(public g: Game) {
    this.root = el('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="top">
        <div class="res" id="r-prey" title="Prey: food for every cat">${RES_ICON.prey}<span>0</span></div>
        <div class="res" id="r-moss" title="Moss: dens and markers">${RES_ICON.moss}<span>0</span></div>
        <div class="res" id="r-herbs" title="Herbs: medicine, upgrades, elite cats">${RES_ICON.herbs}<span>0</span></div>
        <div class="res" id="r-pop" title="Cats / room in the dens">${RES_ICON.pop}<span>0</span></div>
        <div class="sep"></div><div class="age" id="age"></div>
        <div class="sep"></div><div class="season" id="season"></div>
        <div class="sep"></div><div class="stars" id="stars" title="Your leader's lives"></div>
        <div class="grow"></div><span id="netinfo"></span><span class="clock" id="clock">0:00</span>
        <button class="tbtn" id="b-tree" title="Tech tree (F2)">Tech tree</button>
        <button class="tbtn" id="b-help" title="Help (F1)">Help</button>
        <button class="tbtn" id="b-menu" title="Menu (F10)">Menu</button>
      </div>
      <div id="bottom">
        <div id="cmds"></div>
        <div id="selpanel"></div>
        <div id="minimap-wrap"><canvas id="minimap" width="256" height="128"></canvas><span class="mlabel" id="mlabel"></span></div>
      </div>
      <div id="log"></div>
      <div id="banner"></div>
      <div id="waiting" class="hidden"></div>
      <div id="tooltip" class="hidden"></div>
      <input id="chat" class="hidden" maxlength="120" placeholder="Type a message, or a taunt number (1-20), then Enter">`;
    document.body.appendChild(this.root);
    const cmds = $('cmds');
    for (let i = 0; i < 15; i++) {
      const b = el('button', 'cmd empty');
      b.dataset.i = String(i);
      b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', e => { const btn = this.gridBtns[i]; if (btn) this.g.pressButton(btn, e.shiftKey); });
      b.addEventListener('mouseenter', () => this.showTip(b, this.gridBtns[i], KEYS[i]));
      b.addEventListener('mouseleave', () => this.hideTip());
      cmds.appendChild(b);
    }
    $('b-menu').onclick = () => g.openMenu();
    $('b-help').onclick = () => g.menus.help();
    $('b-tree').onclick = () => g.menus.techTree(g.me >= 0 ? g.world.players[g.me].clan : 'thunder');
    for (const id of ['top', 'bottom']) $(id).addEventListener('mousedown', e => e.stopPropagation());
  }
  destroy() { this.root.remove(); }
  show(on: boolean) { this.root.style.display = on ? '' : 'none'; }

  // ---------------------------------------------------------------- icons from sprites
  spriteIcon(key: string, draw: () => HTMLCanvasElement | null, size = 40): string {
    const c = this.iconCache.get(key);
    if (c) return c;
    const src = draw();
    if (!src) return '';
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#4e6a34'; ctx.fillRect(0, 0, size, size);
    const s = Math.min(size / src.width, size / src.height) * 1.6;
    ctx.drawImage(src, (size - src.width * s) / 2, (size - src.height * s) / 2 + 2, src.width * s, src.height * s);
    const url = `<img src="${cv.toDataURL()}">`;
    this.iconCache.set(key, url);
    return url;
  }
  unitIcon(t: string): string {
    const clan = this.g.me >= 0 ? this.g.world.players[this.g.me].clan : 'thunder';
    return this.spriteIcon('u' + t + clan, () => {
      const s = this.g.renderer.sprites.unit(t, clan, 0, 1, t === 'medicine' ? 'med_idle' : 'idle', 0, true);
      if (!s) return null;
      // crop
      const cv = document.createElement('canvas'); cv.width = 50; cv.height = 46;
      cv.getContext('2d')!.drawImage(s.s.c, s.s.ax - 25, s.s.ay - 40, 50, 46, 0, 0, 50, 46);
      return cv;
    });
  }
  bldIcon(t: string): string {
    return this.spriteIcon('b' + t, () => {
      const sz = BLDS[t].size;
      const s = this.g.renderer.sprites.structure(t, [0, 0, 0], sz, false, 1);
      if (!s) return null;
      const cw = Math.min(s.w, sz * 64 + 20), ch = Math.min(s.h, sz * 32 + 90);
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      cv.getContext('2d')!.drawImage(s.c, s.ax - cw / 2, s.ay - ch + sz * 16 + 10, cw, ch, 0, 0, cw, ch);
      return cv;
    });
  }

  // ---------------------------------------------------------------- per-frame
  update(now: number) {
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const g = this.g, w = g.world;
    const P = g.me >= 0 ? w.players[g.me] : null;
    if (P) {
      this.setTxt('r-prey', String(P.prey)); this.setTxt('r-moss', String(P.moss)); this.setTxt('r-herbs', String(P.herbs));
      this.setTxt('r-pop', P.pop + '/' + P.cap);
      ($('r-pop').querySelector('span') as HTMLElement).style.color = P.pop >= P.cap && P.cap < B.popCap ? '#ff9a80' : '';
      let age = B.ages[P.age - 1].name;
      const camp = w.get(P.campId);
      if (P.aging && camp && camp.q && camp.q[0] && camp.q[0].tech) { const q = camp.q[0]; age += `<span class="agebar"><i style="width:${Math.round((1 - q.left / q.total) * 100)}%"></i></span>`; }
      this.setHtml('age', age);
      const L = w.get(P.leaderId);
      let st = P.lives > 0 ? starsHtml(P.lives) : '';
      if (P.successionId) st += ' <span style="color:#cfe6ff">(at the Moonstone)</span>';
      else if (P.needSuccession) st += ' <span style="color:#ff9a80">leaderless</span>';
      else if (L && L.hide === 2) st += ' <span style="color:#cfe6ff">returning…</span>';
      if (P.auraOff > w.tick) st += ' <span style="color:#ff9a80" title="StarClan is displeased">☾</span>';
      this.setHtml('stars', st);
    } else {
      this.setHtml('age', 'Watching'); this.setHtml('stars', '');
    }
    const len = B.seasons.lengthSec * TPS;
    const frac = (w.tick % len) / len;
    this.setHtml('season', seasonDial(w.season, frac) + `<span>${B.seasons.names[w.season]}</span>`);
    this.setTxt('clock', fmtTime(w.tick) + (g.paused ? ' (paused)' : g.speed !== 1 ? ` ×${g.speed}` : ''));
    this.setTxt('mlabel', w.frozen ? 'The river is frozen' : '');
    // grid
    const sig = g.selSignature() + '|' + (P ? [P.age, P.aging, P.alarm, P.prey >> 4, P.moss >> 4, P.herbs >> 4, P.pop, P.cap, Object.keys(P.techs).length, P.deputyId, w.tick >> 5].join(',') : '');
    if (sig !== this.gridSig) { this.gridSig = sig; this.renderGrid(); }
    this.renderSel();
    // log fade
    for (const l of this.logEls) { const a = now - l.t; l.el.style.opacity = a > 14000 ? '0' : a > 10000 ? '0.5' : '1'; }
    this.logEls = this.logEls.filter(l => { if (now - l.t > 16000) { l.el.remove(); return false; } return true; });
  }
  setTxt(id: string, t: string) { const e = $(id); const s = e.querySelector('span') || e; if (s.textContent !== t) s.textContent = t; }
  setHtml(id: string, h: string) { const e = $(id); if ((e as any)._h !== h) { (e as any)._h = h; e.innerHTML = h; } }

  renderGrid() {
    this.gridBtns = buildGrid(this.g);
    const P = this.g.me >= 0 ? this.g.world.players[this.g.me] : null;
    const kids = $('cmds').children;
    for (let i = 0; i < 15; i++) {
      const b = this.gridBtns[i];
      const e = kids[i] as HTMLElement;
      if (!b) { e.className = 'cmd empty'; e.innerHTML = ''; continue; }
      let off = !!b.req;
      if (!off && b.cost && P) { const k = costOf(b.cost); off = P.prey < k.prey || P.moss < k.moss || P.herbs < k.herbs; }
      e.className = 'cmd' + (off ? ' off' : '') + (b.on ? ' on' : '');
      e.innerHTML = b.icon + `<span class="hk">${KEYS[i].toUpperCase()}</span>` + (b.count ? `<span class="ct">${b.count}</span>` : '');
    }
    if (this.tipFor) { const i = Number(this.tipFor.dataset.i); this.showTip(this.tipFor, this.gridBtns[i], KEYS[i]); }
  }

  showTip(anchor: HTMLElement, b: Btn | null, key: string) {
    if (!b) return this.hideTip();
    this.tipFor = anchor;
    const t = $('tooltip');
    let h = `<h4>${b.title} <span style="font-weight:400;color:#7a6a50">(${key.toUpperCase()})</span></h4>`;
    if (b.cost && Object.keys(b.cost).length) h += `<div class="cost">${costHtml(b.cost)}${b.sec ? `<span style="font-weight:400">⧗ ${b.sec}s</span>` : ''}</div>`;
    if (b.desc) h += `<div>${b.desc}</div>`;
    if (b.strong) h += `<div class="s">Strong against: ${b.strong}</div>`;
    if (b.weak) h += `<div class="w">Weak against: ${b.weak}</div>`;
    if (b.req) h += `<div class="req">${b.req}</div>`;
    t.innerHTML = h;
    t.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    t.style.left = Math.max(4, r.left) + 'px';
    t.style.top = (r.top - t.offsetHeight - 8) + 'px';
  }
  hideTip() { this.tipFor = null; $('tooltip').classList.add('hidden'); }

  renderSel() {
    const g = this.g, w = g.world;
    const sel = g.selected();
    const sp = $('selpanel');
    const sig = sel.map(e => e.id + ':' + Math.ceil(e.hp / 100) + ':' + (e.q ? e.q.map(q => q.left).join('.') : '') + ':' + (e.stock ?? '') + ':' + (e.carry ?? '') + ':' + (e.kills ?? '') + ':' + (e.shel ? e.shel.length : '') + ':' + (e.bp ?? '') + ':' + (e.dep ? 1 : 0)).join(',') + '|' + (g.me >= 0 ? w.players[g.me].lives : '');
    if (sig === this.selSig) return;
    this.selSig = sig;
    sp.innerHTML = '';
    if (!sel.length) {
      const P = g.me >= 0 ? w.players[g.me] : null;
      if (P) {
        const clan = B.clans[P.clan];
        sp.innerHTML = `<div class="portrait" style="align-items:center">${CLAN_SYMBOL[P.clan](clan.color).replace('<svg', '<svg width="70" height="70"')}</div>
          <div><h3>${clan.name}</h3><div class="rank">${clan.playstyle}</div>
          <div class="note">${clan.bonuses.map((x: string) => '• ' + x).join('<br>')}</div>
          <div class="note" style="color:#8a2a1a">• ${clan.weakness}</div></div>`;
      }
      return;
    }
    if (sel.length > 1) {
      const m = el('div', 'multi');
      for (const e of sel.slice(0, 60)) {
        const d = el('div', 'mini');
        d.title = (e.name || '') + ' — ' + (UNITS[e.t] ? UNITS[e.t].name : '');
        const p = this.portrait(e, 48, 46);
        if (p) d.appendChild(p);
        const bar = el('i'); bar.style.width = Math.round(e.hp / e.mhp * 32) + 'px'; bar.style.background = e.hp / e.mhp > 0.5 ? '#5aa040' : '#d05030';
        d.appendChild(bar);
        d.onclick = (ev) => { if (ev.shiftKey) g.sel.delete(e.id); else { g.sel.clear(); g.sel.add(e.id); } g.selChanged(); };
        m.appendChild(d);
      }
      sp.appendChild(m);
      return;
    }
    const e = sel[0];
    const por = el('div', 'portrait');
    const pc = this.portrait(e, 96, 96);
    if (pc) por.appendChild(pc);
    sp.appendChild(por);
    const info = el('div');
    info.style.minWidth = '0';
    sp.appendChild(info);
    const own = e.o === g.me;
    const clanName = e.o >= 0 ? B.clans[w.clanOf(e.o)].name : '';
    if (e.k === 1) {
      const ut = UNITS[e.t];
      let rank = ut.name + (clanName ? ' of ' + clanName : '');
      if (e.leader) rank = 'Leader of ' + clanName;
      if (e.dep) rank = 'Deputy of ' + clanName;
      if (e.t === 'medicine') rank = (e.name && e.name.endsWith('paw') ? 'Medicine cat apprentice of ' : 'Medicine cat of ') + clanName;
      let h = `<h3>${e.name || ut.name}</h3><div class="rank">${rank}${e.leader && own ? ' — ' + starsHtml(w.players[e.o].lives) : ''}</div>`;
      h += `<div class="hpbar"><i style="width:${Math.round(e.hp / e.mhp * 100)}%;background:${e.hp / e.mhp > 0.5 ? '#5aa040' : '#d05030'}"></i></div>`;
      const P = e.o >= 0 ? w.players[e.o] : null;
      let dmg = ut.dmg;
      if (P && ut.role === 'fighter') dmg += (P.techs.battle1 ? 1 : 0) + (P.techs.battle2 ? 1 : 0);
      h += `<div class="stats"><b>Health</b><span>${Math.ceil(e.hp / 100)} / ${Math.ceil(e.mhp / 100)}</span><b>Damage</b><span>${dmg}${ut.role === 'medicine' ? ' (heals ' + ut.heal + '/s)' : ''}</span>
        <b>Armour</b><span>${w.armorOf(e)}</span><b>Speed</b><span>${ut.speed}</span>${e.o >= 0 ? `<b>Kills</b><span>${e.kills || 0}</span>` : ''}${(e.carry as number) > 0 ? `<b>Carrying</b><span>${e.carry} ${e.carryT}</span>` : ''}</div>`;
      const notes: string[] = [];
      if (own && w.isConcealed(e)) notes.push('Concealed — enemies see it only from 2 tiles.');
      if (e.leader && own && w.players[e.o].auraOff > w.tick) notes.push('StarClan is displeased: no aura for a while.');
      if (ut.strong) h += `<div class="tip"><span class="s">Strong: ${ut.strong}</span> · <span class="w">Weak: ${ut.weak}</span></div>`;
      if (notes.length) h += `<div class="note">${notes.join(' ')}</div>`;
      info.innerHTML = h;
    } else if (e.k === 2) {
      const bd = BLDS[e.t];
      let h = `<h3>${bd.name}</h3><div class="rank">${clanName}${e.done ? '' : ' — being built (' + Math.floor((e.bp as number) / (e.bneed as number) * 100) + '%)'}</div>`;
      h += `<div class="hpbar"><i style="width:${Math.round(e.hp / e.mhp * 100)}%"></i></div><div class="stats"><b>Health</b><span>${Math.ceil(e.hp / 100)} / ${Math.ceil(e.mhp / 100)}</span>`;
      if (e.t === 'camp') h += `<b>Sheltering</b><span>${(e.shel || []).length} / ${bd.shelter}</span>`;
      if (bd.pop) h += `<b>Room</b><span>+${bd.pop}</span>`;
      h += `</div>`;
      if ((e.dis as number) > w.tick) h += `<div class="note">The queens have carried the kits away. Back in ${Math.ceil(((e.dis as number) - w.tick) / TPS)} s.</div>`;
      else h += `<div class="note">${bd.desc}</div>`;
      info.innerHTML = h;
      if (own && e.q && e.q.length) {
        const qd = el('div', 'queue');
        e.q.forEach((q, i) => {
          const d = el('div', 'qi');
          d.title = (q.u ? UNITS[q.u].name : q.tech && q.tech.startsWith('age') ? B.ages[Number(q.tech[3]) - 1].name : TECHS[q.tech as string].name) + ' — click to cancel';
          d.innerHTML = q.u ? this.unitIcon(q.u) : (ICON[q.tech as string] || ICON.more);
          if (i === 0) { const pr = el('div', 'prog'); pr.style.width = Math.round((1 - q.left / q.total) * 34) + 'px'; d.appendChild(pr); }
          d.onclick = () => g.cmd({ c: 'cq', b: e.id, i });
          qd.appendChild(d);
        });
        const P = w.players[g.me];
        if (e.q[0].u && P.pop >= P.cap) qd.appendChild(el('span', 'note', 'Waiting for room in the dens'));
        if (e.t === 'nursery' && P.aging) qd.appendChild(el('span', 'note', 'Paused during the Clan meeting'));
        info.appendChild(qd);
      }
    } else if (e.k === 3) {
      const names: Record<string, string> = { ground: 'Hunting ground', fish: 'Fishing spot', carrion: 'Carrionplace', moss: 'Moss bed', herb: 'Herb patch' };
      let h = `<h3>${e.rname || names[e.sub as string]}</h3><div class="rank">${e.rt}</div><div class="stats">`;
      if ((e.cap as number) < 99999) h += `<b>Left</b><span>${e.stock} / ${e.cap}</span>`; else h += `<b>Left</b><span>never runs out</span>`;
      h += `</div>`;
      if ((e.fallow as number) > w.tick) h += `<div class="note">Hunted out. Prey returns in ${Math.ceil(((e.fallow as number) - w.tick) / TPS)} s.</div>`;
      if (e.sub === 'ground') h += `<div class="note">Regrows faster in greenleaf, barely at all in leaf-bare.${e.moor ? ` Moor rabbits: WindClan hunts them ${B.clans.wind.moorHuntPct - 100}% faster, others ${100 - B.clans.wind.otherMoorHuntPct}% slower.` : ''}</div>`;
      if (e.sub === 'fish') h += `<div class="note">Only RiverClan swimmers can fish here. ${w.frozen ? 'Frozen over.' : ''}</div>`;
      if (e.hazard) h += `<div class="note" style="color:#8a2a1a">${e.sub === 'carrion' ? 'Rats' : 'Adders'} bite gatherers: ${e.hazard} damage per load${e.immune ? ' (ShadowClan cats are immune)' : ''}.</div>`;
      info.innerHTML = h;
    }
  }
  portrait(e: Ent, w: number, h: number): HTMLCanvasElement | null {
    const g = this.g;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (e.k === 1) {
      const s = g.renderer.sprites.unit(e.t, g.world.clanOf(e.o) || 'thunder', e.pelt as number, 1, e.t === 'medicine' ? 'med_idle' : e.o < 0 ? 'stand' : 'idle', 0, true);
      if (!s) return null;
      const sc = w >= 90 ? 2 : 1;
      ctx.drawImage(s.s.c, w / 2 - s.s.ax * sc, h - 6 - s.s.ay * sc + (w >= 90 ? 14 : 4), s.s.w * sc, s.s.h * sc);
    } else if (e.k === 2) {
      const s = g.renderer.sprites.structure(e.t, [0, 0, 0], e.sz as number, false, 1);
      if (!s) return null;
      const sc = Math.min(w / s.w, h / s.h) * 1.15;
      ctx.drawImage(s.c, (w - s.w * sc) / 2, (h - s.h * sc) / 2, s.w * sc, s.h * sc);
    } else {
      const kind = e.sub === 'moss' ? 'moss' : e.sub === 'herb' ? (e.rname === 'Catmint' ? 'catmint' : 'herb') : null;
      if (kind) { const s = g.renderer.sprites.structure(kind, [0, 0, 0], 1, false); if (s) ctx.drawImage(s.c, (w - s.w) / 2, (h - s.h) / 2); }
      else if (e.critter) { const s = g.renderer.sprites.critter(e.critter, 0); if (s) ctx.drawImage(s.c, w / 2 - s.ax * 2, h / 2 - s.ay * 2 + 20, s.w * 2, s.h * 2); }
    }
    return cv;
  }

  log(text: string, cls: string, x?: number, y?: number) {
    const d = el('div', cls);
    d.textContent = text;
    if (x !== undefined) d.onclick = () => this.g.renderer.centerOn(x, y as number);
    $('log').appendChild(d);
    this.logEls.push({ el: d, t: performance.now() });
    while (this.logEls.length > 8) { const o = this.logEls.shift()!; o.el.remove(); }
  }
  bannerT = 0;
  banner(text: string, sub = '') {
    const b = $('banner');
    b.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    b.style.opacity = '1';
    clearTimeout(this.bannerT as any);
    this.bannerT = setTimeout(() => { b.style.opacity = '0'; }, 3800) as any;
  }
  waiting(text: string | null) {
    const e = $('waiting');
    if (!text) e.classList.add('hidden'); else { e.classList.remove('hidden'); if (e.innerHTML !== text) e.innerHTML = text; }
  }
  net(text: string) { this.setTxt('netinfo', text); }
  void(_: any) { /* */ }
}
export { clanColor, isFighter };
