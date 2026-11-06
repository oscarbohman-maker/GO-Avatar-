// Kraschens effekter i spelvärlden. Kraschen startar bara när planet faktiskt nuddar något
// (sim.js), och här anpassas den efter VAD det träffade och HUR:
//  - mark:    eldklot, eld, jordklumpar, rök och brännmärke
//  - berg:    kraftig smäll, stoft och stenskärvor, mer skrot och mindre eld
//  - trad:    löv och grenar yr, lite rök, liten explosion
//  - byggnad: betongdamm, gnistor och brand – bitar av väggen faller ned
// Kontaktpunkten bestämmer var effekten startar, skräpet följer planets fart och träffvinkeln,
// och allt skalas med kraschens styrka (fart × hur frontal träffen är × vilken del som träffar).
// Partiklarnas meshar och material återanvänds (pool) – inga nya skapas varje frame.
import * as THREE from './lib/three.module.min.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const R = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const MAX_PARTS = 600;

export class CrashFX {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'krasch_fx';
    scene.add(this.root);
    this.ico = new THREE.IcosahedronGeometry(1, 1);
    this.cube = new THREE.BoxGeometry(1, 1, 1);
    this.ring = new THREE.RingGeometry(0.85, 1, 48); this.ring.rotateX(-Math.PI / 2);
    this.parts = [];
    this.pool = { lit: [], flat: [] };
    this.debris = [];
    this.time = 0;
    // ljusblixt vid smällen
    this.flash = new THREE.PointLight(0xff8a30, 0, 140, 1.4);
    this.root.add(this.flash);
    this.flashPeak = 0; this.flashT = -99;
    // brännmärke på marken
    this.scorch = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: 0x24201c, transparent: true, opacity: 0.75, depthWrite: false }));
    this.scorch.rotation.x = -Math.PI / 2; this.scorch.visible = false; this.root.add(this.scorch);
    // gemensamt material för byggnadsbitar som faller
    this.concrete = new THREE.MeshLambertMaterial({ color: 0x8e9196, flatShading: true });
    this.shake = 0;
    this.fire = null;   // efterbrand vid vraket { pos, until, kind }
  }

  // ---- partiklar ---------------------------------------------------------
  _mesh(lit) {
    const list = lit ? this.pool.lit : this.pool.flat;
    if (list.length) return list.pop();
    const mat = lit
      ? new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, flatShading: true })
      : new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.ico, mat); m.userData.lit = !!lit; m.frustumCulled = false;
    return m;
  }

  spawn(o) {
    if (this.parts.length >= MAX_PARTS) this._kill(0);
    const m = this._mesh(o.lit);
    m.geometry = o.geo || this.ico;
    m.material.color.set(o.c0); m.material.opacity = o.op ?? 1;
    const st = o.st || null;
    m.position.copy(o.pos);
    if (o.rot) m.rotation.set(R(0, 6), R(0, 6), R(0, 6)); else m.rotation.set(0, 0, 0);
    this.root.add(m);
    this.parts.push({
      m, st, v: o.vel ? o.vel.clone() : V(), age: 0, life: o.life, size: o.size, grow: o.grow || 0, grav: o.grav || 0, drag: o.drag || 0,
      c0: new THREE.Color(o.c0), c1: new THREE.Color(o.c1 ?? o.c0), op: o.op ?? 1, bounce: !!o.bounce, spin: o.rot ? R(-6, 6) : 0, fadeIn: o.fadeIn || 0,
    });
  }

  _kill(i) {
    const p = this.parts[i];
    this.root.remove(p.m);
    (p.m.userData.lit ? this.pool.lit : this.pool.flat).push(p.m);
    this.parts.splice(i, 1);
  }

  // ---- själva kraschen ---------------------------------------------------
  // e: { type, part, pos:[x,y,z], n:[x,y,z], dir:[x,y,z], sev }
  burst(e) {
    const p = V(...e.pos), n = V(...(e.n || [0, 1, 0])).normalize();
    const dir = V(...(e.dir || [0, 0, -1]));
    // fartens del längs ytan: skräpet glider vidare åt det hållet
    const td = dir.clone().addScaledVector(n, -dir.dot(n));
    if (td.lengthSq() > 1e-6) td.normalize().multiplyScalar(1 - (e.frontal || 0) * 0.6);
    const sev = Math.min(1.3, e.sev || 1);
    const k = 0.45 + 0.75 * sev;                         // antal partiklar, blixt och skak skalas med styrkan
    const S = 2;                                          // världen är i dubbel skala
    const spray = (lo, hi) => V(R(-1, 1), R(0.1, 1.2), R(-1, 1)).normalize().addScaledVector(n, 0.9).addScaledVector(td, 0.9).normalize().multiplyScalar(R(lo, hi) * S);
    const at = (y = 0.5) => p.clone().add(V(R(-1.5, 1.5), y * S + R(0, 1), R(-1.5, 1.5)));
    const ball = (size, grow, life = 0.5) => this.spawn({ pos: p.clone(), life, size, grow, c0: 0xfff6c8, c1: 0xff7a10 });
    const fire = (cnt, lo, hi) => { for (let i = 0; i < Math.round(cnt); i++) this.spawn({ pos: at(), vel: spray(lo, hi), life: R(0.5, 1.2), size: R(0.8, 1.8), grow: R(1.6, 4), drag: 2.2, c0: Math.random() < 0.5 ? 0xffe27a : 0xffa531, c1: 0xb3260c }); };
    const smoke = (cnt) => { for (let i = 0; i < Math.round(cnt); i++) this.spawn({ pos: at(1), vel: spray(1, 5).add(V(0, 4, 0)), life: R(2.5, 5), size: R(1.2, 2.4), grow: R(1.6, 3), drag: 1.2, c0: 0x2e2a28, c1: 0x9a9590, op: 0.85, lit: true, fadeIn: 0.25 }); };
    const dust = (cnt, c0, c1, op, s0 = 1.6, s1 = 3.2) => { for (let i = 0; i < Math.round(cnt); i++) this.spawn({ pos: at(0.3), vel: spray(2, 8), life: R(1.8, 3.2), size: R(s0, s1), grow: R(2.4, 4.4), drag: 1.4, c0, c1, op, lit: true, fadeIn: 0.15 }); };
    const chunks = (cnt, c0, c1, lo, hi, s0, s1) => { for (let i = 0; i < Math.round(cnt); i++) this.spawn({ pos: at(), vel: spray(lo, hi), life: R(1.5, 3), size: R(s0, s1), grav: 30, bounce: true, rot: true, c0, c1, geo: this.cube, lit: true }); };
    const sparks = (cnt) => { for (let i = 0; i < Math.round(cnt); i++) this.spawn({ pos: at(), vel: spray(8, 24), life: R(0.8, 1.8), size: R(0.1, 0.24), grav: 30, bounce: true, rot: true, c0: 0xfff0b0, c1: 0xff6a10, geo: this.cube }); };

    switch (e.type) {
      case 'berg':      // kraftig smäll, mycket stoft och stenskärvor, lite eld
        this._flash(p, 90 * k); this.shake = Math.max(this.shake, 0.9 * k);
        ball(1, 14 * k, 0.35); fire(8 * k, 2, 6);
        dust(40 * k, 0x6e655b, 0xcdc2b4, 0.85);
        chunks(55 * k, 0x7a736b, 0x4d4843, 6, 20, 0.25, 0.8); chunks(15 * k, 0x9a9187, 0x6a625a, 4, 14, 0.6, 1.2);
        sparks(25 * k); smoke(6 * k);
        this.fire = { pos: p.clone(), until: this.time + 2.5, rate: 0.3 };
        break;
      case 'trad':      // löv och grenar yr, lite rök, liten explosion
        this._flash(p, 40 * k); this.shake = Math.max(this.shake, 0.45 * k);
        for (let i = 0; i < 110 * k; i++) this.spawn({ pos: at(1), vel: spray(3, 12).add(V(0, 5, 0)), life: R(2, 4), size: R(0.3, 0.6), grav: 6, drag: 0.8, rot: true, c0: pick([0x4a9a3a, 0x6fb040, 0x2f7a30]), c1: 0xa4c94a, geo: this.cube, st: V(1, 0.12, 1), lit: true });
        for (let i = 0; i < 22 * k; i++) this.spawn({ pos: at(), vel: spray(4, 12), life: R(2, 3), size: R(0.4, 0.7), grav: 24, bounce: true, rot: true, c0: 0x6a4a2a, c1: 0x3f2a16, geo: this.cube, st: V(5, 0.6, 0.6), lit: true });
        fire(6 * k, 2, 6); smoke(8 * k);
        this.fire = { pos: p.clone(), until: this.time + 1.5, rate: 0.2 };
        break;
      case 'byggnad':   // betongdamm, gnistor och brand – delar av väggen faller ned
        this._flash(p, 130 * k); this.shake = Math.max(this.shake, 0.85 * k);
        ball(1.2, 18 * k); fire(30 * k, 3, 12);
        dust(45 * k, 0xaaa8a5, 0xe6e4e0, 0.8, 2, 4.4);
        chunks(45 * k, 0x9c9a97, 0x5a5855, 5, 18, 0.5, 1.4); smoke(25 * k); sparks(40 * k);
        this._wallChunks(p, n, td, sev);
        this.fire = { pos: p.clone(), until: this.time + 4, rate: 1 };
        break;
      default:          // mark: eldklot, eld, jordklumpar, rök och brännmärke
        this._flash(p, 120 * k); this.shake = Math.max(this.shake, 0.8 * k);
        ball(1.2, 20 * k, 0.55);
        this.spawn({ pos: p.clone().add(V(0, 0.2, 0)), life: 0.9, size: 1, grow: 40, c0: 0xffffff, op: 0.8, geo: this.ring });
        fire(45 * k, 4, 14);
        chunks(40 * k, 0x6b4a2b, 0x3d2a18, 5, 18, 0.3, 0.8); chunks(20 * k, 0x4f9a3a, 0x2f6a28, 4, 14, 0.16, 0.4);
        dust(18 * k, 0xb59b74, 0xe0cfa8, 0.7); smoke(20 * k); sparks(18 * k);
        this.scorch.position.set(p.x, 0.06, p.z);
        this.scorch.scale.setScalar(0.7 + 0.5 * sev);
        this.scorch.visible = true;
        this.fire = { pos: V(p.x, 0.5, p.z), until: this.time + 5, rate: 1 };
    }
  }

  _flash(p, peak) {
    this.flash.position.copy(p).add(V(0, 6, 0));
    this.flashPeak = peak; this.flashT = this.time;
  }

  // Bitar av en vägg som lossnar och faller (delad geometri och material)
  _wallChunks(p, n, td, sev) {
    const cnt = Math.round(3 + 5 * sev);
    for (let i = 0; i < cnt; i++) {
      const m = new THREE.Mesh(this.cube, this.concrete);
      m.name = 'vaggbit';
      m.scale.set(R(1.2, 3.4), R(0.8, 2.4), R(1.2, 3));
      m.position.copy(p).add(V(R(-3, 3), R(0, 6), R(-3, 3))).addScaledVector(n, -1);
      m.rotation.set(R(0, 1), R(0, 1), R(0, 1));
      this.root.add(m);
      this.debris.push({ o: m, v: n.clone().multiplyScalar(R(2, 6)).addScaledVector(td, R(2, 8)).add(V(0, R(0, 4), 0)), w: V(R(-3, 3), R(-3, 3), R(-3, 3)), own: false });
    }
  }

  // Lägg en avbruten del av planet som skrot (meshen är en kopia som delar geometri/material)
  addDebris(obj, vel, spin) {
    this.root.add(obj);
    this.debris.push({ o: obj, v: vel, w: spin, smoke: Math.random() < 0.5 });
  }

  // Efter en ny start: brännmärke och skrot bort (pågående partiklar får brinna klart)
  clearWreck() {
    this.scorch.visible = false;
    this.fire = null;
    for (const d of this.debris) d.o.removeFromParent();
    this.debris.length = 0;
  }

  // Spelarens vrak: rök och lite eld bakom planet medan det tumlar
  trail(pos, sev) {
    if (Math.random() < 0.7) this.spawn({ pos, vel: V(R(-1, 1), R(2, 4), R(-1, 1)), life: R(1.5, 2.5), size: 0.8, grow: 2.4, c0: 0x2e2a28, c1: 0x8d8884, op: 0.8, lit: true });
    if (Math.random() < 0.3 + 0.4 * sev) this.spawn({ pos, vel: V(R(-1, 1), R(0, 2), R(-1, 1)), life: R(0.25, 0.45), size: 0.7, grow: 1, c0: 0xffe27a, c1: 0xd8380f });
  }

  update(dt) {
    this.time += dt;
    // efterbrand
    if (this.fire && this.time < this.fire.until) {
      const f = this.fire, r = (f.until - this.time) / 5;
      if (Math.random() < f.rate * Math.min(1, r + 0.3)) this.spawn({ pos: f.pos.clone().add(V(R(-3, 3), 0.5, R(-3, 3))), vel: V(R(-1, 1), R(4, 8), R(-1, 1)), life: R(0.5, 0.9), size: R(0.6, 1.1), grow: 1.6, c0: 0xffe27a, c1: 0xc8300d });
      if (Math.random() < 0.6 * f.rate) this.spawn({ pos: f.pos.clone().add(V(R(-2, 2), 3, R(-2, 2))), vel: V(R(0.6, 2), R(4, 7), R(-0.8, 0.8)), life: R(3, 4.5), size: 1.2, grow: 2.2, c0: 0x302c2a, c1: 0xa09b96, op: 0.5, lit: true, fadeIn: 0.3 });
    }
    // ljusblixt
    this.flash.intensity = Math.max(0, this.flashPeak * (1 - (this.time - this.flashT) / 1.1));
    this.shake = Math.max(0, this.shake - dt * 1.6);
    // partiklar
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.age += dt;
      if (p.age >= p.life) { this._kill(i); continue; }
      const k = p.age / p.life;
      p.v.y -= p.grav * dt; p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.m.position.addScaledVector(p.v, dt);
      if (p.bounce && p.m.position.y < 0.1) { p.m.position.y = 0.1; p.v.y *= -0.35; p.v.x *= 0.6; p.v.z *= 0.6; }
      const s = p.size + p.grow * p.age;
      if (p.st) p.m.scale.set(s * p.st.x, s * p.st.y, s * p.st.z); else p.m.scale.setScalar(s);
      if (p.spin) { p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt; }
      p.m.material.color.copy(p.c0).lerp(p.c1, Math.min(1, k * 1.6));
      const fin = p.fadeIn ? Math.min(1, p.age / p.fadeIn) : 1;
      p.m.material.opacity = p.op * fin * Math.pow(1 - k, 1.4);
    }
    // skrot (planets delar och väggbitar) faller och studsar mot marken
    for (const d of this.debris) {
      if (d.rest) continue;
      d.v.y -= 22 * dt;
      d.o.position.addScaledVector(d.v, dt);
      d.o.rotation.x += d.w.x * dt; d.o.rotation.y += d.w.y * dt; d.o.rotation.z += d.w.z * dt;
      if (d.o.position.y < 0.5) {
        d.o.position.y = 0.5; d.v.y = -d.v.y * 0.3; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.5);
        if (Math.abs(d.v.y) < 1.5 && d.v.length() < 2) d.rest = true;
      }
      if (d.smoke && Math.random() < 0.3) this.spawn({ pos: d.o.position, vel: V(R(-0.5, 0.5), R(2, 4), R(-0.5, 0.5)), life: R(1.2, 2), size: 0.5, grow: 1.6, c0: 0x3b3735, c1: 0x9a9590, op: 0.6, lit: true });
    }
  }

  // kameraskak (litet slumpat förskjutning), skalas med kraschens styrka
  shakeOffset(out) {
    const s = this.shake * this.shake * 1.4;
    return out.set(R(-1, 1) * s, R(-1, 1) * s, R(-1, 1) * s);
  }

  dispose() {
    this.clearWreck();
    while (this.parts.length) this._kill(0);
    [...this.pool.lit, ...this.pool.flat].forEach((m) => m.material.dispose());
    this.ico.dispose(); this.cube.dispose(); this.ring.dispose();
    this.scorch.geometry.dispose(); this.scorch.material.dispose(); this.concrete.dispose();
    this.root.removeFromParent();
  }
}
