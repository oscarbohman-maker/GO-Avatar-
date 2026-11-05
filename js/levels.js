// Världar och banor. Banorna byggs deterministiskt (seedad slump) så att
// piloten och navigatören får exakt samma bana utan att skicka geometrin.

import { yawFromDir, buildGrid } from './physics.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WORLDS = [
  { id: 'test', name: 'Testvärlden', difficulty: 'Övning', levels: ['test'], available: true },
  { id: 'skog', name: 'Skogsdalen', difficulty: 'Lätt', levels: ['demo'], available: true },
  { id: 'berg', name: 'Bergspasset', difficulty: 'Medel', levels: [], available: false },
  { id: 'stad', name: 'Neonstaden', difficulty: 'Svår', levels: [], available: false },
  { id: 'grotta', name: 'Kristallgrottan', difficulty: 'Expert', levels: [], available: false },
];

export const LEVEL_INFO = {
  test: { id: 'test', name: 'Kanjonslingan', world: 'test', difficulty: 'Övning' },
  demo: { id: 'demo', name: 'Demo: Övningsflygningen', world: 'skog', difficulty: 'Lätt' },
};

function distToSegment2(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const L = vx * vx + vz * vz;
  let t = L > 0 ? (wx * vx + wz * vz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

function distToPath(path, x, z) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distToSegment2(x, z, path[i][0], path[i][2], path[i + 1][0], path[i + 1][2]);
    if (d < best) best = d;
  }
  return best;
}

// Är (x,z) inuti en lådas fotavtryck (med marginal)?
function insideBoxFootprint(b, x, z, margin) {
  const dx = x - b.x, dz = z - b.z;
  const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  return Math.abs(lx) < b.hx + margin && Math.abs(lz) < b.hz + margin;
}

// En rak "korridor" (kanjon eller tunnel) längs Z-axeln.
function corridor(boxes, cx, z0, z1, halfWidth, wallH, roofY, kind) {
  const len = Math.abs(z1 - z0);
  const cz = (z0 + z1) / 2;
  const t = 1.5; // halv väggtjocklek
  boxes.push({ x: cx - halfWidth - t, y: wallH / 2, z: cz, hx: t, hy: wallH / 2, hz: len / 2, yaw: 0, kind });
  boxes.push({ x: cx + halfWidth + t, y: wallH / 2, z: cz, hx: t, hy: wallH / 2, hz: len / 2, yaw: 0, kind });
  if (roofY != null) {
    boxes.push({ x: cx, y: roofY + 1, z: cz, hx: halfWidth + 2 * t, hy: 1, hz: len / 2, yaw: 0, kind: 'roof' });
  }
}

// Vägg (vinkelrät mot Z) med ett fyrkantigt hål.
function windowWall(boxes, cx, cz, width, height, holeY, holeHalf) {
  const t = 1; // halv tjocklek
  const sideW = (width / 2 - holeHalf) / 2;
  boxes.push({ x: cx - holeHalf - sideW, y: height / 2, z: cz, hx: sideW, hy: height / 2, hz: t, yaw: 0, kind: 'wall' });
  boxes.push({ x: cx + holeHalf + sideW, y: height / 2, z: cz, hx: sideW, hy: height / 2, hz: t, yaw: 0, kind: 'wall' });
  const below = holeY - holeHalf;
  boxes.push({ x: cx, y: below / 2, z: cz, hx: holeHalf, hy: below / 2, hz: t, yaw: 0, kind: 'wall' });
  const above = height - (holeY + holeHalf);
  boxes.push({ x: cx, y: holeY + holeHalf + above / 2, z: cz, hx: holeHalf, hy: above / 2, hz: t, yaw: 0, kind: 'wall' });
}

// Banorna ritas i en grundskala och förstoras sedan så att flygplanet
// (13 m vingbredd) får plats i portar och passager.
export const WORLD_SCALE = 2;

function scaleLevel(L, S) {
  const k = (o, keys) => keys.forEach((key) => { if (o[key] != null) o[key] *= S; });
  k(L.start, ['x', 'y', 'z']);
  L.gates.forEach((g) => k(g, ['x', 'y', 'z', 'r', 'tube']));
  L.trees.forEach((t) => k(t, ['x', 'z', 'baseR', 'h', 'trunkH', 'trunkR']));
  L.rocks.forEach((o) => k(o, ['x', 'z', 'r', 'h']));
  L.boxes.forEach((b) => k(b, ['x', 'y', 'z', 'hx', 'hy', 'hz']));
  L.zones.forEach((zn) => k(zn, ['x', 'z']));
  L.path = L.path.map((p) => p.map((v) => v * S));
  k(L.bounds, ['minX', 'maxX', 'minZ', 'maxZ']);
  L.ceiling *= S;
  k(L.fog, ['near', 'far']);
  return L;
}

