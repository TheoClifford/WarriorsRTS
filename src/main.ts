// Boot: loading screen, attract mode behind the main menu, game lifecycle.
import { Game, GameOptions } from './ui/game';
import { Menus, AppLike } from './ui/menus';
import { unlockAudio } from './audio/sound';
import type { MatchSettings } from './sim/types';
import { POSES } from './render/sprites';

class App implements AppLike {
  game: Game | null = null;
  attract: Game | null = null;
  menus: Menus;
  constructor() {
    this.menus = new Menus(this);
    (window as any).__app = this;
  }
  start(o: Omit<GameOptions, 'menus'>): Game {
    if (this.attract) { this.attract.dispose(); this.attract = null; }
    if (this.game) { this.game.dispose(); this.game = null; }
    this.menus.clear();
    const g = new Game({ ...o, menus: this.menus });
    g.onEnd = () => this.menus.end(g);
    this.game = g;
    return g;
  }
  toMenu() {
    if (this.game) { this.game.dispose(); this.game = null; }
    this.startAttract();
    this.menus.main();
  }
  startAttract() {
    if (this.attract) return;
    const clans = ['thunder', 'river', 'wind', 'shadow'] as const;
    const a = clans[(Math.random() * 4) | 0];
    let b = clans[(Math.random() * 4) | 0];
    if (b === a) b = clans[(clans.indexOf(a) + 2) % 4];
    const settings: MatchSettings = { seed: (Math.random() * 1e9) | 0, players: [{ clan: a, name: a, ai: true }, { clan: b, name: b, ai: true }] };
    this.attract = new Game({ mode: 'attract', settings, me: -1, ais: [{ seat: 0, strat: 'rush', diff: 'normal' }, { seat: 1, strat: 'rush', diff: 'normal' }], menus: this.menus });
    this.attract.speed = 1;
  }
}

function boot() {
  const loading = document.getElementById('loading') as HTMLElement;
  const bar = loading.querySelector('i') as HTMLElement;
  const app = new App();
  // warm the most common sprites in small slices so the first match starts smoothly
  const tmp = document.createElement('canvas');
  void tmp;
  let step = 0;
  const total = 12;
  const tick = () => {
    step++;
    bar.style.width = Math.round(step / total * 100) + '%';
    if (step < total) { setTimeout(tick, 16); return; }
    loading.remove();
    app.startAttract();
    app.menus.main();
  };
  setTimeout(tick, 30);
  document.addEventListener('click', () => unlockAudio(), { once: true });
  void POSES;
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
