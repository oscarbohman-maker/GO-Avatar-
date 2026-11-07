// 3D-vy: renderar världen och planet från en plats i cockpiten eller utifrån.
// Används av piloten (helskärm) och av navigatören (litet fönster).
import * as THREE from './lib/three.module.min.js';
import { World3D } from './world3d.js';
import { PlaneRig } from './rig.js';
import { CrashFX } from './crashfx.js';
import { sfx } from './sfx.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);

export class View3D {
  // seat: 'pilot' | 'copilot'
  constructor(holder, level, opts = {}) {
    this.holder = holder;
    this.level = level;
    this.seat = opts.seat || 'pilot';
    this.mode = 'auto';   // 'auto' | 'outside'
    const canvas = document.createElement('canvas');
    canvas.className = 'view3d';
    holder.appendChild(canvas);
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);

    this.world = new World3D(level);
    this.world.onThunder = () => sfx.thunder();
    this.denseFog = this.seat === 'pilot';   // navigatören ser genom dimman
    this.rig = new PlaneRig(this.seat);
    this.world.scene.add(this.rig.root);
    this.fx = new CrashFX(this.world.scene);   // kraschens effekter (bara när planet nuddar något)
    this.crash = null;
    this._shake = V();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.04, this.world.maxFar + 20);
    this.blend = 0;          // 0 = utifrån, 1 = cockpit
    this.orbitA = 0;
    this.chasePos = null;
    this.chaseYaw = level.start.yaw;
    this._p = V(); this._q = new THREE.Quaternion();
    this._cp = V(); this._cq = new THREE.Quaternion();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  resize() {
    const w = this.holder.clientWidth || window.innerWidth;
    const h = this.holder.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  gesture(kind) { this.rig.gesture(kind); }

  // Kraschen anpassas efter vad som träffades, var, med vilken del och hur hårt
  gateBurst(e) { this.world.gateBurst(e.gate, e.perfect, e.combo); }

  onCrash(e) {
    if (!e || !e.pos) return;
    const d = V(...(e.dir || [0, 0, -1])); d.y = 0;
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    this.crash = { pos: V(...e.pos), sev: e.sev || 1, t: 0, dir: d.normalize() };
    this.fx.burst(e);
    this.rig.breakApart(e, this.fx);
  }

  // Ny runda: delarna tillbaka, skrot och brännmärke bort
  onRespawn() {
    this.crash = null;
    this.fx.clearWreck();
    this.rig.restoreParts();
  }
  setRoute(pts) { this.world.setRoute(pts); }

  // st: planets tillstånd + phase, countdown (cd), nextGate (ng)
  // look: pilotens blick runtom {yaw,pitch}
  frame(dt, st, look) {
    const rig = this.rig;
    rig.update(dt, st, this.seat === 'pilot' ? { pilotLook: look } : { copilotLook: look });
    this.world.updateGates(st.ng || 0);
    this.world.animate(dt, this.camera.position, st.ft);
    this.fx.update(dt);
    if (st.phase === 'crashed' && this.crash) {
      this.crash.t += dt;
      this.fx.trail(V(st.x, st.y, st.z), this.crash.sev);    // vraket ryker och brinner medan det tumlar
    }

    // Vilken kameraposition vill vi ha?
    let target;
    if (this.mode === 'outside') target = 0;
    else if (st.phase === 'fly') target = 1;
    else if (st.phase === 'countdown') target = smooth(Math.min(1, Math.max(0, 1 - (st.cd || 0) / 3)));
    else target = 0;
    if (st.phase === 'countdown' && this.mode !== 'outside') this.blend = target;
    else if (target > this.blend) this.blend = Math.min(target, this.blend + dt * (st.phase === 'fly' ? 2.5 : 1));
    else this.blend = Math.max(target, this.blend - dt * 4);
    if (this._lastPhase === 'crashed' && st.phase === 'fly' && this.mode !== 'outside') this.blend = 1; // efter respawn: direkt in
    this._lastPhase = st.phase;

    // Utifrån-kamera
    if (st.phase !== 'crashed') this.chaseYaw = st.yaw;
    const planeP = V(st.x, st.y, st.z);
    let outPos, outLook;
    if (st.phase === 'waiting' || st.phase === 'finished') {
      this.orbitA += dt * 0.25;
      outPos = V(st.x + Math.sin(this.orbitA) * 24, st.y + 5, st.z + Math.cos(this.orbitA) * 24);
      outLook = planeP.clone();
      this.chasePos = null;
    } else {
      const back = V(Math.sin(this.chaseYaw) * 22, 6, Math.cos(this.chaseYaw) * 22);
      const want = planeP.clone().add(back);
      if (!this.chasePos) this.chasePos = want.clone();
      this.chasePos.lerp(want, Math.min(1, dt * (st.phase === 'crashed' ? 1.5 : 5)));
      outPos = this.chasePos;
      outLook = planeP.clone().add(V(-Math.sin(this.chaseYaw) * 6, 1, -Math.cos(this.chaseYaw) * 6));
      // efter smällen: kameran glider till en plats bakom och ovanför kontaktpunkten och följer den
      if (st.phase === 'crashed' && this.crash) {
        const C = this.crash;
        const want = C.pos.clone().addScaledVector(C.dir, -36).add(V(0, 14, 0));
        if (want.y < C.pos.y + 6) want.y = C.pos.y + 6;
        this.chasePos.lerp(want, Math.min(1, dt * 3));
        outLook = C.pos.clone().add(V(0, 2, 0)).lerp(planeP, 0.3);
      }
    }
    if (outPos.y < 2) outPos.y = 2;

    const cam = this.camera;
    // cockpitpose
    rig.eyePose(this.seat, this._cp, this._cq, this.seat === 'pilot' ? look : null);
    // utifrånpose
    this._p.copy(outPos);
    const m = new THREE.Matrix4().lookAt(outPos, outLook, V(0, 1, 0));
    this._q.setFromRotationMatrix(m);

    const b = this.blend;
    this.world.setFogMix(this.denseFog ? b : 0);
    // rita bara så långt man ser (dimman) – sparar kraft på mobilen
    const far = this.world.scene.fog.far + 25;
    if (Math.abs(cam.far - far) > 2) { cam.far = far; cam.updateProjectionMatrix(); }
    cam.position.copy(this._p).lerp(this._cp, b);
    if (this.fx.shake > 0) cam.position.add(this.fx.shakeOffset(this._shake));   // kameraskak efter smällen
    cam.quaternion.copy(this._q).slerp(this._cq, b);
    const fov = 60 + (95 - 60) * b;   // hög FOV i cockpiten
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    rig.setView(b > 0.88 ? 'cockpit' : 'outside');
    this.renderer.render(this.world.scene, cam);
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    this.fx.dispose();
    this.rig.dispose();
    this.world.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (_) {}
    this.canvas.remove();
  }
}
