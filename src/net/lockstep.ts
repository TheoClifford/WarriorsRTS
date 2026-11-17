// Deterministic lockstep over a presence transport.
// Turns are 2 ticks (100 ms). Each side publishes the window of its turns the other hasn't acknowledged.
import type { Transport } from './transport';
import type { Cmd } from '../sim/types';
import type { World } from '../sim/world';

export const TURN = 2;
const HASH_EVERY = 10; // turns

export interface LockstepStatus { waiting: boolean; waitMs: number; peerSilentMs: number; delay: number; rtt: number; desync: number; resyncing: boolean; resyncProgress: number }

export class Lockstep {
  local = new Map<number, Cmd[]>();
  remote = new Map<number, Cmd[]>();
  pending: Cmd[] = [];
  lastCommitted = -1;  // my highest committed turn
  peerAck = -1;        // highest of my turns the peer has (contiguous)
  myAck = -1;          // highest contiguous remote turn I have
  delay = 3;
  myHashes = new Map<number, number>();
  peerHashes = new Map<number, number>();
  desync = -1;
  sentAt = new Map<number, number>();
  rtt = 150;
  lastPeerChange = 0;
  waitStart = 0;
  hb = 0;
  peer = '';
  peerName = '';
  log: [number, number, Cmd][] = [];   // replay log: turn, player, command
  // resync
  snapOut: { id: number; turn: number; chunks: string[]; i: number } | null = null;
  snapIn: { id: number; n: number; parts: (string | null)[] } | null = null;
  needSnap = false;
  onRestored: ((json: string) => void) | null = null;
  lastPublish = 0;
  dirty = true;
  maxWindowChars = 1600;
  epoch = 0;
  peerRole = '';
  clock: () => number = () => performance.now();

  constructor(public t: Transport, public seat: number, public world: World, now: number) {
    this.lastPeerChange = now;
    t.onState((peer, s) => this.onRemote(peer, s));
    // the first turns are empty for everyone
    for (let k = 0; k < this.delay; k++) { this.local.set(k, []); this.remote.set(k, []); }
    this.lastCommitted = this.delay - 1;
    this.myAck = this.delay - 1;
    this.peerAck = this.delay - 1;
  }

  issue(cmd: Cmd) { cmd.p = this.seat; this.pending.push(cmd); }

  /** commit my turns up to current + delay, then publish */
  pump(tick: number, now: number) {
    const cur = Math.floor(tick / TURN);
    const windowChars = this.windowChars();
    while (this.lastCommitted < cur + this.delay) {
      const t = ++this.lastCommitted;
      const take = windowChars < this.maxWindowChars ? this.pending.splice(0, 12) : [];
      this.local.set(t, take);
      this.sentAt.set(t, now);
      this.dirty = true;
    }
    if (now - this.lastPublish > 1000) { this.hb++; this.dirty = true; }
    if (this.dirty && now - this.lastPublish > 30) this.publish(now);
    // adapt delay to round trip
    const want = Math.max(2, Math.min(12, Math.ceil((this.rtt * 1.25 + 40) / (TURN * 50))));
    if (want > this.delay) this.delay = want;
    else if (want < this.delay && cur % 50 === 0) this.delay--;
  }
  windowChars(): number {
    let n = 0;
    for (let t = this.peerAck + 1; t <= this.lastCommitted; t++) n += JSON.stringify(this.local.get(t) || []).length + 1;
    return n;
  }
  publish(now: number) {
    const c: Cmd[][] = [];
    for (let t = this.peerAck + 1; t <= this.lastCommitted; t++) c.push((this.local.get(t) || []).map(x => { const y: any = { ...x }; delete y.p; return y; }));
    const h: number[] = [];
    const keys = Array.from(this.myHashes.keys()).sort((a, b) => b - a).slice(0, 3);
    for (const k of keys) h.push(k, this.myHashes.get(k) as number);
    const patch: any = { ls: { b: this.peerAck + 1, c }, ack: this.myAck, h, hb: this.hb, d: this.delay, need: this.needSnap ? 1 : 0, ep: this.epoch };
    if (this.snapOut) {
      const s = this.snapOut;
      patch.snap = { id: s.id, n: s.chunks.length, i: s.i, d: s.chunks[s.i], turn: s.turn };
      s.i = (s.i + 1) % s.chunks.length;
      this.dirty = true; // keep cycling
    } else patch.snap = null;
    if (this.snapIn) patch.got = { id: this.snapIn.id, k: this.snapIn.parts.filter(Boolean).length };
    // presence is capped (4 KiB for the whole merged object): send fewer turns rather than fail
    const base = (this.t as any).cur ? JSON.stringify({ ...(this.t as any).cur, ls: null, snap: null, got: null }).length : 300;
    while (c.length > 1 && base + JSON.stringify(patch).length > 3900) c.pop();
    this.t.setState(patch);
    this.lastPublish = now;
    this.dirty = false;
  }

