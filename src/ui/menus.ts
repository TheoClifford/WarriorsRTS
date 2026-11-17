// Menus, lobby, help, tech tree, end screen.
import { B, CLANS, TPS, costOf } from '../sim/core';
import { UNITS, BLDS, TECHS, World } from '../sim/world';
import type { MatchSettings, Cmd } from '../sim/types';
import { CLAN_SYMBOL, RES_ICON, ICON } from './icons';
import { el, fmtTime, costHtml } from './hud';
import { TAUNTS } from './flavor';
import { sfx, unlockAudio, setSound, soundOn, setVolume, volume } from '../audio/sound';
import { getRoom, RoomTransport, BroadcastTransport, Transport } from '../net/transport';
import { Lockstep } from '../net/lockstep';
import type { Game, GameOptions } from './game';
import type { Strategy, Difficulty } from '../ai/ai';

export const VERSION = 'wc-0.9-' + (JSON.stringify(B).length % 100000);

export interface AppLike {
  start(o: Omit<GameOptions, 'menus'>): Game;
  toMenu(): void;
  game: Game | null;
}

function store(k: string, v?: string): string | null {
  try { if (v !== undefined) { localStorage.setItem('wc.' + k, v); return v; } return localStorage.getItem('wc.' + k); } catch { return null; }
}
function sess(k: string, v?: string | null): string | null {
  try { if (v === null) { sessionStorage.removeItem('wc.' + k); return null; } if (v !== undefined) { sessionStorage.setItem('wc.' + k, v); return v; } return sessionStorage.getItem('wc.' + k); } catch { return null; }
}

export class Menus {
  screen: HTMLElement | null = null;
  overlay: HTMLElement | null = null;
  lobby: any = null;          // claude room (lobby) or null
  lobbyLocal: BroadcastTransport | null = null;
  roomChecked = false;
  openGames = new Map<string, any>();
  cleanup: (() => void)[] = [];
  constructor(public app: AppLike) {}

  isOpen() { return !!this.overlay; }
  closeOverlay() { if (this.overlay) { this.overlay.remove(); this.overlay = null; } if (this.app.game && this.app.game.mode !== 'mp') this.app.game.paused = this.pausedBefore; }
  pausedBefore = false;
  clear() { for (const c of this.cleanup) c(); this.cleanup = []; if (this.screen) { this.screen.remove(); this.screen = null; } }
  show(html: string | HTMLElement, cls = 'screen'): HTMLElement {
    this.clear();
    const s = el('div', cls);
    if (typeof html === 'string') s.innerHTML = html; else s.appendChild(html);
    document.body.appendChild(s);
    this.screen = s;
    s.addEventListener('click', () => unlockAudio());
    return s;
  }
  showOverlay(inner: HTMLElement) {
    if (this.overlay) this.overlay.remove();
    const s = el('div', 'screen');
    s.style.zIndex = '40';
    s.appendChild(inner);
    s.addEventListener('mousedown', e => { if (e.target === s) this.closeOverlay(); });
    document.body.appendChild(s);
    if (this.app.game && this.app.game.mode !== 'mp') { this.pausedBefore = this.app.game.paused; this.app.game.paused = true; }
    this.overlay = s;
  }

  // ---------------------------------------------------------------- main menu
  main() {
    const s = this.show(`<div>
      <div class="title"><h1>Warriors: Clans of the Forest</h1><div class="sub">Lead a Clan. Hold your territory. Drive out your rivals.</div></div>
      <div class="menu">
        <button class="mbtn primary" id="m-sp">Play against the forest<small>You and one rival Clan, led by the computer</small></button>
        <button class="mbtn primary" id="m-mp">Play a friend<small>A 1v1 match with a colleague, from this same page</small></button>
        <button class="mbtn" id="m-pr">Practice<small>The whole forest to yourself, no rival</small></button>
        <button class="mbtn" id="m-watch">Watch two Clans<small>Computer against computer, nothing hidden</small></button>
        <button class="mbtn" id="m-rep">Watch a replay<small>Paste a replay code</small></button>
        <button class="mbtn" id="m-help">How to play</button>
      </div>
      <p class="muted" style="text-align:center;color:#a8987a;margin-top:18px">An unofficial fan prototype. Sound is generated in your browser — click anywhere to wake it.</p></div>`);
    s.style.background = 'radial-gradient(ellipse at center, rgba(16,22,12,.25), rgba(6,8,5,.82))';
    (s.querySelector('#m-sp') as HTMLElement).onclick = () => this.setup('sp');
    (s.querySelector('#m-mp') as HTMLElement).onclick = () => this.multiplayer();
    (s.querySelector('#m-pr') as HTMLElement).onclick = () => this.setup('practice');
    (s.querySelector('#m-watch') as HTMLElement).onclick = () => this.setup('watch');
    (s.querySelector('#m-rep') as HTMLElement).onclick = () => this.replayLoad();
    (s.querySelector('#m-help') as HTMLElement).onclick = () => this.help();
    s.querySelectorAll('button').forEach(b => b.addEventListener('click', () => sfx.click()));
    // a shared link straight to a match
    const m = /^#m-([a-z0-9]{4,8})$/i.exec(location.hash || '');
    if (m) setTimeout(() => this.multiplayer(m[1].toUpperCase()), 50);
  }

