import type { ClanId } from './core';

export interface Order {
  o: 'move' | 'amove' | 'attack' | 'gather' | 'build' | 'repair' | 'shelter' | 'deputy' | 'tunnel' | 'explore';
  x?: number; y?: number; t?: number;
}

export interface QItem { u?: string; tech?: string; left: number; total: number; paid: { prey: number; moss: number; herbs: number } }

export interface Ent {
  id: number;
  k: number;            // 1 unit, 2 building, 3 resource
  t: string;            // type key
  o: number;            // owner: player index, -1 = wild/none
  x: number; y: number; // fixed-point centre
  hp: number; mhp: number;
  dead: number;
  gone?: boolean;
  // ---- unit ----
  px?: number; py?: number;
  face?: number; anim?: number;
  ord?: Order[];
  gx?: number; gy?: number; gR?: number;    // current movement goal
  path?: number[] | null; pi?: number; pgx?: number; pgy?: number; preq?: boolean;
  stuck?: number; repaths?: number; lastD?: number;
  moving?: boolean;
  tgt?: number; cd?: number; pcd?: number;
  pounce?: { conc: boolean; t: number; start: number } | null;
  carry?: number; carryT?: string; gacc?: number; gs?: number; gres?: number;
  name?: string; kills?: number; pelt?: number;
  lastMove?: number; lastFight?: number; lastHurt?: number; lastHit?: number; reveal?: number; lightning?: number;
  lastAttacker?: number;
  dep?: boolean; leader?: boolean;
  hide?: number; hideUntil?: number;  // 1 sheltered, 2 leader respawning, 3 journey to Moonstone, 4 in tunnel
  stance?: number; hx?: number; hy?: number;
  prog?: number;
  den?: number[];
  saved?: Order[] | null;
  vis?: number;         // bitmask of players that can see it
  inClaim?: number;     // bitmask of player claims it stands in
  explore?: boolean;
  healT?: number;
  // ---- building ----
  tx?: number; ty?: number; sz?: number; done?: boolean; bp?: number; bneed?: number; bcount?: number;
  q?: QItem[]; rally?: { x: number; y: number; t: number } | null; dis?: number; shel?: number[]; pair?: number; fcd?: number;
  seen?: number;        // bitmask of players who have seen it
  // ---- resource ----
  rt?: string; sub?: string; stock?: number; cap?: number; racc?: number; fallow?: number; r?: number;
  hazard?: number; immune?: string; moor?: boolean; rname?: string; critter?: string; home?: number;
}

export interface PlayerStats {
  gathered: { prey: number; moss: number; herbs: number };
  trained: number; lost: number; killed: number; built: number;
  ageTimes: number[];
  firstFight: number;
  timeline: { t: number; apps: number; army: number; prey: number; moss: number; herbs: number }[];
  livesLost: number;
}

export interface Player {
  id: number; clan: ClanId; name: string; ai: boolean;
  prey: number; moss: number; herbs: number;
  age: number; aging: boolean;
  techs: Record<string, boolean>;
  pop: number; cap: number;
  campId: number; leaderId: number; lives: number; deputyId: number; depCd: number;
  successionId: number; needSuccession: boolean;
  auraOff: number;
  alarm: boolean;
  defeated: boolean; resigned: boolean;
  claim: Uint8Array; vis: Uint8Array; explored: Uint8Array;
  sunAcc: number; lastTrespass: number; warnedSnow: number;
  stats: PlayerStats;
}

export interface GameEvent {
  tick: number;
  p: number;            // -1 = everyone, else player index
  kind: string;         // log category / sound cue
  text: string;
  x?: number; y?: number; id?: number; seq?: number;
}

export interface Cmd { c: string; p: number; [k: string]: any }

export interface PlayerSetup { clan: ClanId; name: string; ai?: boolean }
export interface MatchSettings {
  seed: number;
  players: PlayerSetup[];
  lastLife?: boolean;
  canonLeaders?: boolean;
}

export interface Monster { s: number; dir: number; hit: number[]; kind: number }
export interface Corpse { x: number; y: number; t: string; o: number; pelt: number; face: number; tick: number; clan: string }
export interface Fx { x: number; y: number; kind: string; tick: number; o?: number }
