// Shopens 3D-visning: planet roterar långsamt i valt skin. Samma renderare gör också
// små bilder av varje skin till korten i listan.
import * as THREE from './lib/three.module.min.js';
import { PlaneRig } from './rig.js';

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
    const disc = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = -2.2; scene.add(disc);
    this.rig = new PlaneRig('pilot');
    this.rig.setView('outside');
    this.rig.update(0.016, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, phase: 'waiting' }, {});
    scene.add(this.rig.root);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
    this.angle = 0.7;
    this.running = false;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
  }

  setSkin(id) { this.rig.setSkin(id); }

  _place(a, dist = 30) {
    this.camera.position.set(Math.sin(a) * dist, 7.5, Math.cos(a) * dist);
    this.camera.lookAt(0, -0.6, 0);
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
      this.angle += dt * 0.35;
      this.rig.update(dt, { x: 0, y: Math.sin(now / 900) * 0.25, z: 0, yaw: 0, pitch: 0, roll: Math.sin(now / 1300) * 0.08, speed: 25, phase: 'fly' }, {});
      this._place(this.angle);
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  // Liten bild av ett skin (data-URL). Ändrar inte vad förhandsvisningen visar.
  thumbnail(id, w = 240, h = 150) {
    const prevSkin = this.rig.skinId;
    const size = new THREE.Vector2(); this.renderer.getSize(size);
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.rig.setSkin(id);
    this.rig.update(0.016, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, phase: 'waiting' }, {});
    this._place(0.75, 27);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(size.x, size.y, false);
    this.camera.aspect = size.x / Math.max(1, size.y); this.camera.updateProjectionMatrix();
    this.rig.setSkin(prevSkin);
    return url;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resize);
    this.rig.dispose();
    this.renderer.dispose();
  }
}
