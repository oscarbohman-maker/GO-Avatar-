// Banans 3D-värld: mark, träd, klippor, väggar, portar och navigatörens rutt.
import * as THREE from './lib/three.module.min.js';
import { moverY } from './physics.js';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#4f7d3a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#5a8a42';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 400; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(30,60,20,0.25)' : 'rgba(140,180,90,0.18)';
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const GATE_COLORS = { next: 0xffd23f, upcoming: 0xff8c42, passed: 0x3ddc84, finish: 0xffffff };

export class World3D {
  constructor(level) {
    this.level = level;
    const L = level;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.fogA = { color: new THREE.Color(L.fog.color), near: L.fog.near, far: L.fog.far };
    const pf = L.pilotFog || L.fog;
    this.fogB = { color: new THREE.Color(pf.color), near: pf.near, far: pf.far };
    scene.background = this.fogA.color.clone();
    scene.fog = new THREE.Fog(this.fogA.color.clone(), this.fogA.near, this.fogA.far);
    this.maxFar = Math.max(this.fogA.far, this.fogB.far);

    // dagsljus (mörkare och kallare i storm)
    const storm = !!(L.weather && L.weather.rain);
    this.hemi = new THREE.HemisphereLight(storm ? 0xb8c4d2 : 0xdfeeff, storm ? 0x2c3a2a : 0x3a5a2c, storm ? 1.25 : 1.9);
    this.hemiBase = this.hemi.intensity;
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(storm ? 0xc8d2de : 0xfff2d6, storm ? 0.9 : 2.1);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    // mark
    const B = L.bounds;
    const size = 4200;
    const tex = groundTexture();
    tex.repeat.set(size / 20, size / 20);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((B.minX + B.maxX) / 2, 0, (B.minZ + B.maxZ) / 2);
    scene.add(ground);

    // träd (instansierade granar i tre våningar, facetterade)
    const allTrees = L.trees.concat(L.decor || []);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();
    if (allTrees.length) {
      const n = allTrees.length;
      const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 7); trunkGeo.translate(0, 0.5, 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3c22, flatShading: true }), n);
      // våningar: [bas (andel av kronan), höjd (andel), radie (andel)]
      const tiers = [[0, 0.5, 1], [0.28, 0.45, 0.78], [0.55, 0.45, 0.55]];
      const tierMeshes = tiers.map((_, k) => {
        const g = new THREE.ConeGeometry(1, 1, 9 - k, 1); g.translate(0, 0.5, 0);
        return new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
      });
      allTrees.forEach((t, i) => {
        const v = ((Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1 + 1) % 1;
        const rot = q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v * 6.28);
        m.compose(pos.set(t.x, 0, t.z), rot, scl.set(t.trunkR, t.trunkH + 1.5, t.trunkR));
        trunks.setMatrixAt(i, m);
        const ch = t.h - t.trunkH;
        tiers.forEach(([b, h, r], k) => {
          m.compose(pos.set(t.x, t.trunkH + b * ch, t.z), rot, scl.set(t.baseR * r, ch * h, t.baseR * r));
          tierMeshes[k].setMatrixAt(i, m);
          tierMeshes[k].setColorAt(i, col.setHSL(0.28 + v * 0.07, 0.5 + v * 0.1, 0.17 + v * 0.07 + k * 0.035));
        });
      });
      scene.add(trunks, ...tierMeshes);
    }

    if (L.rocks.length) {
      const rockGeo = new THREE.CylinderGeometry(1, 1.15, 1, 7); rockGeo.translate(0, 0.5, 0);
      const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x8a7f72 }), L.rocks.length);
      L.rocks.forEach((o, i) => { m.compose(pos.set(o.x, 0, o.z), q, scl.set(o.r, o.h, o.r)); rocks.setMatrixAt(i, m); });
      scene.add(rocks);
    }

    // klippväggar: tätt packade, kantiga klippspiror (krocken räknas mot den osynliga väggen bakom)
    const dr = L.decorRocks || [];
    if (dr.length) {
      const g = new THREE.CylinderGeometry(0.45, 1, 1, 6, 2); g.translate(0, 0.5, 0);
      // gör spirorna lite skeva så att de inte ser likadana ut
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const y = pa.getY(i);
        if (y > 0.01 && y < 0.99) { pa.setX(i, pa.getX(i) * (0.85 + 0.3 * Math.abs(Math.sin(i * 7.3)))); pa.setZ(i, pa.getZ(i) * (0.85 + 0.3 * Math.abs(Math.cos(i * 3.1)))); }
      }
      g.computeVertexNormals();
      const spires = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), dr.length);
      dr.forEach((o, i) => {
        const v = ((Math.sin(o.x * 12.9898 + o.z * 78.233) * 43758.5453) % 1 + 1) % 1;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v * 6.28);
        m.compose(pos.set(o.x, 0, o.z), q, scl.set(o.r, o.h, o.r));
        spires.setMatrixAt(i, m);
        spires.setColorAt(i, col.setHSL(0.07 + v * 0.03, 0.12 + v * 0.08, (storm ? 0.3 : 0.36) + v * 0.1));
      });
      q.identity();
      scene.add(spires);
    }

    // fallande stenblock: flyttas varje bildruta efter flygtiden (samma tid som simuleringen)
    this.movers = L.movers || [];
    if (this.movers.length) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      this.moverMesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x7a6e62, flatShading: true }), this.movers.length);
      this.moverMesh.frustumCulled = false;
      scene.add(this.moverMesh);
      // mörk skugga på marken där stenen landar
      const sg = new THREE.CircleGeometry(1, 20); sg.rotateX(-Math.PI / 2);
      this.moverShadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }), this.movers.length);
      this.moverShadow.frustumCulled = false;
      scene.add(this.moverShadow);
      this.setMoverTime(0);
    }

    const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d7468, flatShading: true });
    const boxMats = {
      canyon: new THREE.MeshLambertMaterial({ color: 0x9b6b4a }),
      wall: new THREE.MeshLambertMaterial({ color: 0xa04a3a }),
      tunnel: new THREE.MeshLambertMaterial({ color: 0x5c5f66 }),
      roof: new THREE.MeshLambertMaterial({ color: 0x45484e }),
      rockwall: rockMat,
      rockroof: new THREE.MeshLambertMaterial({ color: 0x5f5850, flatShading: true }),
    };
    for (const b of L.boxes) {
      if (b.kind === 'treewall' || b.kind === 'cliffwall') continue;   // syns som träd / klippspiror i stället
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), boxMats[b.kind] || boxMats.wall);
      mesh.position.set(b.x, b.y, b.z);
      mesh.rotation.y = b.yaw;
      scene.add(mesh);
    }

    this.gateMeshes = L.gates.map((g) => {
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(g.r, g.tube, 10, 56), mat);
      mesh.position.set(g.x, g.y, g.z);
      mesh.rotation.y = g.yaw;
      scene.add(mesh);
      return mesh;
    });
    this._shownGate = -1;
    this.updateGates(0);

    // belöningar: snurrande guldstjärnor att flyga igenom
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 1.1 : 2.6;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) starShape.lineTo(x, y); else starShape.moveTo(x, y);
    }
    const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2 });
    starGeo.translate(0, 0, -0.25);
    const starMat = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xffb300, emissiveIntensity: 0.9 });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.18, depthWrite: false });
    const haloGeo = new THREE.SphereGeometry(4.2, 16, 12);
    this.starMeshes = (L.stars || []).map((s) => {
      const grp = new THREE.Group();
      grp.position.set(s.x, s.y, s.z);
      grp.add(new THREE.Mesh(starGeo, starMat), new THREE.Mesh(haloGeo, haloMat));
      scene.add(grp);
      return grp;
    });
    this.time = 0;

    // navigatörens rutt: små lysande prickar (syns bara nära, i dimman)
    this.routeMat = new THREE.MeshBasicMaterial({ color: 0x4dd0ff, transparent: true, opacity: 0.45, depthWrite: false });
    this.routeGeo = new THREE.SphereGeometry(0.45, 8, 6);
    this.routeMesh = null;

    // väder: regn (streck som följer kameran) och blixtar
    this.weather = L.weather || null;
    if (this.weather && this.weather.rain) this._makeRain();
    this.flash = 0;
    this.nextFlash = 4 + Math.random() * 6;
    this.bgBase = null;
  }

  // Stenblocken där de är vid flygtiden t (s)
  setMoverTime(t) {
    if (!this.moverMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    this.movers.forEach((mv, i) => {
      const y = moverY(mv, t);
      const show = y > -mv.r;
      e.set(t * 1.7 + i, t * 1.1 + i * 2, 0);
      q.setFromEuler(e);
      m.compose(p.set(mv.x, y, mv.z), q, s.setScalar(show ? mv.r : 0.0001));
      this.moverMesh.setMatrixAt(i, m);
      // skuggan växer och mörknar när stenen närmar sig marken
      const k = Math.max(0, Math.min(1, 1 - y / mv.top));
      m.compose(p.set(mv.x, 0.06, mv.z), q.identity(), s.setScalar(mv.r * (0.6 + 0.8 * k)));
      this.moverShadow.setMatrixAt(i, m);
    });
    this.moverMesh.instanceMatrix.needsUpdate = true;
    this.moverShadow.instanceMatrix.needsUpdate = true;
  }

  _makeRain() {
    const N = 700;
    this.rainN = N;
    this.rainBox = { w: 70, h: 46 };
    const pos = new Float32Array(N * 6);
    this.rainDrops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainDrops[i * 3] = (Math.random() - 0.5) * this.rainBox.w;
      this.rainDrops[i * 3 + 1] = Math.random() * this.rainBox.h;
      this.rainDrops[i * 3 + 2] = (Math.random() - 0.5) * this.rainBox.w;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d6e6, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  _updateRain(dt, cam) {
    if (!this.rain || !cam) return;
    const W = this.rainBox.w, H = this.rainBox.h, D = this.rainDrops;
    const wind = this.weather.wind || { dir: 0, strength: 0 };
    const wx = Math.cos(wind.dir) * wind.strength * 2.2, wz = Math.sin(wind.dir) * wind.strength * 2.2;
    const vy = -38;
    const len = 0.05;                       // strecket = 0,05 s av fallet
    const P = this.rain.geometry.attributes.position.array;
    const ox = cam.x - W / 2, oz = cam.z - W / 2, oy = cam.y - H / 2;
    for (let i = 0; i < this.rainN; i++) {
      let x = D[i * 3] + wx * dt, y = D[i * 3 + 1] + vy * dt, z = D[i * 3 + 2] + wz * dt;
      if (y < 0) y += H;
      D[i * 3] = x; D[i * 3 + 1] = y; D[i * 3 + 2] = z;
      // dropparna ligger i en låda som följer kameran (lindas runt)
      const px = ox + ((((x - ox) % W) + W) % W), pz = oz + ((((z - oz) % W) + W) % W), py = oy + y;
      // inga droppar inne i kabinen runt kameran
      const ex = px - cam.x, ey = py - cam.y, ez = pz - cam.z;
      if (ex * ex + ez * ez < 36 && ey > -5 && ey < 6) { P.fill(0, i * 6, i * 6 + 6); continue; }
      P[i * 6] = px; P[i * 6 + 1] = py; P[i * 6 + 2] = pz;
      P[i * 6 + 3] = px - wx * len; P[i * 6 + 4] = py - vy * len; P[i * 6 + 5] = pz - wz * len;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  _updateLightning(dt) {
    if (!this.weather || !this.weather.lightning) return;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.flash = 1;
      this.nextFlash = 5 + Math.random() * 9;
      this._double = Math.random() < 0.5 ? 0.18 : -1;   // ibland en dubbelblixt
      if (this.onThunder) this.onThunder();
    }
    if (this._double > 0) { this._double -= dt; if (this._double <= 0) { this.flash = Math.max(this.flash, 0.8); this._double = -1; } }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4.5);
    this.hemi.intensity = this.hemiBase + this.flash * 3.2;
    // dimman och himlen lyser upp ett ögonblick
    if (this._fogBase && (this.flash > 0 || this._flashWas)) {
      if (!this._white) this._white = new THREE.Color(0xeef2ff);
      this.scene.fog.color.copy(this._fogBase).lerp(this._white, this.flash * 0.4);
      this.scene.background.copy(this.scene.fog.color);
      this._flashWas = this.flash > 0;
    }
  }

  // Belöning när man flyger igenom en ring: ringen blinkar och en ljusvåg växer ut från den
  gateBurst(idx, perfect, combo = 1) {
    const g = this.level.gates[idx], mesh = this.gateMeshes[idx];
    if (!g || !mesh) return;
    if (!this._burstGeo) {
      this._burstGeo = new THREE.TorusGeometry(1, 0.06, 8, 48);
      this._bursts = [0, 1, 2, 3, 4, 5].map(() => {
        const m = new THREE.Mesh(this._burstGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        m.visible = false; this.scene.add(m); return m;
      });
      this._burstIdx = 0;
    }
    const col = perfect ? 0xffc22e : combo >= 3 ? 0xff4fd8 : 0x3ddcff;
    const waves = perfect ? 3 : 2;
    for (let i = 0; i < waves; i++) {
      const b = this._bursts[this._burstIdx++ % this._bursts.length];
      b.position.set(g.x, g.y, g.z); b.rotation.set(0, g.yaw, 0);
      b.material.color.setHex(col); b.material.opacity = 1;
      b.userData = { t: -i * 0.09, r: g.r, life: 0.7 };
      b.scale.setScalar(g.r); b.visible = true;
    }
    mesh.userData.flash = 1;
    mesh.userData.flashCol = col;
  }

  updateGates(ng) {
    if (ng === this._shownGate) return;
    this._shownGate = ng;
    this.gateMeshes.forEach((mesh, i) => {
      const g = this.level.gates[i];
      let c;
      if (i < ng) c = GATE_COLORS.passed;
      else if (i === ng) c = g.finish ? GATE_COLORS.finish : GATE_COLORS.next;
      else c = g.finish ? GATE_COLORS.finish : GATE_COLORS.upcoming;
      mesh.material.color.setHex(c);
      mesh.material.emissive.setHex(i === ng ? c : 0x000000);
      mesh.material.emissiveIntensity = i === ng ? 0.6 : 0;
      mesh.material.transparent = i < ng;
      mesh.material.opacity = i < ng ? 0.35 : 1;
    });
  }

  // 0 = vanlig sikt (utifrån), 1 = pilotens täta dimma (i cockpiten)
  setFogMix(k) {
    k = Math.max(0, Math.min(1, k));
    if (this._fogK === k) return;
    this._fogK = k;
    const f = this.scene.fog, A = this.fogA, B = this.fogB;
    f.color.copy(A.color).lerp(B.color, k);
    this.scene.background.copy(f.color);
    this._fogBase = f.color.clone();
    // avståndet minskar snabbt i början så att dimman "sluter sig" när man kliver in
    const e = 1 - Math.pow(1 - k, 2);
    f.near = A.near + (B.near - A.near) * e;
    f.far = A.far + (B.far - A.far) * e;
  }

  setStarCollected(idx, collected = true) {
    const m = this.starMeshes[idx];
    if (m) m.visible = !collected;
  }

  resetStars() { this.starMeshes.forEach((m) => { m.visible = true; }); }

  // cam: kamerans position (för regnet); ft: flygtiden (för de fallande stenarna)
  animate(dt, cam = null, ft = null) {
    this.time += dt;
    if (ft !== null && ft !== undefined) this.setMoverTime(ft);
    this._updateRain(dt, cam);
    this._updateLightning(dt);
    if (this._bursts) for (const b of this._bursts) {
      if (!b.visible) continue;
      const u = b.userData; u.t += dt;
      if (u.t < 0) { b.material.opacity = 0; continue; }
      const k = u.t / u.life;
      if (k >= 1) { b.visible = false; continue; }
      b.scale.setScalar(u.r * (1 + k * 2.2));
      b.material.opacity = Math.pow(1 - k, 1.5);
    }
    this.gateMeshes.forEach((m) => {
      const f = m.userData.flash;
      if (!f) return;
      m.userData.flash = Math.max(0, f - dt * 2.5);
      m.scale.setScalar(1 + 0.25 * m.userData.flash);
      m.material.emissive.setHex(m.userData.flashCol);
      m.material.emissiveIntensity = 1.5 * m.userData.flash;
      if (!m.userData.flash) { m.scale.setScalar(1); this._shownGate = -1; }   // tillbaka till vanlig färg
    });
    this.starMeshes.forEach((m, i) => {
      m.rotation.y = this.time * 2 + i;
      m.children[0].position.y = Math.sin(this.time * 2.5 + i) * 0.4;
    });
  }

  // pts: [[x,z],...]. Höjden tas från närmaste port.
  setRoute(pts) {
    if (this.routeMesh) { this.scene.remove(this.routeMesh); this.routeMesh.dispose(); this.routeMesh = null; }
    if (!pts || pts.length < 2) return;
    const gates = this.level.gates;
    const h = (x, z) => {
      let best = gates[0], bd = Infinity;
      for (const g of gates) { const d = (g.x - x) ** 2 + (g.z - z) ** 2; if (d < bd) { bd = d; best = g; } }
      return best.y;
    };
    const dots = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const ay = h(ax, az), by = h(bx, bz);
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(len / 6));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        dots.push([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t]);
      }
    }
    const last = pts[pts.length - 1];
    dots.push([last[0], h(last[0], last[1]), last[1]]);
    const inst = new THREE.InstancedMesh(this.routeGeo, this.routeMat, dots.length);
    const m = new THREE.Matrix4();
    dots.forEach((d, i) => { m.makeTranslation(d[0], d[1], d[2]); inst.setMatrixAt(i, m); });
    this.routeMesh = inst;
    this.scene.add(inst);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); });
    });
  }
}
