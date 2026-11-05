// Kör: node tests/rig.test.mjs
// Kontrollerar modellerna, IK och att figurernas händer sitter på ratten.
import assert from 'node:assert/strict';
import * as THREE from '../js/lib/three.module.min.js';
import { buildPlane, buildCockpit } from '../js/models.js';
import { solveIK, Spring3 } from '../js/avatar.js';
import { PlaneRig } from '../js/rig.js';

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

test('flygplanet har alla namngivna delar', () => {
  const p = buildPlane();
  for (const n of ['flygkropp', 'vindruta_v', 'vindruta_h', 'vinge_h', 'vinge_v', 'stabilisator_h', 'fena', 'fenspets', 'motor_h', 'motor_v', 'propeller_h', 'propeller_v', 'dorr', 'vingspets_h']) {
    assert.ok(p.getObjectByName(n), 'saknar ' + n);
  }
  const box = new THREE.Box3().setFromObject(p);
  assert.ok(Math.abs(box.max.x - 6.12) < 0.1 && Math.abs(box.min.x + 6.3) < 0.15, 'längd ' + box.min.x + '..' + box.max.x);
  assert.ok(box.max.z > 6.6 && box.min.z < -6.6, 'vingbredd');
});

test('cockpiten har alla namngivna delar', () => {
  const c = buildCockpit();
  for (const n of ['golv', 'instrumentpanel', 'radar_pilot', 'horisont', 'hastighet', 'kompass', 'hojdmatare', 'varvtal', 'bransle', 'ratt_pilot', 'ratt_andrepilot', 'mittkonsol', 'gasreglage_0', 'stol_pilot', 'stol_andrepilot', 'takpanel', 'vindruta_0', 'auto_knapp', 'varningslampa']) {
    assert.ok(c.getObjectByName(n), 'saknar ' + n);
  }
});

test('IK behåller benlängderna och når målet', () => {
  const root = new THREE.Vector3(0, 1, 0), target = new THREE.Vector3(0.3, 0.6, -0.5);
  const mid = new THREE.Vector3(), end = new THREE.Vector3();
  solveIK(root, target, 0.45, 0.43, new THREE.Vector3(1, -1, 0), mid, end);
  assert.ok(Math.abs(root.distanceTo(mid) - 0.45) < 1e-6);
  assert.ok(Math.abs(mid.distanceTo(end) - 0.43) < 1e-6);
  assert.ok(end.distanceTo(target) < 1e-6);
});

test('fjädern är stabil även vid stora tidssteg', () => {
  const s = new Spring3(400, 0.5);
  const t = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 50; i++) s.update(t, 0.1);
  assert.ok(Math.abs(s.p.x - 1) < 0.01, 'x=' + s.p.x);
});

test('pilotens händer sitter på ratten och följer den', () => {
  const rig = new PlaneRig('pilot');
  const st = { x: 0, y: 30, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 44, ix: 0.8, iy: 0.5, throttle: 0, accLong: 0, loadN: 1, rollAcc: 0, phase: 'fly' };
  for (let i = 0; i < 120; i++) rig.update(1 / 60, st);
  const yoke = rig.cockpit.getObjectByName('ratt_pilot');
  for (const [k, side] of [[0, -0.15], [1, 0.15]]) {
    const grip = rig._toCockpit(yoke, new THREE.Vector3(side, 0.08, 0));
    const hand = rig.pilot.arms[k].hand.position;
    assert.ok(hand.distanceTo(grip) < 0.09, `hand ${k} är ${hand.distanceTo(grip).toFixed(3)} m från greppet`);
  }
  assert.ok(yoke.rotation.z < -0.4, 'ratten vreds inte');
  // gasreglage: höger hand flyttar dit
  st.throttle = 1;
  for (let i = 0; i < 60; i++) rig.update(1 / 60, st);
  const knob = rig._toCockpit(rig.levers[1].knob);
  assert.ok(rig.pilot.arms[1].hand.position.distanceTo(knob) < 0.12, 'handen nådde inte gasen');
});

test('andrepiloten pekar vid gest', () => {
  const rig = new PlaneRig('pilot');
  const st = { x: 0, y: 30, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 44, ix: 0, iy: 0, throttle: 0, accLong: 0, loadN: 1, rollAcc: 0, phase: 'fly' };
  rig.gesture('left');
  for (let i = 0; i < 40; i++) rig.update(1 / 60, st);
  assert.ok(rig.copilot.arms[0].finger.visible, 'pekfingret syns inte');
  assert.ok(rig.copilot.arms[0].hand.position.z < -0.2, 'armen pekar inte framåt');
});

if (failures) { console.log(`\n${failures} test misslyckades`); process.exit(1); }
console.log('\nAlla test gick igenom');
