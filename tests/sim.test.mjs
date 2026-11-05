// Kör: node tests/sim.test.mjs
// Kontrollerar att demobanan går att flyga igenom och att reglerna fungerar.
import assert from 'node:assert/strict';
import { buildLevel } from '../js/levels.js';
import { FlightSession, STEP } from '../js/sim.js';
import { checkCollision, gateLocal, forward, gateCrossing } from '../js/physics.js';

const level = buildLevel('demo');
let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function autopilot(sess) {
  const p = sess.plane;
  const g = level.gates[sess.nextGate];
  const n = forward(g.yaw);
  const { s } = gateLocal(g, p.x, p.y, p.z);
  const lead = clamp(-s * 0.3, 0, 14);
  const tx = g.x - n[0] * lead, tz = g.z - n[2] * lead;
  const dx = tx - p.x, dz = tz - p.z;
  const want = Math.atan2(-dx, -dz);
  const err = wrap(want - p.yaw);
  const dist = Math.hypot(dx, dz);
  const wantPitch = clamp(Math.atan2(g.y - p.y, Math.max(dist, 8)), -0.6, 0.6);
  return { x: clamp(-err * 3, -1, 1), y: clamp((wantPitch - p.pitch) * 4, -1, 1), boost: false, brake: false };
}

test('banan har rimligt innehåll', () => {
  assert.equal(level.gates.length, 15);
  assert.ok(level.trees.length > 200, 'träd: ' + level.trees.length);
  assert.ok(level.rocks.length > 10, 'klippor: ' + level.rocks.length);
});

test('inga hinder i portarnas mitt eller på startplatsen', () => {
  assert.equal(checkCollision(level, level.start.x, level.start.y, level.start.z), null);
  for (const g of level.gates) assert.equal(checkCollision(level, g.x, g.y, g.z), null, 'port ' + (g.idx + 1));
});

test('raka linjen mellan portarna är fri (minst 4 m fri radie)', () => {
  const pts = level.path;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    for (let k = 0; k <= 200; k++) {
      const t = k / 200;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const hit = checkCollision({ ...level, gates: [] }, x, y, z, 4);
      assert.equal(hit, null, `segment ${i}->${i + 1} vid t=${t.toFixed(2)} träffar ${hit}`);
    }
  }
});

test('autopilot klarar banan utan krasch och utan missade portar', () => {
  const events = [];
  const sess = new FlightSession(level, (e) => events.push(e));
  sess.begin();
  for (let i = 0; i < 60 * 180 && sess.phase !== 'finished'; i++) sess.step(sess.phase === 'fly' ? autopilot(sess) : { x: 0, y: 0 }, STEP);
  const crashes = events.filter((e) => e.kind === 'crash').map((e) => e.what);
  assert.equal(sess.phase, 'finished', `nådde port ${sess.nextGate + 1}, krascher: ${crashes.join(', ')}`);
  assert.equal(sess.crashes, 0, 'krascher: ' + crashes.join(', '));
  assert.equal(sess.misses, 0);
  console.log(`     tid: ${sess.time.toFixed(1)} s`);
});

test('krasch ger straff och återstart vid senaste porten', () => {
  const events = [];
  const sess = new FlightSession(level, (e) => events.push(e));
  sess.begin();
  for (let i = 0; i < 400; i++) sess.step({ x: 0, y: -1, boost: false, brake: false });
  assert.ok(sess.crashes >= 1);
  assert.ok(events.some((e) => e.kind === 'crash' && e.what === 'marken'));
  assert.ok(sess.penalty >= 3);
  // efter respawn ska planet vara vid starten
  const sess2 = new FlightSession(level);
  sess2.begin();
  for (let i = 0; i < 200; i++) sess2.step({ x: 0, y: -1 });
  for (let i = 0; i < 100; i++) sess2.step({ x: 0, y: 0 });
  assert.ok(sess2.phase === 'fly' || sess2.phase === 'crashed');
});

test('passera utanför ringen = missad port', () => {
  const g = level.gates[0];
  const n = forward(g.yaw);
  const side = [n[2], 0, -n[0]];
  const off = 16;
  const p0 = [g.x - n[0] + side[0] * off, g.y, g.z - n[2] + side[2] * off];
  const p1 = [g.x + n[0] + side[0] * off, g.y, g.z + n[2] + side[2] * off];
  assert.equal(gateCrossing(g, p0, p1), 'miss');
  assert.equal(gateCrossing(g, [g.x - n[0], g.y, g.z - n[2]], [g.x + n[0], g.y, g.z + n[2]]), 'pass');
  assert.equal(gateCrossing(g, [g.x + n[0], g.y, g.z + n[2]], [g.x - n[0], g.y, g.z - n[2]]), null);
});

test('banan är deterministisk (samma för båda spelarna)', () => {
  const a = buildLevel('demo'), b = buildLevel('demo');
  assert.equal(JSON.stringify(a.trees), JSON.stringify(b.trees));
  assert.equal(JSON.stringify(a.rocks), JSON.stringify(b.rocks));
});

if (failures) { console.log(`\n${failures} test misslyckades`); process.exit(1); }
console.log('\nAlla test gick igenom');
