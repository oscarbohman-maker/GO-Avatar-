// NPC-navigatör: en datorstyrd andrepilot som guidar en "blind" pilot.
// Den ser hela banan, letar efter hinder framför planet och säger korta
// kommandon ("Sväng vänster och stig") samtidigt som figuren pekar.
import { checkCollision } from './physics.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = 180 / Math.PI;

// Spakutslag som motsvarar varje kommando (används också i testerna)
const TURN = { sharp: 1, normal: 0.6, slight: 0.28, none: 0 };
const CLIMB = { up: 0.22, down: -0.22, hold: 0 };   // önskad nosvinkel (rad)

// Punkt längs banans mittlinje en bit framför planet ("pure pursuit").
// Sträcka k går från path[k] till path[k+1], där port k sitter i slutet.
export function pursuitTarget(level, sess, ahead = 55) {
  const P = level.path, p = sess.plane;
  let k = Math.min(sess.nextGate, P.length - 2);
  const a = P[k], b = P[k + 1];
  const vx = b[0] - a[0], vz = b[2] - a[2];
  const L = Math.hypot(vx, vz);
  let t = ((p.x - a[0]) * vx + (p.z - a[2]) * vz) / (L * L);
  t = clamp(t, 0, 1);
  let dist = ahead;   // gå framåt längs banan
  let px = a[0] + vx * t, pz = a[2] + vz * t, py = a[1] + (b[1] - a[1]) * t;
  let rem = (1 - t) * L;
  while (dist > rem && k < P.length - 2) {
    dist -= rem;
    k++;
    px = P[k][0]; pz = P[k][2]; py = P[k][1];
    rem = Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][2] - P[k][2]);
  }
  const nb = P[k + 1];
  const segL = Math.hypot(nb[0] - px, nb[2] - pz) || 1;
  const f = Math.min(1, dist / segL);
  return { x: px + (nb[0] - px) * f, z: pz + (nb[2] - pz) * f, y: py + (nb[1] - py) * f };
}

export class NpcNavigator {
  constructor(level) {
    this.level = level;
    this.t = 0;
    this.tick = 0;
    this.lastSay = -99;
    this.lastKey = '';
    this.command = { turn: 0, climb: 0, brake: false };
    this.blocked = false;
  }

  // Siktpunkt: längs banans mittlinje en bit framåt (håller planet mitt i passagen)
  _target(sess) {
    const g = this.level.gates[sess.nextGate];
    const t = pursuitTarget(this.level, sess, 40);
    return { g, x: t.x, z: t.z };
  }

