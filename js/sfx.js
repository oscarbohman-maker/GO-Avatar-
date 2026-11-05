// Små ljudeffekter med WebAudio (inga ljudfiler behövs).
let ctx = null;

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (_) { ctx = null; }
}

function tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slideTo = null) {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch (_) {}
}

export const sfx = {
  tick() { tone(660, 0.12, 'square', 0.08); },
  go() { tone(990, 0.35, 'square', 0.1); },
  star() { tone(1320, 0.08, 'triangle', 0.12); tone(1760, 0.12, 'triangle', 0.1, 0.06); },
  gate() { tone(880, 0.1, 'sine', 0.15); tone(1320, 0.15, 'sine', 0.12, 0.08); },
  miss() { tone(300, 0.25, 'sawtooth', 0.08); },
  crash() { tone(200, 0.5, 'sawtooth', 0.15, 0, 40); },
  finish() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.12)); },
};
