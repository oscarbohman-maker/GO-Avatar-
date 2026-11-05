// Kör: node tests/sim.test.mjs
// Kontrollerar att banorna går att flyga igenom och att reglerna fungerar.
import assert from 'node:assert/strict';
import { buildLevel } from '../js/levels.js';
import { FlightSession, STEP, POINTS, timeBonus } from '../js/sim.js';
import { checkCollision, gateLocal, forward, gateCrossing } from '../js/physics.js';
import { NpcNavigator, pursuitTarget } from '../js/npc.js';
import { LocalAIPilot } from '../js/aipilot.js';

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Enkel autopilot: följer banans mittlinje en bit framåt, bromsar i skarpa svängar
export function autopilot(level, sess) {
  const p = sess.plane;
  const T = pursuitTarget(level, sess, 40);
  const dx = T.x - p.x, dz = T.z - p.z;
  const err = wrap(Math.atan2(-dx, -dz) - p.yaw);
  const dist = Math.hypot(dx, dz);
  const wantPitch = clamp(Math.atan2(T.y - p.y, Math.max(dist, 8)), -0.6, 0.6);
  return { x: clamp(-err * 3.5 + p.yawRate * 0.9, -1, 1), y: clamp((wantPitch - p.pitch) * 4, -1, 1), boost: false, brake: Math.abs(err) > 0.45 };
}

function fly(level, controller) {
  const events = [];
  const sess = new FlightSession(level, (e) => events.push(e));
  sess.begin();
  for (let i = 0; i < 60 * 240 && sess.phase !== 'finished'; i++) sess.step(sess.phase === 'fly' ? controller(sess) : { x: 0, y: 0 }, STEP);
  return { sess, events };
}

for (const id of ['test', 'demo']) {
  const level = buildLevel(id);

  test(`[${id}] inga hinder i portarnas mitt, i stjärnorna eller på startplatsen`, () => {
    assert.equal(checkCollision(level, level.start.x, level.start.y, level.start.z), null);
    for (const g of level.gates) assert.equal(checkCollision(level, g.x, g.y, g.z), null, 'port ' + (g.idx + 1));
    for (const s of level.stars) assert.equal(checkCollision(level, s.x, s.y, s.z, 3), null, 'stjärna ' + s.idx);
  });

  test(`[${id}] raka linjen mellan portarna är fri (minst 4 m fri radie)`, () => {
    const pts = level.path;
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      for (let k = 0; k <= 200; k++) {
        const t = k / 200;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
        const hit = checkCollision(level, x, y, z, 4);
        assert.equal(hit, null, `segment ${i}->${i + 1} vid t=${t.toFixed(2)} träffar ${hit}`);
      }
    }
  });

  test(`[${id}] autopilot klarar banan utan krasch och utan missade portar`, () => {
    const { sess, events } = fly(level, (s) => autopilot(level, s));
    const crashes = events.filter((e) => e.kind === 'crash').map((e) => e.what);
    assert.equal(sess.phase, 'finished', `nådde port ${sess.nextGate + 1}, krascher: ${crashes.join(', ')}`);
    assert.equal(sess.crashes, 0, 'krascher: ' + crashes.join(', '));
    assert.equal(sess.misses, 0);
    console.log(`     tid: ${sess.time.toFixed(1)} s, poäng: ${sess.points}, stjärnor: ${sess.stars.size}/${level.stars.length}, perfect: ${sess.perfects}`);
    const fin = events.find((e) => e.kind === 'finish');
    assert.ok(fin && fin.score === sess.points && fin.timeBonus === timeBonus(level, sess.time) && fin.timeBonus > 0);
  });

  test(`[${id}] banan är deterministisk (samma för båda spelarna)`, () => {
    const b = buildLevel(id);
    assert.equal(JSON.stringify(level.trees), JSON.stringify(b.trees));
    assert.equal(JSON.stringify(level.rocks), JSON.stringify(b.rocks));
    assert.equal(JSON.stringify(level.stars), JSON.stringify(b.stars));
  });
}

const test1 = buildLevel('test');
const demo = buildLevel('demo');

