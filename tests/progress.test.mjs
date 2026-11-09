// Kör: node tests/progress.test.mjs
// Level, XP, mynt och skins: reglerna är logiska och databasfilen är i takt med spelet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MAX_LEVEL, xpForLevel, xpToNext, levelInfo, calcReward, rankOf, maxScoreOf, TIER_XP } from '../js/progress.js';
import { SKINS, RARITY, DEFAULT_PARTS, partOf, skinById } from '../js/skins.js';
import { MAPS, buildLevel } from '../js/levels.js';

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

test('level-kurvan: varje level kräver lite mer XP än den förra', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 100);
  for (let L = 1; L < MAX_LEVEL; L++) {
    assert.equal(xpForLevel(L + 1) - xpForLevel(L), xpToNext(L));
    if (L > 1) assert.ok(xpToNext(L) > xpToNext(L - 1));
  }
  assert.equal(xpToNext(MAX_LEVEL), Infinity);
});

test('levelInfo stämmer vid gränserna', () => {
  assert.deepEqual([levelInfo(0).level, levelInfo(99).level, levelInfo(100).level, levelInfo(239).level, levelInfo(240).level], [1, 1, 2, 2, 3]);
  const top = levelInfo(10 ** 7);
  assert.equal(top.level, MAX_LEVEL); assert.equal(top.max, true); assert.equal(top.progress, 1);
  const mid = levelInfo(150);
  assert.equal(mid.into, 50); assert.equal(mid.need, 140); assert.equal(mid.left, 90);
});

// en "bra" första runda på varje bana (70 % av maxpoängen, 3/4 av stjärnorna)
const levels = MAPS.filter((m) => m.available).map((m) => ({ m, L: buildLevel(m.id) }));
const goodRun = ({ m, L }, prevRuns = 0, prevBest = null, coop = false) => {
  const max = maxScoreOf(L);
  return calcReward({ tier: m.tier, score: Math.round(max * 0.7), maxScore: max, stars: Math.round((L.stars || []).length * 0.75), prevRuns, prevBest, coop });
};

test('belöning: svårare banor ger mer, första gången ger mest, omspel ger mindre', () => {
  const first = levels.map((x) => goodRun(x).xp);
  assert.ok(first[19] > first[0] * 2.5, 'karta 20 ger klart mer än karta 1');
  const x = levels[8];
  const r0 = goodRun(x, 0), r1 = goodRun(x, 1, r0.rank), r4 = goodRun(x, 4, r0.rank), r9 = goodRun(x, 9, r0.rank);
  assert.ok(r0.xp > r1.xp && r1.xp > r4.xp && r4.xp === r9.xp && r9.xp > 0);
  assert.ok(goodRun(x, 1, r0.rank, true).xp > r1.xp, 'co-op ger bonus');
  assert.equal(r0.coins, Math.round(r0.xp / 2));
});

test('belöning: nytt bättre betyg ger bonus, bara en gång', () => {
  const x = levels[5], max = maxScoreOf(x.L);
  const a = calcReward({ tier: x.m.tier, score: Math.round(max * 0.9), maxScore: max, stars: 0, prevRuns: 3, prevBest: 'B' });
  const b = calcReward({ tier: x.m.tier, score: Math.round(max * 0.9), maxScore: max, stars: 0, prevRuns: 3, prevBest: 'S' });
  assert.equal(a.rank, 'S');
  assert.equal(a.xp - b.xp, 80);    // S (100) minus B (20)
});

test('ekonomi: alla banor en gång ger ungefär level 20, och shopen kräver omspel', () => {
  let xp = 0, coins = 0;
  levels.forEach((x) => { const r = goodRun(x); xp += r.xp; coins += r.coins; });
  const lvl = levelInfo(xp).level;
  assert.ok(lvl >= 15 && lvl <= 26, 'level efter alla banor: ' + lvl);
  const shopTotal = SKINS.reduce((a, s) => a + s.price, 0);
  assert.ok(shopTotal > coins, 'hela shopen kostar mer än en genomspelning ger');
  assert.ok(SKINS.filter((s) => s.price > 0 && s.price <= coins / 3).length >= 3, 'några skins går att köpa tidigt');
});

test('betyg: S/A/B/C/D vid rätt andel av maxpoängen', () => {
  assert.deepEqual([850, 849, 700, 550, 400, 399].map((s) => rankOf(s, 1000)), ['S', 'A', 'A', 'B', 'C', 'D']);
});

test('skins: unika id, giltiga färger, rimliga krav, standardskinet gratis', () => {
  const ids = new Set();
  for (const s of SKINS) {
    assert.ok(!ids.has(s.id), 'dubblett ' + s.id); ids.add(s.id);
    assert.ok(RARITY[s.rarity], s.id + ' sällsynthet');
    assert.ok(s.level >= 1 && s.level <= MAX_LEVEL && s.price >= 0);
    for (const [part, st] of Object.entries(s.parts)) {
      assert.ok(DEFAULT_PARTS[part], `${s.id}: okänd del ${part}`);
      assert.match(st.c || '#000000', /^#[0-9a-f]{6}$/i);
      if (st.e) assert.match(st.e, /^#[0-9a-f]{6}$/i);
    }
  }
  assert.equal(SKINS[0].id, 'classic'); assert.equal(SKINS[0].price, 0); assert.equal(SKINS[0].level, 1);
  assert.equal(skinById('nope').id, 'classic');
  for (let i = 1; i < SKINS.length; i++) assert.ok(SKINS[i].level >= SKINS[i - 1].level, 'listan är sorterad efter level');
});

test('skins: alla delar i planmodellen hittar rätt del', () => {
  assert.equal(partOf('flygkropp'), 'body'); assert.equal(partOf('vinge_h'), 'wings'); assert.equal(partOf('fena'), 'tail');
  assert.equal(partOf('motor_v'), 'engines'); assert.equal(partOf('motorring_h'), 'trim'); assert.equal(partOf('blad_h2'), 'props');
  assert.equal(partOf('vindruta_v'), null); assert.equal(partOf('fonster_h3'), null);
});

test('databasfilen (supabase/schema.sql) är i takt med spelet', () => {
  const tmp = path.join(os.tmpdir(), 'pd-schema-' + process.pid + '.sql');
  execFileSync('node', ['tools/gen-sql.mjs', tmp], { stdio: 'ignore' });
  const fresh = fs.readFileSync(tmp, 'utf8');
  fs.unlinkSync(tmp);
  assert.equal(fs.readFileSync('supabase/schema.sql', 'utf8'), fresh, 'kör: node tools/gen-sql.mjs');
});

if (failures) { console.log(`\n${failures} test misslyckades`); process.exit(1); }
console.log('\nAlla test gick igenom');
