// AI-pilot för att prova navigatörens roll solo: en "blind" datorpilot som bara
// gör det navigatören säger med pilknapparna (håll ← / → för att svänga,
// ↑ / ↓ för att stiga/sjunka). Släpper man håller den vingarna plana och
// håller höjden mot nästa port. Spelreglerna körs lokalt, precis som hos en riktig pilot.
import { FlightSession, STEP } from './sim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MIN_TAP = 0.2;    // ett kort tryck ger ändå en tydlig sväng
const TURN = 1;         // max spakutslag när navigatören håller in ← eller →
const RAMP_UP = 2.5;    // ju längre man håller, desto skarpare sväng (mjukt, som en människa)
const RAMP_DOWN = 8;    // släpper man rätar piloten snabbt upp spaken

export class LocalAIPilot {
  constructor(level, { onState, onEvent }) {
    this.level = level;
    this.onState = onState;
    this.onEvent = onEvent;
    this.session = new FlightSession(level, (e) => this.onEvent(e));
    this.held = { left: 0, right: 0, up: 0, down: 0 };   // tidsstämplar för nedtryckta knappar
    this.until = { left: 0, right: 0, up: 0, down: 0 };  // minsta längd för korta tryck
    this.brake = false;
    this.x = 0;
    this.acc = 0;
    this.sendT = 0;
    this.time = 0;
    this.running = false;
  }

  // Meddelanden som navigatören annars skickar över nätet
  handle(msg) {
    if (!msg) return;
    if (msg.t === 'go') this.session.begin();
    else if (msg.t === 'restart') { this.session.reset(); this.release(); }
  }

  press(dir) {
    if (!(dir in this.held)) return;
    this.held[dir] = this.time || 1e-6;
    this.until[dir] = this.time + MIN_TAP;
  }

  releaseDir(dir) { if (dir in this.held) this.held[dir] = 0; }
  release() { for (const k in this.held) { this.held[k] = 0; this.until[k] = 0; } }
  setBrake(v) { this.brake = !!v; }

  _active(dir) { return this.held[dir] > 0 || this.time < this.until[dir]; }

  _control(dt) {
    const S = this.session, p = S.plane;
    let tx = 0;
    if (this._active('left')) tx -= TURN;
    if (this._active('right')) tx += TURN;
    // öka mjukt mot fullt utslag, men backa snabbt när knappen släpps eller byts
    const rising = Math.abs(tx) > Math.abs(this.x) && Math.sign(tx) === Math.sign(this.x || tx);
    this.x += (tx - this.x) * Math.min(1, dt * (rising ? RAMP_UP : RAMP_DOWN));
    const x = this.x;
    // höjd: följ nästa port automatiskt, eller navigatörens ↑/↓
    const g = this.level.gates[Math.min(S.nextGate, this.level.gates.length - 1)];
    let wantPitch = clamp(Math.atan2(g.y - p.y, 60), -0.25, 0.25);
    if (this._active('up')) wantPitch = 0.28;
    if (this._active('down')) wantPitch = -0.28;
    const y = clamp((wantPitch - p.pitch) * 3, -1, 1);
    return { x, y, boost: false, brake: this.brake };
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  frame(dt) {
    this.time += dt;
    const S = this.session;
    const inp = S.phase === 'fly' ? this._control(dt) : { x: 0, y: 0 };
    if (S.phase !== 'fly') this.x = 0;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 8) { S.step(inp, STEP); this.acc -= STEP; n++; }
    if (n === 8) this.acc = 0;
    this.sendT += dt;
    if (this.sendT >= 0.05) { this.sendT = 0; this.onState(S.snapshot()); }
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }
}