for (const lv of [test1, demo]) {
  test(`[${lv.id}] NPC-navigatören guidar en "blind" pilot genom banan`, () => {
    // Piloten gör exakt det NPC:n senast sa (riktning + höjd) – inget annat.
    const npc = new NpcNavigator(lv);
    let cmd = { turn: 0, climb: 0, brake: false };
    const { sess, events } = fly(lv, (s) => {
      const out = npc.update(1 / 60, s);
      if (out && out.command) cmd = out.command;
      return { x: clamp(cmd.turn, -1, 1), y: clamp(cmd.climb * 2 - s.plane.pitch * 2, -1, 1), boost: false, brake: cmd.brake };
    });
    const crashes = events.filter((e) => e.kind === 'crash').map((e) => e.what);
    assert.equal(sess.phase, 'finished', `nådde port ${sess.nextGate + 1}, krascher: ${crashes.join(', ')}`);
    assert.equal(sess.crashes, 0, 'krascher: ' + crashes.join(', '));
    assert.equal(sess.misses, 0, 'missade: ' + sess.misses);
    console.log(`     tid: ${sess.time.toFixed(1)} s, stjärnor ${sess.stars.size}`);
  });
}

test('testvärlden är en kanjon: väggar på båda sidor och alla portar på samma höjd', () => {
  assert.ok(test1.boxes.length >= 18, 'väggar: ' + test1.boxes.length);
  const ys = new Set(test1.gates.map((g) => g.y));
  assert.equal(ys.size, 1);
  // går man rakt åt sidan från varje port ska man träffa en vägg inom 30 m, åt båda hållen
  for (const g of test1.gates) {
    const n = forward(g.yaw);
    for (const sgn of [-1, 1]) {
      const side = [n[2] * sgn, 0, -n[0] * sgn];
      let hit = null;
      for (let d = 0; d <= 30 && !hit; d += 0.5) hit = checkCollision(test1, g.x + side[0] * d, g.y, g.z + side[2] * d, 0.5);
      assert.ok(hit === 'a tree' || hit === 'a rock', `port ${g.idx + 1}: ingen trädvägg åt sidan (${hit})`);
    }
  }
});

test('höjden ändras långsamt: full spak upp i 2 s ger högst ~25 m', () => {
  const sess = new FlightSession(test1);
  sess.begin();
  for (let i = 0; i < 60 * 3.1; i++) sess.step({ x: 0, y: 0 });
  const y0 = sess.plane.y;
  for (let i = 0; i < 120; i++) sess.step({ x: 0, y: 1 });
  assert.ok(sess.plane.y - y0 < 25, 'steg ' + (sess.plane.y - y0).toFixed(1) + ' m');
  assert.ok(sess.plane.pitch <= 0.3 + 1e-9);
});

test('navigatör solo: AI-piloten kan guidas genom kanjonen med bara ← / →', () => {
  const events = [];
  const ai = new LocalAIPilot(test1, { onState: () => {}, onEvent: (e) => events.push(e) });
  ai.handle({ t: 'go' });
  // "navigatören" tittar på radarn och håller inne vänster/höger vid behov
  for (let i = 0; i < 60 * 240 && ai.session.phase !== 'finished'; i++) {
    const S = ai.session;
    if (S.phase === 'fly') {
      const p = S.plane, T = pursuitTarget(test1, S, 40);
      const err = wrap(Math.atan2(-(T.x - p.x), -(T.z - p.z)) - p.yaw);
      const want = -err * 3.5 + p.yawRate * 0.9;
      if (want < -0.15) { if (!ai.held.left) ai.press('left'); ai.releaseDir('right'); }
      else if (want > 0.15) { if (!ai.held.right) ai.press('right'); ai.releaseDir('left'); }
      else { ai.releaseDir('left'); ai.releaseDir('right'); }
      ai.setBrake(Math.abs(err) > 0.45);   // bromsa före skarpa svängar (Shift)
    }
    ai.frame(1 / 60);
  }
  const crashes = events.filter((e) => e.kind === 'crash').map((e) => e.what);
  assert.equal(ai.session.phase, 'finished', `nådde port ${ai.session.nextGate + 1}, krascher: ${crashes.join(', ')}`);
  assert.equal(ai.session.crashes, 0, 'krascher: ' + crashes.join(', '));
  console.log(`     poäng: ${ai.session.points}, tid: ${ai.session.time.toFixed(1)} s`);
});

test('ringarna går att flyga igenom (även nära kanten)', () => {
  for (const g of demo.gates) {
    // punkt precis på ringens rör ska inte räknas som krasch
    const n = forward(g.yaw);
    const side = [n[2], 0, -n[0]];
    const x = g.x + side[0] * g.r, z = g.z + side[2] * g.r;
    const hit = checkCollision({ ...demo, trees: [], rocks: [], boxes: [], _grid: null }, x, g.y, z);
    assert.equal(hit, null, 'port ' + (g.idx + 1) + ' gav ' + hit);
  }
});

