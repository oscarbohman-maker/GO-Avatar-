// Flygmodell och kollisioner. Ren logik utan grafik, så att den kan testas i Node.
//
// Flygmodellen är "halvrealistisk":
//  - Rollen följer spaken via en fjäder/dämpare (tröghet runt längdaxeln).
//  - Planet svänger genom att banka: girhastighet = g_sväng · tan(roll) / fart
//    (koordinerad sväng – högre fart ger större svängradie).
//  - Tippningen har tröghet och nosen planar ut av sig själv.
//  - Gravitationen längs banan: stigning kostar fart, dykning ger fart.
//  - Planet tappar lyftkraft i branta svängar och sjunker om man inte drar upp.
//  - Lätt turbulens skakar planet.
// Värden som accelerationer och G-kraft sparas så att kroppar och kamera kan reagera.

export const PLANE_R = 1.4;      // radie för flygkroppens kollisionskropp (m)
export const GROUND_Y = 1.2;     // lägre än så = marken
export const MISS_RADIUS = 50;   // passerar man portens plan inom detta avstånd men utanför ringen = missad

export const FLIGHT = {
  cruise: 44,        // m/s (≈ 160 km/h)
  boost: 62,
  brake: 28,
  minSpeed: 22,
  maxSpeed: 85,
  thrustResp: 0.8,   // hur snabbt farten närmar sig gaspådraget
  gAlong: 12,        // gravitationens effekt på farten i stigning/dykning
  maxRoll: 0.75,     // rad (≈ 43°) – lugnare bankning
  rollK: 12,         // mjukare fjäder för rollen (långsammare, jämnare rörelser)
  rollC: 7,          // dämpning (≈ kritisk) – ingen översväng
  turnG: 64,         // ger ca 1.35 rad/s vid full bank och marschfart
  maxYawRate: 1.9,
  pitchRate: 0.35,   // långsam höjdändring – spelet handlar mest om höger/vänster
  pitchResp: 3,
  maxPitch: 0.3,     // nosen kan bara peka lite upp eller ner (≈ 17°)
  autoLevel: 2.2,    // planar ut snabbt av sig själv
  bankSink: 0.6,     // m/s – svängar tappar nästan ingen höjd
  turbRoll: 0.3,     // rad/s² turbulens i rollen (svag)
  turbLift: 0.25,    // m/s vertikala vindbyar (svaga)
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Framåtvektor för ett givet yaw/pitch. yaw = 0 pekar mot -Z, positiv yaw = vänster.
export function forward(yaw, pitch = 0) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function yawFromDir(dx, dz) {
  return Math.atan2(-dx, -dz);
}

// Roterar en punkt i planets lokala system (x höger, y upp, -z framåt) till världen.
// Samma ordning som three.js 'YXZ': först roll (Z), sedan pitch (X), sist yaw (Y).
export function rotYXZ(x, y, z, yaw, pitch, roll) {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x1 = x * cr - y * sr, y1 = x * sr + y * cr, z1 = z;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp, x2 = x1;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [x2 * cy + z2 * sy, y2, -x2 * sy + z2 * cy];
}

// Mjuk, deterministisk "turbulens" (summa av sinusar)
export function turbulence(t, seed = 0) {
  return Math.sin(t * 1.3 + seed) * 0.55 + Math.sin(t * 2.9 + 1.7 + seed * 2) * 0.3 + Math.sin(t * 7.3 + 0.4 + seed * 3) * 0.15;
}

export function newPlane(x, y, z, yaw) {
  return {
    x, y, z, yaw, pitch: 0, roll: 0, speed: FLIGHT.cruise,
    rollRate: 0, pitchRate: 0, yawRate: 0, t: 0,
    accLong: 0, loadN: 1, rollAcc: 0, throttle: 0, ix: 0, iy: 0,
  };
}

// inp: { x: -1..1 (höger +), y: -1..1 (nos upp +), boost: bool, brake: bool }
export function stepFlight(s, inp, dt, cfg = FLIGHT) {
  s.t += dt;
  s.ix = inp.x; s.iy = inp.y;
  s.throttle = inp.boost ? 1 : inp.brake ? -1 : 0;

  // Roll: fjäder mot önskad bankvinkel + turbulens
  const targetRoll = -inp.x * cfg.maxRoll;
  const rollAcc = cfg.rollK * (targetRoll - s.roll) - cfg.rollC * s.rollRate + cfg.turbRoll * turbulence(s.t, 0);
  s.rollRate += rollAcc * dt;
  s.roll += s.rollRate * dt;
  s.roll = clamp(s.roll, -1.3, 1.3);
  s.rollAcc = rollAcc;

  // Sväng som följd av banken (koordinerad sväng)
  s.yawRate = clamp(cfg.turnG * Math.tan(s.roll) / Math.max(s.speed, 1), -cfg.maxYawRate, cfg.maxYawRate);
  s.yaw += s.yawRate * dt;

  // Tippning med tröghet, planar ut utan input
  const qCmd = Math.abs(inp.y) > 0.05 ? inp.y * cfg.pitchRate : -s.pitch * cfg.autoLevel;
  s.pitchRate += (qCmd - s.pitchRate) * Math.min(1, dt * cfg.pitchResp);
  s.pitch += s.pitchRate * dt;
  if (s.pitch > cfg.maxPitch) { s.pitch = cfg.maxPitch; s.pitchRate = Math.min(0, s.pitchRate); }
  if (s.pitch < -cfg.maxPitch) { s.pitch = -cfg.maxPitch; s.pitchRate = Math.max(0, s.pitchRate); }

  // Fart: gaspådrag minus gravitation längs banan
  const target = inp.boost ? cfg.boost : inp.brake ? cfg.brake : cfg.cruise;
  const dv = (target - s.speed) * cfg.thrustResp - cfg.gAlong * Math.sin(s.pitch);
  s.speed = clamp(s.speed + dv * dt, cfg.minSpeed, cfg.maxSpeed);
  s.accLong = dv;

  // Lastfaktor (G): bank + uppdragning. Används av kroppar och kamera.
  s.loadN = 1 / Math.max(0.3, Math.cos(s.roll)) + s.pitchRate * s.speed / 9.81 * 0.35;

  const f = forward(s.yaw, s.pitch);
  const sink = cfg.bankSink * (1 - Math.cos(s.roll));
  const gust = cfg.turbLift * turbulence(s.t * 0.8, 5);
  s.x += f[0] * s.speed * dt;
  s.y += (f[1] * s.speed - sink + gust) * dt;
  s.z += f[2] * s.speed * dt;
}

// ---- Kollisioner -------------------------------------------------------

function hitTree(t, x, y, z, r) {
  if (y > t.h + r) return false;
  const dx = x - t.x, dz = z - t.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > t.baseR + r) return false;
  if (y < t.trunkH) return d < t.trunkR + r;
  const k = (y - t.trunkH) / (t.h - t.trunkH);
  const coneR = t.baseR * (1 - Math.min(1, Math.max(0, k))) * 0.9;
  return d < coneR + r;
}

