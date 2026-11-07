// Banans 3D-värld: mark, träd, klippor, väggar, portar, väder och navigatörens rutt.
// Utseendet styrs av kartans tema (skog, öken, djungel, röda klippor, arktis, lava).
import * as THREE from './lib/three.module.min.js';
import { moverY } from './physics.js';
import { THEMES } from './themes.js';

// enkel seedad slump (bara för utseende – påverkar inte banan)
function lcg(seed) { let s = seed % 2147483647 || 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// Markens textur. Skog och kanjon har det gamla rutmönstret, övriga teman fläckar.
// Lavan får dessutom en glödkarta med lysande sprickor.
function groundTexture(T) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = lcg(7);
  g.fillStyle = T.ground[0];
  g.fillRect(0, 0, S, S);
  const wrapDraw = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy); };
  if (T.decor === 'pine') {
    g.fillStyle = T.ground[1];
    g.fillRect(0, 0, S / 2, S / 2);
    g.fillRect(S / 2, S / 2, S / 2, S / 2);
  } else {
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 16 + rnd() * 46;
      wrapDraw((ox, oy) => {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, T.ground[1]); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.globalAlpha = 0.8;
        g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
      });
    }
    g.globalAlpha = 1;
    if (T.decor === 'mesa') {                         // sanddyner: mjuka ränder
      g.strokeStyle = 'rgba(255,240,210,0.25)'; g.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        const y0 = rnd() * S;
        g.beginPath();
        for (let x = -10; x <= S + 10; x += 8) g.lineTo(x, y0 + Math.sin(x / 26 + i) * 8);
        g.stroke();
      }
    }
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rnd() < 0.5 ? T.speck[0] : T.speck[1];
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let glow = null;
  if (T.lavaGlow) {
    const e = document.createElement('canvas');
    e.width = e.height = S;
    const h = e.getContext('2d');
    h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
    h.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28;
      const w = 1.5 + rnd() * 3.5;
      const pts = [[x, y]];
      for (let k = 0; k < 9; k++) { a += (rnd() - 0.5) * 1.3; x += Math.cos(a) * 14; y += Math.sin(a) * 14; pts.push([x, y]); }
      wrapDraw((ox, oy) => {
        for (const [lw, col] of [[w * 3.2, 'rgba(255,60,0,0.35)'], [w, '#ff8a1e'], [w * 0.35, '#ffe08a']]) {
          h.strokeStyle = col; h.lineWidth = lw;
          h.beginPath(); pts.forEach(([px, py], k) => (k ? h.lineTo(px + ox, py + oy) : h.moveTo(px + ox, py + oy))); h.stroke();
        }
      });
    }
    glow = new THREE.CanvasTexture(e);
    glow.wrapS = glow.wrapT = THREE.RepeatWrapping;
    glow.colorSpace = THREE.SRGBColorSpace;
  }
  return { tex, glow };
}

