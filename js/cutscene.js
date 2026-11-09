// Cutscene vid början av varje bana: planet flyger in mot starten, man ser besättningen,
// och sedan glider kameran in i cockpit under nedräkningen.
// Två kameravinklar:
//  1) "Följekameran": snett bakom och ovanför planet, som följer med. Kartans titel visas.
//  2) "Dashcam": från instrumentbrädan in mot besättningen, som pratar och gestikulerar.
// Sist klipps det tillbaka till följekameran, som mjukt glider bakom planet och in i cockpit
// medan nedräkningen går (View3D sköter den biten). Planet flyger hela tiden längs en rak
// inflygning och når startlinjen exakt när nedräkningen säger GO.
import * as THREE from './lib/three.module.min.js';
import { FLIGHT } from './physics.js';

export const INTRO = { shotA: 3.2, shotB: 3.9 };
export const INTRO_LEN = INTRO.shotA + INTRO.shotB;
export const COUNTDOWN_LEN = 3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);

// Planets läge på inflygningen, T sekunder innan det passerar startlinjen
export function approachPose(level, T) {
  const s = level.start, v = FLIGHT.cruise;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  return { x: s.x - fx * v * T, y: s.y, z: s.z - fz * v * T, yaw: s.yaw };
}

// Följekamerans plats i förhållande till planet (bakom, åt höger, ovanför) – k: 0..1 under tagningen
export function followCam(p, k, out, look) {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);   // framåt
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);    // höger
  // kameran till vänster om planet, så att planet hamnar till höger i bilden och titeln får plats till vänster
  const back = 19 - 4 * k, side = -(9 - 2 * k), up = 4.6 + 0.8 * k;
  out.set(p.x - fx * back + rx * side, p.y + up, p.z - fz * back + rz * side);
  look.set(p.x + fx * 4 + rx * -3.5, p.y + 0.6, p.z + fz * 4 + rz * -3.5);
}

export class Cutscene {
  // opts: { level, map, names: { pilot, navigator }, lines: [[vem, text], [vem, text]], onEnd }
  constructor(view, root, opts) {
    this.view = view;
    this.opts = opts;
    this.t = 0;
    this.done = false;
    this.gestured = false;
    this.el = document.createElement('div');
    this.el.className = 'cine';
    this.el.innerHTML = `
      <div class="cine-bar top"></div><div class="cine-bar bot"></div>
      <div class="cine-title">${opts.titleHtml || ''}</div>
      <div class="cine-sub" aria-live="polite"><span class="cs-name"></span><span class="cs-text"></span></div>
      <button class="cine-skip" type="button">Skip<span aria-hidden="true">›</span></button>`;
    root.appendChild(this.el);
    this.sub = this.el.querySelector('.cine-sub');
    this.el.querySelector('.cine-skip').addEventListener('click', (e) => { e.stopPropagation(); this.skip(); });
    this._key = (e) => { if (['Enter', 'Escape', 'Space'].includes(e.code)) { e.preventDefault(); this.skip(); } };
    window.addEventListener('keydown', this._key);
    requestAnimationFrame(() => this.el.classList.add('on'));
    this.shownLine = -1;
  }

  // Planets läge just nu (för rendering)
  planeState(base) {
    const T = COUNTDOWN_LEN + Math.max(0, INTRO_LEN - this.t);
    const p = approachPose(this.opts.level, T);
    const t = this.t;
    // planet "vinkar" med vingarna i början och gungar lätt
    const wave = t > 0.5 && t < 2.3 ? Math.sin((t - 0.5) * 7) * 0.32 * Math.sin(((t - 0.5) / 1.8) * Math.PI) : 0;
    return { ...base, x: p.x, y: p.y + Math.sin(t * 1.3) * 0.35, z: p.z, yaw: p.yaw, pitch: 0.02, roll: wave + Math.sin(t * 0.9) * 0.04, speed: FLIGHT.cruise, phase: 'fly', cd: COUNTDOWN_LEN };
  }

  inDashcam() { return this.t >= INTRO.shotA && this.t < INTRO_LEN; }

  // Besättningens blickar och nickningar under dashcam-tagningen
  crewLooks() {
    const tb = this.t - INTRO.shotA;
    const talkP = this.shownLine === 1 ? Math.sin(tb * 9) * 0.04 : 0;       // piloten pratar (nickar lätt)
    const talkC = this.shownLine === 0 ? Math.sin(tb * 8) * 0.04 : 0;
    return { pilotLook: { yaw: -0.38, pitch: 0.12 + talkP }, copilotLook: { yaw: 0.42, pitch: 0.06 + talkC } };
  }

  // Kameran: följekamera (vinkel 1) eller dashcam (vinkel 2)
  camera(rig, st, outPos, outQuat) {
    const look = V();
    if (!this.inDashcam()) {
      const k = this.t < INTRO.shotA ? this.t / INTRO.shotA : 1;
      followCam(st, ease(k), outPos, look);
      outQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(outPos, look, V(0, 1, 0)));
      return 55;
    }
    // dashcam: från instrumentbrädan, mot besättningen, med en långsam åkning framåt
    const k = (this.t - INTRO.shotA) / INTRO.shotB;
    rig.root.updateMatrixWorld(true);
    outPos.set(0, 1.33 - 0.03 * k, -0.95 + 0.14 * ease(k));
    rig.cockpit.localToWorld(outPos);
    look.set(0.04 * Math.sin(this.t * 0.7), 1.12, 0.3);
    rig.cockpit.localToWorld(look);
    const up = V(0, 1, 0).applyQuaternion(rig.cockpit.getWorldQuaternion(new THREE.Quaternion()));
    outQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(outPos, look, up));
    return 68;
  }

  update(dt, rig) {
    if (this.done) return;
    this.t += dt;
    const tb = this.t - INTRO.shotA;
    this.el.classList.toggle('shot-b', this.inDashcam());
    // repliker under dashcam-tagningen
    const lines = this.opts.lines || [];
    const idx = tb < 0.25 ? -1 : tb < 1.95 ? 0 : 1;
    if (idx !== this.shownLine) {
      this.shownLine = idx;
      if (idx >= 0 && lines[idx]) {
        this.sub.querySelector('.cs-name').textContent = lines[idx][0];
        this.sub.querySelector('.cs-text').textContent = lines[idx][1];
        this.sub.classList.remove('show'); void this.sub.offsetWidth; this.sub.classList.add('show');
      } else this.sub.classList.remove('show');
    }
    // navigatören pekar framåt: "kör!"
    if (!this.gestured && tb > 2.2) { this.gestured = true; rig.gesture('up'); }
    if (this.t >= INTRO_LEN) this.finish();
  }

  skip() { if (!this.done) { this.t = INTRO_LEN; this.finish(); } }

  finish() {
    if (this.done) return;
    this.done = true;
    window.removeEventListener('keydown', this._key);
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), 700);
    if (this.opts.onEnd) this.opts.onEnd();
  }

  destroy() {
    this.done = true;
    window.removeEventListener('keydown', this._key);
    this.el.remove();
  }
}