function buildDemo() {
  const S = WORLD_SCALE;
  const rand = mulberry32(1337);
  const start = [0, 15, 0];
  // Portar: [x, y, z, radie]
  const G = [
    [0, 15, -70, 5],
    [18, 20, -140, 5],
    [0, 12, -210, 5],
    [-16, 9, -260, 4.5],   // skogen börjar
    [6, 10, -305, 4.5],
    [-9, 9, -350, 4.5],
    [0, 14, -410, 5],      // skarp högersväng efter denna
    [55, 14, -430, 5],
    [95, 16, -398, 5],     // hårnål in mot kanjonen
    [95, 12, -315, 4.5],   // i kanjonen
    [95, 10, -235, 4.5],
    [95, 13, -200, 4.6],   // i hålet i väggen
    [95, 10, -140, 4.5],   // i tunneln
    [85, 16, -55, 5],
    [45, 15, -15, 5.5],    // mål
  ];
  const path = [start, ...G.map((g) => [g[0], g[1], g[2]])];
  const gates = G.map((g, i) => {
    const prev = path[i];
    const next = path[i + 2] || null;
    let dx, dz;
    if (next) { dx = next[0] - prev[0]; dz = next[2] - prev[2]; }
    else { dx = g[0] - prev[0]; dz = g[2] - prev[2]; }
    // Portar i raka korridorer pekar rakt längs korridoren.
    if (i >= 9 && i <= 12) { dx = 0; dz = 1; }
    return { idx: i, x: g[0], y: g[1], z: g[2], r: g[3], tube: 0.35, yaw: yawFromDir(dx, dz), finish: i === G.length - 1 };
  });

  const boxes = [];
  const zones = [];
  // Kanjon: smal passage med höga klippväggar
  corridor(boxes, 95, -368, -255, 8.5, 38, null, 'canyon');
  zones.push({ type: 'Kanjon', x: 95, z: -311, note: `Bredd ${17 * S} m` });
  // Vägg med hål
  windowWall(boxes, 95, -200, 70, 40, 13, 6);
  zones.push({ type: 'Vägg', x: 95, z: -200, note: `Hål ${7 * S}–${19 * S} m upp` });
  // Tunnel med tak
  corridor(boxes, 95, -170, -110, 7, 22, 20, 'tunnel');
  zones.push({ type: 'Tunnel', x: 95, z: -140, note: `Tak på ${20 * S} m` });

  const bounds = { minX: -70, maxX: 160, minZ: -470, maxZ: 30 };
  const trees = [];
  const rocks = [];

  const nearGate = (x, z, d) => gates.some((g) => (g.x - x) ** 2 + (g.z - z) ** 2 < d * d);
  const blockedByBox = (x, z, m) => boxes.some((b) => insideBoxFootprint(b, x, z, m));

  // Tät skog runt port 4–6
  const forest = { minX: -55, maxX: 40, minZ: -375, maxZ: -228 };
  let tries = 0;
  while (tries++ < 6000 && trees.length < 260) {
    const x = forest.minX + rand() * (forest.maxX - forest.minX);
    const z = forest.minZ + rand() * (forest.maxZ - forest.minZ);
    const baseR = 1.8 + rand() * 1.4;
    if (distToPath(path, x, z) < 6.2 + baseR) continue;
    if (nearGate(x, z, 14 + baseR)) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < (t.baseR + baseR) ** 2 * 0.8)) continue;
    const h = 16 + rand() * 12;
    trees.push({ x, z, baseR, h, trunkH: 3 + rand() * 2, trunkR: 0.45 });
  }
  // Glesare träd i resten av världen
  tries = 0;
  while (tries++ < 4000 && trees.length < 420) {
    const x = bounds.minX - 40 + rand() * (bounds.maxX - bounds.minX + 80);
    const z = bounds.minZ - 40 + rand() * (bounds.maxZ - bounds.minZ + 80);
    if (x > forest.minX && x < forest.maxX && z > forest.minZ && z < forest.maxZ) continue;
    const baseR = 1.6 + rand() * 1.6;
    if (distToPath(path, x, z) < 13 + baseR) continue;
    if (nearGate(x, z, 14)) continue;
    if (blockedByBox(x, z, 3 + baseR)) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < (t.baseR + baseR) ** 2)) continue;
    const h = 8 + rand() * 14;
    trees.push({ x, z, baseR, h, trunkH: 2 + rand() * 2, trunkR: 0.45 });
  }
  // Klippelare runt de skarpa svängarna (port 7–9)
  tries = 0;
  const rockArea = { minX: -20, maxX: 120, minZ: -465, maxZ: -380 };
  while (tries++ < 3000 && rocks.length < 28) {
    const x = rockArea.minX + rand() * (rockArea.maxX - rockArea.minX);
    const z = rockArea.minZ + rand() * (rockArea.maxZ - rockArea.minZ);
    const r = 1.8 + rand() * 2.2;
    if (distToPath(path, x, z) < 9 + r) continue;
    if (nearGate(x, z, 14 + r)) continue;
    if (blockedByBox(x, z, 2 + r)) continue;
    if (rocks.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r + 3) ** 2)) continue;
    rocks.push({ x, z, r, h: 20 + rand() * 25 });
  }
  // Pelarfält efter tunneln (port 13–14)
  const pillarArea = { minX: 30, maxX: 120, minZ: -105, maxZ: 10 };
  tries = 0;
  let pillars = 0;
  while (tries++ < 3000 && pillars < 16) {
    const x = pillarArea.minX + rand() * (pillarArea.maxX - pillarArea.minX);
    const z = pillarArea.minZ + rand() * (pillarArea.maxZ - pillarArea.minZ);
    const r = 1.2 + rand() * 1.2;
    if (distToPath(path, x, z) < 6 + r) continue;
    if (nearGate(x, z, 10 + r)) continue;
    if (blockedByBox(x, z, 3 + r)) continue;
    if (rocks.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r + 4) ** 2)) continue;
    rocks.push({ x, z, r, h: 30 + rand() * 15 });
    pillars++;
  }
  // Ta bort träd som hamnat i klippor
  const keptTrees = trees.filter((t) => !rocks.some((o) => (o.x - t.x) ** 2 + (o.z - t.z) ** 2 < (o.r + t.baseR) ** 2));

  return scaleLevel({
    id: 'demo',
    name: LEVEL_INFO.demo.name,
    start: { x: start[0], y: start[1], z: start[2], yaw: yawFromDir(G[0][0] - start[0], G[0][2] - start[2]) },
    gates,
    trees: keptTrees,
    rocks,
    boxes,
    zones,
    path,
    bounds,
    ceiling: 50,
    fog: { color: 0x141c2b, near: 16, far: 78 },
    penalties: { crash: 3, miss: 5 },
  }, S);
}