  clanCards(selected: string, taken: string | null, onPick: (c: string) => void): HTMLElement {
    const box = el('div', 'clans');
    for (const c of ['thunder', 'river', 'wind', 'shadow']) {
      const d = B.clans[c];
      const card = el('div', 'clan' + (c === selected ? ' sel' : '') + (c === taken ? ' taken' : ''));
      card.innerHTML = `<div class="sym">${CLAN_SYMBOL[c](d.color)}</div><h3 style="color:${shade(d.color)}">${d.name}</h3><div class="play">${d.playstyle}</div>
        <div><b>Home:</b> ${d.terrain}</div><ul>${d.bonuses.map((b: string) => `<li>${b}</li>`).join('')}</ul>
        <div><b>Unique:</b> ${UNITS[d.unique].name}, ${TECHS[d.tech].name}</div><div class="weak">${d.weakness}</div>
        <div class="muted">Good for: ${d.recommended}</div>`;
      card.onclick = () => { if (c === taken) return; sfx.click(); onPick(c); box.querySelectorAll('.clan').forEach(x => x.classList.remove('sel')); card.classList.add('sel'); };
      box.appendChild(card);
    }
    return box;
  }

  setup(mode: 'sp' | 'practice' | 'watch') {
    const p = el('div', 'panel');
    let mine = store('clan') || 'thunder';
    let foe = 'random';
    const title = mode === 'sp' ? 'Play against the forest' : mode === 'practice' ? 'Practice' : 'Watch two Clans';
    p.innerHTML = `<h2>${title}</h2><div class="muted">${mode === 'watch' ? 'Choose the first Clan; the second is chosen below.' : 'Choose your Clan.'}</div>`;
    p.appendChild(this.clanCards(mine, null, c => { mine = c; store('clan', c); foeSel.querySelectorAll('option').forEach(o => { (o as HTMLOptionElement).disabled = o.value === c; }); if (foe === c) { foe = 'random'; foeSel.value = 'random'; } }));
    const opts = el('div');
    opts.innerHTML = `
      <div class="row">${mode !== 'practice' ? `<label>Rival Clan <select id="o-foe"><option value="random">Random</option>${['thunder', 'river', 'wind', 'shadow'].map(c => `<option value="${c}">${B.clans[c].name}</option>`).join('')}</select></label>
      <label>Rival style <select id="o-strat"><option value="balanced">Balanced</option><option value="rush">Early raids</option><option value="boom">Builds big first</option><option value="random">Random</option></select></label>
      <label>Difficulty <select id="o-diff"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>` : ''}
      </div><div class="row">
      <label><input type="checkbox" id="o-last"> Last Life (the ninth life ends the game)</label>
      <label><input type="checkbox" id="o-canon" checked> Canon leaders (Bluestar, Crookedstar, Tallstar, Raggedstar)</label>
      ${mode === 'sp' ? '<label><input type="checkbox" id="o-reveal"> Reveal the map</label>' : ''}</div>
      <div class="row" style="justify-content:flex-end"><button class="mbtn" id="o-back">Back</button><button class="mbtn primary" id="o-go">Begin</button></div>`;
    p.appendChild(opts);
    this.show(p);
    const foeSel = (p.querySelector('#o-foe') as HTMLSelectElement) || document.createElement('select');
    foeSel.onchange = () => { foe = foeSel.value; };
    foeSel.querySelectorAll('option').forEach(o => { (o as HTMLOptionElement).disabled = o.value === mine; });
    (p.querySelector('#o-back') as HTMLElement).onclick = () => this.main();
    (p.querySelector('#o-go') as HTMLElement).onclick = () => {
      unlockAudio();
      const seed = (Math.random() * 1e9) | 0;
      let f = foe;
      if (f === 'random' || f === mine) { const pool = CLANS.filter(c => c !== mine); f = pool[(Math.random() * pool.length) | 0]; }
      const stratSel = p.querySelector('#o-strat') as HTMLSelectElement | null;
      let strat = (stratSel ? stratSel.value : 'balanced') as Strategy | 'random';
      if (strat === 'random') strat = (['balanced', 'rush', 'boom'] as Strategy[])[(Math.random() * 3) | 0];
      const diff = ((p.querySelector('#o-diff') as HTMLSelectElement | null)?.value || 'normal') as Difficulty;
      const name = store('name') || 'You';
      const settings: MatchSettings = {
        seed, lastLife: (p.querySelector('#o-last') as HTMLInputElement).checked, canonLeaders: (p.querySelector('#o-canon') as HTMLInputElement).checked,
        players: mode === 'practice' ? [{ clan: mine as any, name }] : mode === 'watch' ? [{ clan: mine as any, name: B.clans[mine].name, ai: true }, { clan: f as any, name: B.clans[f].name, ai: true }] : [{ clan: mine as any, name }, { clan: f as any, name: B.clans[f].name, ai: true }],
      };
      this.clear();
      const ais = mode === 'sp' ? [{ seat: 1, strat: strat as Strategy, diff }] : mode === 'watch' ? [{ seat: 0, strat: 'balanced' as Strategy, diff: 'normal' as Difficulty }, { seat: 1, strat: strat as Strategy, diff }] : [];
      const g = this.app.start({ mode: mode === 'watch' ? 'watch' : mode === 'practice' ? 'practice' : 'sp', settings, me: mode === 'watch' ? -1 : 0, ais });
      if (mode === 'sp' && (p.querySelector('#o-reveal') as HTMLInputElement)?.checked) g.showAll = true;
      g.hud.banner(mode === 'watch' ? 'Two Clans meet in the forest' : B.clans[mine].name + ' awaits your orders', mode === 'practice' ? 'Practice: no rival this time.' : 'Press F1 for help.');
    };
  }