function hitRock(o, x, y, z, r) {
  if (y > o.h + r) return false;
  const dx = x - o.x, dz = z - o.z;
  return dx * dx + dz * dz < (o.r + r) * (o.r + r);
}

function hitBox(b, x, y, z, r) {
  const dx = x - b.x, dy = y - b.y, dz = z - b.z;
  const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const qx = clamp(lx, -b.hx, b.hx) - lx;
  const qy = clamp(dy, -b.hy, b.hy) - dy;
  const qz = clamp(lz, -b.hz, b.hz) - lz;
  return qx * qx + qy * qy + qz * qz < r * r;
}

export function gateLocal(g, x, y, z) {
  const n = forward(g.yaw, 0);
  const dx = x - g.x, dy = y - g.y, dz = z - g.z;
  const s = dx * n[0] + dz * n[2];
  const px = dx - n[0] * s, pz = dz - n[2] * s;
  const radial = Math.sqrt(px * px + dy * dy + pz * pz);
  return { s, radial };
}


// Kollisionspunkter på planet (lokalt: x höger, y upp, -z fram).
// Portarnas ringar och stjärnorna kan man alltid flyga igenom – de krockar man aldrig med.
export const PROBES = [
  { name: 'body', p: [0, 0, 0], r: PLANE_R },
  { name: 'nose', p: [0, 0, -5.4], r: 0.9 },
  { name: 'tail', p: [0, 0.9, 5.6], r: 0.8 },
  { name: 'left wing', p: [-6.4, -0.05, -0.3], r: 0.5 },
  { name: 'right wing', p: [6.4, -0.05, -0.3], r: 0.5 },
];

