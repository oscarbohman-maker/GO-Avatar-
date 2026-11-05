// Spelregler för en flygning: faser, portar, krascher, straff och mål.
// Körs hos piloten (auktoritativ) och skickas sedan till navigatören.

import { stepFlight, checkPlaneCollision, gateCrossing, yawFromDir, forward, newPlane, FLIGHT } from './physics.js';
import { STAR_BONUS, STAR_RADIUS } from './levels.js';

// Kortaste avståndet från punkten c till sträckan a-b (3D)
function segDist2(a, b, c) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const L = vx * vx + vy * vy + vz * vz;
  let t = L > 0 ? ((c.x - a[0]) * vx + (c.y - a[1]) * vy + (c.z - a[2]) * vz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a[0] + vx * t - c.x, dy = a[1] + vy * t - c.y, dz = a[2] + vz * t - c.z;
  return dx * dx + dy * dy + dz * dz;
}

export const STEP = 1 / 60;
export const CRASH_TIME = 2.0;  // sekunder som planet tumlar efter en krasch
const GRACE = 0.8;
const COUNTDOWN = 3;
const GRAV = 22;

export class FlightSession {
  constructor(level, onEvent = () => {}) {
    this.level = level;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    const s = this.level.start;
    this.plane = newPlane(s.x, s.y, s.z, s.yaw);
    this.phase = 'waiting';   // waiting -> countdown -> fly <-> crashed -> finished
    this.countdown = COUNTDOWN;
    this.nextGate = 0;
    this.flightTime = 0;
    this.penalty = 0;
    this.crashes = 0;
    this.misses = 0;
    this.phaseTimer = 0;
    this.grace = 0;
    this.lastCrash = null;
    this.tumble = null;
    this.stars = new Set();
  }

  get bonus() { return this.stars.size * STAR_BONUS; }
  get time() { return Math.max(0, this.flightTime + this.penalty - this.bonus); }

  begin() {
    if (this.phase !== 'waiting') return;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.onEvent({ kind: 'countdown' });
  }

  respawn() {
    const L = this.level;
    const from = this.nextGate > 0 ? L.gates[this.nextGate - 1] : L.start;
    const to = L.gates[this.nextGate];
    const t = this.plane.t;
    this.plane = newPlane(from.x, from.y, from.z, yawFromDir(to.x - from.x, to.z - from.z));
    this.plane.t = t;
    this.tumble = null;
    this.grace = GRACE;
  }

  // Planet tumlar efter en krasch: studsar bakåt, snurrar och faller
  _startTumble() {
    const p = this.plane;
    const f = forward(p.yaw, p.pitch);
    const v = Math.max(p.speed, 20);
    const side = p.roll >= 0 ? 1 : -1;
    this.tumble = {
      vx: -f[0] * v * 0.18, vy: 9, vz: -f[2] * v * 0.18,
      wr: side * (4 + v * 0.05), wp: -2.2, wy: side * 0.8,
    };
  }

  _stepTumble(dt) {
    const p = this.plane, T = this.tumble;
    T.vy -= GRAV * dt;
    p.x += T.vx * dt; p.y += T.vy * dt; p.z += T.vz * dt;
    p.roll += T.wr * dt; p.pitch += T.wp * dt; p.yaw += T.wy * dt;
    const damp = Math.exp(-0.6 * dt);
    T.vx *= damp; T.vz *= damp;
    if (p.y < 2.2) {
      p.y = 2.2;
      if (T.vy < 0) T.vy = -T.vy * 0.35;
      T.wr *= 0.6; T.wp *= 0.6; T.wy *= 0.6; T.vx *= 0.5; T.vz *= 0.5;
    }
    p.speed = Math.hypot(T.vx, T.vy, T.vz);
    p.rollAcc = T.wr * 3; p.accLong = -20; p.loadN = 1 + Math.sin(p.t * 20) * 0.8;
    p.rollRate = T.wr; p.pitchRate = T.wp;
    p.t += dt;
  }

  step(inp, dt = STEP) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      this.plane.t += dt;
      if (this.countdown <= 0) { this.phase = 'fly'; this.onEvent({ kind: 'go' }); }
      return;
    }
    if (this.phase === 'crashed') {
      this.phaseTimer -= dt;
      this.flightTime += dt;
      this._stepTumble(dt);
      if (this.phaseTimer <= 0) { this.respawn(); this.phase = 'fly'; this.onEvent({ kind: 'respawn' }); }
      return;
    }
    if (this.phase !== 'fly') { this.plane.t += dt; return; }

    const p = this.plane;
    const p0 = [p.x, p.y, p.z];
    stepFlight(p, inp, dt, FLIGHT);
    this.flightTime += dt;
    if (p.y > this.level.ceiling) { p.y = this.level.ceiling; if (p.pitch > 0) { p.pitch *= 0.9; p.pitchRate = Math.min(0, p.pitchRate); } }
    const p1 = [p.x, p.y, p.z];

    // stjärnor: flyg igenom för bonus
    const stars = this.level.stars || [];
    for (const st of stars) {
      if (this.stars.has(st.idx)) continue;
      if (segDist2(p0, p1, st) < STAR_RADIUS * STAR_RADIUS) {
        this.stars.add(st.idx);
        this.onEvent({ kind: 'star', idx: st.idx, count: this.stars.size, total: stars.length });
      }
    }

    const g = this.level.gates[this.nextGate];
    const cross = gateCrossing(g, p0, p1);
    if (cross === 'pass' || cross === 'miss') {
      if (cross === 'miss') { this.misses++; this.penalty += this.level.penalties.miss; }
      this.nextGate++;
      const finished = this.nextGate >= this.level.gates.length;
      this.onEvent({ kind: cross, gate: g.idx, finished });
      if (finished) {
        this.phase = 'finished';
        this.onEvent({ kind: 'finish', time: this.time, crashes: this.crashes, misses: this.misses, stars: this.stars.size, totalStars: stars.length });
        return;
      }
    }

    if (this.grace > 0) { this.grace -= dt; return; }
    const hit = checkPlaneCollision(this.level, p);
    if (hit) {
      this.crashes++;
      this.penalty += this.level.penalties.crash;
      this.phase = 'crashed';
      this.phaseTimer = CRASH_TIME;
      this.lastCrash = hit;
      this._startTumble();
      this.onEvent({ kind: 'crash', what: hit });
    }
  }

  // Kompakt tillstånd som skickas över nätet ~20 ggr/s
  snapshot() {
    const p = this.plane;
    const r = (v, k = 100) => Math.round(v * k) / k;
    return {
      t: 'st', x: r(p.x), y: r(p.y), z: r(p.z), yw: r(p.yaw, 1000), pt: r(p.pitch, 1000), rl: r(p.roll, 1000),
      sp: r(p.speed, 10), ng: this.nextGate, tm: r(this.time, 10), cr: this.crashes, ms: this.misses,
      ph: this.phase, cd: r(this.countdown, 10), sc: this.stars.size,
      // för kroppar, rattar och instrument hos navigatören
      ix: r(p.ix), iy: r(p.iy), th: p.throttle, ln: r(p.loadN), al: r(p.accLong, 10), ra: r(p.rollAcc, 10),
    };
  }
}