  // ---------------------------------------------------------------- multiplayer
  async ensureLobby(): Promise<'room' | 'local'> {
    if (!this.roomChecked) {
      this.roomChecked = true;
      this.lobby = await getRoom();
      if (this.lobby) {
        this.lobby.onPeers((ch: any) => {
          for (const p of ch.peers) { if (p.isMe) continue; if (p.presence && p.presence.host) this.openGames.set(p.peer, p.presence.host); else this.openGames.delete(p.peer); }
          for (const p of ch.left) this.openGames.delete(p.peer);
          this.refreshGames && this.refreshGames();
        }, () => {});
      } else {
        try {
          this.lobbyLocal = new BroadcastTransport('lobby');
          this.lobbyLocal.onState((peer, s) => { if (s && s.host) this.openGames.set(peer, s.host); else this.openGames.delete(peer); this.refreshGames && this.refreshGames(); });
          this.lobbyLocal.onLeave(peer => { this.openGames.delete(peer); this.refreshGames && this.refreshGames(); });
        } catch { /* */ }
      }
    }
    return this.lobby ? 'room' : 'local';
  }
  refreshGames: (() => void) | null = null;
  advertise(host: any) {
    if (this.lobby) this.lobby.presence({ host }).catch(() => {});
    else if (this.lobbyLocal) this.lobbyLocal.setState({ host });
  }
  async openMatch(code: string): Promise<Transport | null> {
    const kind = await this.ensureLobby();
    if (kind === 'room') return await RoomTransport.join(this.lobby, 'wc-' + code.toLowerCase());
    try { return new BroadcastTransport('m-' + code); } catch { return null; }
  }

  async multiplayer(joinCode?: string) {
    const p = el('div', 'panel');
    p.style.width = '640px';
    p.innerHTML = `<h2>Play a friend</h2><div class="muted" id="mp-status">Looking for this page's live room…</div>
      <div class="row"><label>Your name <input type="text" id="mp-name" maxlength="18" value="${escapeHtml(store('name') || '')}" placeholder="e.g. Firepaw"></label></div>
      <div class="row"><button class="mbtn primary" id="mp-host">Host a match</button><span class="muted">or join:</span>
      <input type="text" id="mp-code" maxlength="8" placeholder="CODE" style="width:90px;text-transform:uppercase"><button class="mbtn" id="mp-join">Join</button></div>
      <h3 style="font-family:Cinzel,Georgia,serif;margin:10px 0 0">Open matches</h3><div class="games" id="mp-games"><span class="muted">None yet.</span></div>
      <div class="row" style="justify-content:flex-end"><button class="mbtn" id="mp-back">Back</button></div>`;
    this.show(p);
    const nameIn = p.querySelector('#mp-name') as HTMLInputElement;
    const getName = () => { const n = (nameIn.value || '').trim().slice(0, 18) || 'A warrior'; store('name', n); return n; };
    (p.querySelector('#mp-back') as HTMLElement).onclick = () => { this.refreshGames = null; try { history.replaceState(null, '', ' '); } catch { location.hash = ''; } this.main(); };
    (p.querySelector('#mp-host') as HTMLElement).onclick = () => this.hostLobby(getName());
    (p.querySelector('#mp-join') as HTMLElement).onclick = () => { const c = (p.querySelector('#mp-code') as HTMLInputElement).value.trim().toUpperCase(); if (c) this.guestLobby(getName(), c); };
    const kind = await this.ensureLobby();
    const st = p.querySelector('#mp-status') as HTMLElement;
    if (st) st.innerHTML = kind === 'room'
      ? 'Connected through this page\'s live room. Anyone you have shared this page with can open it and join.'
      : 'The live room isn\'t available here (it needs the published page on claude.ai, with the page shared with your friend). Matches still work between two tabs of this browser.';
    this.refreshGames = () => {
      const box = p.querySelector('#mp-games');
      if (!box) return;
      box.innerHTML = '';
      const list = Array.from(this.openGames.values()).filter(h => h.open);
      if (!list.length) { box.innerHTML = '<span class="muted">None yet. Host one, then tell your friend to open this page.</span>'; return; }
      for (const h of list) {
        const r = el('div', 'game-row');
        r.innerHTML = `<div style="width:30px">${CLAN_SYMBOL[h.clan] ? CLAN_SYMBOL[h.clan](B.clans[h.clan].color) : ''}</div><div class="grow"><b>${escapeHtml(h.name)}</b> is hosting as ${B.clans[h.clan] ? B.clans[h.clan].name : ''} <span class="muted">(${escapeHtml(h.code)})</span></div>`;
        const b = el('button', 'mbtn', 'Join'); b.onclick = () => this.guestLobby(getName(), h.code);
        r.appendChild(b); box.appendChild(r);
      }
    };
    this.refreshGames();
    if (joinCode) {
      // rejoin after a reload?
      const saved = sess('match');
      if (saved) { try { const m = JSON.parse(saved); if (m.code === joinCode) { this.rejoin(m); return; } } catch { /* */ } }
      this.guestLobby(getName(), joinCode);
    }
  }

