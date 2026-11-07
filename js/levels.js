// Världar och banor. Banorna byggs deterministiskt (seedad slump) så att
// piloten och navigatören får exakt samma bana utan att skicka geometrin.

import { yawFromDir, buildGrid } from './physics.js';
import { THEMES, WEATHER, TIERS, tierOf } from './themes.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Free play: 20 kartplatser. Bara de som är klara går att välja, resten visas skuggade.
// Svårigheten visas som 1–5 pluppar (tier).
export const MAPS = Array.from({ length: 20 }, (_, i) => ({
  n: i + 1, id: null, name: 'Coming soon', tier: tierOf(i + 1), difficulty: TIERS[tierOf(i + 1)], available: false,
}));
Object.assign(MAPS[0], { id: 'test', name: 'Canyon Loop', available: true, theme: 'canyon', weather: 'calm', difficulty: 'Practice' });
Object.assign(MAPS[1], { id: 'demo', name: 'Training Flight', available: true, theme: 'forest', weather: 'calm' });

export const LEVEL_INFO = {
  test: { id: 'test', name: 'Canyon Loop', world: 'canyon', difficulty: 'Practice' },
  demo: { id: 'demo', name: 'Training Flight', world: 'forest', difficulty: 'Easy' },
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
  (L.decor || []).forEach((t) => k(t, ['x', 'z', 'baseR', 'h', 'trunkH', 'trunkR']));
  L.rocks.forEach((o) => k(o, ['x', 'z', 'r', 'h']));
  L.boxes.forEach((b) => k(b, ['x', 'y', 'z', 'hx', 'hy', 'hz']));
  L.zones.forEach((zn) => k(zn, ['x', 'z']));
  (L.movers || []).forEach((m) => k(m, ['x', 'z', 'r', 'top', 'bottom']));
  [...L.rocks, ...(L.movers || [])].forEach((o) => { if (o.lane) { o.lane.lat *= S; o.lane.W *= S; } });
  if (L.halfW) L.halfW *= S;
  if (L.halfs) L.halfs = L.halfs.map((h) => h * S);
  (L.decorRocks || []).forEach((o) => k(o, ['x', 'z', 'r', 'h']));
  (L.stars || []).forEach((st) => k(st, ['x', 'y', 'z']));
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
  zones.push({ type: 'Canyon', x: 95, z: -311, note: `Width ${17 * S} m` });
  // Vägg med hål
  windowWall(boxes, 95, -200, 70, 40, 13, 6);
  zones.push({ type: 'Wall', x: 95, z: -200, note: `Hole ${7 * S}–${19 * S} m up` });
  // Tunnel med tak
  corridor(boxes, 95, -170, -110, 7, 22, 20, 'tunnel');
  zones.push({ type: 'Tunnel', x: 95, z: -140, note: `Roof at ${20 * S} m` });

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
    par: 50,
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
    fog: { color: 0xaec3d3, near: 20, far: 90 },
    penalties: { crash: 3, miss: 5 },
  }, S);
}

// Väggar längs en slingrande rutt (kanjon). Insidan av väggarna följer rutten
// på avståndet halfWidths[i] från mittlinjen, och hörnen sluts med gering (miter)
// så att det aldrig blir glipor eller väggar som sticker in i korridoren.
function canyonWalls(path, halfWidths, wallH, thick = 1.5, extend = 25, kind = 'canyon', decor = null, rand = null, steps = false) {
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
      // olika bredd på sträckorna: ett trappsteg i stället för gering (annars kan skärningen hamna långt bort)
      if (steps && Math.abs(halfWidths[j - 1] - halfWidths[j]) > 1e-6) { pts.push(p1, p2); continue; }
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
        hx: thick, hy: wallH / 2, hz: L / 2, yaw: yawFromDir(dx, dz), kind,
      });
      // Skogsvägg: tätt packade träd i tre rader längs väggens insida
      if (decor && rand) {
        const rows = [[1.3, 1.7], [3.7, 2.1], [6.2, 2.5]];   // [avstånd utåt, avstånd mellan träd]
        rows.forEach(([o, gap], row) => {
          for (let u = rand() * gap; u < L; u += gap * (0.8 + rand() * 0.4)) {
            const j = (rand() - 0.5) * 0.8;
            decor.push({
              x: ax + dx * u + nx * (o + j), z: az + dz * u + nz * (o + j),
              baseR: 1.5 + rand() * 0.7 + row * 0.15,
              h: 18 + rand() * 9 + row * 1.5,
              trunkH: 2 + rand() * 1.2,
              trunkR: 0.45,
            });
          }
        });
      }
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
  const rand = mulberry32(777);
  const decorAll = [];
  const boxes = canyonWalls(path, half, 50, 1.5, 25, 'treewall', decorAll, rand);
  // inga dekorträd inne i någon del av korridoren
  const decor = decorAll.filter((t) => distToPath(path, t.x, t.z) > 8.6);
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
    { type: 'Narrow', x: -15, z: -300, note: `Width ${16 * S} m` },
    { type: 'Sharp turn', x: 65, z: -385, note: 'Brake!' },
  ];
  const xs = path.map((p) => p[0]), zs = path.map((p) => p[2]);
  const bounds = { minX: Math.min(...xs) - 30, maxX: Math.max(...xs) + 30, minZ: Math.min(...zs) - 30, maxZ: Math.max(...zs) + 30 };
  return scaleLevel({
    id: 'test',
    par: 40,
    name: LEVEL_INFO.test.name,
    start: { x: start[0], y: start[1], z: start[2], yaw: yawFromDir(G[0][0] - start[0], G[0][2] - start[2]) },
    gates, trees: [], decor, rocks, boxes, zones, path, bounds,
    ceiling: 50,
    fog: { color: 0xaec3d3, near: 20, far: 90 },
    penalties: { crash: 3, miss: 5 },
  }, S);
}