  onRemote(peer: string, s: any) {
    if (!s || !s.ls) return;
    if (this.peer && peer !== this.peer) return;
    if (this.peerRole && s.role && s.role !== this.peerRole) return;
    const now = this.clock();
    if (s.hb !== undefined && s.hb !== this.lastHb) { this.lastPeerChange = now; this.lastHb = s.hb; }
    else this.lastPeerChange = now;
    // snapshots (resync / reconnect) first
    if (s.snap && s.snap.id !== this.epoch && !this.snapOut) { this.needSnap = true; this.collectSnap(s.snap); }
    if (s.need && !this.needSnap && !this.snapOut) this.startSnapshot();
    if (s.got && this.snapOut && s.got.id === this.snapOut.id && s.got.k >= this.snapOut.chunks.length) { this.snapOut = null; this.dirty = true; }
    if ((s.ep | 0) !== this.epoch || this.needSnap || this.snapOut) return;
    const ls = s.ls;
    if (typeof ls.b === 'number' && Array.isArray(ls.c)) {
      for (let i = 0; i < ls.c.length; i++) {
        const t = ls.b + i;
        if (!this.remote.has(t)) {
          const list: Cmd[] = (ls.c[i] || []).map((x: any) => ({ ...x, p: 1 - this.seat }));
          this.remote.set(t, list);
        }
      }
      while (this.remote.has(this.myAck + 1)) this.myAck++;
      this.dirty = true;
    }
    if (typeof s.ack === 'number' && s.ack > this.peerAck) {
      for (let t = this.peerAck + 1; t <= s.ack; t++) {
        const at = this.sentAt.get(t);
        if (at !== undefined) { this.rtt = this.rtt * 0.85 + (now - at) * 0.15; this.sentAt.delete(t); }
      }
      this.peerAck = s.ack;
      this.dirty = true;
    }
    if (Array.isArray(s.h)) for (let i = 0; i + 1 < s.h.length; i += 2) {
      this.peerHashes.set(s.h[i], s.h[i + 1]);
      const mine = this.myHashes.get(s.h[i]);
      if (mine !== undefined && mine !== s.h[i + 1] && this.desync < 0) this.desync = s.h[i];
    }
  }
  lastHb = -1;