  async hostLobby(name: string) {
    const code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
    const t = await this.openMatch(code);
    if (!t) { alertBox('Could not open a match room. Try again in a moment.'); return; }
    try { location.hash = 'm-' + code.toLowerCase(); } catch { /* */ }
    let clan = store('clan') || 'thunder';
    let guest: any = null, guestPeer = '';
    let lastLife = false, canon = true;
    const p = el('div', 'panel');
    p.innerHTML = `<h2>Hosting <span class="code">${code}</span></h2>
      <div class="muted">Tell your friend this code, or send them this page's link (it now ends in <b>#m-${code.toLowerCase()}</b>). They open the same page and press Join.</div>
      <div id="h-opp" class="game-row" style="margin:10px 0"><span class="muted">Waiting for a friend to join…</span></div>
      <div id="h-cards"></div>
      <div class="row"><label><input type="checkbox" id="h-last"> Last Life</label><label><input type="checkbox" id="h-canon" checked> Canon leaders</label></div>
      <div class="row" style="justify-content:flex-end"><button class="mbtn" id="h-cancel">Cancel</button><button class="mbtn primary" id="h-start" disabled>Start the match</button></div>`;
    this.show(p);
    const publish = () => {
      t.setState({ v: VERSION, role: 'host', code, name, clan, phase: 'lobby', opts: { lastLife, canon } });
      this.advertise({ code, name, clan, open: !guest });
    };
    const cards = () => { const c = p.querySelector('#h-cards') as HTMLElement; c.innerHTML = ''; c.appendChild(this.clanCards(clan, guest && guest.clan, x => { clan = x; store('clan', x); publish(); render(); })); };
    const render = () => {
      const o = p.querySelector('#h-opp') as HTMLElement;
      if (!guest) o.innerHTML = '<span class="muted">Waiting for a friend to join…</span>';
      else if (guest.v !== VERSION) o.innerHTML = `<span style="color:#8a2a1a">${escapeHtml(guest.name)} has a different version of the game. Both of you should reload the page.</span>`;
      else o.innerHTML = `<div style="width:30px">${guest.clan ? CLAN_SYMBOL[guest.clan](B.clans[guest.clan].color) : ''}</div><div class="grow"><b>${escapeHtml(guest.name)}</b> ${guest.clan ? 'leads ' + B.clans[guest.clan].name : 'is choosing a Clan'} ${guest.ready ? '— <b>ready</b>' : ''}</div>`;
      (p.querySelector('#h-start') as HTMLButtonElement).disabled = !(guest && guest.ready && guest.clan && guest.clan !== clan && guest.v === VERSION);
      cards();
    };
    t.onState((peer, s) => {
      if (!s || s.role !== 'guest' || s.code !== code) return;
      if (guestPeer && peer !== guestPeer && guest && guest.ready) return;
      const was = !!guest;
      guest = s; guestPeer = peer;
      if (!was) { sfx.mew(); }
      publish(); render();
    });
    t.onLeave(peer => { if (peer === guestPeer && this.screen && this.screen.contains(p)) { guest = null; guestPeer = ''; publish(); render(); } });
    (p.querySelector('#h-last') as HTMLInputElement).onchange = e => { lastLife = (e.target as HTMLInputElement).checked; publish(); };
    (p.querySelector('#h-canon') as HTMLInputElement).onchange = e => { canon = (e.target as HTMLInputElement).checked; publish(); };
    (p.querySelector('#h-cancel') as HTMLElement).onclick = () => { this.advertise(null); t.close(); this.multiplayer(); };
    (p.querySelector('#h-start') as HTMLElement).onclick = () => {
      const settings: MatchSettings = { seed: (Math.random() * 1e9) | 0, lastLife, canonLeaders: canon, players: [{ clan: clan as any, name }, { clan: guest.clan, name: guest.name }] };
      t.setState({ phase: 'go', settings, guest: guestPeer });
      this.advertise(null);
      sess('match', JSON.stringify({ code, seat: 0, settings }));
      this.launchMp(t, 0, settings, guest.name, code, false);
    };
    publish(); render();
    this.cleanup.push(() => { /* keep transport: it is handed to the game */ });
  }

