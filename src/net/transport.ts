// Transports carry "presence": one absolute state object per participant, latest value wins.
// That suits lockstep: each side publishes its unacknowledged turns, so lost or coalesced updates never matter.

export interface Transport {
  myId: string;
  kind: string;
  setState(patch: Record<string, any>): void;
  /** called with every other participant's full state whenever it changes */
  onState(fn: (peer: string, state: any) => void): void;
  onLeave(fn: (peer: string) => void): void;
  connected(): boolean;
  close(): void;
}

// ---------------------------------------------------------------- Claude artifact room
export async function getRoom(): Promise<any | null> {
  try {
    const c = (window as any).claude;
    if (!c || typeof c.use !== 'function') return null;
    const r = await Promise.race([c.use('room'), new Promise(res => setTimeout(() => res(null), 6000))]);
    return r || null;
  } catch { return null; }
}

export class RoomTransport implements Transport {
  kind = 'room';
  myId = '';
  private stateFns: ((p: string, s: any) => void)[] = [];
  private leaveFns: ((p: string) => void)[] = [];
  private last = new Map<string, any>();
  private unsub: (() => void) | null = null;
  cur: Record<string, any> = {};
  constructor(private room: any) {
    this.unsub = room.onPeers((ch: any) => {
      for (const p of ch.peers) {
        if (p.isMe && p.sameTab) { this.myId = p.peer; continue; }
        if (this.last.get(p.peer) === p.presence) continue;
        this.last.set(p.peer, p.presence);
        if (p.presence && Object.keys(p.presence).length) for (const f of this.stateFns) f(p.peer, p.presence);
      }
      for (const p of ch.left) { this.last.delete(p.peer); for (const f of this.leaveFns) f(p.peer); }
    }, () => { /* terminal error: page keeps working alone */ });
  }
  static async join(lobby: any, name: string): Promise<RoomTransport | null> {
    try { const r = await lobby.join(name); return new RoomTransport(r); } catch { return null; }
  }
  setState(patch: Record<string, any>) {
    for (const k in patch) { if (patch[k] === null) delete this.cur[k]; else this.cur[k] = patch[k]; }
    this.room.presence(patch).catch((e: any) => { if (typeof console !== 'undefined') console.warn('presence rejected', e && e.code); });
  }
  onState(fn: (p: string, s: any) => void) { this.stateFns.push(fn); }
  onLeave(fn: (p: string) => void) { this.leaveFns.push(fn); }
  connected() { try { return this.room.connected(); } catch { return false; } }
  close() { try { this.unsub && this.unsub(); if (this.room.leave) this.room.leave(); } catch { /* */ } }
}

// ---------------------------------------------------------------- BroadcastChannel (two tabs, same browser) fallback
export class BroadcastTransport implements Transport {
  kind = 'local';
  myId = Math.random().toString(36).slice(2, 10);
  private ch: BroadcastChannel;
  private stateFns: ((p: string, s: any) => void)[] = [];
  private leaveFns: ((p: string) => void)[] = [];
  cur: Record<string, any> = {};
  private timer: any;
  private seen = new Map<string, number>();
  constructor(name: string) {
    this.ch = new BroadcastChannel('wc-' + name);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === this.myId) return;
      if (m.bye) { for (const f of this.leaveFns) f(m.from); return; }
      this.seen.set(m.from, Date.now());
      if (m.hello) this.send();
      for (const f of this.stateFns) f(m.from, m.state);
    };
    this.ch.postMessage({ from: this.myId, hello: true, state: this.cur });
    this.timer = setInterval(() => this.send(), 700);
    addEventListener('beforeunload', () => this.ch.postMessage({ from: this.myId, bye: true }));
  }
  private send() { try { this.ch.postMessage({ from: this.myId, state: this.cur }); } catch { /* */ } }
  setState(patch: Record<string, any>) { for (const k in patch) { if (patch[k] === null) delete this.cur[k]; else this.cur[k] = patch[k]; } this.send(); }
  onState(fn: (p: string, s: any) => void) { this.stateFns.push(fn); }
  onLeave(fn: (p: string) => void) { this.leaveFns.push(fn); }
  connected() { return true; }
  close() { clearInterval(this.timer); this.ch.postMessage({ from: this.myId, bye: true }); this.ch.close(); }
}

// ---------------------------------------------------------------- in-memory pair with latency, for tests
export class LoopbackHub {
  ends: LoopbackTransport[] = [];
  constructor(public latency = 80, public jitter = 60, public dropRate = 0.2, public rand: () => number = Math.random) {}
  make(id: string) { const t = new LoopbackTransport(this, id); this.ends.push(t); return t; }
}
export class LoopbackTransport implements Transport {
  kind = 'loopback';
  stateFns: ((p: string, s: any) => void)[] = [];
  cur: Record<string, any> = {};
  pending: { at: number; state: any }[] = [];
  constructor(private hub: LoopbackHub, public myId: string) {}
  now = 0;
  setState(patch: Record<string, any>) {
    for (const k in patch) { if (patch[k] === null) delete this.cur[k]; else this.cur[k] = patch[k]; }
    const snap = JSON.parse(JSON.stringify(this.cur));
    for (const e of this.hub.ends) if (e !== this) {
      // presence is coalesced: sometimes an intermediate state never arrives
      if (this.hub.rand() < this.hub.dropRate) continue;
      e.pending.push({ at: this.now + this.hub.latency + this.hub.rand() * this.hub.jitter, state: { from: this.myId, s: snap } });
    }
  }
  /** advance simulated clock and deliver */
  tick(now: number) {
    this.now = now;
    this.pending.sort((a, b) => a.at - b.at);
    let lastDelivered: any = null;
    while (this.pending.length && this.pending[0].at <= now) lastDelivered = this.pending.shift()!.state;
    if (lastDelivered) for (const f of this.stateFns) f(lastDelivered.from, lastDelivered.s);
  }
  onState(fn: (p: string, s: any) => void) { this.stateFns.push(fn); }
  onLeave() { /* */ }
  connected() { return true; }
  close() { /* */ }
}
