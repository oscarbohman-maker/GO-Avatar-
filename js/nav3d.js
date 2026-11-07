// Navigatörens lilla 3D-fönster: andrepilotens plats i cockpiten.
// Pilotens tillstånd kommer ~20 ggr/s över nätet och interpoleras mjukt
// (renderas ca 110 ms bakåt i tiden mellan två mottagna lägen).
import { View3D } from './view3d.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const DELAY = 110;

export class NavCockpit {
  constructor(holder, level) {
    this.holder = holder;
    this.view = new View3D(holder, level, { seat: 'copilot', maxDpr: 1.5 });
    this.buf = [];
    this.running = false;
    this.paused = false;
  }

  push(s) {
    const now = performance.now();
    // börja om om planet "hoppar" (respawn/omstart)
    const last = this.buf[this.buf.length - 1];
    if (last && Math.hypot(s.x - last.s.x, s.z - last.s.z) > 60) this.buf = [];
    this.buf.push({ t: now, s });
    if (this.buf.length > 12) this.buf.shift();
  }

  sample(now) {
    const B = this.buf;
    if (!B.length) return null;
    const rt = now - DELAY;
    let a = B[0], b = B[B.length - 1];
    if (rt <= a.t) return this._map(a.s, a.s, 0);
    if (rt >= b.t) return this._map(b.s, b.s, 0);
    for (let i = 0; i < B.length - 1; i++) {
      if (B[i].t <= rt && rt <= B[i + 1].t) { a = B[i]; b = B[i + 1]; break; }
    }
    const k = (rt - a.t) / Math.max(1, b.t - a.t);
    return this._map(a.s, b.s, k);
  }

  _map(a, b, k) {
    const L = (p, q) => p + (q - p) * k;
    const A = (p, q) => p + wrap(q - p) * k;
    return {
      x: L(a.x, b.x), y: L(a.y, b.y), z: L(a.z, b.z),
      yaw: A(a.yw, b.yw), pitch: A(a.pt, b.pt), roll: A(a.rl, b.rl), speed: L(a.sp, b.sp),
      ix: L(a.ix || 0, b.ix || 0), iy: L(a.iy || 0, b.iy || 0), throttle: b.th || 0,
      accLong: L(a.al || 0, b.al || 0), loadN: L(a.ln || 1, b.ln || 1), rollAcc: L(a.ra || 0, b.ra || 0),
      phase: b.ph, cd: L(a.cd || 0, b.cd || 0), ng: b.ng,
      ft: (b.ft || 0) < (a.ft || 0) ? b.ft || 0 : L(a.ft || 0, b.ft || 0),   // flygtiden (för fallande stenar)
    };
  }

  gesture(kind) { this.view.gesture(kind); }
  setMode(m) { this.view.mode = m; }
  setPaused(p) { this.paused = p; if (!p) this.view.resize(); }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.paused) return;
      const st = this.sample(now);
      if (st) this.view.frame(dt, st, null);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.view.destroy();
  }
}