// Hindertyp för kraschens effekter: mark, berg, trad (träd) eller byggnad
const BOX_TYPE = { canyon: 'berg', cliffwall: 'berg', treewall: 'trad', wall: 'byggnad', tunnel: 'byggnad', roof: 'byggnad', rockwall: 'berg', rockroof: 'berg' };
const BOX_NAME = { canyon: 'the canyon wall', cliffwall: 'the cliff', treewall: 'a tree', wall: 'a wall', tunnel: 'a wall', roof: 'the tunnel roof', rockwall: 'a rock wall', rockroof: 'the rock ceiling' };
const unit = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

// Ytans normal på en låda (från lådan mot punkten), i världen
function boxNormal(b, x, y, z) {
  const dx = x - b.x, dy = y - b.y, dz = z - b.z;
  const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  // den sida punkten ligger närmast (relativt lådans storlek)
  const ax = Math.abs(lx) / b.hx, ay = Math.abs(dy) / b.hy, az = Math.abs(lz) / b.hz;
  let n;
  if (ax >= ay && ax >= az) n = [Math.sign(lx) || 1, 0, 0];
  else if (ay >= az) n = [0, Math.sign(dy) || 1, 0];
  else n = [0, 0, Math.sign(lz) || 1];
  // tillbaka till världen (rotera med +yaw)
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  return [n[0] * cy + n[2] * sy, n[1], -n[0] * sy + n[2] * cy];
}

// Fallande sten: höjden vid flygtiden t (accelererar nedåt och börjar om uppifrån).
// Samma formel hos piloten och navigatören, så båda ser stenarna på samma ställe.
export function moverY(m, t) {
  const k = (((t + m.phase) % m.period) + m.period) % m.period / m.period;
  return m.top - (m.top - m.bottom) * k * k;
}

// Vad (om något) träffar en sfär i punkten? Returnerar { what, type, n } eller null.
// t = flygtiden (för fallande stenar).
function hitInfo(level, x, y, z, r, t = 0) {
  if (y < GROUND_Y * (r / PLANE_R)) return { what: 'the ground', type: 'mark', n: [0, 1, 0] };
  const grid = level._grid;
  const cands = grid ? grid.query(x, z) : null;
  const trees = cands ? cands.trees : level.trees;
  const rocks = cands ? cands.rocks : level.rocks;
  for (const t of trees) if (hitTree(t, x, y, z, r)) return { what: 'a tree', type: 'trad', n: unit(x - t.x, 0, z - t.z) };
  for (const o of rocks) if (hitRock(o, x, y, z, r)) return { what: 'a rock', type: 'berg', n: unit(x - o.x, 0, z - o.z) };
  for (const b of level.boxes) if (hitBox(b, x, y, z, r)) return { what: BOX_NAME[b.kind] || 'a wall', type: BOX_TYPE[b.kind] || 'byggnad', n: boxNormal(b, x, y, z) };
  if (level.movers) for (const m of level.movers) {
    const dx = x - m.x, dz = z - m.z;
    if (dx * dx + dz * dz > (m.r + r) * (m.r + r)) continue;
    const my = moverY(m, t), dy = y - my;
    if (dx * dx + dy * dy + dz * dz < (m.r + r) * (m.r + r)) return { what: 'a falling rock', type: 'berg', n: unit(dx, dy, dz) };
  }
  return null;
}