// Klippspira med svaga lager (vertexfärger) som gör att klipporna ser skiktade ut
function spireGeometry(snowCap) {
  const g = new THREE.CylinderGeometry(0.45, 1, 1, 6, 6); g.translate(0, 0.5, 0);
  const pa = g.attributes.position;
  const cols = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    if (y > 0.01 && y < 0.99) { pa.setX(i, pa.getX(i) * (0.85 + 0.3 * Math.abs(Math.sin(i * 7.3)))); pa.setZ(i, pa.getZ(i) * (0.85 + 0.3 * Math.abs(Math.cos(i * 3.1)))); }
    let k = 0.82 + 0.18 * (Math.round(y * 6) % 2) + 0.1 * y;   // ljusa och mörka band
    if (snowCap && y > 0.8) k = 1.35;
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = Math.min(1.35, k);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// Rund mjuk prick (för snö och glöd)
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const GATE_COLORS = { next: 0xffd23f, upcoming: 0xff8c42, passed: 0x3ddc84, finish: 0xffffff };

export class World3D {
  constructor(level) {
    this.level = level;
    const L = level;
    const T = THEMES[L.theme] || THEMES.forest;
    this.theme = T;
    const W = L.weather || {};
    this.weather = W;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.fogA = { color: new THREE.Color(L.fog.color), near: L.fog.near, far: L.fog.far };
    const pf = L.pilotFog || L.fog;
    this.fogB = { color: new THREE.Color(pf.color), near: pf.near, far: pf.far };
    scene.background = this.fogA.color.clone();
    scene.fog = new THREE.Fog(this.fogA.color.clone(), this.fogA.near, this.fogA.far);
    this.maxFar = Math.max(this.fogA.far, this.fogB.far);

    // ljus efter tema; mörkare när det regnar eller stormar
    const dim = W.particles === 'rain' ? 0.72 : W.id === 'sandstorm' || W.id === 'blizzard' ? 0.85 : 1;
    const sunDim = W.particles === 'rain' ? 0.45 : W.id === 'sandstorm' || W.id === 'blizzard' ? 0.6 : 1;
    this.hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2] * dim);
    this.hemiBase = this.hemi.intensity;
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(T.sun[0], T.sun[1] * sunDim);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    // mark
    const B = L.bounds;
    const size = 4200;
    const { tex, glow } = groundTexture(T);
    tex.repeat.set(size / (T.decor === 'pine' ? 20 : 40), size / (T.decor === 'pine' ? 20 : 40));
    const gmat = new THREE.MeshLambertMaterial({ map: tex });
    if (glow) {
      glow.repeat.copy(tex.repeat);
      gmat.emissive = new THREE.Color(0xffffff);
      gmat.emissiveMap = glow;
      this.lavaMat = gmat;
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), gmat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((B.minX + B.maxX) / 2, 0, (B.minZ + B.maxZ) / 2);
    scene.add(ground);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);
    const hash = (x, z) => ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;

    // träd: granar (skog) eller lövträd med tät krona (djungel)
    const allTrees = L.trees.concat(L.decor || []);
    if (allTrees.length) {
      const n = allTrees.length;
      const jungle = T.decor === 'jungle';
      const trunkGeo = new THREE.CylinderGeometry(jungle ? 0.5 : 0.7, 1, 1, 7); trunkGeo.translate(0, 0.5, 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: jungle ? 0x4a3524 : 0x5a3c22, flatShading: true }), n);
      // pinjer: våningar [bas (andel av kronan), höjd (andel), radie (andel)]; djungel: tre bollar [x, y, z, r]
      const tiers = jungle
        ? [[0, 0.62, 0, 1], [0.55, 0.42, 0.25, 0.75], [-0.5, 0.5, -0.3, 0.7]]
        : [[0, 0.5, 1], [0.28, 0.45, 0.78], [0.55, 0.45, 0.55]];
      const tierMeshes = tiers.map((_, k) => {
        const g = jungle ? new THREE.IcosahedronGeometry(1, 1) : new THREE.ConeGeometry(1, 1, 9 - k, 1);
        if (!jungle) g.translate(0, 0.5, 0);
        return new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
      });
      allTrees.forEach((t, i) => {
        const v = hash(t.x, t.z);
        const rot = q.setFromAxisAngle(UP, v * 6.28);
        if (jungle) {
          const th = t.h * (0.55 + v * 0.15);            // hög, smal stam
          m.compose(pos.set(t.x, 0, t.z), rot, scl.set(t.trunkR * 0.9, th, t.trunkR * 0.9));
          trunks.setMatrixAt(i, m);
          const R = t.baseR * 1.35;
          tiers.forEach(([ox, oy, oz, r], k) => {
            const lx = ox * R * Math.cos(v * 6.28) - oz * R * Math.sin(v * 6.28), lz = ox * R * Math.sin(v * 6.28) + oz * R * Math.cos(v * 6.28);
            m.compose(pos.set(t.x + lx, th + oy * R, t.z + lz), rot, scl.set(R * r, R * r * 0.75, R * r));
            tierMeshes[k].setMatrixAt(i, m);
            tierMeshes[k].setColorAt(i, col.setHSL(0.27 + v * 0.08, 0.55 + v * 0.15, 0.13 + v * 0.07 + k * 0.03));
          });
        } else {
          m.compose(pos.set(t.x, 0, t.z), rot, scl.set(t.trunkR, t.trunkH + 1.5, t.trunkR));
          trunks.setMatrixAt(i, m);
          const ch = t.h - t.trunkH;
          tiers.forEach(([b, h, r], k) => {
            m.compose(pos.set(t.x, t.trunkH + b * ch, t.z), rot, scl.set(t.baseR * r, ch * h, t.baseR * r));
            tierMeshes[k].setMatrixAt(i, m);
            tierMeshes[k].setColorAt(i, col.setHSL(0.28 + v * 0.07, 0.5 + v * 0.1, 0.17 + v * 0.07 + k * 0.035));
          });
        }
      });
      scene.add(trunks, ...tierMeshes);
    }
    q.identity();

    // klippväggar: tätt packade klippspiror i temats färg (krocken räknas mot den osynliga väggen bakom)
    const glowCol = new THREE.Color(T.glow || 0x000000);
    const dr = L.decorRocks || [];
    if (dr.length) {
      const sp = T.spire || [0.07, 0.15, 0.4, 0.1];
      const spires = new THREE.InstancedMesh(spireGeometry(T.decor === 'ice'),
        new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true, emissive: glowCol }), dr.length);
      dr.forEach((o, i) => {
        const v = hash(o.x, o.z);
        q.setFromAxisAngle(UP, v * 6.28);
        m.compose(pos.set(o.x, 0, o.z), q, scl.set(o.r, o.h, o.r));
        spires.setMatrixAt(i, m);
        spires.setColorAt(i, col.setHSL(sp[0] + (v - 0.5) * sp[3] * 0.4, sp[1], sp[2] + (v - 0.5) * sp[3]));
      });
      q.identity();
      scene.add(spires);
    }

    // pelare (hinder) i temats sten
    if (L.rocks.length) {
      const rockGeo = new THREE.CylinderGeometry(1, 1.15, 1, 7); rockGeo.translate(0, 0.5, 0);
      const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: T.pillar, flatShading: true, emissive: glowCol }), L.rocks.length);
      L.rocks.forEach((o, i) => { m.compose(pos.set(o.x, 0, o.z), q, scl.set(o.r, o.h, o.r)); rocks.setMatrixAt(i, m); });
      scene.add(rocks);
    }

    // dekor på korridorens botten (syns men krockar inte – allt är lägre än lägsta flyghöjd)
    this._floorDecor(T, m, q, pos, scl, col);

    // fallande stenblock: flyttas varje bildruta efter flygtiden (samma tid som simuleringen)
    this.movers = L.movers || [];
    if (this.movers.length) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      const mm = new THREE.MeshLambertMaterial({ color: T.mover, flatShading: true });
      if (T.moverGlow) { mm.emissive = new THREE.Color(T.moverGlow); mm.emissiveIntensity = 0.9; }   // glödande lavabomber
      this.moverMesh = new THREE.InstancedMesh(g, mm, this.movers.length);
      this.moverMesh.frustumCulled = false;
      scene.add(this.moverMesh);
      // mörk skugga på marken där stenen landar
      const sg = new THREE.CircleGeometry(1, 20); sg.rotateX(-Math.PI / 2);
      this.moverShadow = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: T.moverGlow ? 0xff4a10 : 0x000000, transparent: true, opacity: T.moverGlow ? 0.5 : 0.35, depthWrite: false }), this.movers.length);
      this.moverShadow.frustumCulled = false;
      scene.add(this.moverShadow);
      this.setMoverTime(0);
    }

    const boxMats = {
      canyon: new THREE.MeshLambertMaterial({ color: 0x9b6b4a }),
      wall: new THREE.MeshLambertMaterial({ color: T.wall, flatShading: true }),
      tunnel: new THREE.MeshLambertMaterial({ color: 0x5c5f66 }),
      roof: new THREE.MeshLambertMaterial({ color: T.roof }),
      rockwall: new THREE.MeshLambertMaterial({ color: T.wall, flatShading: true, emissive: glowCol }),
      rockroof: new THREE.MeshLambertMaterial({ color: T.roof, flatShading: true, emissive: glowCol }),
    };
    if (L.theme === 'canyon' || !L.theme) boxMats.wall.color.setHex(0xa04a3a);
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

    // väder: partiklar som följer kameran och blixtar
    if (W.particles) this._makeParticles();
    this.flash = 0;
    this.nextFlash = 4 + Math.random() * 6;
  }

  // Dekor på korridorens botten, efter tema: kaktusar, lavapölar, buskar, snödrivor eller stenblock.
  _floorDecor(T, m, q, pos, scl, col) {
    const L = this.level, P = L.path, H = L.halfs;
    if (!P || !H || T.decor === 'pine') return;
    const rnd = lcg(4242 + P.length * 31);
    const spots = [];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
      const rx = -dz / len, rz = dx / len;
      for (let s = 8; s < len - 4; s += 9 + rnd() * 10) {
        const lat = (rnd() * 2 - 1) * (H[i] - 3);
        spots.push({ x: a[0] + dx * (s / len) + rx * lat, z: a[2] + dz * (s / len) + rz * lat, v: rnd(), w: rnd() });
      }
    }
    if (!spots.length) return;
    const add = (geo, mat, list, place) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((sp, i) => { place(sp); im.setMatrixAt(i, m); });
      this.scene.add(im);
      return im;
    };
    const UP = new THREE.Vector3(0, 1, 0);
    const rot = (sp) => q.setFromAxisAngle(UP, sp.v * 6.28);
    if (T.decor === 'mesa') {
      // saguarokaktusar: stam + två armar + en tvärgående "armbåge"
      const cacti = spots.filter((sp) => sp.w < 0.45);
      const cm = new THREE.MeshLambertMaterial({ color: 0x4f7d3a, flatShading: true });
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 7); cyl.translate(0, 0.5, 0);
      const hz = new THREE.CylinderGeometry(1, 1, 1, 6); hz.rotateZ(Math.PI / 2);
      const hgt = (sp) => 5 + sp.v * 4;
      add(cyl, cm, cacti, (sp) => m.compose(pos.set(sp.x, 0, sp.z), rot(sp), scl.set(0.6, hgt(sp), 0.6)));
      add(hz, cm, cacti, (sp) => m.compose(pos.set(sp.x, hgt(sp) * 0.42, sp.z), rot(sp), scl.set(2.4, 0.38, 0.38)));
      for (const side of [-1, 1]) {
        add(cyl, cm, cacti, (sp) => {
          const a = sp.v * 6.28, o = 1.2 * side;
          return m.compose(pos.set(sp.x + Math.cos(a) * o, hgt(sp) * 0.42, sp.z - Math.sin(a) * o), rot(sp), scl.set(0.4, hgt(sp) * (0.32 + 0.12 * side * (sp.w - 0.2)), 0.4));
        });
      }
      // små sandstensblock
      const stones = spots.filter((sp) => sp.w >= 0.75);
      add(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: T.pillar, flatShading: true }), stones,
        (sp) => m.compose(pos.set(sp.x, 0.3, sp.z), rot(sp), scl.set(1.2 + sp.v * 1.6, 0.8 + sp.v, 1.2 + sp.v * 1.4)));
    } else if (T.decor === 'basalt') {
      // glödande lavapölar och svarta basaltblock
      const pools = spots.filter((sp) => sp.w < 0.5);
      const disc = new THREE.CircleGeometry(1, 18); disc.rotateX(-Math.PI / 2);
      add(disc, new THREE.MeshBasicMaterial({ color: 0x5a1a08 }), pools, (sp) => m.compose(pos.set(sp.x, 0.05, sp.z), rot(sp), scl.set(4 + sp.v * 5, 1, 2.6 + sp.v * 3)));
      this.lavaPools = add(disc, new THREE.MeshBasicMaterial({ color: 0xff6a1a }), pools, (sp) => m.compose(pos.set(sp.x, 0.09, sp.z), rot(sp), scl.set(3 + sp.v * 4, 1, 1.8 + sp.v * 2.4)));
      const stones = spots.filter((sp) => sp.w >= 0.65);
      add(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x1e1816, flatShading: true }), stones,
        (sp) => m.compose(pos.set(sp.x, 0.3, sp.z), rot(sp), scl.set(1.4 + sp.v * 2, 1 + sp.v * 1.5, 1.2 + sp.v * 1.8)));
    } else if (T.decor === 'jungle') {
      // buskar och stora blad
      const bushes = spots.filter((sp) => sp.w < 0.8);
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      const im = add(new THREE.IcosahedronGeometry(1, 0), mat, bushes, (sp) => m.compose(pos.set(sp.x, 0.6, sp.z), rot(sp), scl.set(2 + sp.v * 2.5, 1.2 + sp.v * 1.6, 2 + sp.v * 2)));
      if (im) { bushes.forEach((sp, i) => im.setColorAt(i, col.setHSL(0.28 + sp.v * 0.08, 0.6, 0.16 + sp.w * 0.1))); }
    } else if (T.decor === 'ice') {
      // snödrivor och isblock
      const drifts = spots.filter((sp) => sp.w < 0.55);
      add(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf4f8fc }), drifts,
        (sp) => m.compose(pos.set(sp.x, 0, sp.z), rot(sp), scl.set(4 + sp.v * 5, 1 + sp.v * 1.4, 2.5 + sp.v * 3)));
      const ice = spots.filter((sp) => sp.w >= 0.8);
      add(new THREE.OctahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xa8d8f0, flatShading: true }), ice,
        (sp) => m.compose(pos.set(sp.x, 0.8, sp.z), rot(sp), scl.set(1.2 + sp.v, 2 + sp.v * 2, 1.2 + sp.v)));
    } else if (T.decor === 'spire') {
      // röda stenblock
      const stones = spots.filter((sp) => sp.w < 0.5);
      add(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x8e4a30, flatShading: true }), stones,
        (sp) => m.compose(pos.set(sp.x, 0.4, sp.z), rot(sp), scl.set(1.4 + sp.v * 2.4, 1 + sp.v * 2, 1.3 + sp.v * 2)));
    }
    q.identity();
  }

  // Väderpartiklar som följer kameran: regn och sand (streck), snö och glöd (prickar)
  _makeParticles() {
    const kind = this.weather.particles;
    const dense = this.weather.id === 'storm' || this.weather.id === 'sandstorm' || this.weather.id === 'blizzard' || this.weather.id === 'eruption';
    const N = kind === 'rain' ? 700 : kind === 'sand' ? (dense ? 900 : 500) : kind === 'snow' ? (dense ? 1100 : 650) : 260;
    const box = { w: kind === 'embers' ? 110 : 70, h: kind === 'embers' ? 60 : 46 };
    const D = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      D[i * 3] = (Math.random() - 0.5) * box.w;
      D[i * 3 + 1] = Math.random() * box.h;
      D[i * 3 + 2] = (Math.random() - 0.5) * box.w;
    }
    const lines = kind === 'rain' || kind === 'sand';
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * (lines ? 6 : 3)), 3));
    let obj;
    if (lines) {
      obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: kind === 'rain' ? 0xc9d6e6 : 0xe6cf9c, transparent: true, opacity: kind === 'rain' ? 0.55 : 0.5, depthWrite: false,
      }));
    } else {
      obj = new THREE.Points(g, new THREE.PointsMaterial({
        map: dotTexture(), color: kind === 'snow' ? 0xffffff : 0xff8a2a, size: kind === 'snow' ? 0.45 : 0.6,
        transparent: true, opacity: kind === 'snow' ? 0.9 : 1, depthWrite: false, sizeAttenuation: true,
        blending: kind === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
    }
    obj.frustumCulled = false;
    this.scene.add(obj);
    this.pt = { kind, N, box, D, obj, lines };
  }

  _updateParticles(dt, cam) {
    const pt = this.pt;
    if (!pt || !cam) return;
    const { N, D, box, kind, lines } = pt;
    const W = box.w, H = box.h;
    const wind = this.weather.wind || { dir: 0, strength: 0 };
    const k = kind === 'sand' ? 9 : kind === 'snow' ? 3 : kind === 'embers' ? 1.6 : 2.2;   // hur mycket vinden bär partiklarna
    const wx = Math.cos(wind.dir) * wind.strength * k, wz = Math.sin(wind.dir) * wind.strength * k;
    const vy = kind === 'rain' ? -38 : kind === 'sand' ? -2 : kind === 'snow' ? -4 : 3.2;
    const len = kind === 'rain' ? 0.05 : 0.06;          // streckets längd i sekunder
    const P = pt.obj.geometry.attributes.position.array;
    const ox = cam.x - W / 2, oz = cam.z - W / 2, oy = cam.y - H / 2;
    const t = this.time;
    for (let i = 0; i < N; i++) {
      let x = D[i * 3] + wx * dt, y = D[i * 3 + 1] + vy * dt, z = D[i * 3 + 2] + wz * dt;
      if (kind === 'snow') { x += Math.sin(t * 1.3 + i) * 0.6 * dt; z += Math.cos(t * 1.1 + i * 0.7) * 0.6 * dt; }
      if (kind === 'embers') { x += Math.sin(t * 2 + i) * 1.2 * dt; }
      if (y < 0) y += H; else if (y > H) y -= H;
      D[i * 3] = x; D[i * 3 + 1] = y; D[i * 3 + 2] = z;
      // partiklarna ligger i en låda som följer kameran (lindas runt)
      const px = ox + ((((x - ox) % W) + W) % W), pz = oz + ((((z - oz) % W) + W) % W), py = oy + y;
      // inget väder inne i kabinen runt kameran
      const ex = px - cam.x, ey = py - cam.y, ez = pz - cam.z;
      const inside = ex * ex + ez * ez < 36 && ey > -5 && ey < 6;
      if (lines) {
        if (inside) { P.fill(0, i * 6, i * 6 + 6); continue; }
        P[i * 6] = px; P[i * 6 + 1] = py; P[i * 6 + 2] = pz;
        P[i * 6 + 3] = px - wx * len; P[i * 6 + 4] = py - vy * len; P[i * 6 + 5] = pz - wz * len;
      } else {
        P[i * 3] = inside ? 0 : px; P[i * 3 + 1] = inside ? -50 : py; P[i * 3 + 2] = inside ? 0 : pz;
      }
    }
    pt.obj.geometry.attributes.position.needsUpdate = true;
    if (kind === 'embers') pt.obj.material.opacity = 0.75 + 0.25 * Math.sin(t * 9);
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
    this._updateParticles(dt, cam);
    this._updateLightning(dt);
    if (this.lavaMat) this.lavaMat.emissiveIntensity = 0.85 + 0.15 * Math.sin(this.time * 1.7);   // lavan pulserar
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