test('stjärnor ger bonus och räknas en gång', () => {
  const events = [];
  const sess = new FlightSession(test1, (e) => events.push(e));
  sess.begin();
  for (let i = 0; i < 60 * 6; i++) sess.step({ x: 0, y: 0 });
  const st = test1.stars[test1.stars.length - 1];
  assert.ok(!sess.stars.has(st.idx));
  const before = sess.stars.size;
  // placera planet strax före stjärnan och flyg igenom den
  Object.assign(sess.plane, { x: st.x, y: st.y, z: st.z + 10, yaw: 0, pitch: 0, roll: 0, rollRate: 0, pitchRate: 0 });
  sess.grace = 1;
  for (let i = 0; i < 40; i++) sess.step({ x: 0, y: 0 });
  assert.ok(sess.stars.has(st.idx), 'stjärnan samlades inte');
  assert.equal(events.filter((e) => e.kind === 'star' && e.idx === st.idx).length, 1);
  assert.equal(sess.stars.size, before + 1);
  // stjärnan gav poäng, tiden påverkas inte
  assert.ok(events.some((e) => e.kind === 'star' && e.idx === st.idx && e.points === POINTS.star));
  assert.ok(Math.abs(sess.time - (sess.flightTime + sess.penalty)) < 1e-9);
});

test('krasch: man börjar om från starten (portar, stjärnor och tid nollställs)', () => {
  const events = [];
  const sess = new FlightSession(test1, (e) => events.push(e));
  sess.begin();
  // flyg rakt ett tag (passerar port 1 och en stjärna), dyk sedan i marken
  for (let i = 0; i < 60 * 7; i++) sess.step({ x: 0, y: 0 });
  assert.ok(sess.nextGate >= 1, 'passerade ingen port');
  for (let i = 0; i < 60 * 8 && sess.phase !== 'crashed'; i++) sess.step({ x: 0, y: -1 });
  assert.equal(sess.phase, 'crashed');
  assert.equal(sess.crashes, 1);
  for (let i = 0; i < 60 * 2.2; i++) sess.step({ x: 0, y: 0 });
  assert.equal(sess.phase, 'fly');
  assert.ok(events.some((e) => e.kind === 'respawn' && e.full));
  assert.equal(sess.nextGate, 0);
  assert.equal(sess.stars.size, 0);
  assert.equal(sess.points, 0);
  assert.ok(sess.flightTime < 0.2, 'tiden nollställdes inte: ' + sess.flightTime);
  const p = sess.plane, s0 = test1.start;
  assert.ok(Math.hypot(p.x - s0.x, p.z - s0.z) < 10, 'inte vid starten');
  assert.equal(sess.crashes, 1, 'antalet krascher ska finnas kvar');
});

test('ringar ger poäng, mer för "perfect" mitt i ringen', () => {
  const g = test1.gates[0];
  const n = forward(g.yaw);
  const side = [n[2], 0, -n[0]];
  const run = (off) => {
    const events = [];
    const sess = new FlightSession(test1, (e) => events.push(e));
    sess.phase = 'fly';
    Object.assign(sess.plane, { x: g.x - n[0] * 20 + side[0] * off, y: g.y, z: g.z - n[2] * 20 + side[2] * off, yaw: g.yaw, pitch: 0, roll: 0, rollRate: 0, pitchRate: 0 });
    sess.grace = 5;
    for (let i = 0; i < 40; i++) sess.step({ x: 0, y: 0 });
    return events.find((e) => e.kind === 'pass');
  };
  const center = run(0), edge = run(g.r * 0.75);
  assert.ok(center && center.perfect && center.bonus === POINTS.perfect, 'mitten: ' + JSON.stringify(center));
  assert.ok(edge && !edge.perfect && edge.bonus === POINTS.gate, 'kanten: ' + JSON.stringify(edge));
  assert.ok(POINTS.perfect > POINTS.gate && POINTS.gate > POINTS.star);
});

test('passera utanför ringen = missad port', () => {
  const g = demo.gates[0];
  const n = forward(g.yaw);
  const side = [n[2], 0, -n[0]];
  const off = 16;
  const p0 = [g.x - n[0] + side[0] * off, g.y, g.z - n[2] + side[2] * off];
  const p1 = [g.x + n[0] + side[0] * off, g.y, g.z + n[2] + side[2] * off];
  assert.equal(gateCrossing(g, p0, p1), 'miss');
  assert.equal(gateCrossing(g, [g.x - n[0], g.y, g.z - n[2]], [g.x + n[0], g.y, g.z + n[2]]), 'pass');
  assert.equal(gateCrossing(g, [g.x + n[0], g.y, g.z + n[2]], [g.x - n[0], g.y, g.z - n[2]]), null);
});

if (failures) { console.log(`\n${failures} test misslyckades`); process.exit(1); }
console.log('\nAlla test gick igenom');