// Väggar längs en slingrande rutt (kanjon). Insidan av väggarna följer rutten
// på avståndet halfWidths[i] från mittlinjen, och hörnen sluts med gering (miter)
// så att det aldrig blir glipor eller väggar som sticker in i korridoren.
function canyonWalls(path, halfWidths, wallH, thick = 1.5, extend = 25) {
  const boxes = [];
  const segs = [];
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1][0] - path[i][0], dz = path[i + 1][2] - path[i][2];
    const L = Math.hypot(dx, dz);
    segs.push({ d: [dx / L, dz / L], n: [-dz / L, dx / L] });   // n = höger
  }
  for (const s of [-1, 1]) {
    const pts = [];
    const off = (i, p) => [p[0] + s * halfWidths[i] * segs[i].n[0], p[2] + s * halfWidths[i] * segs[i].n[1]];
    const a0 = off(0, path[0]);
    pts.push([a0[0] - segs[0].d[0] * extend, a0[1] - segs[0].d[1] * extend]);
    for (let j = 1; j < segs.length; j++) {
      // skärning mellan linje j-1 och linje j
      const p1 = off(j - 1, path[j]), d1 = segs[j - 1].d;
      const p2 = off(j, path[j]), d2 = segs[j].d;
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-4) { pts.push(p2); continue; }
      const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
      pts.push([p1[0] + d1[0] * t, p1[1] + d1[1] * t]);
    }
    const last = segs.length - 1;
    const aN = off(last, path[path.length - 1]);
    pts.push([aN[0] + segs[last].d[0] * extend, aN[1] + segs[last].d[1] * extend]);
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      const nx = -dz * s, nz = dx * s;   // utåt från korridoren
      boxes.push({
        x: (ax + bx) / 2 + nx * thick, y: wallH / 2, z: (az + bz) / 2 + nz * thick,
        hx: thick, hy: wallH / 2, hz: L / 2, yaw: yawFromDir(dx, dz), kind: 'canyon',
      });
    }
  }
  return boxes;
}

