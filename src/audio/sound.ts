// Synthesised sounds (WebAudio): no files to load.
let ac: AudioContext | null = null;
let master: GainNode | null = null;
export let soundOn = true;
export let volume = 0.5;
export function setSound(on: boolean) { soundOn = on; }
export function setVolume(v: number) { volume = v; if (master) master.gain.value = v; }
export function unlockAudio() {
  try {
    if (!ac) { ac = new (window.AudioContext || (window as any).webkitAudioContext)(); master = ac.createGain(); master.gain.value = volume; master.connect(ac.destination); }
    if (ac.state === 'suspended') ac.resume();
  } catch { ac = null; }
}
const last: Record<string, number> = {};
function ok(name: string, gap: number) {
  if (!soundOn || !ac || !master) return false;
  const t = performance.now();
  if (last[name] && t - last[name] < gap) return false;
  last[name] = t; return true;
}
function noiseBuf(len: number): AudioBuffer {
  const b = ac!.createBuffer(1, Math.floor(ac!.sampleRate * len), ac!.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function env(g: GainNode, t: number, a: number, peak: number, dcy: number) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}
function voice(f0: number, f1: number, f2: number, dur: number, peak = 0.25, type: OscillatorType = 'sawtooth', formant = 1400) {
  const t = ac!.currentTime;
  const o = ac!.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur * 0.35); o.frequency.linearRampToValueAtTime(f2, t + dur);
  const f = ac!.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = formant; f.Q.value = 2.5;
  const g = ac!.createGain(); env(g, t, 0.02, peak, dur);
  o.connect(f); f.connect(g); g.connect(master!); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur: number, freq: number, q: number, peak: number, type: BiquadFilterType = 'bandpass', delay = 0) {
  const t = ac!.currentTime + delay;
  const s = ac!.createBufferSource(); s.buffer = noiseBuf(dur + 0.05);
  const f = ac!.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac!.createGain(); env(g, t, 0.01, peak, dur);
  s.connect(f); f.connect(g); g.connect(master!); s.start(t); s.stop(t + dur + 0.05);
}
function tone(freq: number, dur: number, peak: number, delay = 0, type: OscillatorType = 'sine') {
  const t = ac!.currentTime + delay;
  const o = ac!.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ac!.createGain(); env(g, t, 0.03, peak, dur);
  o.connect(g); g.connect(master!); o.start(t); o.stop(t + dur + 0.1);
}
export const sfx = {
  mew() { if (!ok('mew', 120)) return; const p = 550 + Math.random() * 250; voice(p, p * 1.45, p * 0.8, 0.28, 0.16, 'sawtooth', 1600); },
  chirp() { if (!ok('chirp', 100)) return; const p = 900 + Math.random() * 200; voice(p, p * 1.3, p * 1.1, 0.12, 0.12, 'triangle', 2200); voice(p * 1.2, p * 1.5, p * 1.3, 0.1, 0.08, 'triangle', 2400); },
  hiss() { if (!ok('hiss', 140)) return; noise(0.22, 4500, 0.8, 0.12, 'highpass'); },
  scratch() { if (!ok('scratch', 90)) return; noise(0.06, 3000, 3, 0.09); noise(0.05, 3500, 3, 0.07, 'bandpass', 0.06); },
  yowl() { if (!ok('yowl', 300)) return; voice(500, 780, 300, 0.7, 0.14, 'sawtooth', 1100); },
  alarm() { if (!ok('alarm', 900)) return; for (let i = 0; i < 3; i++) { const t0 = i * 0.28; setTimeout(() => voice(900, 1300, 700, 0.25, 0.18, 'sawtooth', 1500), t0 * 1000); } },
  rustle() { if (!ok('rustle', 150)) return; noise(0.25, 2200, 0.7, 0.08); },
  done() { if (!ok('done', 300)) return; tone(660, 0.25, 0.08); tone(880, 0.35, 0.07, 0.12); },
  age() { if (!ok('age', 1000)) return; [523, 659, 784, 1046].forEach((f, i) => tone(f, 1.6, 0.06, i * 0.12, 'triangle')); },
  trespass() { if (!ok('trespass', 1500)) return; tone(440, 0.18, 0.1, 0, 'square'); tone(330, 0.25, 0.1, 0.2, 'square'); },
  season() { if (!ok('season', 2000)) return; noise(2.2, 500, 0.5, 0.06, 'lowpass'); },
  rumble() { if (!ok('rumble', 2000)) return; noise(3.2, 90, 0.8, 0.22, 'lowpass'); },
  monster() { if (!ok('monster', 1500)) return; const t = ac!.currentTime; const o = ac!.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(140, t + 0.8); o.frequency.linearRampToValueAtTime(60, t + 1.8); const f = ac!.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; const g = ac!.createGain(); env(g, t, 0.3, 0.14, 1.6); o.connect(f); f.connect(g); g.connect(master!); o.start(t); o.stop(t + 2); },
  purr() { if (!ok('purr', 500)) return; const t = ac!.currentTime; const s = ac!.createBufferSource(); s.buffer = noiseBuf(1.2); const f = ac!.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; const g = ac!.createGain(); g.gain.value = 0; const lfo = ac!.createOscillator(); lfo.frequency.value = 24; const lg = ac!.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(g.gain); s.connect(f); f.connect(g); g.connect(master!); s.start(t); lfo.start(t); s.stop(t + 1.2); lfo.stop(t + 1.2); },
  victory() { if (!ok('victory', 3000)) return; [392, 523, 659, 784].forEach((f, i) => tone(f, 1.2, 0.09, i * 0.18, 'triangle')); },
  defeat() { if (!ok('defeat', 3000)) return; [392, 330, 262].forEach((f, i) => tone(f, 1.0, 0.09, i * 0.3, 'triangle')); },
  click() { if (!ok('click', 40)) return; tone(1200, 0.04, 0.04, 0, 'square'); },
  error() { if (!ok('error', 400)) return; tone(200, 0.15, 0.08, 0, 'square'); },
};