  async guestLobby(name: string, code: string) {
    const t = await this.openMatch(code);
    if (!t) { alertBox('Could not open that match room.'); return; }
    let host: any = null, started = false;
    let clan: string | null = null, ready = false;
    const p = el('div', 'panel');
    p.innerHTML = `<h2>Joining <span class="code">${escapeHtml(code)}</span></h2>
      <div id="g-host" class="game-row" style="margin:10px 0"><span class="muted">Looking for the host…</span></div>
      <div id="g-cards"></div>
      <div class="row" style="justify-content:flex-end"><button class="mbtn" id="g-cancel">Leave</button><button class="mbtn primary" id="g-ready" disabled>Ready</button></div>`;
    this.show(p);
    const publish = () => t.setState({ v: VERSION, role: 'guest', code, name, clan, ready, phase: 'lobby' });
    const render = () => {
      const h = p.querySelector('#g-host') as HTMLElement;
      if (!host) h.innerHTML = '<span class="muted">Looking for the host… (they must have this page open)</span>';
      else if (host.v !== VERSION) h.innerHTML = '<span style="color:#8a2a1a">The host has a different version of the game. Both of you should reload the page.</span>';
      else h.innerHTML = `<div style="width:30px">${CLAN_SYMBOL[host.clan](B.clans[host.clan].color)}</div><div class="grow"><b>${escapeHtml(host.name)}</b> leads ${B.clans[host.clan].name}. ${host.opts && host.opts.lastLife ? 'Last Life is on.' : ''}</div>`;
      const c = p.querySelector('#g-cards') as HTMLElement; c.innerHTML = '';
      c.appendChild(this.clanCards(clan || '', host ? host.clan : null, x => { clan = x; ready = false; publish(); render(); }));
      const rb = p.querySelector('#g-ready') as HTMLButtonElement;
      rb.disabled = !host || !clan || (host && clan === host.clan) || host.v !== VERSION;
      rb.textContent = ready ? 'Not ready' : 'Ready';
    };
    t.onState((peer, s) => {
      if (!s || s.role !== 'host' || s.code !== code || started) return;
      host = s;
      if (clan && clan === host.clan) { clan = null; ready = false; publish(); }
      if (s.phase === 'go' && s.settings && (s.guest === t.myId || t.kind === 'room' && s.settings.players[1].name === name && ready)) {
        started = true;
        sess('match', JSON.stringify({ code, seat: 1, settings: s.settings }));
        this.launchMp(t, 1, s.settings, host.name, code, false);
        return;
      }
      render();
    });
    (p.querySelector('#g-ready') as HTMLElement).onclick = () => { ready = !ready; sfx.click(); publish(); render(); };
    (p.querySelector('#g-cancel') as HTMLElement).onclick = () => { t.close(); this.multiplayer(); };
    publish(); render();
  }

  rejoin(m: { code: string; seat: number; settings: MatchSettings }) {
    this.openMatch(m.code).then(t => {
      if (!t) { alertBox('Could not reconnect.'); return; }
      t.setState({ v: VERSION, role: m.seat === 0 ? 'host' : 'guest', code: m.code, name: m.settings.players[m.seat].name, phase: 'play' });
      this.launchMp(t, m.seat, m.settings, m.settings.players[1 - m.seat].name, m.code, true);
    });
  }

  launchMp(t: Transport, seat: number, settings: MatchSettings, peerName: string, code: string, rejoin: boolean) {
    this.clear();
    const world = new World(settings);
    const ls = new Lockstep(t, seat, world, performance.now());
    (ls as any).peerRole = seat === 0 ? 'guest' : 'host';
    if (rejoin) ls.rejoin();
    const g = this.app.start({ mode: 'mp', settings, me: seat, ais: [], net: { ls, t, peerName } });
    g.hud.banner(B.clans[settings.players[seat].clan].name + ' against ' + B.clans[settings.players[1 - seat].clan].name, rejoin ? 'Reconnecting…' : 'Good hunting.');
    void code;
  }

  replayLoad() {
    const p = el('div', 'panel');
    p.style.width = '560px';
    p.innerHTML = `<h2>Watch a replay</h2><div class="muted">Paste a replay code (from the end of a match).</div>
      <textarea id="rp" style="width:100%;height:160px;font-family:monospace;font-size:11px"></textarea>
      <div class="row" style="justify-content:flex-end"><button class="mbtn" id="rp-back">Back</button><button class="mbtn primary" id="rp-go">Watch</button></div>`;
    this.show(p);
    (p.querySelector('#rp-back') as HTMLElement).onclick = () => this.main();
    (p.querySelector('#rp-go') as HTMLElement).onclick = () => {
      try {
        const r = JSON.parse((p.querySelector('#rp') as HTMLTextAreaElement).value);
        if (!r.settings || !Array.isArray(r.log)) throw new Error('bad');
        this.clear();
        this.app.start({ mode: 'replay', settings: r.settings, me: -1, ais: [], replay: r.log });
      } catch { alertBox('That replay code could not be read.'); }
    };
  }