function hitAt(level, x, y, z, r, t = 0) {
  const h = hitInfo(level, x, y, z, r, t);
  return h ? h.what : null;
}

// Punktkollision (används av test, NPC:n och för respawn-kontroller)
export function checkCollision(level, x, y, z, r = PLANE_R, t = 0) {
  const hit = hitAt(level, x, y, z, r, t);
  if (hit) return hit;
  const B = level.bounds, m = 140;
  if (x < B.minX - m || x > B.maxX + m || z < B.minZ - m || z > B.maxZ + m) return 'out of bounds';
  return null;
}

// Kollision för hela planet (kropp, nos, stjärt och vingspetsar)
export function checkPlaneCollision(level, s, t = 0) {
  for (const pr of PROBES) {
    const w = rotYXZ(pr.p[0], pr.p[1], pr.p[2], s.yaw, s.pitch, s.roll);
    const x = s.x + w[0], y = s.y + w[1], z = s.z + w[2];
    const hit = hitAt(level, x, y, z, pr.r, t);
    if (hit) return pr.name === 'body' || pr.name === 'nose' ? hit : hit + ' (' + pr.name + ')';
  }
  const B = level.bounds, m = 140;
  if (s.x < B.minX - m || s.x > B.maxX + m || s.z < B.minZ - m || s.z > B.maxZ + m) return 'out of bounds';
  return null;
}

// Som checkPlaneCollision men med detaljer för kraschens effekter:
// { what, type, part, pos: [x,y,z], n: [x,y,z] } – vilken del av planet som träffade, var och ytans normal.
export function planeHit(level, s, t = 0) {
  for (const pr of PROBES) {
    const w = rotYXZ(pr.p[0], pr.p[1], pr.p[2], s.yaw, s.pitch, s.roll);
    const x = s.x + w[0], y = s.y + w[1], z = s.z + w[2];
    const h = hitInfo(level, x, y, z, pr.r, t);
    if (h) {
      const what = pr.name === 'body' || pr.name === 'nose' ? h.what : h.what + ' (' + pr.name + ')';
      return { what, type: h.type, part: pr.name, pos: [x, y, z], n: h.n };
    }
  }
  const B = level.bounds, m = 140;
  if (s.x < B.minX - m || s.x > B.maxX + m || s.z < B.minZ - m || s.z > B.maxZ + m) {
    return { what: 'out of bounds', type: 'mark', part: 'body', pos: [s.x, s.y, s.z], n: [0, 1, 0] };
  }
  return null;
}

// Kollar om förflyttningen p0 -> p1 korsar portens plan framåt.
export function gateCrossing(g, p0, p1) {
  const a = gateLocal(g, p0[0], p0[1], p0[2]);
  const b = gateLocal(g, p1[0], p1[1], p1[2]);
  if (!(a.s < 0 && b.s >= 0)) return null;
  const t = -a.s / (b.s - a.s);
  const q = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
  const { radial } = gateLocal(g, q[0], q[1], q[2]);
  if (radial < g.r) return 'pass';
  if (radial < MISS_RADIUS) return 'miss';
  return null;
}

export function buildGrid(level, cell = 32) {
  const map = new Map();
  const key = (i, j) => i * 100003 + j;
  const add = (kind, o, rad) => {
    const i0 = Math.floor((o.x - rad) / cell), i1 = Math.floor((o.x + rad) / cell);
    const j0 = Math.floor((o.z - rad) / cell), j1 = Math.floor((o.z + rad) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let c = map.get(k);
      if (!c) { c = { trees: [], rocks: [] }; map.set(k, c); }
      c[kind].push(o);
    }
  };
  for (const t of level.trees) add('trees', t, t.baseR + PLANE_R + 1);
  for (const o of level.rocks) add('rocks', o, o.r + PLANE_R + 1);
  const empty = { trees: [], rocks: [] };
  return {
    query(x, z) {
      return map.get(key(Math.floor(x / cell), Math.floor(z / cell))) || empty;
    },
  };
}
