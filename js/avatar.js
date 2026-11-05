// Spelarfigurer i cockpiten. Armar och ben styrs med invers kinematik (IK),
// så att händerna följer ratten, gasreglagen och knapparna. Överkroppen och
// huvudet hänger i fjädrar som reagerar på planets G-krafter, svängar och skakningar.
import * as THREE from './lib/three.module.min.js';
import { rbox } from './models.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// Fjäder/dämpare i 3D (semi-implicit Euler med delsteg för stabilitet)
export class Spring3 {
  constructor(k, zeta = 0.8, init = V()) {
    this.k = k; this.c = 2 * Math.sqrt(k) * zeta;
    this.p = init.clone(); this.v = V();
  }
  update(target, dt) {
    const n = Math.max(1, Math.ceil(dt * Math.sqrt(this.k) / 0.3));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.x += (this.k * (target.x - this.p.x) - this.c * this.v.x) * h;
      this.v.y += (this.k * (target.y - this.p.y) - this.c * this.v.y) * h;
      this.v.z += (this.k * (target.z - this.p.z) - this.c * this.v.z) * h;
      this.p.addScaledVector(this.v, h);
    }
    return this.p;
  }
  snap(p) { this.p.copy(p); this.v.set(0, 0, 0); }
}

// Analytisk tvåleds-IK. Returnerar mittled (armbåge/knä) och ändpunkt.
const _d = V(), _perp = V();
export function solveIK(root, target, l1, l2, pole, outMid, outEnd) {
  _d.subVectors(target, root);
  let len = _d.length();
  const maxL = (l1 + l2) * 0.999, minL = Math.abs(l1 - l2) + 1e-3;
  if (len < 1e-6) _d.set(0, -1, 0); else _d.divideScalar(len);
  len = Math.min(maxL, Math.max(minL, len));
  const a = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len);
  const h = l1 * Math.sqrt(Math.max(0, 1 - a * a));
  _perp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_perp.lengthSq() < 1e-8) _perp.set(0, 0, -1).addScaledVector(_d, -_d.z);
  _perp.normalize();
  outMid.copy(root).addScaledVector(_d, l1 * a).addScaledVector(_perp, h);
  outEnd.copy(root).addScaledVector(_d, len);
  return len;
}

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const sphGeo = new THREE.SphereGeometry(1, 18, 12);
const capGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);   // övre halvsfär

function placeBone(mesh, a, b, r) {
  const d = _d.subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  mesh.scale.set(r, len, r);
}

export const AVATAR_STYLES = {
  pilot: { jacket: 0x2f6fd1, jacketDark: 0x23539e, gloves: 0xc79a5b, pants: 0x3a3f4a, boots: 0x3b2a1e, skin: 0xf1c7a3, cap: 0x6b4426, headset: 0x26282c, patch: 0xf2c230, brow: 0x5a3a22 },
  copilot: { jacket: 0xf2b33d, jacketDark: 0xc98f22, gloves: 0xf4f4f4, pants: 0x2c3e50, boots: 0x2b2b2b, skin: 0xd9a07a, cap: 0xeeeeee, headset: 0x26282c, patch: 0x2f6fd1, brow: 0x2b1d14 },
};

