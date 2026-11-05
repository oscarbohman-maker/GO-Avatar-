// Spelregler för en flygning: faser, portar, krascher, straff och mål.
// Körs hos piloten (auktoritativ) och skickas sedan till navigatören.

import { stepFlight, checkCollision, gateCrossing, yawFromDir, FLIGHT } from './physics.js';

export const STEP = 1 / 60;
const CRASH_FREEZE = 1.3;
const GRACE = 0.8;
const COUNTDOWN = 3;

export class FlightSession {
  constructor(level, onEvent = () => {}) {
    this.level = level;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    const s = this.level.start;
    this.plane = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, roll: 0, speed: FLIGHT.baseSpeed };
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
  }

  get time() { return this.flightTime + this.penalty; }

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
    const p = this.plane;
    p.x = from.x; p.y = from.y; p.z = from.z;
    p.yaw = yawFromDir(to.x - from.x, to.z - from.z);
    p.pitch = 0; p.roll = 0; p.speed = FLIGHT.baseSpeed;
    this.grace = GRACE;
  }

  step(inp, dt = STEP) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.phase = 'fly'; this.onEvent({ kind: 'go' }); }
      return;
    }
    if (this.phase === 'crashed') {
      this.phaseTimer -= dt;
      this.flightTime += dt;
      if (this.phaseTimer <= 0) { this.respawn(); this.phase = 'fly'; }
      return;
    }
    if (this.phase !== 'fly') return;

    const p = this.plane;
    const p0 = [p.x, p.y, p.z];
    stepFlight(p, inp, dt);
    this.flightTime += dt;
    if (p.y > this.level.ceiling) { p.y = this.level.ceiling; if (p.pitch > 0) p.pitch = 0; }
    const p1 = [p.x, p.y, p.z];

    const g = this.level.gates[this.nextGate];
    const cross = gateCrossing(g, p0, p1);
    if (cross === 'pass' || cross === 'miss') {
      if (cross === 'miss') { this.misses++; this.penalty += this.level.penalties.miss; }
      this.nextGate++;
      const finished = this.nextGate >= this.level.gates.length;
      this.onEvent({ kind: cross, gate: g.idx, finished });
      if (finished) {
        this.phase = 'finished';
        this.onEvent({ kind: 'finish', time: this.time, crashes: this.crashes, misses: this.misses });
        return;
      }
    }

    if (this.grace > 0) { this.grace -= dt; return; }
    const hit = checkCollision(this.level, p.x, p.y, p.z);
    if (hit) {
      this.crashes++;
      this.penalty += this.level.penalties.crash;
      this.phase = 'crashed';
      this.phaseTimer = CRASH_FREEZE;
      this.lastCrash = hit;
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
      ph: this.phase, cd: r(this.countdown, 10),
    };
  }
}