  /** may the simulation advance from this tick? */
  canStep(tick: number): boolean {
    if (this.needSnap || this.snapOut) return false;
    if (tick % TURN !== 0) return true;
    const turn = tick / TURN;
    return this.local.has(turn) && this.remote.has(turn);
  }
  /** commands to execute at this tick, in seat order */
  commandsFor(tick: number): Cmd[] {
    if (tick % TURN !== 0) return [];
    const turn = tick / TURN;
    const a = this.local.get(turn) || [], b = this.remote.get(turn) || [];
    const out = this.seat === 0 ? [...a, ...b] : [...b, ...a];
    for (const c of out) this.log.push([turn, c.p, c]);
    // forget old turns
    this.local.delete(turn - 200); this.remote.delete(turn - 200);
    return out;
  }
  /** call before stepping a tick that starts a turn */
  recordHash(tick: number) {
    if (tick % (TURN * HASH_EVERY) !== 0) return;
    const turn = tick / TURN;
    const h = this.world.hash();
    this.myHashes.set(turn, h);
    if (this.myHashes.size > 8) { const k = Math.min(...Array.from(this.myHashes.keys())); this.myHashes.delete(k); }
    const ph = this.peerHashes.get(turn);
    if (ph !== undefined && ph !== h && this.desync < 0) this.desync = turn;
    this.dirty = true;
  }
  status(tick: number, now: number): LockstepStatus {
    const waiting = !this.canStep(tick);
    if (!waiting) this.waitStart = 0; else if (!this.waitStart) this.waitStart = now;
    return {
      waiting, waitMs: this.waitStart ? now - this.waitStart : 0, peerSilentMs: now - this.lastPeerChange, delay: this.delay, rtt: this.rtt, desync: this.desync,
      resyncing: this.needSnap || !!this.snapOut, resyncProgress: this.snapIn ? this.snapIn.parts.filter(Boolean).length / this.snapIn.n : 0,
    };
  }

  // ---------------------------------------------------------------- resync
  requestResync() { if (this.seat === 0) this.startSnapshot(); else { this.needSnap = true; this.dirty = true; } }
  /** a freshly loaded page that rejoins a running match */
  rejoin() { this.needSnap = true; this.dirty = true; }
  startSnapshot() {
    // snapshot at the current tick (must be a turn boundary: we only stop at turn boundaries)
    const tick = this.world.tick;
    const turn = Math.floor(tick / TURN);
    const state = {
      world: this.world.snapshot(),
      turn,
      // turns from now on that I've committed and the peer has sent
      mine: Array.from(this.local.entries()).filter(([t]) => t >= turn),
      theirs: Array.from(this.remote.entries()).filter(([t]) => t >= turn),
    };
    const json = JSON.stringify(state);
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += 1800) chunks.push(json.slice(i, i + 1800));
    const id = ((Date.now() & 0xffffff) | 1) + (this.epoch === ((Date.now() & 0xffffff) | 1) ? 2 : 0);
    this.snapOut = { id, turn, chunks, i: 0 };
    this.epoch = id;
    this.desync = -1;
    this.dirty = true;
  }
  collectSnap(s: any) {
    if (!this.snapIn || this.snapIn.id !== s.id) this.snapIn = { id: s.id, n: s.n, parts: new Array(s.n).fill(null) };
    if (s.i >= 0 && s.i < s.n) this.snapIn.parts[s.i] = s.d;
    this.dirty = true;
    if (this.snapIn.parts.every(Boolean)) {
      const json = this.snapIn.parts.join('');
      try {
        const st = JSON.parse(json);
        this.world.restore(st.world);
        this.local.clear(); this.remote.clear();
        // the sender's "mine" are my remote; its "theirs" are my local
        for (const [t, c] of st.mine) this.remote.set(t, (c as Cmd[]).map(x => ({ ...x, p: 1 - this.seat })));
        for (const [t, c] of st.theirs) this.local.set(t, (c as Cmd[]).map(x => ({ ...x, p: this.seat })));
        const maxL = Math.max(st.turn - 1, ...Array.from(this.local.keys()));
        this.lastCommitted = maxL;
        for (let t = st.turn; t <= maxL; t++) if (!this.local.has(t)) this.local.set(t, []);
        this.myAck = st.turn - 1; while (this.remote.has(this.myAck + 1)) this.myAck++;
        this.peerAck = Math.min(this.peerAck, st.turn - 1);
        this.epoch = this.snapIn.id;
        this.myHashes.clear(); this.peerHashes.clear();
        this.desync = -1;
        this.needSnap = false;
        this.snapIn = { id: this.epoch, n: st.n || this.snapIn.n, parts: this.snapIn.parts };
        if (this.onRestored) this.onRestored(json);
      } catch { /* wait for a fresh cycle */ this.snapIn = null; }
    }
  }
}
