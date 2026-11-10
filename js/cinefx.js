// Cutscenens händelse – en per värld – som planet flyger igenom under inflygningen:
//  arktis: snöstorm (vit vägg), öken: sandstorm, djungel: blixtnedslag i monsunen,
//  röda klippor: stenras, lava: vulkanutbrott med lavabomber, skog: fågelflock, träning: barrel roll.
// Allt skapas när banan laddas (så att det kan förberedas utan hack) och tas bort när cutscenen är slut.
import * as THREE from './lib/three.module.min.js';
import { THEMES } from './themes.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const R = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const bump = (t, a, b) => clamp01((t - a) / 0.5) * clamp01((b - t) / 0.6);   // tonas in vid a, ut mot b

export const EVENT_OF = { arctic: 'blizzard', desert: 'sandstorm', jungle: 'monsoon', redrock: 'rockfall', lava: 'eruption', forest: 'birds', canyon: 'roll' };

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class IntroFX {
  constructor(world, level) {
    this.world = world;
    this.level = level;
    this.theme = level.theme || 'forest';
    this.kind = EVENT_OF[this.theme] || 'birds';
    this.group = new THREE.Group(); this.group.name = 'intro_fx';
    this.group.visible = false;
    world.scene.add(this.group);
    this.t = 0;
    this.shake = 0;
    this.fog = null;            // { color, far } – stormarna sluter sig runt planet
    this.flash = 0;
    this.thunder = [];
    this.dot = dotTexture();
    const T = THEMES[this.theme] || THEMES.forest;
    const s = level.start;
    this.fwd = V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    this.right = V(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    if (this.kind === 'blizzard' || this.kind === 'sandstorm') this._makeStorm(this.kind === 'blizzard' ? 0xffffff : 0xe2c48c);
    if (this.kind === 'rockfall') this._makeRocks(T.pillar);
    if (this.kind === 'eruption') this._makeEruption();
    if (this.kind === 'monsoon') this._makeBolts();
    if (this.kind === 'birds') this._makeBirds();
    this._makeDust();
  }

  // ---- snö- eller sandstorm: täta, snabba partiklar runt kameran
  _makeStorm(color) {
    const N = 1600, box = 90;
    this.storm = { N, box, D: new Float32Array(N * 3) };
    for (let i = 0; i < N * 3; i++) this.storm.D[i] = (Math.random() - 0.5) * box;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.stormPts = new THREE.Points(g, new THREE.PointsMaterial({ map: this.dot, color, size: this.kind === 'blizzard' ? 0.55 : 0.4, transparent: true, depthWrite: false, opacity: 0 }));
    this.stormPts.frustumCulled = false;
    this.group.add(this.stormPts);
  }

  // ---- stenras: block som rasar ner bredvid planet
  _makeRocks(color) {
    const geo = new THREE.DodecahedronGeometry(1, 0), mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    this.rocks = [];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geo, mat); m.visible = false; this.group.add(m);
      this.rocks.push({ m, t0: 0.4 + i * 0.32, side: i % 2 ? 1 : -1, size: R(1.6, 3.2), done: false });
    }
  }

  // ---- vulkanutbrott: glödande lavabomber i bågar
  _makeEruption() {
    const geo = new THREE.IcosahedronGeometry(1, 1), mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.1, 0.25), toneMapped: false });
    this.bombs = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(geo, mat); m.visible = false; this.group.add(m);
      this.bombs.push({ m, t0: 0.5 + i * 0.22, v: V(), p: V(), size: R(0.7, 1.4) });
    }
  }

  // ---- blixtar: taggiga linjer från himlen
  _makeBolts() {
    this.bolts = [0, 1].map(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(2.5, 2.8, 3.2), toneMapped: false, transparent: true }));
      l.frustumCulled = false; l.visible = false; this.group.add(l);
      return l;
    });
    this.boltTimes = [0.9, 2.35];
  }

  // ---- fågelflock som flyger med planet
  _makeBirds() {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.25, 0, 0, 0.25, 0.9, 0, 0.05]), 3));
    wing.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x1d2328, side: THREE.DoubleSide });
    this.birds = [];
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      const l = new THREE.Mesh(wing, mat), r = new THREE.Mesh(wing, mat); r.scale.x = -1;
      b.add(l, r); b.scale.setScalar(2.6);
      this.group.add(b);
      const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      this.birds.push({ b, l, r, off: V(13 + side * row * 3.2, 4.5 + row * 0.5 + Math.random() * 0.6, 16 - row * 3.4 + R(-0.4, 0.4)), ph: R(0, 6) });
    }
  }

  // ---- dammpuffar och glöd (sprites, återanvänds)
  _makeDust() {
    this.puffs = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; this.group.add(s);
      this.puffs.push({ s, age: 9, life: 1, v: V(), size: 1, grow: 0 });
    }
    this.puffIdx = 0;
  }
  _puff(pos, color, size, life, vel, grow = 3, additive = false) {
    const p = this.puffs[this.puffIdx++ % this.puffs.length];
    p.s.position.copy(pos); p.s.material.color.set(color); p.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.visible = true; p.age = 0; p.life = life; p.size = size; p.grow = grow; p.v.copy(vel || V());
  }

  // Visa allt en gång (för förberedelsen); sedan göms det igen
  showAllForWarmup(on) {
    this.group.visible = on;
    this.group.traverse((o) => { if (o !== this.group) o.visible = on; });
  }

  start() {
    this.showAllForWarmup(false);
    this.group.visible = true;
    if (this.stormPts) this.stormPts.visible = true;
    if (this.birds) this.birds.forEach((b) => { b.b.visible = true; });
    this.t = 0;
  }

  // plane: planets läge {x,y,z}, cam: kamerans position, dash: dashcam-tagningen
  update(dt, plane, cam, dash) {
    this.t += dt;
    const t = this.t, P = V(plane.x, plane.y, plane.z);
    this.shake = 0; this.fog = null; this.flash = Math.max(0, this.flash - dt * 4);
    const ahead = (d, side = 0, up = 0) => P.clone().addScaledVector(this.fwd, d).addScaledVector(this.right, side).add(V(0, up, 0));

    if (this.storm) {
      // stormen sluter sig: tät dimma och partiklar som piskar förbi; planet "slår igenom" in i dashcam-tagningen
      const k = clamp01((t - 0.4) / 1.6);
      const blizz = this.kind === 'blizzard';
      this.fog = { color: blizz ? 0xe9eef4 : 0xd7b47c, far: 92 - 66 * k, near: 6 };
      this.shake = 0.05 + 0.12 * k;
      this.stormPts.material.opacity = 0.25 + 0.65 * k;
      const S = this.storm, W = S.box, D = S.D, pa = this.stormPts.geometry.attributes.position.array;
      const wind = this.right.clone().multiplyScalar(blizz ? -38 : -46).addScaledVector(this.fwd, -10).add(V(0, blizz ? -9 : -2, 0));
      const ox = cam.x - W / 2, oy = cam.y - W / 2, oz = cam.z - W / 2;
      for (let i = 0; i < S.N; i++) {
        const j = i * 3;
        D[j] += wind.x * dt; D[j + 1] += wind.y * dt; D[j + 2] += wind.z * dt;
        let x = ox + ((((D[j] - ox) % W) + W) % W), y = oy + ((((D[j + 1] - oy) % W) + W) % W), z = oz + ((((D[j + 2] - oz) % W) + W) % W);
        // inga flingor inne i kabinen (dashcam)
        if (dash && (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2 < 9) { x = cam.x; y = cam.y - 999; z = cam.z; }
        pa[j] = x; pa[j + 1] = y; pa[j + 2] = z;
      }
      this.stormPts.geometry.attributes.position.needsUpdate = true;
      if (Math.random() < dt * 1.5 * k) this.flash = Math.max(this.flash, 0.35);   // vindbyar som vitnar till
    }

    if (this.rocks) {
      for (const r of this.rocks) {
        if (t < r.t0) continue;
        if (!r.started) {
          r.started = true;
          r.p = ahead(R(72, 95), r.side * R(8, 15), R(30, 40));
          r.v = V(R(-2, 2), -8, R(-2, 2)).addScaledVector(this.right, -r.side * 2);
          r.w = V(R(-3, 3), R(-3, 3), R(-3, 3));
          r.m.visible = true; r.m.scale.setScalar(r.size);
        }
        if (r.done) continue;
        r.v.y -= 30 * dt;
        r.p.addScaledVector(r.v, dt);
        r.m.position.copy(r.p);
        r.m.rotation.x += r.w.x * dt; r.m.rotation.y += r.w.y * dt;
        if (Math.random() < dt * 14) this._puff(r.p, 0xb07050, r.size * 1.2, 0.8, V(0, 1, 0), 2);
        if (r.p.y < r.size * 0.6) {
          r.done = true; r.m.visible = false;
          for (let i = 0; i < 5; i++) this._puff(V(r.p.x + R(-2, 2), 1, r.p.z + R(-2, 2)), 0xa86848, r.size * 2.4, 1.4, V(R(-3, 3), R(2, 5), R(-3, 3)), 5);
          this.shake = Math.max(this.shake, 0.35);
          this.thunder.push(0.25);
        }
      }
    }

    if (this.bombs) {
      // utbrottet: röda blixtar och lavabomber som flyger i bågar över planet
      const glowK = bump(t, 0.4, 3.4);
      this.flash = Math.max(this.flash, glowK * (0.25 + 0.2 * Math.sin(t * 13)));
      this.shake = 0.08 + 0.1 * glowK;
      for (const b of this.bombs) {
        if (t < b.t0) continue;
        if (!b.started) {
          b.started = true;
          b.p = ahead(120 + R(0, 40), R(-30, 30), R(-6, 2));
          const target = ahead(R(10, 45), R(-26, 26), 0);
          const T = R(1.6, 2.2);
          b.v = target.clone().sub(b.p).divideScalar(T).add(V(0, 15 * T, 0));
          b.m.visible = true; b.m.scale.setScalar(b.size);
          if (b === this.bombs[0]) this.thunder.push(0.1);
        }
        if (!b.m.visible) continue;
        b.v.y -= 30 * dt;
        b.p.addScaledVector(b.v, dt);
        b.m.position.copy(b.p);
        if (Math.random() < dt * 30) this._puff(b.p, 0xff6a1a, b.size * 1.6, 0.6, V(0, 1.5, 0), 1.5, true);
        if (b.p.y < 0) { b.m.visible = false; this._puff(V(b.p.x, 1, b.p.z), 0xff8a2a, 5, 0.9, V(0, 2, 0), 6, true); }
      }
    }

    if (this.bolts) {
      // två blixtnedslag nära banan, med blixtljus och åska
      this.bolts.forEach((l, i) => {
        const t0 = this.boltTimes[i];
        if (t >= t0 && t < t0 + 0.32) {
          if (!l.visible) {
            const top = ahead(70 + i * 25, (i ? 1 : -1) * R(18, 28), 120), bottom = V(top.x + R(-8, 8), 0, top.z + R(-8, 8));
            const pa = l.geometry.attributes.position.array;
            for (let k = 0; k < 18; k++) {
              const f = k / 17, j = f > 0 && f < 1 ? 7 * Math.sin(f * Math.PI) : 0;
              pa[k * 3] = top.x + (bottom.x - top.x) * f + R(-j, j); pa[k * 3 + 1] = top.y + (bottom.y - top.y) * f; pa[k * 3 + 2] = top.z + (bottom.z - top.z) * f + R(-j, j);
            }
            l.geometry.attributes.position.needsUpdate = true;
            l.visible = true;
            this.flash = 1; this.shake = 0.3;
            this.thunder.push(0.05);
            this._puff(bottom.clone().add(V(0, 2, 0)), 0xcfe6ff, 10, 0.5, V(), 6, true);
          }
          l.material.opacity = Math.random() < 0.3 ? 0.3 : 1;
        } else l.visible = false;
      });
    }

    if (this.birds) {
      // fåglarna flyger i V-formation bredvid planet och viker sedan av uppåt
      this.birds.forEach((q) => {
        const leave = clamp01((t - 2.4) / 1.5);
        const o = q.off;
        const pos = P.clone().addScaledVector(this.right, o.x + leave * 16).addScaledVector(this.fwd, o.z + leave * 8).add(V(0, o.y + leave * 14, 0));
        q.b.position.copy(pos);
        q.b.rotation.set(0, Math.atan2(-this.fwd.x, -this.fwd.z) + Math.PI / 2, 0);
        const a = Math.sin(t * 11 + q.ph) * 0.6;
        q.l.rotation.z = a; q.r.rotation.z = -a;
      });
    }

    // dammpuffar och glöd
    for (const p of this.puffs) {
      if (p.age >= p.life) { p.s.visible = false; continue; }
      p.age += dt;
      const k = p.age / p.life;
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(p.size + p.grow * p.age);
      p.s.material.opacity = (k < 0.15 ? k / 0.15 : 1) * (1 - k) * 0.8;
    }
  }

  // Ljud som ska spelas (köas av update)
  takeThunder() { const n = this.thunder.length; this.thunder.length = 0; return n; }

  // Planets extra rörelse i cutscenen (barrel roll på träningsbanan)
  roll(t) {
    if (this.kind !== 'roll') return 0;
    const k = clamp01((t - 0.9) / 1.3);
    return -k * k * (3 - 2 * k) * Math.PI * 2;
  }

  dispose() {
    this.world.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.dot.dispose();
  }
}
