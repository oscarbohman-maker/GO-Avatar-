// Pilotens vy: kör flygningen (fysik + regler) och visar den från pilotstolen.
import { FlightSession, STEP } from './sim.js';
import { Input } from './input.js';
import { View3D } from './view3d.js';

export class PilotView {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.onEvent = opts.onEvent || (() => {});
    this.onFrame = opts.onFrame || (() => {});
    this.session = new FlightSession(level, (e) => this.onEvent(e));
    this.input = new Input(container, { invertY: opts.invertY, sensitivity: opts.sensitivity });
    this.view = new View3D(container.querySelector('.view3d-holder'), level, { seat: 'pilot' });
    this.acc = 0;
    this.running = false;
  }

  gesture(kind) { this.view.gesture(kind); }
  setRoute(pts) { this.view.setRoute(pts); }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  frame(dt) {
    const inp = this.input.read(dt);
    const S = this.session;
    if (this.autopilot && S.phase === 'fly') Object.assign(inp, this.autopilot(S));
    if (S.phase !== 'fly') { inp.x = 0; inp.y = 0; inp.boost = false; inp.brake = false; }
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 8) { S.step(inp, STEP); this.acc -= STEP; n++; }
    if (n === 8) this.acc = 0;

    const p = S.plane;
    this.view.frame(dt, {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, roll: p.roll, speed: p.speed,
      ix: p.ix, iy: p.iy, throttle: p.throttle, accLong: p.accLong, loadN: p.loadN, rollAcc: p.rollAcc,
      phase: S.phase, cd: S.countdown, ng: S.nextGate,
    }, this.input.look);
    this.onFrame(S, dt);
  }

  begin() { this.session.begin(); }
  restart() { this.session.reset(); }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.input.destroy();
    this.view.destroy();
  }
}