  // ---------------------------------------------------------------- in-game overlays
  ingame(g: Game) {
    const p = el('div', 'panel');
    p.style.width = '360px';
    p.innerHTML = `<h2>Menu</h2><div class="menu" style="width:100%">
      <button class="mbtn" id="i-res">Resume</button>
      <button class="mbtn" id="i-help">How to play</button>
      <button class="mbtn" id="i-tree">Tech tree</button>
      <div class="row"><label><input type="checkbox" id="i-snd" ${soundOn ? 'checked' : ''}> Sound</label><label>Volume <input type="range" id="i-vol" min="0" max="1" step="0.05" value="${volume}"></label></div>
      <div class="row"><label>Interface size <select id="i-ui">${[0.85, 1, 1.15, 1.3].map(s => `<option value="${s}" ${String(s) === (store('ui') || '1') ? 'selected' : ''}>${Math.round(s * 100)}%</option>`).join('')}</select></label></div>
      ${g.mode !== 'mp' ? `<div class="row"><label>Game speed <select id="i-spd">${[0.5, 1, 1.5, 2, 4].map(s => `<option value="${s}" ${s === g.speed ? 'selected' : ''}>×${s}</option>`).join('')}</select></label></div>` : ''}
      ${g.me >= 0 && !g.world.over ? '<button class="mbtn" id="i-resign">Resign</button>' : ''}
      <button class="mbtn" id="i-quit">Leave the match</button></div>`;
    this.showOverlay(p);
    (p.querySelector('#i-res') as HTMLElement).onclick = () => this.closeOverlay();
    (p.querySelector('#i-help') as HTMLElement).onclick = () => this.help();
    (p.querySelector('#i-tree') as HTMLElement).onclick = () => this.techTree(g.me >= 0 ? g.world.players[g.me].clan : 'thunder');
    (p.querySelector('#i-snd') as HTMLInputElement).onchange = e => setSound((e.target as HTMLInputElement).checked);
    (p.querySelector('#i-vol') as HTMLInputElement).oninput = e => setVolume(Number((e.target as HTMLInputElement).value));
    const ui = p.querySelector('#i-ui') as HTMLSelectElement;
    ui.onchange = () => { store('ui', ui.value); applyUiScale(); g.resize(); };
    const spd = p.querySelector('#i-spd') as HTMLSelectElement | null;
    if (spd) spd.onchange = () => { g.speed = Number(spd.value); };
    const rs = p.querySelector('#i-resign') as HTMLElement | null;
    if (rs) rs.onclick = () => { if (rs.dataset.sure) { g.cmd({ c: 'resign' }); this.closeOverlay(); } else { rs.dataset.sure = '1'; rs.textContent = 'Click again to resign'; } };
    const q = p.querySelector('#i-quit') as HTMLElement;
    q.onclick = () => {
      if (g.mode === 'mp' && !g.world.over && !q.dataset.sure) { q.dataset.sure = '1'; q.textContent = 'Leaving counts as resigning. Click again.'; return; }
      if (g.mode === 'mp' && !g.world.over) g.cmd({ c: 'resign' });
      sess('match', null);
      this.closeOverlay(); this.app.toMenu();
    };
  }

  help() {
    const p = el('div', 'panel');
    p.style.width = '900px';
    p.innerHTML = `<button class="tbtn close-x" id="hx">Close</button><h2>How to play</h2>
    <div class="help">
      <h3>The goal</h3><p>Destroy your rival's <b>Camp</b>. Lose yours and your Clan is driven out. Your <b>Leader</b> has nine lives and returns to camp 30 s after each one is lost.</p>
      <h3>Economy</h3><p><b>Apprentices</b> (trained at the Nursery) gather <b>prey</b> (hunting grounds, critters scurrying), <b>moss</b> (green beds) and <b>herbs</b> (flowering patches, often guarded by a fox). They carry 10 at a time to the Camp or a <b>Cache</b>. Build <b>Warriors' dens</b> for room. Hunting grounds regrow with the seasons — fast in greenleaf, barely in leaf-bare.</p>
      <h3>Ages</h3><p>Call a Clan meeting at the Camp (your leader must be home). <b>Border Moons</b> need a Training Hollow; <b>Battle Moons</b> need a Medicine den and an Elders' den.</p>
      <h3>Fighting</h3><p><b>Guards</b> beat <b>Runners</b>, Runners beat <b>Stalkers</b>, Stalkers beat Guards. <b>Warriors</b> are steady and best against dens. Still cats in <b>undergrowth</b> are hidden beyond 2 tiles — Stalkers pounce from cover for double damage. Medicine cats heal and aren't attacked unless you order it, which angers StarClan.</p>
      <h3>Territory</h3><p><b>Scent markers</b> claim ground: vision, trespass alarms, +${B.combat.homePct}% damage at home. Over-mark enemy markers by sending a fighting cat to stand on them for 10 s.</p>
      <h3>The forest</h3><p>All roads lead through <b>Fourtrees</b>. Monsters roar down the <b>Thunderpath</b> — listen for the rumble, or use the tunnel. In <b>leaf-bare</b> the river freezes and any cat can cross.</p>
      <h3>Mouse</h3><table>
        <tr><td>Left click / drag</td><td>Select / box-select your cats</td></tr><tr><td>Double click</td><td>All cats of that kind on screen</td></tr>
        <tr><td>Right click</td><td>Move, attack, gather, build or repair — whatever fits the target</td></tr><tr><td>Shift + order</td><td>Queue it</td></tr>
        <tr><td>Middle drag / screen edge</td><td>Move the view</td></tr><tr><td>Minimap</td><td>Left: look there · Right: move there</td></tr></table>
      <h3>Keys</h3><table>
        <tr><td>Q W E R T / A S D F G / Z X C V B</td><td>The command grid, by position</td></tr>
        <tr><td>A then click</td><td>Attack-move</td></tr><tr><td>S</td><td>Stop</td></tr><tr><td>B</td><td>Alarm call: apprentices shelter in camp</td></tr>
        <tr><td>H</td><td>Go to camp</td></tr><tr><td>. / ,</td><td>Next idle apprentice / fighting cat</td></tr><tr><td>Ctrl+A</td><td>All fighting cats</td></tr>
        <tr><td>Ctrl+1–9, 1–9</td><td>Set / recall a group (twice to jump)</td></tr><tr><td>Space</td><td>Jump to the last alert</td></tr>
        <tr><td>Enter</td><td>Chat; type 1–20 for a taunt</td></tr><tr><td>F2</td><td>Tech tree</td></tr><tr><td>F3 / P, + / −</td><td>Pause, speed (not online)</td></tr><tr><td>F4</td><td>Reveal map (not online)</td></tr><tr><td>Esc</td><td>Cancel / menu</td></tr></table>
      <h3>Taunts</h3><p style="font-size:12.5px">${Object.entries(TAUNTS).map(([k, v]) => `<b>${k}</b> ${v}`).join(' · ')}</p>
    </div>`;
    if (this.app.game && this.app.game.mode !== 'attract') this.showOverlay(p); else { const s = this.show(p); void s; }
    (p.querySelector('#hx') as HTMLElement).onclick = () => { if (this.overlay) this.closeOverlay(); else this.main(); };
  }