// Testvärlden: en slingrande kanjon med höga väggar och trånga partier.
// Alla portar ligger på samma höjd – det handlar om höger och vänster.
function buildTest() {
  const S = WORLD_SCALE;
  const H = 15;            // flyghöjd (×2 = 30 m)
  const start = [0, H, 0];
  const G = [
    [0, H, -70, 6],
    [20, H, -140, 6],
    [0, H, -210, 5.5],
    [-25, H, -270, 5.5],     // trångt parti
    [-10, H, -340, 5.5],
    [25, H, -390, 6],
    [65, H, -370, 6],        // skarp högersväng – bromsa
    [80, H, -290, 6],
    [65, H, -210, 5.5],      // trångt parti
    [60, H, -120, 6.5],      // mål
  ];
  const path = [start, ...G.map((g) => [g[0], g[1], g[2]])];
  const gates = G.map((g, i) => {
    const prev = path[i];
    const next = path[i + 2] || null;
    const dx = next ? next[0] - prev[0] : g[0] - prev[0];
    const dz = next ? next[2] - prev[2] : g[2] - prev[2];
    return { idx: i, x: g[0], y: g[1], z: g[2], r: g[3], tube: 0.35, yaw: yawFromDir(dx, dz), finish: i === G.length - 1 };
  });
  // korridorens halva bredd per sträcka (oskalad; ×2 i världen)
  const half = [11, 10, 9, 8, 8, 9, 10, 10, 8, 9];
  const boxes = canyonWalls(path, half, 50);
  // pelare inne i kanjonen: man måste väja höger/vänster
  const rocks = [];
  const pillar = (seg, t, side, r = 1.4) => {
    const a = path[seg], b = path[seg + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
    const nx = -dz / L, nz = dx / L;
    const off = half[seg] - 2.0;    // nära väggen – smalnar av passagen
    rocks.push({ x: a[0] + dx * t + nx * off * side, z: a[2] + dz * t + nz * off * side, r, h: 50 });
  };
  pillar(1, 0.5, 1); pillar(2, 0.45, -1); pillar(3, 0.5, 1); pillar(4, 0.4, -1); pillar(4, 0.75, 1);
  pillar(7, 0.5, -1); pillar(8, 0.5, 1); pillar(9, 0.5, -1);
  const zones = [
    { type: 'Trångt', x: -15, z: -300, note: `Bredd ${16 * S} m` },
    { type: 'Skarp sväng', x: 65, z: -385, note: 'Bromsa!' },
  ];
  const xs = path.map((p) => p[0]), zs = path.map((p) => p[2]);
  const bounds = { minX: Math.min(...xs) - 30, maxX: Math.max(...xs) + 30, minZ: Math.min(...zs) - 30, maxZ: Math.max(...zs) + 30 };
  return scaleLevel({
    id: 'test',
    name: LEVEL_INFO.test.name,
    start: { x: start[0], y: start[1], z: start[2], yaw: yawFromDir(G[0][0] - start[0], G[0][2] - start[2]) },
    gates, trees: [], rocks, boxes, zones, path, bounds,
    ceiling: 50,
    fog: { color: 0x141c2b, near: 16, far: 78 },
    penalties: { crash: 3, miss: 5 },
  }, S);
}

// Belöningar: stjärnor längs den raka linjen mellan portarna (som är fri från hinder).
// Flyger man igenom en stjärna dras 1 sekund av från tiden.
export const STAR_BONUS = 1;
export const STAR_RADIUS = 6;

function addStars(level) {
  const P = level.path;
  const stars = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const ts = len > 140 ? [0.35, 0.65] : [0.5];
    for (const t of ts) {
      stars.push({ idx: stars.length, x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t });
    }
  }
  level.stars = stars;
}

const builders = { test: buildTest, demo: buildDemo };

export function buildLevel(id) {
  const b = builders[id];
  if (!b) throw new Error('Okänd bana: ' + id);
  const level = b();
  addStars(level);
  level._grid = buildGrid(level);
  return level;
}
