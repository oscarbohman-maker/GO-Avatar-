// Shopens 3D-visning: planet i valt skin med alla effekter, som om det flög (spåren dras bakåt).
// Tryck på planet för skinets egen effektsmäll. Ett andra plan (utan effekter) gör små bilder till korten.
import * as THREE from './lib/three.module.min.js';
import { PlaneRig } from './rig.js';
import { makeEnvMap } from './envmap.js';

const STILL = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, phase: 'waiting' };

export class SkinPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x223050, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(6, 9, 7); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc8ff, 1.4); rim.position.set(-8, 4, -6); scene.add(rim);
    // golvskiva med mjuk skugga
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = -2.4; scene.add(disc);
    let env = null;
    try { env = makeEnvMap(this.renderer); } catch (e) { console.warn('envmap', e); }
    // planet som visas (med effekter)
    this.rig = new PlaneRig('pilot', { maxParticles: 600, rate: 1 });
    this.rig.setView('outside');
    this.rig.skinTrail = 14;                   // planet står still: spåren dras bakåt som i flykt
    if (env) this.rig.setEnvMap(env);
    this.rig.update(0.016, STILL, {});
    scene.add(this.rig.root, this.rig.skin.group);
    // planet för kortbilderna (inga partiklar)
    this.thumbRig = new PlaneRig('pilot', { maxParticles: 0, rate: 0 });
    this.thumbRig.setView('outside');
    if (env) this.thumbRig.setEnvMap(env);
    this.thumbRig.root.visible = false;
    scene.add(this.thumbRig.root);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
    this.angle = 0.7;
    this.running = false;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    // tryck på planet: skinets effektsmäll
    this._down = null;
    canvas.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', (e) => {
      if (this._down && Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) < 8) this.rig.skinPulse('klick');
      this._down = null;
    });
  }

  setSkin(id) { this.rig.setSkin(id); }

  _place(a, dist = 33) {
    this.camera.position.set(Math.sin(a) * dist, 8, Math.cos(a) * dist);
    this.camera.lookAt(0, -0.4, 0);
  }

  resize() {
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.angle += dt * 0.3;
      this.rig.update(dt, { x: 0, y: Math.sin(now / 900) * 0.25, z: 0, yaw: 0, pitch: 0, roll: Math.sin(now / 1300) * 0.08, speed: 25, phase: 'fly' }, {});
      this._place(this.angle);
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  // Liten bild av ett skin (data-URL). Påverkar inte planet som visas.
  thumbnail(id, w = 240, h = 150) {
    const size = new THREE.Vector2(); this.renderer.getSize(size);
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.thumbRig.setSkin(id);
    this.thumbRig.update(0.016, STILL, {});
    this.rig.root.visible = false; this.rig.skin.group.visible = false; this.thumbRig.root.visible = true;
    this._place(0.75, 31);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.rig.root.visible = true; this.rig.skin.group.visible = true; this.thumbRig.root.visible = false;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(size.x, size.y, false);
    this.camera.aspect = size.x / Math.max(1, size.y); this.camera.updateProjectionMatrix();
    return url;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resize);
    this.rig.dispose();
    this.thumbRig.dispose();
    this.renderer.dispose();
  }
}