  techTree(clan: string) {
    const p = el('div', 'panel');
    p.style.width = '980px';
    const ages = [1, 2, 3];
    const uniq = B.clans[clan];
    let h = `<button class="tbtn close-x" id="tx">Close</button><h2>Tech tree — ${uniq.name}</h2><div class="tree">`;
    for (const a of ages) {
      h += `<div class="col"><h3>${B.ages[a - 1].name}</h3>`;
      if (a > 1) h += `<div class="muted" style="text-align:center">${costHtml(B.ages[a - 1].cost).replace(/<svg/g, '<svg width="14" height="14"')} · ${B.ages[a - 1].sec}s · needs ${B.ages[a - 1].requires.map((r: string) => BLDS[r].name).join(' and ')}</div>`;
      for (const [bk, bd] of Object.entries(BLDS) as [string, any][]) {
        if (bk === 'camp' && a !== 1) continue;
        const ba = bd.age || 1;
        const units = Object.entries(UNITS).filter(([, u]: any) => u.building === bk && (u.age || 1) === a && (!u.clan || u.clan === clan));
        const techs = Object.entries(TECHS).filter(([, t]: any) => t.building === bk && t.age === a && (!t.clan || t.clan === clan));
        if (bk === 'tunnel' && clan !== 'wind') continue;
        if (ba !== a && !units.length && !techs.length) continue;
        h += `<div class="bld">${bd.name}${ba === a && bk !== 'camp' ? ` <span class="muted">${costHtml(bd.cost).replace(/<svg/g, '<svg width="12" height="12"')}</span>` : ''}</div>`;
        for (const [uk, u] of units as [string, any][]) h += `<div class="item ${u.clan ? 'uniq' : ''}">• ${u.name} <span class="muted">${costHtml(u.cost).replace(/<svg/g, '<svg width="12" height="12"')}</span></div>`;
        for (const [tk, t] of techs as [string, any][]) h += `<div class="item ${t.clan ? 'uniq' : ''}">◦ ${t.name} <span class="muted">— ${t.desc}</span></div>`;
      }
      h += '</div>';
    }
    h += '</div>';
    p.innerHTML = h;
    if (this.app.game && this.app.game.mode !== 'attract') this.showOverlay(p); else this.show(p);
    (p.querySelector('#tx') as HTMLElement).onclick = () => { if (this.overlay) this.closeOverlay(); else this.main(); };
  }

