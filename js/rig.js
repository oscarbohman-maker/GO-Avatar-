// Flygplanet som helhet i världen: exteriör, cockpit, två figurer och levande instrument.
// Planets lokala system: x höger, y upp, -z framåt (samma som fysiken).
import * as THREE from './lib/three.module.min.js';
import { buildPlane, buildCockpit } from './models.js';
import { Avatar, AVATAR_STYLES } from './avatar.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// Var cockpiten sitter i förhållande till planets tyngdpunkt (nosen är 6 m fram)
export const COCKPIT_OFFSET = V(0, -0.9, -4.6);

export class PlaneRig {
  // localSeat: 'pilot' | 'copilot' – vems huvud som är kameran (döljs)
  constructor(localSeat = 'pilot') {
    this.localSeat = localSeat;
    this.root = new THREE.Group(); this.root.name = 'plan_rig';
    this.root.rotation.order = 'YXZ';

    // Exteriör: modellens nos pekar mot +x, vi vill ha -z
    this.exteriorWrap = new THREE.Group();
    this.exteriorWrap.rotation.y = Math.PI / 2;
    this.exterior = buildPlane();
    this.exteriorWrap.add(this.exterior);
    this.root.add(this.exteriorWrap);
    this.props = ['propeller_h', 'propeller_v'].map((n) => this.exterior.getObjectByName(n));

    // Cockpit
    this.cockpit = buildCockpit();
    this.cockpit.position.copy(COCKPIT_OFFSET);
    this.root.add(this.cockpit);
    this.root.updateMatrixWorld(true);

    this.pilot = new Avatar(-0.6, AVATAR_STYLES.pilot, 'pilot');
    this.copilot = new Avatar(0.6, AVATAR_STYLES.copilot, 'andrepilot');
    this.cockpit.add(this.pilot.group, this.copilot.group);
    (localSeat === 'pilot' ? this.pilot : this.copilot).setHeadVisible(false);

    this._setupInstruments();
    this.gest = null;      // pågående gest från navigatören
    this.pressT = 0;
    this.throttleHold = 0;
    this.lastThrottle = 0;
    this.idle = { t: 0, yaw: 0, pitch: -0.2, next: 2 };
    this.view = 'cockpit';
    this.time = 0;
  }

  _get(n) { return this.cockpit.getObjectByName(n); }

  // Skapar vridpunkter så att visare, svep och horisont kan röra sig
  _pivotNeedle(gaugeName) {
    const needle = this._get(`${gaugeName}_visare`);
    if (!needle) return null;
    const grp = needle.parent;
    const r = Math.hypot(needle.position.x, needle.position.y) / 0.27;
    const piv = new THREE.Group(); piv.name = `${gaugeName}_visarvrid`;
    grp.add(piv);
    needle.position.set(0, r * 0.27, 0.035);
    needle.rotation.set(0, 0, 0);
    piv.add(needle);
    piv.rotation.z = 0.8;
    return piv;
  }

