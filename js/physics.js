// Flygmodell och kollisioner. Ren logik utan grafik, så att den kan testas i Node.

export const PLANE_R = 0.7;      // planets kollisionsradie (meter/enheter)
export const GROUND_Y = 0.7;     // lägre än så = marken
export const MISS_RADIUS = 25;   // passerar man portens plan inom detta avstånd men utanför ringen = missad

export const FLIGHT = {
  baseSpeed: 22,
  boostSpeed: 32,
  brakeSpeed: 13,
  speedResponse: 2.0,
  turnRate: 1.55,   // rad/s vid fullt utslag
  maxRoll: 0.85,
  pitchRate: 1.25,
  maxPitch: 0.9,
  autoLevel: 1.6,   // hur snabbt nosen planar ut utan input
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

// inp: { x: -1..1 (höger +), y: -1..1 (nos upp +), boost: bool, brake: bool }
export function stepFlight(s, inp, dt, cfg = FLIGHT) {
  const targetRoll = -inp.x * cfg.maxRoll;
  s.roll += (targetRoll - s.roll) * Math.min(1, dt * 6);
  s.yaw -= inp.x * cfg.turnRate * dt;
  if (Math.abs(inp.y) > 0.05) s.pitch += inp.y * cfg.pitchRate * dt;
  else s.pitch -= s.pitch * Math.min(1, dt * cfg.autoLevel);
  s.pitch = clamp(s.pitch, -cfg.maxPitch, cfg.maxPitch);
  const target = inp.boost ? cfg.boostSpeed : inp.brake ? cfg.brakeSpeed : cfg.baseSpeed;
  s.speed += (target - s.speed) * Math.min(1, dt * cfg.speedResponse);
  const f = forward(s.yaw, s.pitch);
  s.x += f[0] * s.speed * dt;
  s.y += f[1] * s.speed * dt;
  s.z += f[2] * s.speed * dt;
}

// ---- Kollisioner -------------------------------------------------------

function hitTree(t, x, y, z, r) {
  if (y > t.h + r) return false;
  const dx = x - t.x, dz = z - t.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > t.baseR + r) return false;
  if (y < t.trunkH) return d < 0.45 + r;
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
  // rotera runt Y med vinkeln -yaw (samma konvention som three.js rotation.y)
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const qx = clamp(lx, -b.hx, b.hx) - lx;
  const qy = clamp(dy, -b.hy, b.hy) - dy;
  const qz = clamp(lz, -b.hz, b.hz) - lz;
  return qx * qx + qy * qy + qz * qz < r * r;
}

// Avstånd från punkt till portens ring (torus). Returnerar {s: signerat avstånd längs normalen, radial}
export function gateLocal(g, x, y, z) {
  const n = forward(g.yaw, 0);
  const dx = x - g.x, dy = y - g.y, dz = z - g.z;
  const s = dx * n[0] + dz * n[2];
  const px = dx - n[0] * s, pz = dz - n[2] * s;
  const radial = Math.sqrt(px * px + dy * dy + pz * pz);
  return { s, radial };
}

function hitGateRing(g, x, y, z, r) {
  const { s, radial } = gateLocal(g, x, y, z);
  if (Math.abs(s) > g.tube + r) return false;
  const d = Math.sqrt(s * s + (radial - g.r) * (radial - g.r));
  return d < g.tube + r;
}

// Returnerar null eller en sträng som beskriver vad man krockade med.
export function checkCollision(level, x, y, z, r = PLANE_R) {
  if (y < GROUND_Y) return 'marken';
  const grid = level._grid;
  const cands = grid ? grid.query(x, z) : null;
  const trees = cands ? cands.trees : level.trees;
  const rocks = cands ? cands.rocks : level.rocks;
  for (const t of trees) if (hitTree(t, x, y, z, r)) return 'ett träd';
  for (const o of rocks) if (hitRock(o, x, y, z, r)) return 'en klippa';
  for (const b of level.boxes) if (hitBox(b, x, y, z, r)) return b.kind === 'roof' ? 'tunneltaket' : 'en vägg';
  for (const g of level.gates) if (hitGateRing(g, x, y, z, r)) return 'portens ram';
  const B = level.bounds, m = 70;
  if (x < B.minX - m || x > B.maxX + m || z < B.minZ - m || z > B.maxZ + m) return 'utanför banan';
  return null;
}

// Kollar om förflyttningen p0 -> p1 korsar portens plan framåt.
// Returnerar 'pass', 'miss' eller null.
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

// Enkelt rutnät så att vi inte testar alla träd varje steg.
export function buildGrid(level, cell = 16) {
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