// Belöningar: stjärnor längs den raka linjen mellan portarna (som är fri från hinder).
// Flyger man igenom en stjärna dras 1 sekund av från tiden.
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

// ---------------------------------------------------------------- kartor 3–20 (genererade)
// Varje karta byggs av faser längs en slingrande korridor. Svårigheten d (0..1) styr:
// smalare korridor, skarpare svängar, fler och närmare hinder, mer höjdskillnad,
// lägre tak, mindre hål, fler fallande stenar och mer storm.
// Allt är seedat, så båda spelarna får exakt samma bana.
export const GEN_MAPS = [
  // [nummer, namn, tema, väder, variant] – varianten är ett förvalt frö som är provflugen (tests/sim.test.mjs)
  [3, 'Pine Valley', 'forest', 'calm', 0], [4, 'Hill Hopper', 'forest', 'calm', 0], [5, 'Window Woods', 'forest', 'breeze', 0],
  [6, 'Dune Drift', 'desert', 'heat', 0], [7, 'Cactus Canyon', 'desert', 'heat', 0], [8, 'Sandstorm Mesa', 'desert', 'sandstorm', 0],
  [9, 'Jungle Dash', 'jungle', 'rain', 0], [10, 'Vine Gorge', 'jungle', 'rain', 1], [11, 'Monsoon Temple', 'jungle', 'storm', 0],
  [12, 'Red Rock Pass', 'redrock', 'breeze', 0], [13, 'Boulder Gorge', 'redrock', 'breeze', 0], [14, 'Rockfall Run', 'redrock', 'breeze', 2],
  [15, 'Frost Pass', 'arctic', 'snow', 1], [16, 'Avalanche Alley', 'arctic', 'snow', 4], [17, 'Blizzard Peaks', 'arctic', 'blizzard', 9],
  [18, 'Ash Valley', 'lava', 'embers', 2], [19, 'Magma Gorge', 'lava', 'embers', 6], [20, 'The Inferno', 'lava', 'eruption', 3],
];

// Vilka faser som finns från vilken svårighet
const FEATURES = [
  { f: 'slalom', from: 0 }, { f: 'updown', from: 0 }, { f: 'window', from: 0.1 },
  { f: 'roof', from: 0.15 }, { f: 'hairpin', from: 0.25 }, { f: 'rockfall', from: 0.3 }, { f: 'zigzag', from: 0.45 },
];

// Fönstervägg tvärs över korridoren (lokalt x = åt höger, z = framåt) med ett fyrkantigt hål
function crossWall(boxes, cx, cz, yaw, halfW, height, holeY, holeHalf, kind) {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);        // planets "höger" för den här riktningen
  const t = 1;                                          // halv tjocklek
  const side = (halfW + 3 - holeHalf) / 2;              // bredd på väggbitarna vid sidan av hålet
  const put = (lx, y, hx, hy) => boxes.push({ x: cx + rx * lx, y, z: cz + rz * lx, hx, hy, hz: t, yaw, kind });
  put(-(holeHalf + side), height / 2, side, height / 2);
  put(holeHalf + side, height / 2, side, height / 2);
  const below = holeY - holeHalf;
  if (below > 0.2) put(0, below / 2, holeHalf, below / 2);
  const above = height - (holeY + holeHalf);
  if (above > 0.2) put(0, holeY + holeHalf + above / 2, holeHalf, above / 2);
}