  _setupInstruments() {
    const c = this.cockpit;
    this.yokes = ['ratt_pilot', 'ratt_andrepilot'].map((n) => this._get(n));
    this.yokeRest = this.yokes.map((y) => y.position.clone());
    this.needles = {};
    ['hastighet', 'kompass', 'hojdmatare', 'varvtal', 'bransle', 'oljetryck', 'temperatur'].forEach((n) => { this.needles[n] = this._pivotNeedle(n); });

    // radarsvep
    const sweep = this._get('radar_pilot_svep');
    this.sweepPivot = new THREE.Group(); sweep.parent.add(this.sweepPivot); this.sweepPivot.add(sweep);
    // konstgjord horisont
    const sky = this._get('horisont_himmel'), ground = this._get('horisont_mark');
    this.horizonPivot = new THREE.Group(); sky.parent.add(this.horizonPivot);
    this.horizonPivot.add(sky, ground);
    this.horizonR = 0.12;

    // gasreglage: vridpunkt vid basen
    c.updateMatrixWorld(true);
    this.levers = [0, 1, 2].map((i) => {
      const lever = this._get(`gasreglage_${i}`), knob = this._get(`gasknopp_${i}`);
      const axis = V(0, 1, 0).applyEuler(lever.rotation);
      const base = lever.position.clone().addScaledVector(axis, -0.1);
      const piv = new THREE.Group(); piv.name = `gasvrid_${i}`; piv.position.copy(base);
      c.add(piv); piv.updateMatrixWorld(true);
      piv.attach(lever); piv.attach(knob);
      return { piv, knob };
    });

    // varningslampa och knappar som kan blinka (egna material)
    const own = (n) => { const o = this._get(n); if (o) o.material = o.material.clone(); return o; };
    this.warn = own('varningslampa');
    this.roofLamps = [own('taklampa'), own('taklampa2')];
    this.roofSwitches = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) this.roofSwitches.push(this._get(`takbrytare_${i}${j}`));
    this.switchIdx = 0;
    this.dashButtons = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) this.dashButtons.push(own(`knapp_${j}${i}`));
    this.screen = own('skarm_mitt');
  }

  // Gester från navigatören: 'left' | 'right' | 'up' | 'down' | 'press'
  gesture(kind) {
    if (kind === 'press') {
      this.pressT = 0.9;
      this.pressSwitch = this.roofSwitches[[8, 9, 6, 7][this.switchIdx++ % 4]];
      return;
    }
    this.gest = { kind, t: 1.8 };
  }

  setView(v) {
    this.view = v;
    const inside = v === 'cockpit';
    this.cockpit.visible = inside;
    this.exteriorWrap.visible = !inside;
  }

  // Punkt i ett barn till cockpiten -> cockpitens koordinater
  _toCockpit(obj, local = V()) {
    const p = local.clone();
    let o = obj;
    while (o && o !== this.cockpit) { o.updateMatrix(); p.applyMatrix4(o.matrix); o = o.parent; }
    return p;
  }

  // st: { x,y,z,yaw,pitch,roll,speed,ix,iy,throttle,accLong,loadN,rollAcc,phase }
  update(dt, st, opts = {}) {
    this.time += dt;
    const R = this.root;
    R.position.set(st.x, st.y, st.z);
    R.rotation.set(st.pitch, st.yaw, st.roll);

    // propellrar
    const spin = (st.phase === 'crashed' ? 4 : 30 + st.speed * 0.9);
    this.props.forEach((p, i) => { if (p) p.rotation.x += (i ? -1 : 1) * spin * dt; });

    // rattarna följer spaken (rollen = vrid, tippning = in/ut)
    const ix = st.ix || 0, iy = st.iy || 0;
    this.yokes.forEach((y, i) => {
      y.rotation.z += (-ix * 0.75 - y.rotation.z) * Math.min(1, dt * 14);
      const tz = this.yokeRest[i].z + iy * 0.09;
      y.position.z += (tz - y.position.z) * Math.min(1, dt * 14);
    });

    // gasreglage
    const th = st.throttle || 0;
    this.levers.forEach((l, i) => {
      const t = i === 2 ? 0 : -th * 0.4;
      l.piv.rotation.x += (t - l.piv.rotation.x) * Math.min(1, dt * 10);
    });

    // instrument
    const N = this.needles;
    const setN = (n, a) => { if (N[n]) N[n].rotation.z += (-a - N[n].rotation.z) * Math.min(1, dt * 8); };
    setN('hastighet', -2.4 + THREE.MathUtils.clamp((st.speed - 20) / 70, 0, 1) * 4.8);
    if (N.kompass) N.kompass.rotation.z = st.yaw;
    if (N.hojdmatare) N.hojdmatare.rotation.z = -(st.y / 100) * Math.PI * 2;
    setN('varvtal', -1.2 + (th + 1) * 1.1 + Math.sin(this.time * 31) * 0.03);
    setN('bransle', 1.6 - this.time * 0.002);
    setN('oljetryck', 0.5 + Math.sin(this.time * 0.7) * 0.08 + th * 0.2);
    setN('temperatur', 0.2 + Math.sin(this.time * 0.3) * 0.05);
    this.sweepPivot.rotation.z -= dt * 2.6;
    this.horizonPivot.rotation.z = -st.roll;
    this.horizonPivot.position.y = THREE.MathUtils.clamp(-st.pitch * 0.08, -0.03, 0.03);

    const crashed = st.phase === 'crashed';
    const blink = (Math.sin(this.time * 12) > 0) ? 1 : 0;
    if (this.warn) this.warn.material.emissiveIntensity = crashed || st.y < 12 ? 2.5 * blink : 0.25;
    if (this.screen) this.screen.material.emissiveIntensity = 0.6 + 0.2 * Math.sin(this.time * 3);

    // ---- figurer ----
    const accel = V((st.rollAcc || 0) * 1.1, ((st.loadN || 1) - 1) * 9.81, st.accLong || 0);
    const shake = crashed ? 0.03 : 0.0003 + Math.min(0.0012, Math.abs(st.rollAcc || 0) * 0.00004);

    // Pilot: händerna på ratten, höger hand till gasen när man gasar/bromsar
    const yokeP = this.yokes[0];
    const gripL = this._toCockpit(yokeP, V(-0.15, 0.08, 0));
    const gripR = this._toCockpit(yokeP, V(0.15, 0.08, 0));
    if (th !== 0) this.throttleHold = 0.5; else this.throttleHold -= dt;
    const knob = this._toCockpit(this.levers[1].knob);
    const pilotHands = [gripL, this.throttleHold > 0 ? knob.add(V(-0.01, 0.03, 0.02)) : gripR];
    if (crashed) { pilotHands[0] = V(-0.75, 1.55, -0.1); pilotHands[1] = V(-0.45, 1.55, -0.1); }
    const pilotLook = opts.pilotLook || { yaw: 0, pitch: 0 };
    this.pilot.update(dt, {
      hands: pilotHands,
      accel, shake,
      lean: this.pilot.reachDeficit(pilotHands),
      look: { yaw: pilotLook.yaw + (crashed ? 0.3 : 0), pitch: -0.06 + pilotLook.pitch },
      brace: crashed ? 1 : th < 0 ? 0.6 : 0,
    });

    // Andrepilot (navigatören): vila, peka eller trycka på knappar
    const X = 0.6;
    const rest = [V(X - 0.13, 0.72, 0.06), V(X + 0.13, 0.72, 0.06)];
    const cpHands = rest.map((v) => v.clone());
    const point = [false, false];
    let look = { yaw: 0, pitch: -0.15 };
    const shL = V(X - 0.215, 1.16, 0.22);
    if (this.gest) {
      this.gest.t -= dt;
      const dirs = { left: V(-0.75, 0.15, -0.65), right: V(0.25, 0.12, -0.96), up: V(-0.2, 0.92, -0.35), down: V(-0.3, -0.4, -0.86) };
      const d = (dirs[this.gest.kind] || dirs.left).clone().normalize();
      cpHands[0] = shL.clone().addScaledVector(d, 0.86);
      point[0] = true;
      look = { yaw: 0.85, pitch: -0.05 };   // tittar på piloten medan den pekar
      if (this.gest.t <= 0) this.gest = null;
    } else if (this.pressT > 0) {
      this.pressT -= dt;
      const sw = this.pressSwitch;
      const p = this._toCockpit(sw);
      cpHands[0] = p.add(V(0, -0.02, 0.03));
      point[0] = true;
      look = { yaw: 0.25, pitch: 0.7 };
      if (this.pressT < 0.45 && !this._flipped) {
        this._flipped = true;
        sw.rotation.x = -sw.rotation.x;
        this.roofLamps.forEach((l) => { l.material.emissiveIntensity = 3; });
      }
      if (this.pressT <= 0) this._flipped = false;
    } else if (this.localSeat !== 'copilot') {
      // tittar runt lite när den inte gör något
      const I = this.idle;
      I.t += dt;
      if (I.t > I.next) {
        I.t = 0; I.next = 1.5 + Math.random() * 3;
        const r = Math.random();
        I.yaw = r < 0.3 ? 0.8 : r < 0.6 ? 0.15 : -0.2; I.pitch = r < 0.3 ? -0.05 : r < 0.6 ? -0.45 : -0.1;
      }
      look = { yaw: I.yaw, pitch: I.pitch };
    } else {
      look = opts.copilotLook || { yaw: 0.45, pitch: -0.12 };
    }
    this.roofLamps.forEach((l) => { l.material.emissiveIntensity += (1.2 - l.material.emissiveIntensity) * Math.min(1, dt * 3); });
    if (crashed) { cpHands[0] = V(0.45, 1.55, -0.1); cpHands[1] = V(0.75, 1.55, -0.1); }
    this.copilot.update(dt, {
      hands: cpHands, point, accel, shake,
      lean: this.copilot.reachDeficit(cpHands),
      look, brace: crashed ? 1 : 0,
    });
  }

  // Ögats position och riktning i världen för given plats
  eyePose(seat, outPos, outQuat) {
    const av = seat === 'copilot' ? this.copilot : this.pilot;
    this.root.updateMatrixWorld(true);
    outPos.copy(av.eye);
    this.cockpit.localToWorld(outPos);
    this.cockpit.getWorldQuaternion(outQuat);
    outQuat.multiply(av.headQuat);
  }

  dispose() {
    this.pilot.dispose(); this.copilot.dispose();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}