  // ---------------------------------------------------------------- end of match
  end(g: Game) {
    const w = g.world;
    sess('match', null);
    const me = g.me;
    const won = me >= 0 && w.winner === me;
    const title = me < 0 ? (w.winner >= 0 ? B.clans[w.players[w.winner].clan].name + ' is victorious' : 'The match is over') : won ? 'Victory' : 'Defeat';
    if (me >= 0) (won ? sfx.victory : sfx.defeat)();
    const reason = w.events.filter(e => e.kind === 'defeat').map(e => e.text).slice(-1)[0] || '';
    const p = el('div', 'panel');
    p.style.width = '820px';
    const rows: [string, (pl: any) => string][] = [
      ['Cats raised', pl => String(pl.stats.trained)], ['Cats lost', pl => String(pl.stats.lost)], ['Rival cats driven off', pl => String(pl.stats.killed)],
      ['Prey gathered', pl => String(pl.stats.gathered.prey)], ['Moss gathered', pl => String(pl.stats.gathered.moss)], ['Herbs gathered', pl => String(pl.stats.gathered.herbs)],
      ['Border Moons', pl => pl.stats.ageTimes[1] ? fmtTime(pl.stats.ageTimes[1]) : '—'], ['Battle Moons', pl => pl.stats.ageTimes[2] ? fmtTime(pl.stats.ageTimes[2]) : '—'],
      ['Leader lives lost', pl => String(pl.stats.livesLost)], ['Dens built', pl => String(pl.stats.built)],
    ];
    let tbl = `<table class="stats"><tr><th></th>${w.players.map(pl => `<th style="color:${shade(B.clans[pl.clan].color)}">${escapeHtml(pl.name)}<br><span class="muted">${B.clans[pl.clan].name}</span></th>`).join('')}</tr>`;
    for (const [k, f] of rows) tbl += `<tr><td>${k}</td>${w.players.map(pl => `<td>${f(pl)}</td>`).join('')}</tr>`;
    tbl += '</table>';
    const moments = w.events.filter(e => ['agedone', 'enemyage', 'leader', 'nursery', 'defeat', 'victory', 'starclan'].includes(e.kind) && (e.p === -1 || e.p === me || me < 0)).slice(-10)
      .map(e => `<div>${fmtTime(e.tick)} — ${escapeHtml(e.text)}</div>`).join('');
    const ff = w.players[0].stats.firstFight;
    p.innerHTML = `<h1 style="font-size:34px">${title}</h1><div style="font-style:italic;margin-bottom:6px">${escapeHtml(reason)} ${ff >= 0 ? 'First blood at ' + fmtTime(ff) + '.' : ''} The match lasted ${fmtTime(w.tick)}.</div>
      <div style="display:flex;gap:20px;align-items:flex-start"><div>${tbl}</div><div><div class="muted">Fighting cats over time</div><canvas class="chart" id="chart" width="330" height="170"></canvas>
      <div class="muted" style="margin-top:6px">Key moments</div><div style="font-size:13px">${moments}</div></div></div>
      <div class="row" style="justify-content:flex-end"><button class="mbtn" id="e-copy">Copy replay code</button><button class="mbtn" id="e-watch">Watch the replay</button><button class="mbtn" id="e-stay">Keep looking</button><button class="mbtn primary" id="e-menu">Back to the forest</button></div>`;
    this.showOverlay(p);
    this.chart(p.querySelector('#chart') as HTMLCanvasElement, w);
    const replay = { v: VERSION, settings: w.settings, log: g.log };
    (p.querySelector('#e-copy') as HTMLElement).onclick = () => {
      const txt = JSON.stringify(replay);
      navigator.clipboard.writeText(txt).then(() => alertBox('Replay code copied (' + Math.round(txt.length / 1024) + ' KB).'), () => {
        const ta = document.createElement('textarea'); ta.value = txt; ta.style.width = '100%'; ta.style.height = '120px'; p.appendChild(ta); ta.select();
      });
    };
    (p.querySelector('#e-watch') as HTMLElement).onclick = () => { this.closeOverlay(); this.app.start({ mode: 'replay', settings: w.settings, me: -1, ais: [], replay: g.log }); };
    (p.querySelector('#e-stay') as HTMLElement).onclick = () => { this.closeOverlay(); g.showAll = true; };
    (p.querySelector('#e-menu') as HTMLElement).onclick = () => { this.closeOverlay(); this.app.toMenu(); };
  }
  chart(c: HTMLCanvasElement, w: World) {
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const series = w.players.map(p => p.stats.timeline.map(s => s.army));
    const apps = w.players.map(p => p.stats.timeline.map(s => s.apps));
    const max = Math.max(5, ...series.flat(), ...apps.flat());
    const n = Math.max(2, ...series.map(s => s.length));
    ctx.strokeStyle = '#d8c8a4'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(30, 10 + i * (H - 30) / 4); ctx.lineTo(W - 6, 10 + i * (H - 30) / 4); ctx.stroke(); }
    ctx.fillStyle = '#6a5a44'; ctx.font = '10px Georgia';
    ctx.fillText(String(max), 4, 14); ctx.fillText('0', 18, H - 18);
    ctx.fillText('0:00', 28, H - 4); ctx.fillText(fmtTime(w.tick), W - 34, H - 4);
    const plot = (s: number[], col: string, dash: boolean) => {
      ctx.strokeStyle = col; ctx.lineWidth = dash ? 1.2 : 2.2; ctx.setLineDash(dash ? [3, 3] : []);
      ctx.beginPath();
      s.forEach((v, i) => { const x = 30 + i / (n - 1) * (W - 36), y = H - 20 - v / max * (H - 30); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    w.players.forEach((p, i) => { plot(apps[i], shade(B.clans[p.clan].color), true); plot(series[i], shade(B.clans[p.clan].color), false); });
    ctx.fillStyle = '#6a5a44'; ctx.fillText('solid: fighting cats · dashed: apprentices', 34, 22);
  }
}

export function applyUiScale() {
  const s = Number(store('ui') || '1') || 1;
  const h = document.getElementById('hud');
  if (h) (h.style as any).zoom = String(s);
  return s;
}
export function escapeHtml(s: string) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]); }
function shade(hex: string) {
  // darker variant for text on parchment
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * 0.62, g = ((n >> 8) & 255) * 0.62, b = (n & 255) * 0.62;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function alertBox(text: string) {
  const d = el('div', 'panel');
  d.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:60;max-width:420px';
  d.innerHTML = `<div>${escapeHtml(text)}</div><div class="row" style="justify-content:flex-end"><button class="mbtn">OK</button></div>`;
  (d.querySelector('button') as HTMLElement).onclick = () => d.remove();
  document.body.appendChild(d);
}
void RES_ICON; void ICON; void costOf; void TPS;
