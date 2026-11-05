// Banans 3D-värld: mark, träd, klippor, väggar, portar och navigatörens rutt.
import * as THREE from './lib/three.module.min.js';

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
  // opts.dark: pilotens mörka nattvy med kort sikt
  constructor(level, opts = {}) {
    this.level = level;
    const L = level;
    const dark = !!opts.dark;
    this.fog = dark ? L.pilotFog : L.fog;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(this.fog.color);
    scene.fog = new THREE.Fog(this.fog.color, this.fog.near, this.fog.far);

    if (dark) {
      // natt: svagt blått månljus
      scene.add(new THREE.HemisphereLight(0x7f97c8, 0x0c140c, 0.45));
      const moon = new THREE.DirectionalLight(0xa9c1ff, 0.45);
      moon.position.set(-30, 80, 20);
      scene.add(moon);
    } else {
      scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2d4a22, 1.7));
      const sun = new THREE.DirectionalLight(0xfff2d6, 2.0);
      sun.position.set(40, 80, 30);
      scene.add(sun);
    }

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

    const boxMats = {
      canyon: new THREE.MeshLambertMaterial({ color: 0x9b6b4a }),
      wall: new THREE.MeshLambertMaterial({ color: 0xa04a3a }),
      tunnel: new THREE.MeshLambertMaterial({ color: 0x5c5f66 }),
      roof: new THREE.MeshLambertMaterial({ color: 0x45484e }),
    };
    for (const b of L.boxes) {
      if (b.kind === 'treewall') continue;   // syns som träd i stället
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

  setStarCollected(idx, collected = true) {
    const m = this.starMeshes[idx];
    if (m) m.visible = !collected;
  }

  resetStars() { this.starMeshes.forEach((m) => { m.visible = true; }); }

  animate(dt) {
    this.time += dt;
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
