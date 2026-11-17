// Inline SVG icons: Clan symbols, resources and command buttons.
const svg = (body: string, vb = '0 0 40 40') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const CLAN_SYMBOL: Record<string, (c: string) => string> = {
  thunder: c => svg(`<circle cx="20" cy="20" r="18" fill="#1e160e" stroke="${c}" stroke-width="2"/><path d="M23 5 L11 22 h8 l-4 13 l14-18 h-8 z" fill="${c}"/>`),
  river: c => svg(`<circle cx="20" cy="20" r="18" fill="#1e160e" stroke="${c}" stroke-width="2"/><path d="M7 15 q4.3-5 8.6 0 t8.6 0 t8.6 0 M7 22 q4.3-5 8.6 0 t8.6 0 t8.6 0 M7 29 q4.3-5 8.6 0 t8.6 0 t8.6 0" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`),
  wind: c => svg(`<circle cx="20" cy="20" r="18" fill="#1e160e" stroke="${c}" stroke-width="2"/><path d="M6 14 h18 a4 4 0 1 0 -4 -4 M6 21 h24 a4.5 4.5 0 1 1 -4.5 4.5 M6 28 h12" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`),
  shadow: c => svg(`<circle cx="20" cy="20" r="18" fill="#1e160e" stroke="${c}" stroke-width="2"/><path d="M24 7 a13 13 0 1 0 9 22 a10.5 10.5 0 1 1 -9 -22 z" fill="${c}"/><circle cx="29" cy="12" r="1.3" fill="${c}"/><circle cx="32" cy="18" r="1" fill="${c}"/>`),
};

export const RES_ICON: Record<string, string> = {
  prey: svg(`<ellipse cx="18" cy="23" rx="11" ry="7" fill="#8c7462" stroke="#2b2116" stroke-width="1.5"/><circle cx="29" cy="19" r="5" fill="#8c7462" stroke="#2b2116" stroke-width="1.5"/><circle cx="29" cy="13.5" r="2.6" fill="#c89a90" stroke="#2b2116"/><circle cx="31" cy="18.5" r="1" fill="#111"/><path d="M7 24 q-5 0 -5 6" stroke="#c89a90" stroke-width="1.6" fill="none"/>`),
  moss: svg(`<ellipse cx="20" cy="26" rx="15" ry="7" fill="#4e7a30" stroke="#1e2c12" stroke-width="1.5"/><circle cx="13" cy="21" r="6" fill="#78b048" stroke="#1e2c12" stroke-width="1.2"/><circle cx="22" cy="18" r="7" fill="#88c050" stroke="#1e2c12" stroke-width="1.2"/><circle cx="29" cy="22" r="5" fill="#6aa040" stroke="#1e2c12" stroke-width="1.2"/>`),
  herbs: svg(`<path d="M20 35 q-2-12 0-26" stroke="#3e5a24" stroke-width="2" fill="none"/><path d="M20 18 q-12-4-13-12 q10 1 13 12z" fill="#7cbc54" stroke="#2a3e18" stroke-width="1.2"/><path d="M20 24 q12-3 14-11 q-11 0-14 11z" fill="#64a440" stroke="#2a3e18" stroke-width="1.2"/><circle cx="20" cy="8" r="3" fill="#f0c840" stroke="#6a5010"/>`),
  pop: svg(`<path d="M8 32 q0-10 8-10 h8 q8 0 8 10z" fill="#c8b48c" stroke="#2b2116" stroke-width="1.5"/><circle cx="20" cy="14" r="7" fill="#c8b48c" stroke="#2b2116" stroke-width="1.5"/><path d="M14 9 l1-6 l4 4 M26 9 l-1-6 l-4 4" fill="#c8b48c" stroke="#2b2116" stroke-width="1.5"/>`),
};

