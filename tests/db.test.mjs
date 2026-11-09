// Testar databasen (supabase/schema.sql) mot en lokal Postgres med en förenklad kopia av Supabases auth.
// Kör: PD_PG="-h /var/tmp/pdtest -p 55432 -U postgres" node tests/db.test.mjs
// Utan PD_PG hoppas testet över (det kräver en Postgres-server).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { calcReward, levelInfo, xpForLevel } from '../js/progress.js';
import { SKINS } from '../js/skins.js';

const conn = process.env.PD_PG;
if (!conn) { console.log('PD_PG saknas – databastestet hoppas över'); process.exit(0); }
const base = conn.split(/\s+/).filter(Boolean);
const DB = 'pd_test';

function psql(sql, db = DB, { raw = false } = {}) {
  const out = execFileSync('psql', [...base, '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return raw ? out : out.trim();
}
function psqlFile(file) {
  execFileSync('psql', [...base, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
// kör SQL som en inloggad spelare (eller anonym om uid är null)
function as(uid, sql) {
  const who = uid ? `set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);` : 'set local role anon;';
  const out = psql(`begin; ${who} ${sql}; commit;`).split('\n');
  return out[out.length - 1];
}
function fails(uid, sql) {
  try { as(uid, sql); } catch (e) { return String(e.stderr || e.message); }
  return null;
}
const json = (uid, sql) => JSON.parse(as(uid, `select ${sql}`));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e.stderr || e.message)); }
}

// ------------------------------------------------------------ ny databas med auth-stub
psql(`drop database if exists ${DB}`, 'postgres');
psql(`create database ${DB}`, 'postgres');
psql(`
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- som i Supabase: nya tabeller och funktioner får fulla rättigheter som standard
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;`);
psqlFile('supabase/schema.sql');
psqlFile('supabase/schema.sql');      // ska gå att köra flera gånger

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
psql(`insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com')`);
const resetCooldown = (uid) => psql(`update public.profiles set last_award_at = null where id = '${uid}'`);
const mapRow = (id) => { const [tier, stars, max] = psql(`select tier, stars, max_score from public.maps where id = '${id}'`).split('|').map(Number); return { tier, stars, max }; };

test('profilen skapas vid första anropet, med standardskinet', () => {
  const p = json(A, `public.get_profile('Ace')`);
  assert.equal(p.display_name, 'Ace');
  assert.equal(p.xp, 0); assert.equal(p.coins, 0); assert.equal(p.level, 1);
  assert.deepEqual(p.owned_skins, ['classic']);
  assert.equal(p.equipped_skin, 'classic');
});

test('spelaren kan inte ändra XP, mynt eller skins direkt', () => {
  assert.ok(fails(A, `update public.profiles set xp = 99999 where id = '${A}'`));
  assert.ok(fails(A, `insert into public.clears (user_id, map_id) values ('${A}', 'm3')`));
  assert.ok(fails(A, `update public.skins set price = 0`));
});

test('man ser bara sin egen profil', () => {
  json(B, `public.get_profile('Bee')`);
  assert.equal(as(A, `select count(*) from public.profiles`), '1');
  assert.equal(as(A, `select display_name from public.profiles`), 'Ace');
});

test('utan inloggning går inget att anropa', () => {
  assert.ok(fails(null, `select public.award_flight('m3', 1000, 3, false)`));
  assert.ok(fails(null, `select public.buy_skin('sky')`));
  assert.ok(fails(null, `select public.get_profile(null)`));
  assert.ok(fails(A, `select public.pd_grant_free_skins('${B}')`));     // interna funktioner är stängda
  assert.ok(fails(A, `select public.pd_profile_json('${B}')`));
  assert.ok(fails(null, `select * from public.profiles`) || as(null, 'select count(*) from public.profiles') === '0');
});

test('belöningen räknas exakt som i spelet (första gången, co-op)', () => {
  const m = mapRow('m9');
  const r = json(A, `public.award_flight('m9', 5200, 12, true)`);
  const js = calcReward({ tier: m.tier, score: 5200, maxScore: m.max, stars: 12, prevRuns: 0, prevBest: null, coop: true });
  assert.equal(r.xp, js.xp); assert.equal(r.coins, js.coins); assert.equal(r.rank, js.rank);
  assert.equal(r.profile.xp, js.xp); assert.equal(r.profile.coins, js.coins);
});

test('omspel ger mindre, och nytt bättre betyg ger bonus', () => {
  const m = mapRow('m9');
  let prevRuns = 1, prevBest = calcReward({ tier: m.tier, score: 5200, maxScore: m.max, stars: 12 }).rank;
  for (const score of [5000, Math.round(m.max * 0.9), 4000, 4000, 4000]) {
    resetCooldown(A);
    const r = json(A, `public.award_flight('m9', ${score}, 10, false)`);
    const js = calcReward({ tier: m.tier, score, maxScore: m.max, stars: 10, prevRuns, prevBest });
    assert.equal(r.xp, js.xp, `omspel ${prevRuns}`);
    assert.equal(r.coins, js.coins);
    if (['D', 'C', 'B', 'A', 'S'].indexOf(js.rank) > ['D', 'C', 'B', 'A', 'S'].indexOf(prevBest)) prevBest = js.rank;
    prevRuns++;
  }
  const c = JSON.parse(as(A, `select row_to_json(c) from public.clears c where map_id = 'm9'`));
  assert.equal(c.runs, 6); assert.equal(c.best_rank, 'S');
});

test('fuskskydd: orimliga poäng, stjärnor, okänd bana och för täta anrop avvisas', () => {
  resetCooldown(A);
  assert.match(fails(A, `select public.award_flight('m3', 999999, 3, false)`), /invalid_score/);
  assert.match(fails(A, `select public.award_flight('m3', 1000, 999, false)`), /invalid_stars/);
  assert.match(fails(A, `select public.award_flight('nope', 1000, 1, false)`), /unknown_map/);
  json(A, `public.award_flight('m3', 1000, 1, false)`);
  assert.match(fails(A, `select public.award_flight('m3', 1000, 1, false)`), /too_soon/);
});

test('level räknas likadant i databasen och i spelet', () => {
  for (const xp of [0, 99, 100, 239, 240, 1539, 1540, 9999, 51939, 51940, 999999]) {
    assert.equal(Number(psql(`select public.pd_level(${xp})`)), levelInfo(xp).level, `xp ${xp}`);
  }
});

test('shop: level-krav, pris, köp och utrustning', () => {
  const sk = SKINS.find((x) => x.level === 3 && x.price > 0);          // ett Common-skin på level 3
  const B0 = json(B, `public.get_profile(null)`);
  assert.equal(B0.level, 1);
  assert.match(fails(B, `select public.buy_skin('${sk.id}')`), /level_too_low/);
  psql(`update public.profiles set xp = ${xpForLevel(3)}, coins = ${sk.price - 1} where id = '${B}'`);
  assert.match(fails(B, `select public.buy_skin('${sk.id}')`), /not_enough_coins/);
  assert.match(fails(B, `select public.equip_skin('${sk.id}')`), /not_owned/);
  psql(`update public.profiles set coins = ${sk.price + 100} where id = '${B}'`);
  const p = json(B, `public.buy_skin('${sk.id}')`);
  assert.equal(p.coins, 100);
  assert.ok(p.owned_skins.includes(sk.id));
  const p2 = json(B, `public.buy_skin('${sk.id}')`);       // ett andra köp kostar inget
  assert.equal(p2.coins, 100);
  assert.equal(json(B, `public.equip_skin('${sk.id}')`).equipped_skin, sk.id);
  assert.match(fails(B, `select public.buy_skin('nope')`), /unknown_skin/);
  // Ultra-skin kräver hög level
  const ultra = SKINS.find((x) => x.rarity === 'ultra');
  assert.match(fails(B, `select public.buy_skin('${ultra.id}')`), /level_too_low/);
});

test('alla skins i spelet finns i databasen med samma pris och level', () => {
  for (const s of SKINS) assert.equal(psql(`select price || '/' || min_level from public.skins where id = '${s.id}'`), `${s.price}/${s.level}`, s.id);
});

test('gratis skins (pris 0) delas ut när man når leveln', () => {
  psql(`insert into public.skins values ('test_free5', 0, 5), ('test_free40', 0, 40)`);
  psql(`update public.profiles set xp = ${xpForLevel(12)} where id = '${B}'`);
  const p = json(B, `public.get_profile(null)`);
  assert.ok(p.owned_skins.includes('test_free5'));
  assert.ok(!p.owned_skins.includes('test_free40'));
});

test('nya skins i en belöning när man går upp i level', () => {
  psql(`update public.profiles set xp = ${xpForLevel(5) - 1}, last_award_at = null, owned_skins = array['classic'] where id = '${A}'`);
  const r = json(A, `public.award_flight('m4', 3000, 5, false)`);
  assert.ok(r.level_after >= 5 && r.level_before === 4);
  assert.ok(r.new_skins.includes('test_free5'));
});

test('borttagna skins betalas tillbaka när databasfilen körs igen', () => {
  psql(`insert into public.skins values ('old_skin', 150, 1)`);
  psql(`update public.profiles set coins = 10, owned_skins = array['classic', 'old_skin'], equipped_skin = 'old_skin' where id = '${B}'`);
  psqlFile('supabase/schema.sql');
  const p = json(B, `public.get_profile(null)`);
  assert.equal(p.coins, 160);
  assert.ok(!p.owned_skins.includes('old_skin'));
  assert.equal(p.equipped_skin, 'classic');
  assert.equal(psql(`select count(*) from public.skins where id = 'old_skin'`), '0');
  assert.equal(Number(psql(`select count(*) from public.skins`)), SKINS.length);
});

test('namnbyte (1–16 tecken)', () => {
  assert.equal(json(A, `public.set_display_name('  Captain Oscar  ')`).display_name, 'Captain Oscar');
  assert.match(fails(A, `select public.set_display_name('   ')`), /invalid_name/);
  assert.equal(json(A, `public.set_display_name('${'x'.repeat(30)}')`).display_name.length, 16);
});

psql(`drop database if exists ${DB}`, 'postgres');
if (failures) { console.log(`\n${failures} test misslyckades`); process.exit(1); }
console.log('\nAlla databastest gick igenom');