  // Är det fritt längs en riktning? (vingbredd + marginal)
  _clear(p, yaw, y0, y1, maxDist) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let d = 12; d <= maxDist; d += 7) {
      const k = d / Math.max(maxDist, 1);
      const y = y0 + (y1 - y0) * k;
      const hit = checkCollision(this.level, p.x + fx * d, y, p.z + fz * d, 7.5);
      if (hit && hit !== 'out of bounds') return false;
    }
    return true;
  }

  // Analyserar läget. Returnerar { say, gesture, command } när något ska sägas.
  update(dt, sess) {
    this.t += dt;
    if (sess.phase !== 'fly') return null;
    this.tick -= dt;
    if (this.tick > 0) return null;
    this.tick = 0.2;

    const p = sess.plane;
    const T = this._target(sess);
    const dx = T.x - p.x, dz = T.z - p.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const look = Math.min(dist, 95);

    // hitta en fri riktning så nära målet som möjligt
    let yaw = wantYaw;
    this.blocked = false;
    if (!this._clear(p, wantYaw, p.y, T.g.y, look)) {
      this.blocked = true;
      const offs = [0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1];
      // föredra den sida planet redan svänger åt
      const pref = Math.sign(wrap(wantYaw - p.yaw)) || 1;
      offs.sort((a, b) => Math.abs(a) - Math.abs(b) || (Math.sign(b) === pref) - (Math.sign(a) === pref));
      for (const o of offs) {
        if (this._clear(p, wantYaw + o, p.y, T.g.y, Math.min(look, 70))) { yaw = wantYaw + o; break; }
      }
    }

    const err = wrap(yaw - p.yaw);               // + = vänster
    const a = Math.abs(err) * DEG;
    // Önskat spakutslag. Tar hänsyn till hur mycket planet redan svänger,
    // så att NPC:n säger "rakt fram" i tid i stället för att låta det svänga för långt.
    const want = -err * 3.5 + p.yawRate * 0.9;   // + = höger
    const w = Math.abs(want);
    const level = (a > 40 && w > 0.7) || w > 0.85 ? 'sharp' : w > 0.45 ? 'normal' : w > 0.14 ? 'slight' : 'none';
    const side = want < 0 ? 'left' : 'right';
    const dy = T.g.y - p.y;
    const climb = dy > 7 ? 'up' : dy < -7 ? 'down' : 'hold';
    const brake = (level === 'sharp' && p.speed > 34) || (this.blocked && dist < 60 && p.speed > 40);

    this.command = {
      turn: (side === 'left' ? -1 : 1) * TURN[level],
      climb: CLIMB[climb],
      brake,
    };

    const key = `${level === 'none' ? 'none' : level + side}|${climb}|${brake}|${this.blocked}`;
    const changed = key !== this.lastKey;
    const since = this.t - this.lastSay;
    if ((changed && since > 0.6) || since > 4.5) {
      this.lastKey = key;
      this.lastSay = this.t;
      return { say: this._phrase(level, side, climb, brake), gesture: this._gesture(level, side, climb), command: this.command };
    }
    return { command: this.command };
  }

  _phrase(level, side, climb, brake) {
    const dir = side === 'left' ? 'left' : 'right';
    let s;
    if (level === 'sharp') s = `Hard ${dir}!`;
    else if (level === 'normal') s = `Turn ${dir}`;
    else if (level === 'slight') s = `A little ${dir}`;
    else s = climb === 'hold' ? 'Straight ahead, good!' : 'Straight ahead';
    if (climb === 'up') s += level === 'none' ? ', climb' : ' and climb';
    if (climb === 'down') s += level === 'none' ? ', descend' : ' and descend';
    if (brake) s = 'Brake! ' + s;
    if (this.blocked) s = 'Obstacle ahead! ' + s;
    return s;
  }

  _gesture(level, side, climb) {
    if (level !== 'none' && level !== 'slight') return side;
    if (climb === 'up') return 'up';
    if (climb === 'down') return 'down';
    if (level === 'slight') return side;
    return null;
  }

  // Kommentarer på händelser
  onEvent(e, level) {
    switch (e.kind) {
      case 'go': return "Here we go! I'll tell you how to fly.";
      case 'pass': return e.finished ? null : (e.gate % 2 === 0 ? `Nice! Gate ${e.gate + 1}.` : null);
      case 'star': return Math.random() < 0.5 ? 'Nice, a star!' : null;
      case 'miss': return 'We missed the gate. On to the next one!';
      case 'crash': return "Ouch! We'll go again from the last gate.";
      case 'finish': return `Finish! ${e.stars || 0} of ${e.totalStars || (level && level.stars ? level.stars.length : 0)} stars. Great flying!`;
      default: return null;
    }
  }
}

// Tal (text-till-tal) på engelska
export class NpcVoice {
  constructor() {
    this.enabled = true;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voice = null;
    const pick = () => {
      if (!this.synth) return;
      const vs = this.synth.getVoices() || [];
      this.voice = vs.find((v) => /^en-(US|GB)/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
    };
    pick();
    if (this.synth && 'onvoiceschanged' in this.synth) this.synth.onvoiceschanged = pick;
  }

  // Safari kräver att tal startas efter en knapptryckning första gången
  unlock() {
    if (!this.synth) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; this.synth.speak(u); } catch (_) {}
  }

  say(text) {
    if (!this.enabled || !this.synth || !text) return;
    try {
      this.synth.cancel();   // nya order är viktigare än gamla
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.1;
      u.pitch = 1.05;
      this.synth.speak(u);
    } catch (_) {}
  }

  stop() { try { this.synth && this.synth.cancel(); } catch (_) {} }
}