const ico = (body: string) => svg(`<rect x="1" y="1" width="38" height="38" rx="3" fill="#2b2116"/>${body}`);
export const ICON: Record<string, string> = {
  stop: ico(`<path d="M11 11 L29 29 M29 11 L11 29" stroke="#e05a44" stroke-width="4" stroke-linecap="round"/>`),
  amove: ico(`<path d="M8 30 l12-12 M14 12 h8 v8" stroke="#e8c46a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M22 28 l8-14 M26 30 l8-14 M18 26 l8-14" stroke="#f0e0c0" stroke-width="2" stroke-linecap="round"/>`),
  aggressive: ico(`<path d="M10 30 l9-20 M17 31 l9-20 M24 32 l9-20" stroke="#e05a44" stroke-width="3" stroke-linecap="round"/>`),
  defensive: ico(`<path d="M20 7 l11 5 v8 q0 10 -11 14 q-11 -4 -11 -14 v-8 z" fill="#5a7a3a" stroke="#d8e8c0" stroke-width="2"/>`),
  stand: ico(`<path d="M12 32 q0-12 8-14 q-4-6 2-10 l2 4 l3-4 q3 6 -1 10 q6 3 6 14 z" fill="#c8b48c" stroke="#1e160e" stroke-width="1.5"/>`),
  deputy: ico(`<path d="M20 6 q10 8 4 22 q-4 6 -4 6 q0 0 -4 -6 q-6 -14 4 -22z" fill="#8fd068" stroke="#2a3e18" stroke-width="1.5"/><path d="M20 10 v22" stroke="#2a3e18" stroke-width="1.2"/>`),
  explore: ico(`<ellipse cx="20" cy="20" rx="13" ry="8" fill="#f0e0c0" stroke="#1e160e" stroke-width="1.5"/><ellipse cx="20" cy="20" rx="3" ry="7" fill="#58a040"/><ellipse cx="20" cy="20" rx="1.2" ry="5" fill="#111"/>`),
  delete: ico(`<path d="M12 12 l16 16 M28 12 l-16 16" stroke="#e05a44" stroke-width="3"/><circle cx="20" cy="20" r="13" fill="none" stroke="#e05a44" stroke-width="2"/>`),
  alarm: ico(`<path d="M8 22 q6-12 12 0 q6-12 12 0" stroke="#e8c46a" stroke-width="2.5" fill="none"/><path d="M20 8 v8 M12 10 l3 5 M28 10 l-3 5" stroke="#e05a44" stroke-width="2.5" stroke-linecap="round"/><text x="20" y="35" font-size="11" text-anchor="middle" fill="#f0e0c0" font-family="Georgia">!</text>`),
  shelter: ico(`<path d="M6 30 q14-26 28 0 z" fill="#4e6a34" stroke="#1e160e" stroke-width="1.5"/><ellipse cx="20" cy="27" rx="4" ry="4" fill="#120d08"/><path d="M30 10 l-6 6 M24 10 v6 h6" stroke="#f0e0c0" stroke-width="2"/>`),
  unshelter: ico(`<path d="M6 30 q14-26 28 0 z" fill="#4e6a34" stroke="#1e160e" stroke-width="1.5"/><ellipse cx="20" cy="27" rx="4" ry="4" fill="#120d08"/><path d="M24 16 l6 -6 M24 10 h6 v6" stroke="#f0e0c0" stroke-width="2"/>`),
  age2: ico(`<circle cx="20" cy="20" r="11" fill="#e8dcb0"/><circle cx="26" cy="17" r="10" fill="#2b2116"/><circle cx="12" cy="10" r="1.2" fill="#fff"/><circle cx="30" cy="31" r="1.2" fill="#fff"/>`),
  age3: ico(`<circle cx="20" cy="20" r="12" fill="#f0e4b8"/><circle cx="16" cy="17" r="2" fill="#d0c090"/><circle cx="24" cy="24" r="3" fill="#d0c090"/><path d="M5 35 l4-6 M35 35 l-4-6" stroke="#e05a44" stroke-width="2"/>`),
  battle1: ico(`<path d="M10 30 l8-20 M17 31 l8-20 M24 32 l8-20" stroke="#f0e0c0" stroke-width="2.5" stroke-linecap="round"/><text x="33" y="14" font-size="10" fill="#e8c46a" font-family="Georgia">I</text>`),
  battle2: ico(`<path d="M10 30 l8-20 M17 31 l8-20 M24 32 l8-20" stroke="#e8c46a" stroke-width="2.5" stroke-linecap="round"/><text x="31" y="14" font-size="10" fill="#e8c46a" font-family="Georgia">II</text>`),
  pelt1: ico(`<path d="M20 7 q12 3 12 13 q0 9 -12 14 q-12 -5 -12 -14 q0 -10 12 -13z" fill="#8a6a4a" stroke="#f0e0c0" stroke-width="1.5"/><path d="M14 16 q6 3 12 0 M14 22 q6 3 12 0" stroke="#5a3e28" stroke-width="2" fill="none"/>`),
  pelt2: ico(`<path d="M20 7 q12 3 12 13 q0 9 -12 14 q-12 -5 -12 -14 q0 -10 12 -13z" fill="#a0805a" stroke="#e8c46a" stroke-width="2"/><path d="M14 16 q6 3 12 0 M14 22 q6 3 12 0 M14 28 q6 2 12 0" stroke="#5a3e28" stroke-width="2" fill="none"/>`),
  senior: ico(`<path d="M20 6 l4 9 l10 1 l-7.5 6.5 l2.5 10 l-9 -5.5 l-9 5.5 l2.5 -10 l-7.5 -6.5 l10 -1z" fill="#e8c46a" stroke="#6a5010" stroke-width="1.2"/>`),
  hunting: ico(`<ellipse cx="17" cy="24" rx="9" ry="6" fill="#8c7462"/><circle cx="26" cy="20" r="4.5" fill="#8c7462"/><circle cx="26" cy="15" r="2.3" fill="#c89a90"/><path d="M28 30 l6 -6 M30 32 l6 -6" stroke="#f0e0c0" stroke-width="2"/>`),
  bundles: ico(`<circle cx="15" cy="22" r="7" fill="#78b048"/><circle cx="24" cy="18" r="8" fill="#88c050"/><circle cx="26" cy="27" r="6" fill="#6aa040"/><path d="M8 32 h24" stroke="#c8a070" stroke-width="2.5"/>`),
  tracking: ico(`<path d="M8 22 q12-14 24 0 q-12 14 -24 0z" fill="#f0e0c0"/><circle cx="20" cy="22" r="4" fill="#3a6a2a"/><path d="M27 10 q4 -2 6 2 M24 8 q4 -4 9 0" stroke="#e8c46a" stroke-width="1.5" fill="none"/>`),
  borders: ico(`<circle cx="20" cy="20" r="13" fill="none" stroke="#e8c46a" stroke-width="2" stroke-dasharray="4 3"/><rect x="17" y="15" width="6" height="12" rx="2" fill="#8a6a4a"/>`),
  herblore: ico(`<path d="M20 34 q-2-12 0-26" stroke="#3e5a24" stroke-width="2" fill="none"/><path d="M20 18 q-12-4-13-12 q10 1 13 12z" fill="#7cbc54"/><path d="M20 24 q12-3 14-11 q-11 0-14 11z" fill="#64a440"/><path d="M28 28 h8 M32 24 v8" stroke="#f0e0c0" stroke-width="2.4"/>`),
  cobweb: ico(`<path d="M20 6 v28 M6 20 h28 M10 10 l20 20 M30 10 l-20 20" stroke="#e8e8e8" stroke-width="1"/><circle cx="20" cy="20" r="5" fill="none" stroke="#e8e8e8"/><circle cx="20" cy="20" r="10" fill="none" stroke="#e8e8e8"/><circle cx="31" cy="30" r="4" fill="#f0a020"/>`),
  travelling: ico(`<ellipse cx="17" cy="24" rx="5" ry="4" fill="#f0e0c0"/><circle cx="11" cy="17" r="2" fill="#f0e0c0"/><circle cx="16" cy="15" r="2" fill="#f0e0c0"/><circle cx="21" cy="16" r="2" fill="#f0e0c0"/><path d="M26 12 h8 M28 18 h7 M27 24 h6" stroke="#8fd068" stroke-width="2"/>`),
  lightning: ico(`<path d="M23 5 L11 22 h8 l-4 13 l14-18 h-8 z" fill="#ffd040" stroke="#6a4a10"/>`),
  watercombat: ico(`<path d="M5 26 q4-5 8 0 t8 0 t8 0 t8 0" stroke="#5ab0f0" stroke-width="3" fill="none"/><path d="M14 20 l6-12 l6 12" fill="#c8d8e8" stroke="#1e160e"/>`),
  tunnels: ico(`<path d="M5 32 q15-30 30 0 z" fill="#7a5a3a"/><path d="M12 32 q8-14 16 0 z" fill="#120d08"/>`),
  nightambush: ico(`<path d="M24 7 a13 13 0 1 0 9 22 a10.5 10.5 0 1 1 -9 -22 z" fill="#b080e0"/><circle cx="14" cy="20" r="1.5" fill="#ffd040"/><circle cx="19" cy="20" r="1.5" fill="#ffd040"/>`),
  tunnel: ico(`<ellipse cx="20" cy="26" rx="15" ry="8" fill="#7a5a3a"/><ellipse cx="20" cy="25" rx="7" ry="5" fill="#120d08"/>`),
  tunnelgo: ico(`<ellipse cx="20" cy="26" rx="15" ry="8" fill="#7a5a3a"/><ellipse cx="20" cy="25" rx="7" ry="5" fill="#120d08"/><path d="M20 6 v10 M15 12 l5 5 l5 -5" stroke="#e8c46a" stroke-width="2.5" fill="none"/>`),
  more: ico(`<circle cx="12" cy="20" r="3" fill="#f0e0c0"/><circle cx="20" cy="20" r="3" fill="#f0e0c0"/><circle cx="28" cy="20" r="3" fill="#f0e0c0"/>`),
  back: ico(`<path d="M26 10 l-12 10 l12 10" stroke="#f0e0c0" stroke-width="3" fill="none"/>`),
};