export class Avatar {
  // seatX: stolens x-position i cockpiten (−0.6 pilot, +0.6 andrepilot)
  constructor(seatX, style, name) {
    this.seatX = seatX;
    this.side = Math.sign(seatX) || -1;
    const S = style;
    const mat = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
    const m = {
      jacket: mat(S.jacket), jacketDark: mat(S.jacketDark), gloves: mat(S.gloves, 0.6), pants: mat(S.pants),
      boots: mat(S.boots, 0.5), skin: mat(S.skin, 0.6), cap: mat(S.cap, 0.6), headset: mat(S.headset, 0.4),
      lens: new THREE.MeshStandardMaterial({ color: 0x9fd3ff, roughness: 0.1, metalness: 0.3 }),
      eyeWhite: mat(0xffffff, 0.3), pupil: mat(0x1a1a1a, 0.2), brow: mat(S.brow, 0.8), mouth: mat(0x7a2e24, 0.6),
      patch: mat(S.patch, 0.5), metal: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.3, metalness: 0.5 }),
    };
    this.mats = m;
    const g = new THREE.Group(); g.name = 'kropp_' + name; this.group = g;
    const mk = (geo, mt, nm) => { const o = new THREE.Mesh(geo, mt); o.name = nm; g.add(o); return o; };

    // kropp
    this.torso = mk(rbox(0.44, 0.58, 0.28, 0.1), m.jacket, `${name}_torso`);
    // detaljer på jackan (följer med bålen)
    const td = (geo, mt, nm, p) => { const o = new THREE.Mesh(geo, mt); o.name = nm; o.position.set(...p); this.torso.add(o); return o; };
    td(new THREE.BoxGeometry(0.014, 0.5, 0.012), m.jacketDark, `${name}_dragkedja`, [0, -0.01, -0.141]);
    td(rbox(0.1, 0.09, 0.014, 0.012), m.jacketDark, `${name}_brostficka`, [0.1, 0.11, -0.141]);
    td(new THREE.BoxGeometry(0.03, 0.006, 0.006), m.metal, `${name}_fickknapp`, [0.1, 0.15, -0.15]);
    td(rbox(0.08, 0.05, 0.012, 0.01), m.patch, `${name}_marke`, [-0.1, 0.14, -0.141]);
    [-1, 1].forEach((k) => td(rbox(0.1, 0.025, 0.12, 0.01), m.jacketDark, `${name}_axelklaff_${k}`, [k * 0.17, 0.28, 0]));
    this.hips = mk(rbox(0.4, 0.18, 0.3, 0.07), m.pants, `${name}_hoft`);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.045, 0.31), m.headset);
    belt.name = `${name}_balte`; belt.position.set(0, 0.07, 0); this.hips.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.012), m.metal);
    buckle.name = `${name}_spanne`; buckle.position.set(0, 0.07, -0.158); this.hips.add(buckle);
    this.collar = mk(rbox(0.24, 0.06, 0.18, 0.03), m.jacketDark, `${name}_krage`);
    this.neck = mk(cylGeo, m.skin, `${name}_hals`);
    // huvud (egen grupp så att det kan vridas)
    const head = new THREE.Group(); head.name = `${name}_huvud`; g.add(head); this.head = head;
    const hm = (geo, mt, nm, p, s, r) => { const o = new THREE.Mesh(geo, mt); o.name = nm; o.position.set(...p); if (s) o.scale.set(...s); if (r) o.rotation.set(...r); head.add(o); return o; };
    hm(sphGeo, m.skin, `${name}_ansikte`, [0, 0, 0], [0.125, 0.14, 0.13]);
    // mössa/hjälm: en övre halvsfär, framkanten lite uppvinklad så att ansiktet syns
    hm(capGeo, m.cap, `${name}_mossa`, [0, 0.02, 0.006], [0.137, 0.14, 0.142], [0.12, 0, 0]);
    // ansikte: ögon (vitor + pupiller), ögonbryn, näsa och mun
    [-1, 1].forEach((s) => {
      hm(sphGeo, m.eyeWhite, `${name}_oga_${s}`, [s * 0.044, 0.004, -0.107], [0.021, 0.023, 0.016]);
      hm(sphGeo, m.pupil, `${name}_pupill_${s}`, [s * 0.044, 0.002, -0.122], [0.011, 0.012, 0.006]);
      hm(sphGeo, m.eyeWhite, `${name}_glans_${s}`, [s * 0.044 + 0.004, 0.007, -0.127], [0.0035, 0.0035, 0.002]);
      hm(new THREE.BoxGeometry(0.038, 0.008, 0.01), m.brow, `${name}_ogonbryn_${s}`, [s * 0.045, 0.032, -0.118], null, [0.15, 0, s * -0.12]);
    });
    hm(sphGeo, m.skin, `${name}_nasa`, [0, -0.022, -0.13], [0.019, 0.024, 0.02]);
    hm(new THREE.TorusGeometry(0.024, 0.0045, 6, 14, Math.PI), m.mouth, `${name}_mun`, [0, -0.058, -0.112], null, [0.25, 0, Math.PI]);
    // flygglasögon uppe på pannan (på mössan) med band
    hm(new THREE.TorusGeometry(0.139, 0.01, 8, 36), m.headset, `${name}_glasogonband`, [0, 0.075, 0.008], [1, 0.82, 1], [Math.PI / 2 - 0.3, 0, 0]);
    [-1, 1].forEach((s) => {
      hm(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 20), m.lens, `${name}_glas_${s}`, [s * 0.046, 0.108, -0.106], null, [Math.PI / 2 - 0.75, 0, 0]);
      hm(new THREE.TorusGeometry(0.031, 0.007, 6, 20), m.headset, `${name}_glasram_${s}`, [s * 0.046, 0.111, -0.112], null, [-0.75, 0, 0]);
    });
    // hörlurar och mikrofon
    [-1, 1].forEach((s) => hm(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 20), m.headset, `${name}_lur_${s}`, [s * 0.135, -0.005, 0.01], null, [0, 0, Math.PI / 2]));
    hm(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8), m.headset, `${name}_mikrofonarm`, [-0.1, -0.06, -0.06], null, [Math.PI / 2, 0.6, 0]);
    hm(sphGeo, m.headset, `${name}_mikrofon`, [-0.06, -0.08, -0.115], [0.018, 0.018, 0.018]);
    this.headMeshes = head.children.slice();

    // lemmar
    const limb = (mt, nm) => mk(cylGeo, mt, nm);
    const joint = (mt, nm) => mk(sphGeo, mt, nm);
    this.arms = [-1, 1].map((s) => ({
      s,
      upper: limb(m.jacket, `${name}_overarm_${s}`), fore: limb(m.jacket, `${name}_underarm_${s}`),
      shoulderJ: joint(m.jacket, `${name}_axel_${s}`), elbowJ: joint(m.jacket, `${name}_armbage_${s}`),
      cuff: limb(m.jacketDark, `${name}_manschett_${s}`),
      hand: mk(rbox(0.085, 0.1, 0.06, 0.025), m.gloves, `${name}_hand_${s}`),
      thumb: mk(rbox(0.03, 0.05, 0.03, 0.012), m.gloves, `${name}_tumme_${s}`),
      finger: mk(rbox(0.022, 0.07, 0.022, 0.009), m.gloves, `${name}_pekfinger_${s}`),
      target: V(), spring: null, mid: V(), end: V(), pointing: false,
    }));
    this.legs = [-1, 1].map((s) => ({
      s,
      thigh: limb(m.pants, `${name}_lar_${s}`), shin: limb(m.pants, `${name}_smalben_${s}`),
      kneeJ: joint(m.pants, `${name}_kna_${s}`),
      foot: mk(rbox(0.12, 0.09, 0.27, 0.035), m.boots, `${name}_stovel_${s}`),
      mid: V(), end: V(),
    }));

    // vila
    const X = seatX;
    this.pelvis = V(X, 0.62, 0.46);
    this.torsoSpring = new Spring3(70, 0.9);   // nästan kritiskt dämpad: lugnt, utan studs
    this.headSpring = new Spring3(180, 0.95);
    this.lookYaw = 0; this.lookPitch = 0;
    this.lookTarget = { yaw: 0, pitch: 0 };
    this.lean = 0;
    this.sideLean = 0;
    this.time = Math.random() * 10;
    // beräknade punkter
    this.shoulderC = V(); this.neckP = V(); this.headP = V(); this.eye = V();
    this.shoulders = [V(), V()];
    this.hipsP = [V(), V()];
    this.headQuat = new THREE.Quaternion();
    for (const a of this.arms) a.spring = new Spring3(260, 0.85, V(X + a.s * 0.15, 0.75, 0.15));
  }

  setHeadVisible(v) { this.headMeshes.forEach((o) => { o.visible = v; }); this.neck.visible = v; }

  // ctx: { hands: [vänsterMål, högerMål] (Vector3), point: [bool,bool], accel: Vector3 (lokal, m/s²),
  //        look: {yaw,pitch}, brace: 0..1, shake: tal }
  update(dt, ctx) {
    this.time += dt;
    const X = this.seatX;
    // Överkroppens fjäder: tröghet mot planets accelerationer
    const a = ctx.accel || V();
    const breathe = Math.sin(this.time * 1.7) * 0.003;
    const tTarget = V(
      THREE.MathUtils.clamp(-a.x * 0.0025, -0.035, 0.035),
      THREE.MathUtils.clamp(-a.y * 0.0018, -0.025, 0.02) + breathe,
      THREE.MathUtils.clamp(a.z * 0.002, -0.03, 0.04),
    );
    if (ctx.shake) tTarget.add(V((Math.random() - 0.5) * ctx.shake, (Math.random() - 0.5) * ctx.shake, (Math.random() - 0.5) * ctx.shake));
    const to = this.torsoSpring.update(tTarget, dt);

    // Luta fram om händerna behöver nå längre
    const leanT = THREE.MathUtils.clamp(ctx.lean || 0, 0, 0.22);
    this.lean += (leanT - this.lean) * Math.min(1, dt * 6);
    // luta åt sidan (t.ex. mot kompisen när man pekar)
    this.sideLean +=((ctx.sideLean || 0) - this.sideLean) * Math.min(1, dt * 5);

    const pel = this.pelvis;
    this.shoulderC.set(X + to.x + this.sideLean, pel.y + 0.57 + to.y, pel.z - 0.24 + to.z - this.lean);
    this.neckP.copy(this.shoulderC).add(V(0, 0.09, 0.01));
    // huvudet hänger i en egen, lite slappare fjäder
    const hTarget = V(this.neckP.x + to.x * 0.3, this.neckP.y + 0.18, this.neckP.z + to.z * 0.3);
    const hp = this.headSpring.update(hTarget, dt);
    this.headP.copy(hp);

    // blickriktning
    const k = Math.min(1, dt * 5);
    this.lookYaw += ((ctx.look ? ctx.look.yaw : 0) - this.lookYaw) * k;
    this.lookPitch += ((ctx.look ? ctx.look.pitch : 0) - this.lookPitch) * k;
    const tilt = THREE.MathUtils.clamp(-to.x * 1.0, -0.05, 0.05);
    this.headQuat.setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, tilt, 'YXZ'));
    this.head.position.copy(this.headP);
    this.head.quaternion.copy(this.headQuat);
    this.eye.set(0, 0.03, -0.1).applyQuaternion(this.headQuat).add(this.headP);

    // bål
    const tc = V().addVectors(pel, this.shoulderC).multiplyScalar(0.5).add(V(0, 0.02, 0));
    this.torso.position.copy(tc);
    const up = V().subVectors(this.shoulderC, pel).normalize();
    this.torso.quaternion.setFromUnitVectors(UP, up);
    this.hips.position.copy(pel).add(V(0, -0.02, 0.02));
    this.collar.position.copy(this.shoulderC).add(V(0, 0.03, 0.02));
    this.collar.quaternion.copy(this.torso.quaternion);
    placeBone(this.neck, this.shoulderC, this.headP, 0.045);

    // armar
    const sideDir = V(1, 0, 0);
    for (const arm of this.arms) {
      const sh = this.shoulders[arm.s < 0 ? 0 : 1].copy(this.shoulderC).addScaledVector(sideDir, arm.s * 0.215).add(V(0, -0.03, 0));
      const tgt = ctx.hands[arm.s < 0 ? 0 : 1];
      const hp2 = arm.spring.update(tgt, dt);
      // armbågen pekar utåt och nedåt
      const pole = V(arm.s * 1.0, -0.9, 0.25);
      // handen sitter lite förbi handleden
      const dir = V().subVectors(hp2, sh).normalize();
      const wristT = V().copy(hp2).addScaledVector(dir, -0.05);
      solveIK(sh, wristT, 0.45, 0.43, pole, arm.mid, arm.end);
      placeBone(arm.upper, sh, arm.mid, 0.058);
      placeBone(arm.fore, arm.mid, arm.end, 0.052);
      arm.shoulderJ.position.copy(sh); arm.shoulderJ.scale.setScalar(0.07);
      arm.elbowJ.position.copy(arm.mid); arm.elbowJ.scale.setScalar(0.058);
      const fdir = V().subVectors(arm.end, arm.mid).normalize();
      const cuffEnd = V().copy(arm.end);
      const cuffStart = V().copy(arm.end).addScaledVector(fdir, -0.05);
      placeBone(arm.cuff, cuffStart, cuffEnd, 0.06);
      // hand
      const q = new THREE.Quaternion().setFromUnitVectors(UP, fdir);
      arm.hand.position.copy(arm.end).addScaledVector(fdir, 0.055);
      arm.hand.quaternion.copy(q);
      const thumbOff = V(-arm.s * 0.045, 0.03, -0.01).applyQuaternion(q);
      arm.thumb.position.copy(arm.hand.position).add(thumbOff);
      arm.thumb.quaternion.copy(q);
      const pointing = ctx.point && ctx.point[arm.s < 0 ? 0 : 1];
      arm.finger.visible = !!pointing;
      if (pointing) {
        arm.finger.position.copy(arm.hand.position).addScaledVector(fdir, 0.08);
        arm.finger.quaternion.copy(q);
      }
    }

    // ben
    for (const leg of this.legs) {
      const hip = this.hipsP[leg.s < 0 ? 0 : 1].copy(pel).add(V(leg.s * 0.11, -0.02, 0));
      const brace = ctx.brace || 0;
      const foot = V(X + leg.s * 0.14, 0.15 + brace * 0.05, -0.24 - brace * 0.16);
      solveIK(hip, foot, 0.46, 0.5, V(0, 1, -1.2), leg.mid, leg.end);
      placeBone(leg.thigh, hip, leg.mid, 0.075);
      placeBone(leg.shin, leg.mid, leg.end, 0.065);
      leg.kneeJ.position.copy(leg.mid); leg.kneeJ.scale.setScalar(0.075);
      leg.foot.position.copy(leg.end).add(V(0, -0.06, -0.07));
    }
  }

  // Hur långt ut handen behöver sträckas (för framåtlutning)
  reachDeficit(targets) {
    let worst = 0;
    const base = V(this.seatX, this.pelvis.y + 0.57, this.pelvis.z - 0.24);
    for (const arm of this.arms) {
      const sh = V().copy(base).add(V(arm.s * 0.215, -0.03, 0));
      const d = sh.distanceTo(targets[arm.s < 0 ? 0 : 1]) - 0.86;
      if (d > worst) worst = d;
    }
    return worst;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry && o.geometry !== cylGeo && o.geometry !== sphGeo && o.geometry !== capGeo) o.geometry.dispose(); });
    Object.values(this.mats).forEach((mt) => mt.dispose());
  }
}
