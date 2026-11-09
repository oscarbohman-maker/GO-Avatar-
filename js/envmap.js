// Enkel omgivning för reflexer (himmel, horisont, mark och en ljus sol) så att metall,
// krom och blank lack på planets skins ser ut som i designen. Görs en gång per renderare.
import * as THREE from './lib/three.module.min.js';

export function makeEnvMap(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const sky = new THREE.Color(0x9cc4ff), horizon = new THREE.Color(0xf2f4f8), ground = new THREE.Color(0x3a3d44), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.copy(horizon).lerp(sky, Math.pow(y, 0.6)); else c.copy(horizon).lerp(ground, Math.min(1, -y * 3));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5) }));
  sun.position.set(4, 7, 5);
  scene.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}