export function starsHtml(lives: number) {
  let s = '';
  for (let i = 0; i < 9; i++) s += i < lives ? '★' : '<span class="lost">★</span>';
  return s;
}
export function seasonDial(season: number, frac: number) {
  // four quarters: newleaf (green), greenleaf (deep green), leaf-fall (amber), leaf-bare (white)
  const cols = ['#9cd060', '#4e8a30', '#d89040', '#e8eef4'];
  let parts = '';
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 4) * Math.PI * 2 - Math.PI / 2;
    parts += `<path d="M13 13 L${13 + 11 * Math.cos(a0)} ${13 + 11 * Math.sin(a0)} A11 11 0 0 1 ${13 + 11 * Math.cos(a1)} ${13 + 11 * Math.sin(a1)} Z" fill="${cols[i]}" opacity="${i === season ? 1 : 0.45}"/>`;
  }
  const a = ((season + frac) / 4) * Math.PI * 2 - Math.PI / 2;
  parts += `<line x1="13" y1="13" x2="${13 + 12 * Math.cos(a)}" y2="${13 + 12 * Math.sin(a)}" stroke="#2b2116" stroke-width="2"/><circle cx="13" cy="13" r="11.5" fill="none" stroke="#120d08"/>`;
  return `<svg width="26" height="26" viewBox="0 0 26 26">${parts}</svg>`;
}
