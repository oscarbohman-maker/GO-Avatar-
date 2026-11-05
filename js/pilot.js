// Pilotens vy: förstapersons 3D med begränsad sikt (dimma/skugga längre fram).
import * as THREE from './lib/three.module.min.js';
import { FlightSession, STEP } from './sim.js';
import { Input } from './input.js';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#4f7d3a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#5a8a42';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  // lite brus så att man ser farten
  for (let i = 0; i < 400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(30,60,20,0.25)' : 'rgba(140,180,90,0.18)';
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const GATE_COLORS = {
  next: 0xffd23f,
  upcoming: 0xff8c42,
  passed: 0x3ddc84,
  finish: 0xffffff,
};

export class PilotView {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.opts = opts;
    this.onEvent = opts.onEvent || (() => {});
    this.onFrame = opts.onFrame || (() => {});
    this.session = new FlightSession(level, (e) => this.onEvent(e));
    this.input = new Input(container, { invertY: opts.invertY });
    this.acc = 0;
    this.running = false;
    this._build();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  _build() {
    const L = this.level;
    const canvas = document.createElement('canvas');
    canvas.className = 'view3d';
    this.container.querySelector('.view3d-holder').appendChild(canvas);
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);

    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(L.fog.color);
    scene.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, L.fog.far + 5);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);

    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2d4a22, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.8);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    // Mark
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshLambertMaterial({ map: groundTexture() })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(45, 0, -220);
    scene.add(ground);

    // Träd (instansierade för prestanda på mobil)
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 1, 6); trunkGeo.translate(0, 0.5, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7); coneGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4a2b }), L.trees.length);
    const crowns = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), L.trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();
    L.trees.forEach((t, i) => {
      m.compose(pos.set(t.x, 0, t.z), q, scl.set(1, t.trunkH + 0.5, 1));
      trunks.setMatrixAt(i, m);
      m.compose(pos.set(t.x, t.trunkH, t.z), q, scl.set(t.baseR, t.h - t.trunkH, t.baseR));
      crowns.setMatrixAt(i, m);
      const v = ((Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1 + 1) % 1;
      crowns.setColorAt(i, col.setHSL(0.27 + v * 0.08, 0.55, 0.22 + v * 0.1));
    });
    scene.add(trunks, crowns);

    // Klippor/pelare
    if (L.rocks.length) {
      const rockGeo = new THREE.CylinderGeometry(1, 1.15, 1, 7); rockGeo.translate(0, 0.5, 0);
      const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x8a7f72 }), L.rocks.length);
      L.rocks.forEach((o, i) => {
        m.compose(pos.set(o.x, 0, o.z), q, scl.set(o.r, o.h, o.r));
        rocks.setMatrixAt(i, m);
      });
      scene.add(rocks);
    }

    // Väggar, kanjon, tunnel
    const boxMats = {
      canyon: new THREE.MeshLambertMaterial({ color: 0x9b6b4a }),
      wall: new THREE.MeshLambertMaterial({ color: 0xa04a3a }),
      tunnel: new THREE.MeshLambertMaterial({ color: 0x5c5f66 }),
      roof: new THREE.MeshLambertMaterial({ color: 0x45484e }),
    };
    for (const b of L.boxes) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), boxMats[b.kind] || boxMats.wall);
      mesh.position.set(b.x, b.y, b.z);
      mesh.rotation.y = b.yaw;
      scene.add(mesh);
    }

    // Portar
    this.gateMeshes = L.gates.map((g) => {
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 });
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(g.r, g.tube, 8, 40), mat);
      mesh.position.set(g.x, g.y, g.z);
      mesh.rotation.y = g.yaw;
      scene.add(mesh);
      return mesh;
    });
    this._shownGate = -1;
    this._updateGates();

    // Nos och propeller framför kameran (förstaperson)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 12), new THREE.MeshLambertMaterial({ color: 0xd8432f }));
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.66, -1.3);
    const prop = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, fog: false, depthWrite: false })
    );
    prop.position.set(0, -0.66, -1.78);
    this.camera.add(nose, prop);
  }

  _updateGates() {
    const ng = this.session.nextGate;
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

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  frame(dt) {
    const inp = this.input.read(dt);
    this.lastInput = inp;
    const S = this.session;
    if (this.autopilot && S.phase === 'fly') Object.assign(inp, this.autopilot(S));
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 8) { S.step(inp, STEP); this.acc -= STEP; n++; }
    if (n === 8) this.acc = 0;
    this._updateGates();

    const p = S.plane;
    this.camera.position.set(p.x, p.y, p.z);
    let shake = 0;
    if (S.phase === 'crashed') shake = 0.25 * Math.max(0, S.phaseTimer);
    this.camera.rotation.set(p.pitch + (Math.random() - 0.5) * shake * 0.2, p.yaw + (Math.random() - 0.5) * shake * 0.2, p.roll);
    this.renderer.render(this.scene, this.camera);
    this.onFrame(S, dt);
  }

  begin() { this.session.begin(); }
  restart() { this.session.reset(); this._shownGate = -1; this._updateGates(); }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    this.input.destroy();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); });
      }
    });
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (_) {}
    this.canvas.remove();
  }
}
