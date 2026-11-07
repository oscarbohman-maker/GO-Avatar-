// Renderar en miniatyrbild per karta: en kamera snett ovanför och bakom planet vid första porten,
// som tittar längs banan. Samma värld (World3D) och samma plan (PlaneRig) som i spelet.
import * as THREE from '../js/lib/three.module.min.js';
import { MAPS, buildLevel } from '../js/levels.js';
import { World3D } from '../js/world3d.js';
import { PlaneRig } from '../js/rig.js';

const W = 640, H = 360;
const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

export function renderThumb(id) {
  const level = buildLevel(id);
  const world = new World3D(level);
  const P = level.path;
  // välj sträckan med banans första hinder (så att bilden visar vad kartan handlar om)
  let k = 0;
  const z0 = id.startsWith('m') && level.zones && level.zones[0];
  if (z0) {
    let best = Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const d = Math.hypot((P[i][0] + P[i + 1][0]) / 2 - z0.x, (P[i][2] + P[i + 1][2]) / 2 - z0.z);
      if (d < best) { best = d; k = i; }
    }
  }
  const a = P[k], b = P[k + 1];
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  const fx = dx / len, fz = dz / len;
  const t0 = Math.min(0.4, 50 / len);
  // planet ligger på den fria sidan om sträckan har ett hinder
  const obst = [...level.rocks, ...(level.movers || [])].find((o) => o.lane && o.lane.seg === k);
  const side = obst ? -Math.sign(obst.lane.lat) * (level.halfs ? level.halfs[k] * 0.42 : 6) : 0;
  const rx = -fz, rz = fx;                          // åt höger
  const pp = { x: a[0] + dx * t0 + rx * side, y: a[1] + (b[1] - a[1]) * t0, z: a[2] + dz * t0 + rz * side };
  const yaw = Math.atan2(-fx, -fz);
  const rig = new PlaneRig('pilot');
  rig.setView('outside');
  rig.update(0.016, { x: pp.x, y: pp.y, z: pp.z, yaw, pitch: 0.02, roll: side ? Math.sign(side) * -0.25 : -0.12, speed: 40, phase: 'fly' }, {});
  world.scene.add(rig.root);
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.5, 900);
  const cs = side ? Math.sign(side) * 4 : -5;          // kameran lite åt samma sida som planet
  cam.position.set(pp.x - fx * 30 + rx * cs, pp.y + 13, pp.z - fz * 30 + rz * cs);
  const look = z0 ? { x: z0.x, z: z0.z } : { x: b[0], z: b[2] };
  const ax = a[0] + dx * Math.min(1, t0 + 0.5), az = a[2] + dz * Math.min(1, t0 + 0.5);
  cam.lookAt(z0 ? look.x * 0.5 + ax * 0.5 : ax, pp.y - 4, z0 ? look.z * 0.5 + az * 0.5 : az);
  // ringar och stjärnor precis vid kameran skymmer bilden
  const near = (o) => o.position.distanceTo(cam.position) < 45;
  world.gateMeshes.forEach((g) => { if (near(g)) g.visible = false; });
  world.starMeshes.forEach((g) => { if (near(g)) g.visible = false; });
  // längre sikt än i spelet, så att miljön syns
  world.setFogMix(0);
  world.scene.fog.near = 60; world.scene.fog.far = 420;
  for (let i = 0; i < 40; i++) world.animate(1 / 30, cam.position, 0.7 + i / 30);
  world.scene.fog.near = 60; world.scene.fog.far = 420;
  renderer.render(world.scene, cam);
  const url = canvas.toDataURL('image/jpeg', 0.84);
  rig.dispose();
  world.dispose();
  return url;
}

window.renderThumb = renderThumb;
window.thumbIds = MAPS.filter((m) => m.available).map((m) => m.id);
const grid = document.getElementById('grid');
for (const m of MAPS.filter((x) => x.available)) {
  const f = document.createElement('figure');
  f.innerHTML = `<img alt=""><figcaption>${m.n}. ${m.name}</figcaption>`;
  f.querySelector('img').src = renderThumb(m.id);
  grid.appendChild(f);
}
window.thumbsReady = true;
