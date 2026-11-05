// NPC-navigatör: en datorstyrd andrepilot som guidar en "blind" pilot.
// Den ser hela banan, letar efter hinder framför planet och säger korta
// kommandon ("Sväng vänster och stig") samtidigt som figuren pekar.
import { gateLocal, forward, checkCollision } from './physics.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = 180 / Math.PI;

// Spakutslag som motsvarar varje kommando (används också i testerna)
const TURN = { sharp: 1, normal: 0.6, slight: 0.28, none: 0 };
const CLIMB = { up: 0.22, down: -0.22, hold: 0 };   // önskad nosvinkel (rad)

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

  // Siktpunkt: lite framför nästa port, så att planet kommer in rakt
  _target(sess) {
    const p = sess.plane;
    const g = this.level.gates[sess.nextGate];
    const n = forward(g.yaw);
    const { s } = gateLocal(g, p.x, p.y, p.z);
    const lead = clamp(-s * 0.3, 0, 14);
    return { g, x: g.x - n[0] * lead, z: g.z - n[2] * lead };
  }

  // Är det fritt längs en riktning? (vingbredd + marginal)
  _clear(p, yaw, y0, y1, maxDist) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let d = 12; d <= maxDist; d += 7) {
      const k = d / Math.max(maxDist, 1);
      const y = y0 + (y1 - y0) * k;
      const hit = checkCollision(this.level, p.x + fx * d, y, p.z + fz * d, 7.5);
      if (hit && hit !== 'utanför banan') return false;
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

    const turnDeg = wrap(yaw - p.yaw) * DEG;   // + = vänster
    const a = Math.abs(turnDeg);
    // nära porten räknas även små vinkelfel, eftersom de ger meter i sidled
    const lateral = dist * Math.sin(Math.min(a, 90) / DEG);
    const level = a > 40 ? 'sharp' : a > 14 ? 'normal' : (a > 5 || (lateral > 3 && a > 1.5)) ? 'slight' : 'none';
    const side = turnDeg > 0 ? 'left' : 'right';
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
    if ((changed && since > 0.9) || since > 4.5) {
      this.lastKey = key;
      this.lastSay = this.t;
      return { say: this._phrase(level, side, climb, brake), gesture: this._gesture(level, side, climb), command: this.command };
    }
    return { command: this.command };
  }

  _phrase(level, side, climb, brake) {
    const dir = side === 'left' ? 'vänster' : 'höger';
    let s;
    if (level === 'sharp') s = `Skarpt ${dir}!`;
    else if (level === 'normal') s = `Sväng ${dir}`;
    else if (level === 'slight') s = `Lite ${dir}`;
    else s = climb === 'hold' ? 'Rakt fram, bra!' : 'Rakt fram';
    if (climb === 'up') s += level === 'none' ? ', stig' : ' och stig';
    if (climb === 'down') s += level === 'none' ? ', sjunk' : ' och sjunk';
    if (brake) s = 'Bromsa! ' + s;
    if (this.blocked) s = 'Hinder framför! ' + s;
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
      case 'go': return 'Nu kör vi! Jag säger hur du ska flyga.';
      case 'pass': return e.finished ? null : (e.gate % 2 === 0 ? `Bra! Port ${e.gate + 1}.` : null);
      case 'star': return Math.random() < 0.5 ? 'Snyggt, en stjärna!' : null;
      case 'miss': return 'Vi missade porten. Vidare till nästa!';
      case 'crash': return 'Aj! Vi tar det från förra porten.';
      case 'finish': return `Mål! ${e.stars || 0} av ${e.totalStars || (level && level.stars ? level.stars.length : 0)} stjärnor. Bra flugit!`;
      default: return null;
    }
  }
}

// Tal (text-till-tal) på svenska om webbläsaren kan
export class NpcVoice {
  constructor() {
    this.enabled = true;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voice = null;
    const pick = () => {
      if (!this.synth) return;
      const vs = this.synth.getVoices() || [];
      this.voice = vs.find((v) => /^sv/i.test(v.lang)) || null;
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
      u.lang = 'sv-SE';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.15;
      u.pitch = 1.05;
      this.synth.speak(u);
    } catch (_) {}
  }

  stop() { try { this.synth && this.synth.cancel(); } catch (_) {} }
}