function buildGenerated(n, name, theme, weatherId = 'calm', variant = 0) {
  const S = WORLD_SCALE;
  const d = Math.max(0, Math.min(1, (n - 3) / 17));
  const rand = mulberry32(9100 + n * 131 + variant * 7919);
  const R = (a, b) => a + rand() * (b - a);
  const TH = THEMES[theme], WX = WEATHER[weatherId];
  const mountain = TH.walls === 'rock';               // klippväggar (annars skogsväggar)
  const H0 = 15;
  const nG = 10 + Math.round(d * 8);
  const halfW = 11 - 1.2 * d;                           // korridorens halva bredd (oskalad; ×2 i världen)
  const gateR = 6 - 1.1 * d;

  // 1) välj fas per sträcka (första sträckan är lugn, sista leder in i målet)
  const pool = FEATURES.filter((x) => d >= x.from).map((x) => x.f);
  const feats = [];
  for (let i = 0; i < nG; i++) {
    if (i === 0 || i === nG - 1 || rand() < 0.28 - 0.2 * d) { feats.push('none'); continue; }
    // ingen skarp sväng direkt efter ett hinder (man ligger då ofta långt ut åt sidan)
    const dodge = (x) => x === 'slalom' || x === 'zigzag' || x === 'rockfall';
    let f; do { f = pool[(rand() * pool.length) | 0]; } while ((f === feats[i - 1] && pool.length > 1 && f !== 'slalom') || (f === 'hairpin' && dodge(feats[i - 1])));
    feats.push(f);
  }

  // 2) höjder: fönster och tak kräver en viss höjd, upp/ner växlar; sedan begränsas lutningen
  const alt = new Array(nG).fill(H0);
  let flip = rand() < 0.5 ? 1 : -1;
  const holeHalf = 5.4 - 0.9 * d, roofY = 12.5 - 2 * d;
  for (let i = 0; i < nG; i++) {
    const f = feats[i];
    if (f === 'updown' || f === 'window') { flip = -flip; alt[i] = H0 + flip * R(3, 4.5 + 2 * d); }
    else if (f === 'roof') alt[i] = roofY - 5.2;
    else alt[i] = H0 + R(-1.5, 1.5);
    alt[i] = Math.max(6.5, Math.min(22, alt[i]));
  }
  // Fönster och tak har låsta höjder. Porten före ett tak läggs lågt (så att man hinner ner),
  // och övriga höjder jämnas ut så att två portar i rad skiljer högst MAXD.
  const MAXD = 4.6;                                     // största höjdskillnad mellan två portar
  const fixed = feats.map((f) => f === 'roof' || f === 'window');
  for (let i = 1; i < nG; i++) {
    if (fixed[i - 1]) continue;
    if (feats[i] === 'roof') { alt[i - 1] = Math.min(alt[i - 1], alt[i] + 2.5); fixed[i - 1] = true; }
    if (feats[i] === 'window') { alt[i - 1] = Math.max(alt[i] - 3, Math.min(alt[i] + 3, alt[i - 1])); fixed[i - 1] = true; }
  }
  for (let pass = 0; pass < 6; pass++) {
    for (let i = nG - 1; i > 0; i--) if (!fixed[i - 1]) alt[i - 1] = Math.max(alt[i] - MAXD, Math.min(alt[i] + MAXD, alt[i - 1]));
    let prev = H0;
    for (let i = 0; i < nG; i++) {
      if (!fixed[i]) alt[i] = Math.max(prev - MAXD, Math.min(prev + MAXD, alt[i]));
      prev = alt[i];
    }
  }

  // 3) rutten: kurs inom ±1 rad från rakt fram, så att banan aldrig korsar sig själv
  const start = [0, H0, 0];
  const path = [start];
  let heading = 0, x = 0, z = 0;
  for (let i = 0; i < nG; i++) {
    const f = feats[i];
    let turn = (rand() * 2 - 1) * (0.22 + 0.42 * d);
    if (f === 'hairpin') turn = (rand() < 0.5 ? -1 : 1) * (0.55 + 0.35 * d);           // skarp sväng (bromsa!)
    if (i === 0) turn *= 0.3;
    if (f === 'window' || f === 'roof') turn *= 0.35;                                    // raka in mot fönster och tak
    if (f === 'slalom' || f === 'zigzag' || f === 'rockfall') turn *= 0.5;              // väj, inte sväng samtidigt
    heading = Math.max(-1, Math.min(1, heading + turn));
    // sträckor med hinder är längre: tid att väja ut och sedan tillbaka till mitten före nästa port
    const L = f === 'slalom' || f === 'zigzag' || f === 'rockfall' ? R(84, 96) : R(62, 76);
    x += -Math.sin(heading) * L; z += -Math.cos(heading) * L;
    path.push([x, alt[i], z]);
  }

  const gates = [];
  for (let i = 0; i < nG; i++) {
    const p = path[i + 1], prev = path[i], next = path[i + 2] || null;
    let dx, dz;
    if (feats[i] === 'window' || feats[i] === 'roof') { dx = p[0] - prev[0]; dz = p[2] - prev[2]; }   // pekar längs sträckan
    else if (next) { dx = next[0] - prev[0]; dz = next[2] - prev[2]; }
    else { dx = p[0] - prev[0]; dz = p[2] - prev[2]; }
    let r = gateR;
    if (feats[i] === 'window') r = Math.min(r, holeHalf - 0.7);
    gates.push({ idx: i, x: p[0], y: p[1], z: p[2], r, tube: 0.35, yaw: yawFromDir(dx, dz), finish: i === nG - 1 });
  }

  // 4) väggar längs korridoren (skog eller klippor)
  // korridoren är bredare där det står hinder (plats att väja), smalare annars
  const BULGE = 3.5;
  const half = feats.map((f) => (f === 'slalom' || f === 'zigzag' || f === 'rockfall' ? halfW + BULGE : halfW));
  const decor = [];
  const boxes = canyonWalls(path, half, 50, 1.5, 25, mountain ? 'cliffwall' : 'treewall', decor, rand, true);
  // dekor (syns men krockas inte med) får aldrig hamna inne i korridoren, inte ens där den är bredare
  const outside = (t) => {
    for (let i = 0; i < path.length - 1; i++) {
      if (distToSegment2(t.x, t.z, path[i][0], path[i][2], path[i + 1][0], path[i + 1][2]) < half[i] - 0.4) return false;
    }
    return true;
  };
  const decorTrees = mountain ? [] : decor.filter(outside);
  const decorRocks = mountain
    ? decor.filter(outside).map((t) => ({ x: t.x, z: t.z, r: t.baseR * 1.15, h: t.h * (1.1 + rand() * 0.6) }))
    : [];

  // 5) hinder per fas
  const rocks = [], movers = [], zones = [], stars = [], centers = [];
  const at = (i, t, lat) => {
    const a = path[i], b = path[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
    const rx = -dz / L, rz = dx / L;                    // höger
    return { x: a[0] + dx * t + rx * lat, y: a[1] + (b[1] - a[1]) * t, z: a[2] + dz * t + rz * lat, yaw: yawFromDir(dx, dz), L };
  };
  const pillarR = 1.25 + 0.25 * d;
  // Pelaren ska blockera mitten men lämna en passage på andra sidan som är minst
  // planets vingbredd (6.6) + 2.8 i marginal (oskalade enheter)
  const wObs = halfW + BULGE;
  const minOff = Math.max(0.8, 9.4 - wObs + pillarR), maxOff = Math.max(minOff, Math.min(3.4, pillarR + 2.2));
  let side = rand() < 0.5 ? 1 : -1;
  for (let i = 0; i < nG; i++) {
    const f = feats[i];
    if (f === 'slalom' || f === 'zigzag') {
      // pelarna står minst ~60 m isär (tid att väja från ena sidan till andra)
      // flera pelare i samma sträcka står på samma sida (en lång undanmanöver);
      // sidan byts mellan sträckorna, så att det blir tid att svänga över
      const ts = f === 'zigzag' || d > 0.5 ? [0.46, 0.62] : [0.52];
      side = -side;
      ts.forEach((t) => {
        const lat = side * R(minOff, maxOff);
        const p = at(i, t, lat);
        rocks.push({ x: p.x, z: p.z, r: pillarR, h: 50, lane: { seg: i, t, lat, W: wObs } });
      });
      const m = at(i, 0.5, 0);
      zones.push({ type: f === 'zigzag' ? 'Zigzag' : 'Slalom', x: m.x, z: m.z, note: `${ts.length} pillar${ts.length > 1 ? 's' : ''}` });
    } else if (f === 'window') {
      const p = at(i, 0.78, 0);
      crossWall(boxes, p.x, p.z, p.yaw, halfW, 50, alt[i], holeHalf, mountain ? 'rockwall' : 'wall');
      centers.push({ seg: i, t: 0.78 });                  // genom hålet: mitt i banan
      zones.push({ type: 'Wall', x: p.x, z: p.z, note: `Hole at ${Math.round(alt[i] * S)} m` });
    } else if (f === 'roof') {
      const p = at(i, 0.78, 0);
      const len = p.L * 0.38;                           // taket börjar efter 60 % av sträckan
      boxes.push({ x: p.x, y: roofY + 1, z: p.z, hx: halfW + 3, hy: 1, hz: len / 2, yaw: p.yaw, kind: mountain ? 'rockroof' : 'roof' });
      zones.push({ type: 'Low roof', x: p.x, z: p.z, note: `Stay under ${Math.round(roofY * S)} m` });
    } else if (f === 'hairpin') {
      const m = at(i, 0.5, 0);
      zones.push({ type: 'Hairpin', x: m.x, z: m.z, note: 'Brake!' });
    } else if (f === 'rockfall') {
      const ts = d > 0.55 ? [0.46, 0.62] : [0.52];
      side = -side;
      for (const t of ts) {
        const lat = side * R(minOff, maxOff);
        const p = at(i, t, lat);
        movers.push({ x: p.x, z: p.z, r: 1.6 + 0.3 * d, top: 34, bottom: -2, period: R(2.2, 2.8) - 0.5 * d, phase: R(0, 3), lane: { seg: i, t, lat, W: wObs } });
      }
      const m = at(i, 0.5, 0);
      zones.push({ type: 'Rockfall', x: m.x, z: m.z, note: 'Falling rocks!' });
    }
    // stjärna strax efter varje port (där det är fritt), och en till på lugna sträckor
    const s1 = at(i, 0.16, 0);
    stars.push({ idx: stars.length, x: s1.x, y: s1.y, z: s1.z });
    if (f === 'none' || f === 'updown') { const s2 = at(i, 0.6, 0); stars.push({ idx: stars.length, x: s2.x, y: s2.y, z: s2.z }); }
  }

  const xs = path.map((p) => p[0]), zs = path.map((p) => p[2]);
  const bounds = { minX: Math.min(...xs) - 30, maxX: Math.max(...xs) + 30, minZ: Math.min(...zs) - 30, maxZ: Math.max(...zs) + 30 };
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) len += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][2] - path[i][2]);
  const windDir = rand() * Math.PI * 2;
  const weather = {
    id: weatherId, particles: WX.particles || null, lightning: !!WX.lightning, rain: WX.particles === 'rain',
    wind: WX.wind ? { dir: windDir, strength: WX.wind * (1 + 1.2 * d) } : null,
  };
  return scaleLevel({
    id: 'm' + n,
    name,
    par: Math.round(len * S / 38) + 6,
    start: { x: start[0], y: start[1], z: start[2], yaw: yawFromDir(path[1][0] - start[0], path[1][2] - start[2]) },
    gates, trees: [], decor: decorTrees, decorRocks, rocks, movers, boxes, zones, path, bounds, stars, weather,
    theme,
    halfW,
    halfs: half.slice(),                                // korridorens halva bredd per sträcka
    centers,
    ceiling: 50,
    fog: { color: TH.sky, near: WX.dense ? 16 : 20, far: WX.dense ? 75 : 90 },
    pilotFog: { color: TH.pilotFog, near: 0, far: 44 - (WX.dense ? 7 : 0) - 4 * d },
    penalties: { crash: 3, miss: 5 },
  }, S);
}

const builders = { test: buildTest, demo: buildDemo };
for (const row of GEN_MAPS) {
  const [n, name, theme, weather] = row;
  builders['m' + n] = () => buildGenerated(n, name, theme, weather, row[4] || 0);
  Object.assign(MAPS[n - 1], { id: 'm' + n, name, available: true, theme, weather });
  LEVEL_INFO['m' + n] = { id: 'm' + n, name, world: theme, difficulty: MAPS[n - 1].difficulty };
}

export function buildLevel(id) {
  const b = builders[id];
  if (!b) throw new Error('Unknown level: ' + id);
  const level = b();
  if (!level.stars) addStars(level);
  level.decor = level.decor || [];
  if (!level.theme) level.theme = id === 'test' ? 'canyon' : 'forest';
  // Pilotens sikt i cockpiten: mycket tät, ljusgrå dimma som börjar direkt
  // (helt tät vid ca 44 m, träden vid sidorna ~20 m bort är halvt dolda)
  level.pilotFog = level.pilotFog || { color: 0xc6ced6, near: 0, far: 44 };
  level._grid = buildGrid(level);
  return level;
}
